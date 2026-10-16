import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { StrategyCipher } from "./crypto";
import { ArenaMediaApi, within, type MediaReference } from "./mediaApi";
import type { LiveFrozenInput } from "./input";
import type { SavedAdjudication } from "./adjudication";

/** Publication changes retained bytes and provider balances. Invalidate admission
 * capacity atomically; a concurrent stale measurement must not reopen intake. */
export async function markArenaMediaReady(
  pool: Pool,
  deployment: string,
  id: string,
  filmSha256: string
) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `arena/capacity/${deployment}`
    ]);
    const updated = await db.query(
      "UPDATE yunipals_arena.media_job SET state='ready',detail=NULL,film_sha256=$3,updated_at=clock_timestamp() WHERE deployment=$1 AND tournament_id=$2 AND state<>'ready'",
      [deployment, id, filmSha256]
    );
    if (updated.rowCount)
      await db.query(
        "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
        [deployment]
      );
  });
}

const hashBytes = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function mediaFolder(storage: string, deployment: string, id: string) {
  if (!/^[1-9][0-9]{0,77}$/.test(id))
    throw new Error("Invalid media tournament ID.");
  return resolve(storage, sha256(deployment), id);
}

export function offlineMediaTool(repository: string) {
  return (
    operation: "compile" | "extract" | "assemble",
    job: string,
    match?: string
  ): Promise<void> =>
    new Promise((accept, reject) => {
      const child = spawn(
        "python3",
        [
          join(repository, "scripts/arena/media_tools.py"),
          operation,
          "--job",
          job,
          ...(match ? ["--match", match] : [])
        ],
        {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 180000,
          // Python receives neither provider keys nor transaction-signing keys.
          env: {
            PATH: "/usr/local/bin:/usr/bin:/bin",
            PYTHONDONTWRITEBYTECODE: "1"
          }
        }
      );
      child.on("error", () => reject(new Error("Media tool could not start.")));
      child.on("close", (code) =>
        code === 0
          ? accept()
          : reject(
              new Error("Offline media step failed; existing assets retained.")
            )
      );
    });
}

async function immutableJson(path: string, value: unknown) {
  try {
    if (
      canonicalJson(JSON.parse(await readFile(path, "utf8"))) !==
      canonicalJson(value)
    )
      throw new Error("Saved media input is immutable.");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Caller holds the per-job session lock. A crash leaves only an unserved temp file.
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600
  });
  await rename(path + ".tmp", path);
}

async function immutableBytes(path: string, bytes: Buffer) {
  try {
    if (hashBytes(await readFile(path)) !== hashBytes(bytes))
      throw new Error("Saved media reference is immutable.");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path + ".tmp", bytes, { mode: 0o600 });
  await rename(path + ".tmp", path);
}

export class ArenaMedia {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: StrategyCipher,
    private readonly api: ArenaMediaApi,
    private readonly repository: string,
    private readonly storage: string,
    private readonly offline = offlineMediaTool(repository)
  ) {}

  async step(deployment: string, id: string) {
    // Session lock spans filesystem/provider work, without holding a DB transaction.
    const lock = await this.pool.connect();
    const lockName = `arena/media/${deployment}/${id}`;
    try {
      const held = (
        await lock.query<{ held: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS held",
          [lockName]
        )
      ).rows[0]!.held;
      if (!held) return { state: "busy" };
      const row = (
        await lock.query<SavedAdjudication & { ciphertext: string }>(
          `SELECT a.*,f.ciphertext FROM yunipals_arena.adjudication a
         JOIN yunipals_arena.frozen_input f ON f.deployment=a.deployment AND f.tournament_id=a.tournament_id
         JOIN yunipals_arena.tournament t ON t.deployment=a.deployment AND t.id=a.tournament_id
         WHERE a.deployment=$1 AND a.tournament_id=$2 AND a.state='valid' AND f.revealed_at IS NOT NULL
           AND t.state->>'phase'='settled' AND t.state->>'resultHash'=a.outcome_hash AND t.state->>'inputHash'=a.input_hash AND f.input_hash=a.input_hash`,
          [deployment, id]
        )
      ).rows[0];
      if (!row)
        throw new Error(
          "Media requires confirmed settlement and its exact revealed input."
        );
      const { input } = this.cipher.open<{ input: LiveFrozenInput }>(
        `${deployment}/${id}/input`,
        row.ciphertext
      );
      if (
        input.mode !== "base-mainnet" ||
        `0x${sha256(canonicalJson(input))}` !== row.input_hash ||
        `0x${sha256(canonicalJson(row.candidate))}` !== row.outcome_hash
      )
        throw new Error("Media input/result checksum mismatch.");
      await lock.query(
        "INSERT INTO yunipals_arena.media_job(deployment,tournament_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [deployment, id]
      );
      const job = mediaFolder(this.storage, deployment, id);
      await mkdir(join(job, "public"), { recursive: true, mode: 0o700 });
      await mkdir(join(job, "references"), { recursive: true, mode: 0o700 });
      await immutableJson(join(job, "public/input.json"), {
        inputSha256: row.input_hash.slice(2),
        input
      });
      await immutableJson(join(job, "public/outcome.json"), {
        inputSha256: row.input_hash.slice(2),
        outcomeSha256: row.outcome_hash.slice(2),
        outcome: row.candidate,
        validation: row.validation
      });
      const refs = new Map<string, MediaReference>();
      for (const f of input.roster) {
        if (!/^[0-9a-f]{64}$/.test(f.imageSha256))
          throw new Error("Missing verified fighter artwork.");
        const source = join(
          this.repository,
          "docs/arena/identity-registry-v1/references",
          f.imageSha256 + ".img"
        );
        const reviewed =
          input.roster.find((r) => r.id === f.id)?.identityVersion ===
          "reviewed-artwork-v1";
        const bytes = reviewed
          ? await readFile(source)
          : (
              await this.pool.query<{ artwork: Buffer }>(
                `SELECT artwork FROM yunipals_arena.identity_job WHERE deployment=$1 AND state='ready'
           AND profile->>'imageSha256'=$2 LIMIT 1`,
                [deployment, f.imageSha256]
              )
            ).rows[0]?.artwork;
        if (!bytes) throw new Error("Verified fighter artwork is missing.");
        if (hashBytes(bytes) !== f.imageSha256)
          throw new Error("Fighter artwork changed.");
        const file = `references/${f.imageSha256}.img`;
        await immutableBytes(join(job, file), bytes);
        refs.set(f.id, { file, sha256: f.imageSha256 });
      }
      const islandPath = join(
        this.repository,
        "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public/images",
        input.island.tokenId + ".png"
      );
      if (!/^[1-9][0-9]{0,4}$/.test(input.island.tokenId))
        throw new Error("Invalid island reference.");
      const island = await readFile(islandPath),
        islandRef = {
          file: "references/island.png",
          sha256: hashBytes(island)
        };
      const metadata = JSON.parse(
        await readFile(
          islandPath
            .replace("/images/", "/metadata/")
            .replace(/\.png$/, ".json"),
          "utf8"
        )
      );
      if (metadata.properties?.image_sha256 !== islandRef.sha256)
        throw new Error("Island artwork differs from its published checksum.");
      await immutableBytes(join(job, islandRef.file), island);
      await immutableJson(join(job, "reference-lock.json"), {
        fighters: [...refs],
        island: islandRef
      });
      await this.offline("compile", job);
      const matches = (
        row.candidate as {
          matches: Array<{ id: string; fighterIds: string[] }>;
        }
      ).matches;
      for (const match of matches) {
        if (!["SF1", "SF2", "FINAL"].includes(match.id))
          throw new Error("Invalid match ID.");
        const scene = join(job, "scenes", match.id);
        const request = {
          kind: "image" as const,
          prompt: (
            await readFile(join(scene, "frame-prompt.txt"), "utf8")
          ).trim(),
          references: [
            ...match.fighterIds.map((fid) => refs.get(fid)!),
            islandRef
          ]
        };
        if (request.references.some((r) => !r))
          throw new Error("Missing match reference.");
        await this.api.reserve(deployment, id, `${match.id}/image`, request);
        const image = await this.api.step(
          deployment,
          id,
          `${match.id}/image`,
          job
        );
        if (image.state !== "completed")
          return this.progress(
            deployment,
            id,
            image.state === "failed" ? "needs-attention" : "images",
            `${match.id}/image`
          );
        if (!image.response?.local)
          throw new Error("Completed image is missing its receipt.");
        await this.verifyAsset(job, image.response.local);
        for (const part of ["opening", "continuation"] as const) {
          if (part === "continuation")
            await this.offline("extract", job, match.id);
          const file =
            part === "opening"
              ? image.response.local.file
              : `scenes/${match.id}/continuation-frame.png`;
          const frame = await readFile(await within(job, file));
          const videoRequest = {
            kind: "video" as const,
            prompt: (
              await readFile(join(scene, `${part}-prompt.txt`), "utf8")
            ).trim(),
            references: [{ file, sha256: hashBytes(frame) }],
            duration: (part === "opening" ? 3 : 5) as 3 | 5
          };
          const asset = `${match.id}/${part}`;
          await this.api.reserve(deployment, id, asset, videoRequest);
          const clip = await this.api.step(deployment, id, asset, job);
          if (clip.state !== "completed")
            return this.progress(
              deployment,
              id,
              clip.state === "failed" ? "needs-attention" : "videos",
              asset
            );
          if (!clip.response?.local)
            throw new Error("Completed video is missing its receipt.");
          await this.verifyAsset(job, clip.response.local);
        }
      }
      await this.progress(deployment, id, "assembling", null);
      await this.offline("assemble", job);
      const receipt = JSON.parse(
        await readFile(join(job, "public/film.json"), "utf8")
      ) as { sha256: string; outcomeSha256: string };
      if (receipt.outcomeSha256 !== row.outcome_hash.slice(2))
        throw new Error("Film result changed.");
      await this.verifyAsset(job, {
        file: "public/film.mp4",
        sha256: receipt.sha256
      });
      const tasks = await this.pool.query<{
        asset: string;
        request_id: string;
        reserved_microusd: string;
        actual_microusd: string | null;
        state: string;
      }>(
        "SELECT asset,request_id,reserved_microusd,actual_microusd,state FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND kind='media' ORDER BY asset",
        [deployment, id]
      );
      await writeFile(
        join(job, "public/receipts.json"),
        JSON.stringify(tasks.rows, null, 2) + "\n",
        { mode: 0o600 }
      );
      // Publication copies an explicit allowlist; private job files are never served.
      const destination = mediaFolder(
        join(this.storage, "published"),
        deployment,
        id
      );
      await mkdir(destination, { recursive: true, mode: 0o755 });
      for (const file of [
        "film.mp4",
        "native-sfx.mp4",
        "film.json",
        "input.json",
        "outcome.json",
        "prompts.json",
        "receipts.json",
        "credits.txt",
        "SF1.png",
        "SF2.png",
        "FINAL.png",
        "media-policy.json"
      ]) {
        await copyFile(
          join(job, "public", file),
          join(destination, file + ".tmp")
        );
        await rename(join(destination, file + ".tmp"), join(destination, file));
      }
      await markArenaMediaReady(this.pool, deployment, id, receipt.sha256);
      return { state: "ready" };
    } finally {
      try {
        await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
      } finally {
        lock.release();
      }
    }
  }

  private async verifyAsset(root: string, ref: MediaReference) {
    if (hashBytes(await readFile(await within(root, ref.file))) !== ref.sha256)
      throw new Error("Saved media asset checksum mismatch.");
  }
  private async progress(
    deployment: string,
    id: string,
    state: string,
    detail: string | null
  ) {
    await this.pool.query(
      "UPDATE yunipals_arena.media_job SET state=$3,detail=$4,updated_at=now() WHERE deployment=$1 AND tournament_id=$2",
      [deployment, id, state, detail]
    );
    return { state, detail };
  }
}

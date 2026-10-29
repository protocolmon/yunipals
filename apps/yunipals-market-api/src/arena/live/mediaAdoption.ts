import { parseArenaDeployment } from "@protopals/yunipals-market-core/arenaProtocol";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { PublicClient, Address } from "viem";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import {
  verifyNativeArenaAction,
  type NativeArenaActionObservation
} from "./nativeAction";
import type { NativeArenaSource } from "./nativeSource";
import type { NativeProviderProof } from "./nativeProvider";
import { mediaFolder } from "./mediaPaths";
import { arenaMediaMigration } from "./mediaSchema";
import {
  buildMediaPublication,
  mediaFileProof,
  recordMediaPublication,
  verifyPublicationFile
} from "./mediaPublication";

type Queryable = Pick<PoolClient, "query">;
type LegacyTask = {
  asset: string;
  request_id: string;
  state: string;
  request: unknown;
  response: { local?: { file?: string; sha256?: string } } | null;
  reserved_microusd: string;
  actual_microusd: string | null;
};
const assets = ["SF1", "SF2", "FINAL"]
  .flatMap((match) =>
    ["image", "opening", "continuation"].map((kind) => `${match}/${kind}`)
  )
  .sort();
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** No signer or provider. Check the saved publication hash at a fresh canonical
 * head as well as the native event/phase/input witness. */
export async function verifyNativeArenaFilm(
  client: PublicClient,
  observed: NativeArenaActionObservation
) {
  await verifyNativeArenaAction(client, observed);
  const head = await client.getBlock({ blockTag: "latest" });
  if (
    !head.hash ||
    head.number < BigInt(observed.tournament.last.blockNumber) ||
    Math.abs(Number(head.timestamp) * 1000 - Date.now()) > 120000
  )
    throw new Error("Arena publication head is unavailable.");
  const film = await client.readContract({
    address: parseArenaDeployment(observed.tournament.deployment).contract,
    abi: arenaAbi,
    functionName: "publishedVideoHash",
    args: [BigInt(observed.tournament.id)],
    blockNumber: head.number
  });
  if (
    film.toLowerCase() !==
      (observed.tournament.state.videoHash ?? `0x${"0".repeat(64)}`) ||
    (await client.getBlock({ blockNumber: head.number })).hash !== head.hash
  )
    throw new Error("Arena publication hash changed.");
}

/** Explicit migration only. Verifies the existing legacy folders and tasks;
 * never decrypts secrets, edits media, buys inference, or changes source mode. */
export class ArenaMediaAdoption {
  constructor(
    readonly pool: Pool,
    readonly source: Pick<NativeArenaSource, "read">,
    readonly deployment: string,
    readonly storage: string,
    readonly verify: (observed: NativeArenaActionObservation) => Promise<void>
  ) {
    parseArenaDeployment(deployment);
  }
  private async fence(db: Queryable) {
    const marker = (
      await db.query<{ checksum: string }>(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [arenaMediaMigration.version]
      )
    ).rows[0];
    if (marker?.checksum !== arenaMediaMigration.checksum)
      throw new Error("Arena publication migration is required.");
    const row = (
      await db.query<{ halted: boolean; indexer_mode: string }>(
        "SELECT halted,indexer_mode FROM yunipals_arena.deployment WHERE id=$1 FOR SHARE",
        [this.deployment]
      )
    ).rows[0];
    if (!row?.halted || row.indexer_mode !== "unified")
      throw new Error("Media adoption requires a halted native deployment.");
  }
  private async observe(id: string, incarnation: string) {
    const observed = await this.source.read(id),
      t = observed.tournament;
    if (
      !t ||
      t.deployment !== this.deployment ||
      t.id !== id ||
      t.incarnation !== incarnation ||
      t.state.phase !== "settled" ||
      !t.inputFrozen ||
      !hash(t.state.inputHash) ||
      !hash(t.state.resultHash)
    )
      throw new Error(
        "Media adoption requires the exact current settled opening."
      );
    return { ...observed, tournament: t };
  }
  private async records(
    db: Queryable,
    id: string,
    observed: NativeArenaActionObservation,
    lock = false
  ) {
    const t = observed.tournament;
    const row = (
      await db.query<{
        cipher_context: string;
        opened_event_id: string;
        opened_block_hash: string;
        bound_release_id: string;
        state: string;
        film_sha256: string | null;
        input_hash: string | null;
        outcome_hash: string | null;
        publication_hash: string | null;
        frozen_hash: string;
        revealed_at: Date | null;
        adjudication_input: string;
        adjudication_outcome: string;
        candidate: unknown;
        validation: { valid?: boolean };
        winners: unknown;
      }>(
        `SELECT i.cipher_context,i.opened_event_id,i.opened_block_hash,i.bound_release_id,m.state,m.film_sha256,m.input_hash,m.outcome_hash,m.publication_hash,
      f.input_hash AS frozen_hash,f.revealed_at,a.input_hash AS adjudication_input,a.outcome_hash AS adjudication_outcome,a.candidate,a.validation,a.winners
      FROM yunipals_arena.tournament_identity i
      JOIN yunipals_arena.media_job m USING(deployment,tournament_id,incarnation)
      JOIN yunipals_arena.frozen_input f USING(deployment,tournament_id,incarnation)
      JOIN yunipals_arena.adjudication a USING(deployment,tournament_id,incarnation)
      WHERE i.deployment=$1 AND i.tournament_id=$2 AND i.incarnation=$3 AND a.state='valid' ${lock ? "FOR SHARE OF i,m,f,a" : ""}`,
        [this.deployment, id, t.incarnation]
      )
    ).rows[0];
    if (
      !row ||
      row.cipher_context !== `${this.deployment}/${id}` ||
      row.opened_event_id !== t.opened.id ||
      row.opened_block_hash !== t.opened.blockHash ||
      !hash(row.bound_release_id) ||
      row.state !== "ready" ||
      !row.film_sha256 ||
      !/^[0-9a-f]{64}$/.test(row.film_sha256) ||
      !row.revealed_at ||
      row.frozen_hash !== t.state.inputHash ||
      row.adjudication_input !== t.state.inputHash ||
      row.adjudication_outcome !== t.state.resultHash ||
      row.validation?.valid !== true ||
      manifestDigest(row.candidate) !== t.state.resultHash ||
      canonicalJson(row.winners) !== canonicalJson(t.state.winners) ||
      (row.input_hash !== null && row.input_hash !== t.state.inputHash) ||
      (row.outcome_hash !== null && row.outcome_hash !== t.state.resultHash) ||
      (t.state.videoHash !== null &&
        t.state.videoHash !== `0x${row.film_sha256}`)
    )
      throw new Error(
        "Saved legacy media does not match its adopted native identity/input/result."
      );
    const tasks = (
      await db.query<LegacyTask>(
        `SELECT asset,request_id,state,request,response,reserved_microusd::text,actual_microusd::text
      FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='media' ORDER BY asset ${lock ? "FOR SHARE" : ""}`,
        [this.deployment, id, t.incarnation]
      )
    ).rows;
    if (
      tasks.length !== 9 ||
      tasks.map((task) => task.asset).join() !== assets.join() ||
      tasks.some(
        (task) =>
          task.state !== "completed" ||
          !task.response?.local?.file ||
          !/^[0-9a-f]{64}$/.test(task.response.local.sha256 ?? "")
      )
    )
      throw new Error(
        "Legacy publication requires its nine completed original media tasks."
      );
    const {
      input_hash: boundInput,
      outcome_hash: boundOutcome,
      publication_hash: publicationHash,
      ...stable
    } = row;
    return {
      row,
      tasks,
      historyHash: manifestDigest({
        row: { ...stable, revealed_at: row.revealed_at.toISOString() },
        tasks
      })
    };
  }
  async run(id: string, incarnation: string, applyReviewHash?: string) {
    if (
      !/^[1-9][0-9]{0,77}$/.test(id) ||
      BigInt(id) >= 2n ** 256n ||
      !hash(incarnation) ||
      (applyReviewHash !== undefined && !hash(applyReviewHash))
    )
      throw new Error("Explicit Arena media adoption identity is required.");
    const db = await this.pool.connect(),
      locks: string[] = [];
    let discard = false;
    try {
      for (const key of [
        `arena/project/${this.deployment}`,
        `arena/media/${this.deployment}/${id}`,
        `arena/media/${this.deployment}/${id}/${incarnation}`
      ]) {
        const held = (
          await db.query<{ held: boolean }>(
            "SELECT pg_try_advisory_lock(hashtext($1)) AS held",
            [key]
          )
        ).rows[0]?.held;
        if (!held)
          throw new Error("Arena media adoption is busy; no changes made.");
        locks.push(key);
      }
      await this.fence(db);
      const observed = await this.observe(id, incarnation),
        t = observed.tournament;
      const saved = await this.records(db, id, observed);
      const folder = mediaFolder(
        join(this.storage, "published"),
        this.deployment,
        id
      );
      const privateFolder = mediaFolder(this.storage, this.deployment, id);
      const publication = await buildMediaPublication(folder, {
        deployment: this.deployment,
        tournamentId: id,
        incarnation,
        inputHash: t.state.inputHash!,
        outcomeHash: t.state.resultHash!
      });
      if (
        publication.manifest.filmSha256 !== saved.row.film_sha256 ||
        (saved.row.publication_hash !== null &&
          saved.row.publication_hash !== publication.publicationHash)
      )
        throw new Error(
          "Legacy publication differs from its original saved film."
        );
      for (const [name, proof] of Object.entries(publication.manifest.files)) {
        await verifyPublicationFile(folder, name, proof);
        await verifyPublicationFile(join(privateFolder, "public"), name, proof);
      }
      for (const task of saved.tasks) {
        const file = `provider/${task.asset}.${task.asset.endsWith("/image") ? "png" : "mp4"}`;
        if (
          task.response!.local!.file !== file ||
          (await mediaFileProof(privateFolder, file)).sha256 !==
            task.response!.local!.sha256
        )
          throw new Error(
            "Legacy provider asset differs from its original saved receipt."
          );
      }
      const receipts: unknown = JSON.parse(
        await readFile(join(folder, "receipts.json"), "utf8")
      );
      if (
        !Array.isArray(receipts) ||
        receipts.length !== 9 ||
        saved.tasks.some(
          (task) =>
            receipts.filter(
              (receipt: unknown) =>
                record(receipt) &&
                receipt.asset === task.asset &&
                receipt.request_id === task.request_id &&
                String(receipt.reserved_microusd) === task.reserved_microusd
            ).length !== 1
        )
      )
        throw new Error(
          "Legacy public receipts differ from the saved provider requests."
        );
      const proof: NativeProviderProof = {
        deployment: this.deployment,
        tournamentId: id,
        incarnation,
        releaseId: observed.releaseId,
        openedEventId: t.opened.id,
        openedBlockHash: t.opened.blockHash,
        frozenEventId: t.inputFrozen!.id,
        frozenBlockHash: t.inputFrozen!.blockHash,
        inputHash: t.state.inputHash!,
        resultHash: t.state.resultHash!
      };
      const sourceHash = manifestDigest({
        releaseId: observed.releaseId,
        tournament: t
      });
      const reviewHash = manifestDigest({
        publicationHash: publication.publicationHash,
        sourceHash,
        historyHash: saved.historyHash
      });
      if (applyReviewHash !== undefined && applyReviewHash !== reviewHash)
        throw new Error(
          "Arena media adoption review changed; inspect again before applying."
        );
      await this.verify(observed);
      const current = await this.observe(id, incarnation);
      if (
        manifestDigest({
          releaseId: current.releaseId,
          tournament: current.tournament
        }) !== sourceHash
      )
        throw new Error(
          "Arena media adoption source changed during verification."
        );
      for (const [name, file] of Object.entries(publication.manifest.files)) {
        await verifyPublicationFile(folder, name, file);
        await verifyPublicationFile(join(privateFolder, "public"), name, file);
      }
      for (const task of saved.tasks)
        if (
          (await mediaFileProof(privateFolder, task.response!.local!.file!))
            .sha256 !== task.response!.local!.sha256
        )
          throw new Error("Legacy provider asset changed during verification.");
      await transaction(this.pool, async (commit) => {
        await this.fence(commit);
        if (
          (await this.records(commit, id, current, true)).historyHash !==
          saved.historyHash
        )
          throw new Error(
            "Arena media adoption history changed during verification."
          );
        const fresh = await this.observe(id, incarnation);
        if (
          canonicalJson(fresh.tournament) !==
            canonicalJson(current.tournament) ||
          fresh.releaseId !== current.releaseId
        )
          throw new Error("Arena media adoption source changed before commit.");
        if (applyReviewHash === undefined) return;
        await commit.query(
          `UPDATE yunipals_arena.frozen_input SET revealed_event_id=$4,revealed_block_hash=$5
          WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$6 AND revealed_at IS NOT NULL`,
          [
            this.deployment,
            id,
            incarnation,
            proof.frozenEventId,
            proof.frozenBlockHash,
            proof.inputHash
          ]
        );
        await commit.query(
          `UPDATE yunipals_arena.media_job SET input_hash=$4,outcome_hash=$5 WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3`,
          [this.deployment, id, incarnation, proof.inputHash, proof.resultHash]
        );
        await recordMediaPublication(commit, publication, {
          ...proof,
          adoption: { reviewHash, historyHash: saved.historyHash }
        });
      });
      return {
        applied: applyReviewHash !== undefined,
        deployment: this.deployment,
        tournamentId: id,
        incarnation,
        publicationHash: publication.publicationHash,
        reviewHash,
        filmSha256: publication.manifest.filmSha256,
        payoutsReleased: !!t.state.videoHash,
        files: Object.keys(publication.manifest.files).length,
        providerTasks: saved.tasks.length
      };
    } finally {
      for (const key of locks.reverse())
        try {
          await db.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
        } catch {
          discard = true;
        }
      db.release(discard);
    }
  }
}

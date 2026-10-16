import { randomUUID, createHash } from "node:crypto";
import { readFile, realpath, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";

export type MediaReference = { file: string; sha256: string };
export type MediaRequest = {
  kind: "image" | "video";
  prompt: string;
  references: MediaReference[];
  duration?: 3 | 5;
};
export type MediaTask = {
  request_id: string;
  state: string;
  request: MediaRequest;
  response: {
    output?: { imageURL?: string; videoURL?: string; cost?: number };
    local?: MediaReference;
    code?: string;
  } | null;
  reserved_microusd: string;
  actual_microusd: string | null;
};
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function within(root: string, file: string) {
  if (
    !/^[A-Za-z0-9_./-]+$/.test(file) ||
    file.startsWith("/") ||
    file.split("/").includes("..")
  )
    throw new Error("Invalid media path.");
  const base = await realpath(root),
    path = await realpath(resolve(root, file));
  if (relative(base, path).startsWith(".."))
    throw new Error("Media path escapes its job.");
  return path;
}

export async function boundedBody(response: Response, maxBytes: number) {
  if (!response.ok || !response.body)
    throw new Error("Media response is unavailable.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > maxBytes)
        throw new Error("Media response exceeds its size limit.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

/** One persisted UUID per asset. A lost POST response only permits getResponse,
 * never a second generation. Provider costs share the referee's $1.60 ledger. */
export class ArenaMediaApi {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!key.trim()) throw new Error("RUNWARE_API_KEY is required.");
  }

  private async task(deployment: string, id: string, asset: string) {
    const row = (
      await this.pool.query<MediaTask>(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND kind='media' AND asset=$3",
        [deployment, id, asset]
      )
    ).rows[0];
    if (!row) throw new Error("Media task must be reserved first.");
    return row;
  }

  private async ready(deployment: string, id: string) {
    const ready = await this.pool.query(
      `SELECT 1 FROM yunipals_arena.tournament t
       JOIN yunipals_arena.adjudication a ON a.deployment=t.deployment AND a.tournament_id=t.id
       JOIN yunipals_arena.deployment d ON d.id=t.deployment
       WHERE t.deployment=$1 AND t.id=$2 AND t.state->>'phase'='settled' AND a.state='valid'
         AND t.state->>'resultHash'=a.outcome_hash AND t.state->>'inputHash'=a.input_hash
         AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes'`,
      [deployment, id]
    );
    if (!ready.rowCount)
      throw new Error(
        "Media generation requires the confirmed settled result."
      );
  }

  async reserve(
    deployment: string,
    id: string,
    asset: string,
    request: MediaRequest
  ) {
    if (!/^(SF1|SF2|FINAL)\/(image|opening|continuation)$/.test(asset))
      throw new Error("Invalid media asset.");
    const image = asset.endsWith("/image");
    if (
      request.kind !== (image ? "image" : "video") ||
      request.references.length !== (image ? 3 : 1) ||
      !request.prompt ||
      request.prompt.length > (image ? 3000 : 4000) ||
      (!image && request.duration !== (asset.endsWith("/opening") ? 3 : 5)) ||
      (image && request.duration !== undefined) ||
      request.references.some((ref) => !/^[0-9a-f]{64}$/.test(ref.sha256))
    )
      throw new Error("Media request exceeds the pinned envelope.");
    const reserve = image ? 40000 : request.duration === 3 ? 100000 : 160000;
    await this.ready(deployment, id);
    await transaction(this.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/spend/${deployment}/${id}`
      ]);
      const old = (
        await db.query<MediaTask>(
          "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND kind='media' AND asset=$3",
          [deployment, id, asset]
        )
      ).rows[0];
      if (old) {
        if (canonicalJson(old.request) !== canonicalJson(request))
          throw new Error("Media request is already frozen.");
        return;
      }
      const cost = (
        await db.query<{ total: string }>(
          "SELECT coalesce(sum(coalesce(actual_microusd,reserved_microusd)),0)::text AS total FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2",
          [deployment, id]
        )
      ).rows[0]!;
      if (BigInt(cost.total) + BigInt(reserve) > 1600000n)
        throw new Error("Combined generation budget exhausted.");
      await db.query(
        "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,request,reserved_microusd) VALUES($1,$2,'media',$3,$4,$5,$6)",
        [deployment, id, asset, randomUUID(), request, reserve]
      );
    });
  }

  async step(
    deployment: string,
    id: string,
    asset: string,
    root: string
  ): Promise<MediaTask> {
    const task = await this.task(deployment, id, asset);
    if (["failed", "completed"].includes(task.state)) return task;
    if (task.response?.output)
      return this.download(deployment, id, asset, root, task);
    let body: Record<string, unknown> = {
      taskType: "getResponse",
      taskUUID: task.request_id
    };
    if (task.state === "reserved") {
      const references: string[] = [];
      for (const ref of task.request.references) {
        const bytes = await readFile(await within(root, ref.file));
        if (bytes.length > 32 * 1024 * 1024 || sha(bytes) !== ref.sha256)
          throw new Error("Media reference checksum mismatch.");
        const mime = bytes
          .subarray(0, 8)
          .equals(Buffer.from("89504e470d0a1a0a", "hex"))
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216
            ? "image/jpeg"
            : null;
        if (!mime) throw new Error("Unsupported reference format.");
        references.push(`data:${mime};base64,${bytes.toString("base64")}`);
      }
      const common = {
        taskUUID: task.request_id,
        positivePrompt: task.request.prompt,
        numberResults: 1,
        deliveryMethod: "async",
        outputType: "URL",
        includeCost: true
      };
      body =
        task.request.kind === "image"
          ? {
              ...common,
              taskType: "imageInference",
              model: "bytedance:seedream@4.5",
              width: 2560,
              height: 1440,
              outputFormat: "PNG",
              inputs: { referenceImages: references }
            }
          : {
              ...common,
              taskType: "videoInference",
              model: "xai:grok-imagine@video-1.5-lite",
              resolution: "720p",
              duration: task.request.duration,
              outputFormat: "MP4",
              outputQuality: 85,
              inputs: {
                frameImages: [{ image: references[0], frame: "first" }]
              }
            };
      await this.ready(deployment, id);
      const claimed = await this.pool.query(
        "UPDATE yunipals_arena.provider_task SET state='submitting',updated_at=now() WHERE request_id=$1 AND state='reserved' RETURNING request_id",
        [task.request_id]
      );
      if (!claimed.rowCount) return this.task(deployment, id, asset);
    }
    let response: {
      data?: Array<{
        taskUUID?: string;
        imageURL?: string;
        videoURL?: string;
        cost?: number;
        status?: string;
      }>;
      errors?: Array<{ taskUUID?: string; code?: string; status?: string }>;
    };
    try {
      const result = await this.fetcher("https://api.runware.ai/v1", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([body]),
        redirect: "error",
        signal: AbortSignal.timeout(45000)
      });
      response = JSON.parse(
        (await boundedBody(result, 1000000)).toString("utf8")
      );
    } catch {
      await this.pool.query(
        "UPDATE yunipals_arena.provider_task SET state='uncertain',error_code='retrieval_required',updated_at=now() WHERE request_id=$1 AND state NOT IN ('completed','failed','downloading')",
        [task.request_id]
      );
      throw new Error(
        "Runware request is unconfirmed. Only retrieval of its saved UUID is allowed."
      );
    }
    const outputs =
      response.data?.filter(
        (r) => r.taskUUID === task.request_id && (r.imageURL || r.videoURL)
      ) ?? [];
    if (outputs.length > 1)
      throw new Error("Provider returned multiple assets for one task.");
    const output = outputs[0];
    if (output) {
      const url =
        task.request.kind === "image" ? output.imageURL : output.videoURL;
      this.mediaUrl(url);
      if (output.cost !== undefined && typeof output.cost !== "number")
        throw new Error("Invalid provider cost.");
      const cost =
        output.cost === undefined ? null : Math.ceil(output.cost * 1000000);
      if (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))
        throw new Error("Invalid provider cost.");
      // Never persist unknown provider fields or reflect provider errors into the UI.
      const clean = {
        imageURL: output.imageURL,
        videoURL: output.videoURL,
        cost: output.cost
      };
      await this.pool.query(
        "UPDATE yunipals_arena.provider_task SET state='downloading',response=$2,actual_microusd=$3,updated_at=now() WHERE request_id=$1 AND state NOT IN ('completed','failed')",
        [task.request_id, { output: clean }, cost]
      );
      return this.download(
        deployment,
        id,
        asset,
        root,
        await this.task(deployment, id, asset)
      );
    }
    const error = response.errors?.find(
      (e) => e.taskUUID === task.request_id && e.status === "error"
    );
    await this.pool.query(
      "UPDATE yunipals_arena.provider_task SET state=$2,error_code=$3,updated_at=now() WHERE request_id=$1 AND state NOT IN ('completed','failed','downloading')",
      [
        task.request_id,
        error ? "failed" : response.errors?.length ? "uncertain" : "processing",
        error
          ? "provider_terminal_failure"
          : response.errors?.length
            ? "retrieval_requires_reconciliation"
            : null
      ]
    );
    return this.task(deployment, id, asset);
  }

  private mediaUrl(value: unknown) {
    if (typeof value !== "string") throw new Error("Missing media URL.");
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["im.runware.ai", "vm.runware.ai"].includes(url.hostname) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      throw new Error("Untrusted media URL.");
    return url.href;
  }

  private async download(
    deployment: string,
    id: string,
    asset: string,
    root: string,
    task: MediaTask
  ) {
    const image = task.request.kind === "image";
    const url = this.mediaUrl(
      image ? task.response?.output?.imageURL : task.response?.output?.videoURL
    );
    const response = await this.fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(60000)
    });
    const bytes = await boundedBody(response, (image ? 32 : 128) * 1024 * 1024);
    if (
      image
        ? !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        : bytes.subarray(4, 8).toString() !== "ftyp"
    )
      throw new Error("Provider asset has an unexpected file format.");
    const file = `provider/${asset}.${image ? "png" : "mp4"}`;
    const target = resolve(root, file);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
    const local = { file, sha256: sha(bytes) };
    await this.pool.query(
      "UPDATE yunipals_arena.provider_task SET state='completed',response=$2,updated_at=now() WHERE request_id=$1 AND state='downloading'",
      [task.request_id, { output: task.response!.output, local }]
    );
    return this.task(deployment, id, asset);
  }
}

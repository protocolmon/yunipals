import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import type { Pool } from "pg";
import { z } from "zod";
import { archiveReleaseId, canonicalJson, contentHash } from "../../lib/metadata/source/canonical.js";
import { beginSource, commitSourceBatch, ensureCandidate, type ArchiveRecord } from "../../lib/metadata/source/archive.js";

const runSchema = z.object({ namespace: z.string().min(1), cursor: z.unknown(), upperBound: z.unknown(),
  count: z.string().regex(/^\d+$/), hash: z.string(), state: z.enum(["running","scanned","reconciled","failed"]), descriptor: z.unknown() });
const headerSchema = z.object({ type: z.literal("header"), format: z.literal("metadata-source-backup-v1"),
  sourceRelease: z.string(), manifest: z.unknown(), runs: z.array(runSchema) });
const recordSchema = z.object({ key: z.string().min(1), payload: z.record(z.unknown()),
  assetKey: z.string().nullable(), legacyId: z.string().nullable(), family: z.string().nullable(),
  chainId: z.string().nullable(), originType: z.string().nullable(), burned: z.boolean().nullable(), issue: z.string().nullable() });
const frameSchema = z.object({ type: z.literal("source"), namespace: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/), record: recordSchema });
const footerSchema = z.object({ type: z.literal("footer"), records: z.number().int().nonnegative(), hash: z.string().regex(/^[0-9a-f]{64}$/) });

/** Source recovery export. Rendered projections are deliberately rebuilt. */
export async function exportSources(pool: Pool, release: string, outputPath: string) {
  archiveReleaseId(release);
  const output = resolve(outputPath), temporary = `${output}.${randomUUID()}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const existing = await client.query("SELECT manifest FROM metadata_source.archive_release WHERE release_id=$1", [release]);
    if (!existing.rowCount) throw new Error("Archive release does not exist");
    const runs = (await client.query(`SELECT namespace,cursor,upper_bound AS "upperBound",rows_imported::text AS count,
      rolling_hash AS hash,state,source_descriptor AS descriptor FROM metadata_source.import_run WHERE release_id=$1 ORDER BY namespace`, [release])).rows;
    const header = headerSchema.parse({ type: "header", format: "metadata-source-backup-v1", sourceRelease: release,
      manifest: existing.rows[0].manifest, runs });
    const digest = createHash("sha256");
    async function* lines() {
      const encode = (value: unknown) => { const line = canonicalJson(value) + "\n"; digest.update(line); return line; };
      yield encode(header);
      for (const run of header.runs) {
        let cursor = "", count = 0;
        while (true) {
          const rows = (await client.query(`SELECT r.source_key AS key,b.payload,r.content_hash AS hash,
            r.asset_key AS "assetKey",r.legacy_id AS "legacyId",r.family,r.chain_id AS "chainId",
            r.origin_type AS "originType",r.source_burned AS burned,r.issue
            FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
            WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key>$3 ORDER BY r.source_key LIMIT 500`,
          [release, run.namespace, cursor])).rows;
          for (const { hash, ...record } of rows) {
            if (contentHash(record.payload) !== hash) throw new Error("Stored source checksum mismatch");
            yield encode({ type: "source", namespace: run.namespace, hash, record });
            count++; written++; cursor = record.key;
          }
          if (rows.length < 500) break;
        }
        if (String(count) !== run.count) throw new Error("Import checkpoint count differs from stored source count");
      }
      yield canonicalJson({ type: "footer", records: written, hash: digest.digest("hex") }) + "\n";
    }
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await client.query("COMMIT");
    // link is an atomic no-overwrite publication on the same filesystem.
    await link(temporary, output);
    return { release, records: written, output };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await unlink(temporary).catch(() => {}); }
}

export async function restoreSources(pool: Pool, release: string, inputPath: string) {
  archiveReleaseId(release);
  if ((await pool.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1", [release])).rowCount) {
    throw new Error("Restore target release already exists; choose a new release ID");
  }
  const input = createReadStream(resolve(inputPath)), unzip = createGunzip();
  input.on("error", error => unzip.destroy(error));
  input.pipe(unzip);
  const lines = createInterface({ input: unzip, crlfDelay: Infinity });
  const digest = createHash("sha256");
  let header: z.infer<typeof headerSchema> | undefined, footer = false, count = 0, created = false;
  const pending = new Map<string, ArchiveRecord[]>();
  const cursors = new Map<string, unknown>();
  const counts = new Map<string, number>();
  const hashes = new Map<string, string>();
  async function flush(namespace: string) {
    const batch = pending.get(namespace)!;
    if (!batch.length) return;
    const next = batch.at(-1)!.key;
    const hash = await commitSourceBatch(pool, release, namespace, cursors.get(namespace), next, batch);
    cursors.set(namespace, next); hashes.set(namespace, hash); pending.set(namespace, []);
  }
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 32 * 1024 * 1024) throw new Error("Archive frame exceeds size limit");
      if (footer) throw new Error("Unexpected data after archive footer");
      const parsed: unknown = JSON.parse(line);
      if (!header) {
        header = headerSchema.parse(parsed);
        if (new Set(header.runs.map(run => run.namespace)).size !== header.runs.length) throw new Error("Duplicate source namespaces");
        await ensureCandidate(pool, release, header.manifest); created = true;
        for (const run of header.runs) {
          await beginSource(pool, release, run.namespace, run.descriptor, run.upperBound);
          pending.set(run.namespace, []); cursors.set(run.namespace, null); counts.set(run.namespace, 0); hashes.set(run.namespace, "");
        }
        digest.update(canonicalJson(parsed) + "\n");
      } else if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "footer") {
        const end = footerSchema.parse(parsed);
        if (end.records !== count || end.hash !== digest.digest("hex")) throw new Error("Archive footer checksum or count mismatch");
        footer = true;
      } else {
        const frame = frameSchema.parse(parsed);
        const batch = pending.get(frame.namespace);
        if (!batch) throw new Error("Unknown source namespace in archive");
        if (contentHash(frame.record.payload) !== frame.hash) throw new Error("Archive source checksum mismatch");
        const previous = batch.at(-1)?.key ?? cursors.get(frame.namespace);
        if (previous !== null && frame.record.key <= String(previous)) throw new Error("Source records out of order or duplicated");
        batch.push(frame.record); count++; counts.set(frame.namespace, counts.get(frame.namespace)! + 1);
        digest.update(canonicalJson(parsed) + "\n");
        if (batch.length >= 500) await flush(frame.namespace);
      }
    }
    if (!header || !footer) throw new Error("Truncated source archive");
    for (const run of header.runs) {
      await flush(run.namespace);
      if (String(counts.get(run.namespace)) !== run.count || canonicalJson(cursors.get(run.namespace)) !== canonicalJson(run.cursor)
        || hashes.get(run.namespace) !== run.hash) throw new Error("Restored checkpoint does not match source manifest");
      if (["scanned", "reconciled"].includes(run.state)) {
        await commitSourceBatch(pool, release, run.namespace, run.cursor, run.cursor, [], true);
      }
    }
    return { release, records: count, state: "candidate" };
  } catch (error) {
    if (created) await pool.query("UPDATE metadata_source.archive_release SET state='invalid' WHERE release_id=$1 AND state='candidate'", [release]);
    throw error;
  } finally { lines.close(); input.destroy(); unzip.destroy(); }
}

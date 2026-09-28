import { createHash } from "node:crypto";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";
import { sourceIdentity } from "../lib/metadata/source/identity.js";
import { beginSource, commitSourceBatch, ensureCandidate, type ArchiveRecord } from "../lib/metadata/source/archive.js";
import { argumentsOf, legacyMongo, postgresFrom, safeFailure, type SourceDocument } from "./metadata/support.js";

const args = argumentsOf({ release: { type: "string" }, resume: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false }, "batch-size": { type: "string", default: "500" },
  limit: { type: "string", default: "0" }, "delay-ms": { type: "string", default: "25" } });
const batchSize = Number(args["batch-size"]), limit = Number(args.limit), delay = Number(args["delay-ms"]);
if (![batchSize, limit, delay].every(Number.isSafeInteger) || batchSize < 1 || batchSize > 2000 || limit < 0 || delay < 0 || delay > 10000) {
  throw new Error("Invalid import limits");
}
const sourceNames = ["pmonCollection", "pmonCollectionBurned"];
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function metadataRecord(doc: SourceDocument, name: string, serialize: (value: unknown) => unknown): ArchiveRecord {
  if (doc._id?._bsontype !== "ObjectId") throw new Error("Unsupported Mongo key type");
  return { key: String(doc._id), payload: serialize(doc), ...sourceIdentity(doc), burned: name === "pmonCollectionBurned" };
}

async function main() {
  const release = args.release ? archiveReleaseId(String(args.release)) : undefined;
  if (!args["dry-run"] && !release) throw new Error("--release is required for an import");
  const source = await legacyMongo(String(args["legacy-root"]));
  let connection: Awaited<ReturnType<typeof postgresFrom>> | undefined;
  try {
    const endpoint = new URL(source.env.ONE_COLLECTION_MONGO_URI);
    const descriptor = { format: "canonical-ejson-v1", driver: "mongodb-5-compatible", database: "nfts",
      endpointFingerprint: createHash("sha256").update(endpoint.host).digest("hex"), collections: sourceNames };
    if (args["dry-run"]) {
      for (const name of sourceNames) {
        const collection = source.db.collection(name);
        const sample = await collection.findOne({});
        const record = sample && metadataRecord(sample, name, value => source.driver.BSON.EJSON.serialize(value, { relaxed: false }));
        console.log(JSON.stringify({ namespace: `nfts.${name}`, estimatedCount: await collection.estimatedDocumentCount(),
          sampleIdentityValid: record?.issue === null, samplePayloadBytes: record ? Buffer.byteLength(JSON.stringify(record.payload)) : 0 }));
      }
      return;
    }
    connection = await postgresFrom(String(args["env-file"]));
    const { pool } = connection;
    if (!args.resume && (await pool.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1", [release])).rowCount) {
      throw new Error("Release already exists; use --resume");
    }
    await ensureCandidate(pool, release!, { importer: "metadata-source-v1", source: descriptor });
    let imported = 0;
    const started = Date.now();
    for (const name of sourceNames) {
      if (stopping || (limit && imported >= limit)) break;
      const collection = source.db.collection(name), namespace = `nfts.${name}`;
      const last = await collection.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
      if (last[0] && last[0]._id?._bsontype !== "ObjectId") throw new Error("Unsupported Mongo key type");
      const maximum = last[0] ? String(last[0]._id) : null;
      const run = await beginSource(pool, release!, namespace, { ...descriptor, collection: name }, maximum);
      if (run.state === "scanned" || run.state === "reconciled") continue;
      let cursor = run.cursor as string | null;
      if (run.upperBound !== null && !/^[0-9a-f]{24}$/.test(String(run.upperBound))) throw new Error("Unsupported Mongo key type");
      while (!stopping && (!limit || imported < limit)) {
        const take = limit ? Math.min(batchSize, limit - imported) : batchSize;
        const query = run.upperBound === null ? null : { _id: {
          $lte: new source.driver.ObjectId(String(run.upperBound)),
          ...(cursor ? { $gt: new source.driver.ObjectId(cursor) } : {})
        } };
        const docs = query ? await collection.find(query, { maxTimeMS: 30000 }).hint("_id_").sort({ _id: 1 }).limit(take).toArray() : [];
        const records = docs.map(doc => metadataRecord(doc, name,
          value => source.driver.BSON.EJSON.serialize(value, { relaxed: false })));
        const next = records.at(-1)?.key ?? cursor;
        await commitSourceBatch(pool, release!, namespace, cursor, next, records, docs.length < take);
        imported += records.length;
        cursor = next;
        console.log(JSON.stringify({ release, namespace, importedThisInvocation: imported, cursor,
          elapsedSeconds: Math.round((Date.now()-started)/1000), state: docs.length < take ? "scanned" : "running" }));
        if (docs.length < take) break;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    console.log(`Import checkpoint saved (${imported} records this invocation). Scanned sources still require reconciliation; nothing was activated.`);
  } finally { await source.client.close(); await connection?.pool.end(); }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });

import { readFile } from "node:fs/promises";
import { collections } from "../lib/constants.js";
import { sqlIdentifier } from "../lib/offchain/sql.js";
import { argumentsOf, legacyMongo, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";

const args = argumentsOf({ output: { type: "string", default: "docs/metadata-migration/inventory.json" },
  resume: { type: "boolean", default: false }, "max-time-ms": { type: "string", default: "120000" } });
const output = String(args.output);
const maxTimeMS = Number(args["max-time-ms"]);
if (!Number.isSafeInteger(maxTimeMS) || maxTimeMS < 1 || maxTimeMS > 600000) throw new Error("Invalid query timeout");

async function main() {
  const previous = args.resume ? JSON.parse(await readFile(output, "utf8")) : undefined;
  if (previous && previous.format !== "metadata-inventory-v1") throw new Error("Unsupported inventory format");
  const report = previous ?? { format: "metadata-inventory-v1", startedAt: new Date().toISOString(),
    status: "running", configuredCollections: collections, source: {}, postgres: {}, errors: [] };
  report.status = "running";
  const { pool, env } = await postgresFrom(String(args["env-file"]));
  let source: Awaited<ReturnType<typeof legacyMongo>> | undefined;
  try {
    const readSchema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA ?? "public");
    report.postgres = {
      observedAt: new Date().toISOString(),
      metadata: (await pool.query(`SELECT collection, fetch_status, count(*)::text AS count
        FROM metadata.token_metadata GROUP BY 1,2 ORDER BY 1,2`)).rows,
      metadataValidity: (await pool.query(`SELECT collection,
        count(*) FILTER (WHERE fetch_status='success' AND name IS NULL)::text AS successful_without_name,
        count(*) FILTER (WHERE fetch_status='success' AND name IS NULL AND document ? 'message')::text AS message_only
        FROM metadata.token_metadata GROUP BY 1 ORDER BY 1`)).rows,
      tokens: (await pool.query(`SELECT collection, burned, count(*)::text AS count
        FROM ${readSchema}.token GROUP BY 1,2 ORDER BY 1,2`)).rows,
      lifecycles: (await pool.query(`SELECT collection, count(*)::text AS count
        FROM ${readSchema}.token_lifecycle GROUP BY 1 ORDER BY 1`)).rows
    };
    await writeReport(output, report);
    source = await legacyMongo(String(args["legacy-root"]));
    for (const name of ["pmonCollection", "pmonCollectionBurned"]) {
      const collection = source.db.collection(name);
      const entry = report.source[name] ??= { namespace: `nfts.${name}`, fields: {},
        countMethod: "estimatedDocumentCount; each complete field grouping has an independent exact total" };
      entry.estimatedCount = await collection.estimatedDocumentCount();
      entry.indexes = (await collection.listIndexes().toArray()).map(({ name, key, unique }) => ({ name, key, unique: !!unique }));
      // Each grouping can use an existing covered index. Avoid an unindexed
      // multi-field aggregation over seven million large NFT envelopes.
      for (const [field, hint] of [
        ["chain.id", { "chain.id": 1, "nft.birthday": 1 }],
        ["genId.type", { "genId.type": 1, "genId.id": 1 }],
        ["origin.type", { "origin.type": 1, "nft.birthday": 1 }]
      ] as const) {
        if (entry.fields[field]?.complete) continue;
        console.log(`Inventory ${name}: ${field}`);
        const groups = await collection.aggregate([
          { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }
        ], { hint, maxTimeMS, allowDiskUse: false }).toArray();
        entry.fields[field] = { complete: true, observedAt: new Date().toISOString(), groups,
          total: groups.reduce((total, row) => total + Number(row.count), 0) };
        await writeReport(output, report);
      }
    }
    report.status = "complete";
    report.finishedAt = new Date().toISOString();
    console.log(`Inventory complete: ${output}`);
  } catch (error) {
    report.status = "incomplete";
    report.errors.push({ at: new Date().toISOString(), error: safeFailure(error) });
    process.exitCode = 1;
    console.error(safeFailure(error));
  } finally {
    await writeReport(output, report);
    await source?.client.close();
    await pool.end();
  }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });

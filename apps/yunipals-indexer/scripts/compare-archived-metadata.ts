import { ArchiveReader, ArchiveLookupError } from "../lib/metadata/source/read.js";
import { archiveReleaseId, canonicalJson } from "../lib/metadata/source/canonical.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";

const args = argumentsOf({ release: { type: "string" }, limit: { type: "string", default: "20" },
  output: { type: "string", default: "docs/metadata-migration/archive-comparison.json" } });
async function main() {
  if (!args.release) throw new Error("--release is required");
  const release = archiveReleaseId(String(args.release)), limit = Number(args.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Comparison sample must be between 1 and 100");
  const { pool } = await postgresFrom(String(args["env-file"]));
  const reader = new ArchiveReader(pool,release,true);
  try {
    const samples = (await pool.query(`SELECT legacy_id AS id,family FROM metadata_source.source_record
      WHERE release_id=$1 AND namespace='nfts.pmonCollection' AND issue IS NULL
      ORDER BY source_key LIMIT $2`, [release,limit])).rows;
    const results: Record<string,unknown>[] = [];
    for (const { id, family } of samples) {
      try {
        const archived = await reader.snapshot(id); // same unqualified alias behavior as /meta
        const response = await fetch(`http://127.0.0.1:9001/meta?id=${encodeURIComponent(id)}`,
          { signal: AbortSignal.timeout(15000), redirect: "error" });
        const legacy: unknown = await response.json();
        const match = response.ok && canonicalJson(comparisonDocument(archived.document)) === canonicalJson(comparisonDocument(legacy));
        results.push({ id, family, status: match ? "matched" : "mismatch", httpStatus: response.status });
      } catch (error) {
        results.push({ id, family, status: error instanceof ArchiveLookupError ? error.code : "comparison_failed" });
      }
    }
    const report = { release, observedAt: new Date().toISOString(), completeCoverage: false,
      rules: ["Ignore Last metadata update", "Compare trait arrays by complete trait value, preserving other array order",
        "Owner snapshot fields are compared; this check does not verify current chain ownership"], results };
    await writeReport(String(args.output),report);
    const matched = results.filter(row => row.status === "matched").length;
    console.log(`Archived metadata matched ${matched}/${results.length} sampled live responses; full coverage and chain ownership validation remain separate gates.`);
    if (matched !== results.length || !results.length) process.exitCode = 1;
  } finally { await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });

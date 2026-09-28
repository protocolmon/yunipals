import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";

const args = argumentsOf({ release: { type: "string" }, output: { type: "string" } });
async function main() {
  if (!args.release) throw new Error("--release is required");
  const release = archiveReleaseId(String(args.release));
  const { pool } = await postgresFrom(String(args["env-file"]));
  try {
    const result = await pool.query(`SELECT release_id,state,format_version,created_at,validated_at,activated_at
      FROM metadata_source.archive_release WHERE release_id=$1`, [release]);
    if (!result.rowCount) throw new Error("Release not found");
    const report = { observedAt: new Date().toISOString(), ...result.rows[0],
      sources: (await pool.query(`SELECT namespace,rows_imported::text AS rows,cursor,upper_bound,
        state,started_at,updated_at FROM metadata_source.import_run WHERE release_id=$1 ORDER BY namespace`, [release])).rows,
      storageBytes: (await pool.query(`SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='metadata_source' AND c.relkind='r'`)).rows[0].bytes };
    if (args.output) await writeReport(String(args.output), report);
    console.log(JSON.stringify(report, null, 2));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });

import assert from "node:assert/strict";
import { migrations } from "../lib/offchain/migrations.js";
import { sqlIdentifier } from "../lib/offchain/sql.js";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";

// Observation only. This command never activates a release or changes a table.
const args = argumentsOf({
  release: { type: "string" },
  output: { type: "string", default: "docs/metadata-migration/step-5-preflight.json" }
});

async function main() {
  const release = archiveReleaseId(String(args.release ?? ""));
  const { pool, env } = await postgresFrom(String(args["env-file"]));
  const client = await pool.connect();
  try {
    const readSchema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA ?? "public");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const observed = (await client.query("SELECT current_database() AS database, now() AS observed_at")).rows[0];
    assert.ok(!String(observed.database).startsWith("metadata_archive_test_"), "Use the production database for cutover preflight");
    const migration = (await client.query("SELECT COALESCE(max(version),0)::int AS version FROM metadata.schema_migration")).rows[0];
    const releaseRow = (await client.query("SELECT release_id,state,created_at,validated_at,activated_at FROM metadata_source.archive_release WHERE release_id=$1", [release])).rows[0];
    assert.ok(releaseRow, "Release not found");
    const active = (await client.query("SELECT release_id FROM metadata_source.archive_release WHERE state='active'")).rows.map(row => row.release_id as string);
    const imports = (await client.query(`SELECT namespace,state,rows_imported::text AS rows,updated_at
      FROM metadata_source.import_run WHERE release_id=$1 ORDER BY namespace`, [release])).rows;
    const source = (await client.query(`SELECT namespace,count(*)::text AS rows FROM metadata_source.source_record
      WHERE release_id=$1 GROUP BY namespace ORDER BY namespace`, [release])).rows;
    const lifecycleBindings = (await client.query("SELECT count(*)::text AS rows FROM metadata_source.lifecycle_binding WHERE release_id=$1", [release])).rows[0].rows;
    const tokens = (await client.query(`SELECT collection,count(*)::text AS rows FROM ${readSchema}.token GROUP BY collection ORDER BY collection`)).rows;
    const publication = (await client.query("SELECT collection,publication_status,count(*)::text AS rows FROM metadata.token_publication GROUP BY collection,publication_status ORDER BY collection,publication_status")).rows;
    const jobs = (await client.query("SELECT status,count(*)::text AS rows FROM metadata.publication_job GROUP BY status ORDER BY status")).rows;
    const base = (await client.query("SELECT name,next_block::text,target_block::text,updated_at FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'")).rows[0] ?? null;
    const optional = (await client.query(`SELECT to_regclass('metadata.chain_readiness') IS NOT NULL AS readiness,
      to_regclass('metadata.derived_snapshot') IS NOT NULL AS derived`)).rows[0];
    const readiness = optional.readiness
      ? (await client.query("SELECT collection,state,checkpoint_block::text AS checkpoint_block,updated_at FROM metadata.chain_readiness ORDER BY collection")).rows
      : null;
    const derived = optional.derived
      ? (await client.query("SELECT name,metadata_release_id,updated_at FROM metadata.derived_snapshot ORDER BY name")).rows
      : null;
    await client.query("COMMIT");
    const mode = env.METADATA_SOURCE_MODE ?? "legacy-http";
    const concurrency = Number(env.METADATA_CONCURRENCY ?? 8);
    const report = {
      format: "metadata-cutover-preflight-v1", observedAt: observed.observed_at, database: observed.database,
      release: releaseRow, activeReleases: active, migrationVersion: migration.version,
      expectedMigrationVersion: migrations.length, pendingMigrations: Math.max(0, migrations.length - migration.version),
      envFileConfiguration: { metadataSourceMode: mode, rarityReadSource: env.RARITY_READ_SOURCE ?? "metadata", metadataConcurrency: concurrency,
        readSchema: env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA ?? "public" },
      environmentNote: "Service-specific systemd drop-ins may override this env file; verify each running process separately before switching modes.",
      imports, source, lifecycleBindings, tokens, publication, jobs, base, readiness, derived,
      cutoverExecuted: false,
      gatesRequiringSeparateEvidence: [
        "Coordinate the shared-server change window with the separate Yunipals marketplace task",
        "Confirm current-owner coverage and direct-port/external callers",
        "Take a final source-writer checkpoint and reconcile changes since the step-4 backup",
        "Capture a fresh rollback snapshot and tested config/routing copies",
        "Install pending migrations and browse indexes during the coordinated publisher pause",
        "Set archive-mode concurrency to at most 32 and use one consistent mode across API, metadata and leaderboard",
        "Activate only the reconciled release, finish publication and derived generations, and verify production lag",
        "Apply and verify metadata-host routing only after archive API checks pass"
      ]
    };
    await writeReport(String(args.output), report);
    console.log(JSON.stringify({ observedAt: report.observedAt, releaseState: releaseRow.state,
      activeReleases: active.length, migrationVersion: migration.version, pendingMigrations: report.pendingMigrations,
      metadataSourceMode: mode, metadataConcurrency: concurrency, cutoverExecuted: false }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });

import { createHash } from "node:crypto";
import type { Pool } from "pg";

// Operational support data is deliberately outside replay-owned Ponder schemas.
// Migrations are explicit; read APIs never create tables or promote a release.
export const controlSchema = "yunipals_indexer_control";

export async function migrateIndexerControl(
  pool: Pick<Pool, "connect">
): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('yunipals-indexer-control/migrate'))"
    );
    const migrationSql = `
      CREATE SCHEMA IF NOT EXISTS yunipals_indexer_control;
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.release (
        id text PRIMARY KEY, physical_schema text NOT NULL UNIQUE,
        build_id text NOT NULL, manifest_hash text NOT NULL,
        manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.active_release (
        name text PRIMARY KEY CHECK(name='main'),
        release_id text NOT NULL REFERENCES yunipals_indexer_control.release(id),
        previous_release_id text REFERENCES yunipals_indexer_control.release(id),
        epoch bigint NOT NULL CHECK(epoch>0), published_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.chain_status (
        release_id text NOT NULL REFERENCES yunipals_indexer_control.release(id),
        chain_id integer NOT NULL, revision bigint NOT NULL DEFAULT 0,
        head_number bigint, head_hash text, head_timestamp bigint,
        finalized_number bigint, finalized_hash text,
        witness_number bigint, witness_hash text,
        observed_at_ms bigint, provider_id text,
        anchors jsonb NOT NULL DEFAULT '{}'::jsonb,
        halted boolean NOT NULL DEFAULT false, error_code text, finality_error_code text,
        checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(release_id,chain_id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.transaction_evidence (
        chain_id integer NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL,
        block_number bigint NOT NULL, receipt jsonb NOT NULL, block jsonb NOT NULL,
        payload_hash text NOT NULL, provider_id text NOT NULL,
        verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(chain_id,block_hash,transaction_hash)
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.chain_anchor (
        release_id text NOT NULL REFERENCES yunipals_indexer_control.release(id),
        chain_id integer NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
        witness_number bigint NOT NULL, witness_hash text NOT NULL,
        PRIMARY KEY(release_id,chain_id,block_number)
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.receipt_job (
        chain_id integer NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL,
        block_number bigint NOT NULL,
        lease_id text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), error_code text,
        PRIMARY KEY(chain_id,block_hash,transaction_hash)
      );
      CREATE INDEX IF NOT EXISTS receipt_job_due ON yunipals_indexer_control.receipt_job(next_attempt_at,chain_id,block_number);
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.receipt_discovery (
        release_id text NOT NULL REFERENCES yunipals_indexer_control.release(id),
        chain_id integer NOT NULL, block_number bigint, block_hash text, transaction_hash text,
        previous_position jsonb, PRIMARY KEY(release_id,chain_id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_indexer_control.consumer_cursor (
        consumer text NOT NULL, source_id text NOT NULL, release_id text NOT NULL,
        policy text NOT NULL, generation bigint NOT NULL DEFAULT 0,
        cursor jsonb, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(consumer,source_id)
      );
    `;
    const checksum = createHash("sha256").update(migrationSql).digest("hex");
    await db.query("CREATE SCHEMA IF NOT EXISTS yunipals_indexer_control");
    await db.query(`CREATE TABLE IF NOT EXISTS yunipals_indexer_control.schema_migration (
      version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const applied = await db.query<{ version: number; checksum: string }>(
      "SELECT version,checksum FROM yunipals_indexer_control.schema_migration ORDER BY version"
    );
    if (
      applied.rows.some((row) => row.version !== 1 || row.checksum !== checksum)
    ) {
      throw new Error(
        "Indexer control migration history differs from this release."
      );
    }
    if (!applied.rows.length) {
      await db.query(migrationSql);
      await db.query(
        "INSERT INTO yunipals_indexer_control.schema_migration(version,checksum) VALUES(1,$1)",
        [checksum]
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export { indexerTransaction } from "../../../../packages/yunipals-indexer-server/src/database.js";

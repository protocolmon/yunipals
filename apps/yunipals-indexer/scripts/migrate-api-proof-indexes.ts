import pg from "pg";
import { bnbSchema, physicalPonderSchema } from "../lib/offchain/sql.js";
import { projectionGenerationMode } from "../lib/metadata/read-source.js";

// Concurrent, additive covering indexes for the measured bulk proof lookups.
// Never run inside a transaction: ordinary ingestion and API reads stay live.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const lock = await db.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('yunipals_api_proof_indexes')) AS locked"
  );
  if (!lock.rows[0]?.locked)
    throw new Error("Another API proof index migration is running.");
  await db.query("SET statement_timeout='15min'");
  // Concurrent builds wait for old snapshots, including pg_dump. They do not
  // lock out ordinary reads/writes; the statement deadline bounds that wait.
  await db.query("SET lock_timeout=0");
  await db.query("SET maintenance_work_mem='128MB'");
  const schemas = [...new Set([physicalPonderSchema, bnbSchema])];
  const definitions: { relation: string; name: string; sql: string }[] = [];
  for (const schema of schemas) {
    definitions.push(
      {
        relation: `${schema}.transfer_event`,
        name: "api_mint_proof_cover_idx",
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS api_mint_proof_cover_idx
      ON ${schema}.transfer_event(collection,token_id,lifecycle)
      INCLUDE(transaction_hash,block_number,log_index)
      WHERE "from"='0x0000000000000000000000000000000000000000'`
      },
      {
        relation: `${schema}.token_lifecycle`,
        name: "api_lifecycle_proof_cover_idx",
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS api_lifecycle_proof_cover_idx
      ON ${schema}.token_lifecycle(collection,token_id,lifecycle)
      INCLUDE(mint_transaction_hash,mint_block)`
      },
      {
        relation: `${schema}.token`,
        name: "api_token_count_cover_idx",
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS api_token_count_cover_idx
      ON ${schema}.token(collection,(token_id::numeric),lifecycle) INCLUDE(owner,burned)`
      }
    );
  }
  const revision = projectionGenerationMode
    ? "metadata_projection.revision"
    : "metadata.projection_revision";
  definitions.push(
    {
      relation: revision,
      name: "api_revision_proof_cover_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS api_revision_proof_cover_idx
    ON ${revision}(${projectionGenerationMode ? "generation_id," : ""}collection,token_id,lifecycle)
    INCLUDE(metadata_content_hash)`
    },
    {
      relation: "metadata.token_publication",
      name: "api_publication_proof_cover_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS api_publication_proof_cover_idx
    ON metadata.token_publication(collection,token_id,lifecycle)
    INCLUDE(release_id,publication_content_hash,mint_transaction_hash,mint_log_index,chain_event_key)
    WHERE source_kind='archive' AND publication_status='published'`
    }
  );
  for (const { relation, name, sql } of definitions) {
    const schema = relation.split(".")[0]!;
    const index = `${schema}.${name}`;
    const existing = await db.query<{
      valid: boolean;
      matches: boolean;
      building: boolean;
    }>(
      `
      SELECT i.indisvalid AND i.indisready AS valid,i.indrelid=to_regclass($2) AS matches,
        EXISTS(SELECT 1 FROM pg_stat_progress_create_index WHERE index_relid=i.indexrelid) AS building
      FROM pg_index i WHERE i.indexrelid=to_regclass($1)`,
      [index, relation]
    );
    const row = existing.rows[0];
    if (row && (!row.matches || row.building))
      throw new Error(`Inspect conflicting index ${index} before retrying.`);
    if (row && !row.valid) await db.query(`DROP INDEX CONCURRENTLY ${index}`);
    await db.query(sql);
    console.log(JSON.stringify({ event: "api_proof_index_built", index }));
  }
  const result = await db.query<{
    schema: string;
    name: string;
    valid: boolean;
  }>(
    `
    SELECT n.nspname AS schema,c.relname AS name,i.indisvalid AND i.indisready AS valid
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE i.indexrelid=ANY(ARRAY(SELECT to_regclass(name) FROM unnest($1::text[]) name))`,
    [
      definitions.map(
        ({ relation, name }) => `${relation.split(".")[0]}.${name}`
      )
    ]
  );
  if (
    result.rows.length !== definitions.length ||
    result.rows.some((row) => !row.valid)
  )
    throw new Error(
      "API covering index validation failed; inspect any interrupted concurrent build before retrying."
    );
  console.log(
    JSON.stringify({ event: "api_proof_indexes_ready", indexes: result.rows })
  );
} finally {
  await db.end();
}

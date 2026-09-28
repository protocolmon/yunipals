import { pool, closePool } from "../lib/offchain/db.js";
import { migrations } from "../lib/offchain/migrations.js";
import { bnbReadSchemaStatements } from "../lib/bnb/read-schema.js";
import { physicalPonderSchema, physicalPonderSchemaName } from "../lib/offchain/sql.js";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(migrations[0]);
  await client.query(migrations[1]);
  const appliedResult = await client.query<{ version: number }>("SELECT version FROM metadata.schema_migration ORDER BY version");
  const applied = new Set(appliedResult.rows.map((row) => row.version));
  if (applied.size === 0) {
    const legacy = await client.query(`SELECT
      to_regclass('metadata.token_metadata_polygon_uri_audit_idx') IS NOT NULL AS complete,
      to_regclass('metadata.token_visibility') IS NOT NULL AS visibility`);
    if (legacy.rows[0]?.complete && legacy.rows[0]?.visibility) {
      const legacyVersion = migrations.findIndex((sql) => sql.includes("token_metadata_bnb_uri_audit_idx")) + 1;
      await client.query(`INSERT INTO metadata.schema_migration(version)
        SELECT generate_series(1, $1) ON CONFLICT DO NOTHING`, [legacyVersion]);
      for (let version = 1; version <= legacyVersion; version++) applied.add(version);
    }
  }
  for (const [index, sql] of migrations.entries()) {
    const version = index + 1;
    if (applied.has(version)) continue;
    await client.query(sql);
    await client.query("INSERT INTO metadata.schema_migration(version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
  }
  const onchainTokenTable = await client.query("SELECT to_regclass($1) AS table_name", [`${physicalPonderSchemaName}.token`]);
  if (onchainTokenTable.rows[0]?.table_name) {
    const indexes = await client.query(`SELECT to_regclass($1) AS numeric_collection,
      to_regclass($2) AS collection_numeric`, [
      `${physicalPonderSchemaName}.token_numeric_collection_idx`,
      `${physicalPonderSchemaName}.token_collection_numeric_idx`
    ]);
    if (!indexes.rows[0]?.numeric_collection) await client.query(`CREATE INDEX token_numeric_collection_idx ON ${physicalPonderSchema}.token ((token_id::numeric), collection)`);
    if (!indexes.rows[0]?.collection_numeric) await client.query(`CREATE INDEX token_collection_numeric_idx ON ${physicalPonderSchema}.token (collection, (token_id::numeric))`);
  }
  const transferEventTable = await client.query("SELECT to_regclass($1) AS table_name", [`${physicalPonderSchemaName}.transfer_event`]);
  if (transferEventTable.rows[0]?.table_name) {
    const index = await client.query("SELECT to_regclass($1) AS name", [`${physicalPonderSchemaName}.transfer_event_token_order_idx`]);
    if (!index.rows[0]?.name) await client.query(`CREATE INDEX transfer_event_token_order_idx ON ${physicalPonderSchema}.transfer_event (collection, token_id, block_number, transaction_index, log_index)`);
  }
  for (const sql of bnbReadSchemaStatements) {
    if (sql.includes("CREATE OR REPLACE VIEW") && !onchainTokenTable.rows[0]?.table_name) continue;
    await client.query(sql);
  }
  await client.query("COMMIT");
  const performanceIndexes = [
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_rarity_desc_idx
      ON metadata.token_search(collection, rarity_points DESC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_rarity_asc_idx
      ON metadata.token_search(collection, rarity_points ASC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_rarity_desc_idx
      ON metadata.token_search(rarity_points DESC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_rarity_asc_idx
      ON metadata.token_search(rarity_points ASC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_capped_rarity_desc_idx
      ON metadata.token_search(collection, rarity_points_capped DESC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_capped_rarity_asc_idx
      ON metadata.token_search(collection, rarity_points_capped ASC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_capped_rarity_desc_idx
      ON metadata.token_search(rarity_points_capped DESC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_capped_rarity_asc_idx
      ON metadata.token_search(rarity_points_capped ASC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`
  ];
  for (const sql of performanceIndexes) await client.query(sql);
  await client.query("ANALYZE metadata.token_search");
  console.log(`Applied ${migrations.length} idempotent migrations`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closePool();
}

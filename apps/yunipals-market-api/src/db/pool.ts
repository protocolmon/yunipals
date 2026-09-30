import pg, { type PoolClient } from "pg";
import type { Environment } from "@/environment";

export function createPool(environment: Environment) {
  return new pg.Pool({
    connectionString: environment.databaseUrl,
    application_name: `yunipals_market_${environment.deployment}`,
    max: environment.poolMax,
    connectionTimeoutMillis: 1500,
    statement_timeout: environment.statementTimeoutMs,
    lock_timeout: 1500,
    idle_in_transaction_session_timeout: 10000
  });
}

export function createCatalogKeeperPool(environment: Environment) {
  return new pg.Pool({
    connectionString: environment.databaseUrl,
    application_name: `yunipals_catalog_${environment.deployment}`,
    max: 8,
    connectionTimeoutMillis: 1500,
    statement_timeout: environment.statementTimeoutMs,
    lock_timeout: 1500,
    idle_in_transaction_session_timeout: 95000
  });
}

export function createCatalogIndexerPool(environment: Environment) {
  if (!environment.indexerDatabaseUrl) return undefined;
  return new pg.Pool({
    connectionString: environment.indexerDatabaseUrl,
    application_name: `yunipals_catalog_indexer_${environment.deployment}`,
    // Two independent read slots, each with two source lanes, per generation.
    max: 17,
    connectionTimeoutMillis: 1500,
    statement_timeout: environment.statementTimeoutMs,
    lock_timeout: 1500,
    idle_in_transaction_session_timeout: 95000
  });
}

export async function transaction<T>(
  pool: pg.Pool,
  task: (client: PoolClient) => Promise<T>
) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

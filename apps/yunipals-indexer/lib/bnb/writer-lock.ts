import type { Pool, PoolClient } from "pg";

import { bnbSchemaName } from "./schema.js";

export async function acquireBnbWriterLock(database: Pool): Promise<PoolClient> {
  const client = await database.connect();
  try {
    await client.query("SELECT set_config('application_name', $1, false)", [
      `yunipals_bnb_writer:${bnbSchemaName}`
    ]);
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('yunipals_bnb_writer'), hashtext($1::text)) AS acquired",
      [bnbSchemaName]
    );
    if (!result.rows[0]?.acquired) {
      throw new Error(`BNB ownership writer already active for schema ${bnbSchemaName}`);
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function releaseBnbWriterLock(client: PoolClient): Promise<void> {
  try {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('yunipals_bnb_writer'), hashtext($1::text))",
      [bnbSchemaName]
    );
  } finally {
    client.release();
  }
}

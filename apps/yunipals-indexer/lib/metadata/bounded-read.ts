import type { Pool, PoolClient } from "pg";

// An open snapshot stops vacuum from removing dead rows across the whole
// database, which slows live indexing. The worker pool has no statement timeout
// because its refresh jobs are meant to run long, so bound reads that are not.
export async function boundedRead<T>(
  pool: Pool,
  timeout: string,
  read: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout',$1,true)", [
      timeout
    ]);
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

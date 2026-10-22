import type { Pool, PoolClient } from "pg";

export function sqlIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value) || Buffer.byteLength(value) > 63)
    throw new Error("Invalid shared indexer SQL identifier.");
  return `"${value}"`;
}

export async function indexerTransaction<T>(
  pool: Pick<Pool, "connect">,
  task: (db: PoolClient) => Promise<T>,
  readOnly = false
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query(
      readOnly
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL REPEATABLE READ"
    );
    const result = await task(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

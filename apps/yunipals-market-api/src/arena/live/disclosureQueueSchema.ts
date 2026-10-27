import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `ALTER TABLE yunipals_arena.frozen_input
    ADD COLUMN native_check_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN native_check_lease uuid`,
  `CREATE INDEX arena_native_disclosure_queue ON yunipals_arena.frozen_input(deployment,native_check_at,tournament_id)`
] as const;
const checksum = createHash("sha256")
  .update(JSON.stringify(statements))
  .digest("hex");

/** An application-work schedule, never a chain ingestion cursor. Existing
 * ciphertext, revelation evidence and immutable job identities are retained.
 */
export async function migrateArenaDisclosureQueue(db: PoolClient) {
  const row = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=4"
    )
  ).rows[0];
  if (row) {
    if (row.checksum !== checksum)
      throw new Error("Arena disclosure queue migration checksum changed.");
    return;
  }
  for (const statement of statements) await db.query(statement);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(4,$1)",
    [checksum]
  );
}

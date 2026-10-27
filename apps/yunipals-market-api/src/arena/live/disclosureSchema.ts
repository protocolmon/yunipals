import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const sql = `ALTER TABLE yunipals_arena.frozen_input ADD COLUMN IF NOT EXISTS revealed_event_id text,
  ADD COLUMN IF NOT EXISTS revealed_block_hash text,
  ADD CONSTRAINT arena_disclosure_evidence CHECK(
    (revealed_event_id IS NULL AND revealed_block_hash IS NULL)
    OR (revealed_event_id IS NOT NULL AND length(revealed_event_id)>0
      AND revealed_block_hash IS NOT NULL AND revealed_block_hash~'^0x[0-9a-f]{64}$' AND revealed_at IS NOT NULL))`;
const checksum = createHash("sha256").update(sql).digest("hex");
export async function migrateArenaDisclosure(db: PoolClient) {
  const row = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=3"
    )
  ).rows[0];
  if (row) {
    if (row.checksum !== checksum)
      throw new Error("Arena disclosure migration checksum changed.");
    return;
  }
  await db.query(sql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(3,$1)",
    [checksum]
  );
}

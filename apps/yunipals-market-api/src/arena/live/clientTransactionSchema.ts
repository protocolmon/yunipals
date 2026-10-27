import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `ALTER TABLE yunipals_arena.client_transaction
    ADD COLUMN reader_mode text NOT NULL DEFAULT 'legacy' CHECK(reader_mode IN('legacy','unified')),
    ADD COLUMN tournament_id numeric(78),ADD COLUMN incarnation text,
    ADD COLUMN receipt_block_number bigint,ADD COLUMN receipt_block_hash text,
    ADD COLUMN receipt_finalized boolean NOT NULL DEFAULT false,ADD COLUMN proof_event_id text,
    ADD COLUMN verified_release_id text CHECK(verified_release_id~'^0x[0-9a-f]{64}$'),
    ADD CONSTRAINT arena_client_origin FOREIGN KEY(deployment,tournament_id,incarnation)
      REFERENCES yunipals_arena.tournament_identity(deployment,tournament_id,incarnation) ON UPDATE CASCADE,
    ADD CONSTRAINT arena_client_native_origin CHECK(reader_mode='legacy' OR COALESCE(
      ((action->>'kind')='claim' AND tournament_id IS NULL AND incarnation IS NULL) OR
      ((action->>'kind') IN('entry','approval') AND tournament_id IS NOT NULL AND incarnation IS NOT NULL
        AND tournament_id::text=action->>'tournamentId' AND incarnation~'^0x[0-9a-f]{64}$' AND incarnation=action->>'incarnation'),false)),
    ADD CONSTRAINT arena_client_receipt_identity CHECK(
      (receipt_block_number IS NULL AND receipt_block_hash IS NULL) OR
      (receipt_block_number IS NOT NULL AND receipt_block_number>=0 AND receipt_block_hash IS NOT NULL AND receipt_block_hash~'^0x[0-9a-f]{64}$'))`,
  `CREATE INDEX arena_native_client_queue ON yunipals_arena.client_transaction(deployment,next_check_at)
    WHERE reader_mode='unified' AND NOT receipt_finalized`,
  `CREATE TABLE yunipals_arena.client_receipt_history (
    deployment text NOT NULL,transaction_hash text NOT NULL,block_hash text NOT NULL CHECK(block_hash~'^0x[0-9a-f]{64}$'),
    block_number bigint NOT NULL CHECK(block_number>=0),receipt jsonb NOT NULL,
    canonical boolean NOT NULL,finalized boolean NOT NULL DEFAULT false,
    first_seen_at timestamptz NOT NULL DEFAULT now(),checked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(deployment,transaction_hash,block_hash),
    FOREIGN KEY(deployment,transaction_hash) REFERENCES yunipals_arena.client_transaction(deployment,hash))`,
  `CREATE FUNCTION yunipals_arena.client_tracking_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $client$
    BEGIN
      IF (OLD.deployment,OLD.hash,OLD.wallet,OLD.created_at,OLD.action-'incarnation')
        IS DISTINCT FROM (NEW.deployment,NEW.hash,NEW.wallet,NEW.created_at,NEW.action-'incarnation')
        OR (OLD.reader_mode='unified' AND (OLD.reader_mode,OLD.tournament_id,OLD.incarnation,OLD.action)
          IS DISTINCT FROM (NEW.reader_mode,NEW.tournament_id,NEW.incarnation,NEW.action))
        THEN RAISE EXCEPTION 'Arena client transaction binding is immutable'; END IF;
      RETURN NEW;
    END $client$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.client_tracking_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_client_tracking_immutable BEFORE UPDATE ON yunipals_arena.client_transaction
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.client_tracking_immutable()`,
  `CREATE FUNCTION yunipals_arena.client_receipt_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $client$
    BEGIN
      IF (OLD.deployment,OLD.transaction_hash,OLD.block_hash,OLD.block_number,OLD.receipt,OLD.first_seen_at)
        IS DISTINCT FROM (NEW.deployment,NEW.transaction_hash,NEW.block_hash,NEW.block_number,NEW.receipt,NEW.first_seen_at)
        THEN RAISE EXCEPTION 'Arena client receipt history is immutable'; END IF;
      RETURN NEW;
    END $client$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.client_receipt_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_client_receipt_immutable BEFORE UPDATE ON yunipals_arena.client_receipt_history
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.client_receipt_immutable()`
] as const;
const checksum = createHash("sha256")
  .update(JSON.stringify(statements))
  .digest("hex");
export const arenaClientTransactionMigration = {
  version: 6,
  checksum
} as const;

export async function migrateArenaClientTransactions(db: PoolClient) {
  const row = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=6"
    )
  ).rows[0];
  if (row) {
    if (row.checksum !== checksum)
      throw new Error("Arena client transaction migration checksum changed.");
    return;
  }
  for (const sql of statements) await db.query(sql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(6,$1)",
    [checksum]
  );
}

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `ALTER TABLE yunipals_arena.transaction_intent
    ADD COLUMN action_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN checked_at timestamptz,
    ADD COLUMN receipt_finalized boolean NOT NULL DEFAULT false,
    DROP CONSTRAINT transaction_intent_pkey,
    ADD PRIMARY KEY(action_id)`,
  `ALTER TABLE yunipals_arena.transaction_intent ALTER COLUMN incarnation DROP NOT NULL,
    ADD CONSTRAINT arena_intent_origin CHECK(incarnation IS NOT NULL OR purpose='open-lobby'),
    ADD CONSTRAINT arena_intent_deployment FOREIGN KEY(deployment) REFERENCES yunipals_arena.deployment(id),
    ADD CONSTRAINT arena_intent_action_deployment UNIQUE(action_id,deployment,tournament_id),
    ADD CONSTRAINT arena_intent_key UNIQUE NULLS NOT DISTINCT(deployment,purpose,tournament_id,incarnation)`,
  // Fail on an existing cross-deployment conflict instead of silently erasing a
  // signed transaction. Application advisory locks already use this global key.
  `CREATE UNIQUE INDEX arena_intent_global_nonce ON yunipals_arena.transaction_intent(lower(signer),nonce)`,
  `CREATE TABLE yunipals_arena.transaction_receipt_history (
    action_id uuid NOT NULL REFERENCES yunipals_arena.transaction_intent(action_id),
    block_hash text NOT NULL CHECK(block_hash~'^0x[0-9a-f]{64}$'),
    block_number bigint NOT NULL CHECK(block_number>=0),receipt jsonb NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),checked_at timestamptz NOT NULL DEFAULT now(),
    canonical boolean NOT NULL,finalized boolean NOT NULL DEFAULT false,
    PRIMARY KEY(action_id,block_hash))`,
  `CREATE TABLE yunipals_arena.opening_action_observation (
    action_id uuid NOT NULL REFERENCES yunipals_arena.transaction_intent(action_id),
    deployment text NOT NULL,tournament_id numeric(78) NOT NULL,incarnation text NOT NULL CHECK(incarnation~'^0x[0-9a-f]{64}$'),
    release_id text NOT NULL CHECK(release_id~'^0x[0-9a-f]{64}$'),observed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(action_id,incarnation),
    FOREIGN KEY(action_id,deployment,tournament_id) REFERENCES yunipals_arena.transaction_intent(action_id,deployment,tournament_id),
    FOREIGN KEY(deployment,tournament_id,incarnation)
      REFERENCES yunipals_arena.tournament_identity(deployment,tournament_id,incarnation) ON UPDATE CASCADE)`,
  `CREATE FUNCTION yunipals_arena.intent_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $intent$
    BEGIN
      IF (OLD.action_id,OLD.deployment,OLD.purpose,OLD.tournament_id,OLD.signer,OLD.nonce,OLD.raw_transaction,OLD.tx_hash)
        IS DISTINCT FROM (NEW.action_id,NEW.deployment,NEW.purpose,NEW.tournament_id,NEW.signer,NEW.nonce,NEW.raw_transaction,NEW.tx_hash)
        OR ((OLD.incarnation IS DISTINCT FROM NEW.incarnation)
          AND (OLD.incarnation='legacy' AND NEW.incarnation~'^0x[0-9a-f]{64}$') IS NOT TRUE)
        THEN RAISE EXCEPTION 'Arena signed intent is immutable'; END IF;
      RETURN NEW;
    END $intent$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.intent_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_intent_immutable BEFORE UPDATE ON yunipals_arena.transaction_intent
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.intent_immutable()`,
  `CREATE FUNCTION yunipals_arena.receipt_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $receipt$
    BEGIN
      IF (OLD.action_id,OLD.block_hash,OLD.block_number,OLD.receipt,OLD.first_seen_at)
        IS DISTINCT FROM (NEW.action_id,NEW.block_hash,NEW.block_number,NEW.receipt,NEW.first_seen_at)
        THEN RAISE EXCEPTION 'Arena receipt history is immutable'; END IF;
      RETURN NEW;
    END $receipt$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.receipt_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_receipt_immutable BEFORE UPDATE ON yunipals_arena.transaction_receipt_history
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.receipt_immutable()`,
  // NULL belongs only to a pending opening action; its composite FK deliberately
  // has no tournament target. Every other native private write remains fenced.
  `CREATE OR REPLACE FUNCTION yunipals_arena.ensure_legacy_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $identity$
    DECLARE mode text; selected_id numeric;
    BEGIN
      IF TG_TABLE_NAME='tournament' THEN selected_id:=NEW.id;
      ELSE selected_id:=NEW.tournament_id; END IF;
      IF TG_TABLE_NAME<>'tournament' THEN
        IF NEW.incarnation IS DISTINCT FROM 'legacy' THEN RETURN NEW; END IF;
      END IF;
      SELECT d.indexer_mode INTO mode FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment;
      IF mode IS DISTINCT FROM 'legacy' THEN RAISE EXCEPTION 'Legacy Arena writes are fenced'; END IF;
      INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,cipher_context)
        VALUES(NEW.deployment,selected_id,'legacy',NEW.deployment||'/'||selected_id::text) ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $identity$`
] as const;
const checksum = createHash("sha256")
  .update(JSON.stringify(statements))
  .digest("hex");
export const arenaTransactionMigration = { version: 5, checksum } as const;

export async function migrateArenaTransactions(db: PoolClient) {
  const row = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=5"
    )
  ).rows[0];
  if (row) {
    if (row.checksum !== checksum)
      throw new Error("Arena transaction migration checksum changed.");
    return;
  }
  for (const sql of statements) await db.query(sql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(5,$1)",
    [checksum]
  );
}

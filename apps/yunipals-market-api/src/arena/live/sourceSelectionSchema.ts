import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `CREATE TABLE yunipals_arena.source_operational_cursor (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    indexed_block bigint NOT NULL CHECK(indexed_block>=0),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    observed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_selection (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    epoch uuid NOT NULL,kind text NOT NULL CHECK(kind IN('unified','legacy_rollback')),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    accepted_block bigint NOT NULL CHECK(accepted_block>=0),
    accepted_hash text NOT NULL CHECK(accepted_hash~'^0x[0-9a-f]{64}$'),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_switch_history (
    epoch uuid PRIMARY KEY,deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    review jsonb NOT NULL,switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE FUNCTION yunipals_arena.source_switch_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN RAISE EXCEPTION 'Arena source switch history is immutable'; END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_switch_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_switch_immutable BEFORE UPDATE OR DELETE ON yunipals_arena.source_switch_history
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`,
  `CREATE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block)
        THEN RAISE EXCEPTION 'Arena source floor cannot be reset'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_selection_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_selection_fence BEFORE INSERT OR UPDATE ON yunipals_arena.source_selection
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_selection_fence()`
] as const;

export const arenaSourceSelectionMigration = {
  version: 9,
  checksum: createHash("sha256")
    .update(JSON.stringify(statements))
    .digest("hex")
};

// A deployment with no reviewed switch can still be removed by explicit
// fixture/deployment teardown. This watermark is derived coverage, not private
// history. Reviewed deployments remain protected by their immutable ledger FK.
const watermarkSql = `ALTER TABLE yunipals_arena.source_operational_cursor
  DROP CONSTRAINT source_operational_cursor_deployment_fkey,
  ADD CONSTRAINT source_operational_cursor_deployment_fkey FOREIGN KEY(deployment)
  REFERENCES yunipals_arena.deployment(id) ON DELETE CASCADE`;
export const arenaSourceWatermarkMigration = {
  version: 10,
  checksum: createHash("sha256").update(watermarkSql).digest("hex")
};
const deleteFenceSql = `CREATE TRIGGER arena_source_selection_no_delete BEFORE DELETE ON yunipals_arena.source_selection
  FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`;
export const arenaSourceDeleteFenceMigration = {
  version: 11,
  checksum: createHash("sha256").update(deleteFenceSql).digest("hex")
};
const predecessorStatements = [
  `CREATE OR REPLACE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE previous jsonb;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' THEN
        IF NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block OR NEW.epoch=OLD.epoch
          THEN RAISE EXCEPTION 'Arena source change requires a fresh epoch and nondecreasing floor'; END IF;
        previous:=jsonb_build_object('epoch',OLD.epoch::text,'kind',OLD.kind,'source_id',OLD.source_id);
      ELSE previous:='null'::jsonb; END IF;
      IF NEW.accepted_block<COALESCE((SELECT c.indexed_block FROM yunipals_arena.source_operational_cursor c WHERE c.deployment=NEW.deployment),0)
        THEN RAISE EXCEPTION 'Arena source is below the accepted operational floor'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash
        AND h.review->'previous'=previous)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review for its current predecessor'; END IF;
      RETURN NEW;
    END $source$`,
  `CREATE FUNCTION yunipals_arena.source_watermark_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE selected text; selected_deployment text;
    BEGIN
      IF TG_OP='DELETE' THEN selected_deployment:=OLD.deployment; ELSE selected_deployment:=NEW.deployment; END IF;
      PERFORM pg_advisory_xact_lock_shared(hashtext('arena/source-selection/'||selected_deployment));
      IF TG_OP='DELETE' THEN
        IF EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=OLD.deployment)
          THEN RAISE EXCEPTION 'Arena operational floor cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.indexed_block<OLD.indexed_block)
        THEN RAISE EXCEPTION 'Arena operational floor cannot decrease'; END IF;
      SELECT s.source_id INTO selected FROM yunipals_arena.source_selection s WHERE s.deployment=NEW.deployment;
      IF selected IS NOT NULL AND NEW.source_id<>selected
        THEN RAISE EXCEPTION 'Arena watermark source epoch changed'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_watermark_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_watermark_fence BEFORE INSERT OR UPDATE OR DELETE ON yunipals_arena.source_operational_cursor
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_watermark_fence()`
] as const;
export const arenaSourcePredecessorMigration = {
  version: 12,
  checksum: createHash("sha256")
    .update(JSON.stringify(predecessorStatements))
    .digest("hex")
};
async function migrateArenaSourcePredecessor(db: PoolClient) {
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [arenaSourcePredecessorMigration.version]
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== arenaSourcePredecessorMigration.checksum)
      throw new Error("Arena source predecessor checksum changed.");
    return;
  }
  for (const statement of predecessorStatements) await db.query(statement);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES($1,$2)",
    [
      arenaSourcePredecessorMigration.version,
      arenaSourcePredecessorMigration.checksum
    ]
  );
}
async function migrateArenaSourceDeleteFence(db: PoolClient) {
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [arenaSourceDeleteFenceMigration.version]
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== arenaSourceDeleteFenceMigration.checksum)
      throw new Error("Arena source delete fence checksum changed.");
    await migrateArenaSourcePredecessor(db);
    return;
  }
  await db.query(deleteFenceSql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES($1,$2)",
    [
      arenaSourceDeleteFenceMigration.version,
      arenaSourceDeleteFenceMigration.checksum
    ]
  );
  await migrateArenaSourcePredecessor(db);
}
async function migrateArenaSourceWatermark(db: PoolClient) {
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [arenaSourceWatermarkMigration.version]
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== arenaSourceWatermarkMigration.checksum)
      throw new Error("Arena source watermark migration checksum changed.");
    await migrateArenaSourceDeleteFence(db);
    return;
  }
  await db.query(watermarkSql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES($1,$2)",
    [
      arenaSourceWatermarkMigration.version,
      arenaSourceWatermarkMigration.checksum
    ]
  );
  await migrateArenaSourceDeleteFence(db);
}

export async function migrateArenaSourceSelection(db: PoolClient) {
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [arenaSourceSelectionMigration.version]
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== arenaSourceSelectionMigration.checksum)
      throw new Error("Arena source selection migration checksum changed.");
    await migrateArenaSourceWatermark(db);
    return;
  }
  for (const statement of statements) await db.query(statement);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES($1,$2)",
    [
      arenaSourceSelectionMigration.version,
      arenaSourceSelectionMigration.checksum
    ]
  );
  await migrateArenaSourceWatermark(db);
}

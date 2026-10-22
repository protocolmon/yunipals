import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const arenaPrivateTables = [
  "submission",
  "fighter_snapshot",
  "frozen_input",
  "admission",
  "provider_task",
  "transaction_intent",
  "adjudication",
  "media_job"
] as const;

// An identity is durable application history, never evidence that its opening
// remains canonical. Legacy placeholders preserve existing ciphertext contexts.
const statements = [
  `ALTER TABLE yunipals_arena.deployment ADD COLUMN IF NOT EXISTS indexer_mode text NOT NULL DEFAULT 'legacy'
    CHECK(indexer_mode IN('legacy','unified'))`,
  `CREATE TABLE yunipals_arena.tournament_identity (
    deployment text NOT NULL REFERENCES yunipals_arena.deployment(id) ON DELETE CASCADE,
    tournament_id numeric(78) NOT NULL,incarnation text NOT NULL,
    opened_event_id text,opened_block_hash text,bound_release_id text,bound_at timestamptz,
    cipher_context text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(deployment,tournament_id,incarnation),
    CHECK((incarnation='legacy' AND opened_event_id IS NULL AND opened_block_hash IS NULL
      AND bound_release_id IS NULL AND bound_at IS NULL)
      OR (incarnation~'^0x[0-9a-f]{64}$' AND opened_event_id IS NOT NULL
      AND opened_block_hash~'^0x[0-9a-f]{64}$' AND bound_release_id~'^0x[0-9a-f]{64}$' AND bound_at IS NOT NULL))
  )`,
  `CREATE FUNCTION yunipals_arena.ensure_legacy_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $identity$
    DECLARE mode text; selected_id numeric;
    BEGIN
      IF TG_TABLE_NAME='tournament' THEN selected_id:=NEW.id;
      ELSE selected_id:=NEW.tournament_id; END IF;
      IF TG_TABLE_NAME<>'tournament' THEN
        IF NEW.incarnation<>'legacy' THEN RETURN NEW; END IF;
      END IF;
      SELECT d.indexer_mode INTO mode FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment;
      IF mode IS DISTINCT FROM 'legacy' THEN RAISE EXCEPTION 'Legacy Arena writes are fenced'; END IF;
      INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,cipher_context)
        VALUES(NEW.deployment,selected_id,'legacy',NEW.deployment||'/'||selected_id::text) ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $identity$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.ensure_legacy_identity() FROM PUBLIC`,
  `CREATE TRIGGER arena_legacy_identity AFTER INSERT ON yunipals_arena.tournament
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.ensure_legacy_identity()`,
  `CREATE FUNCTION yunipals_arena.identity_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $identity$
    BEGIN
      IF (OLD.deployment,OLD.tournament_id,OLD.cipher_context,OLD.created_at)
        IS DISTINCT FROM (NEW.deployment,NEW.tournament_id,NEW.cipher_context,NEW.created_at)
        OR (OLD.incarnation<>'legacy' AND OLD IS DISTINCT FROM NEW)
        THEN RAISE EXCEPTION 'Arena identity history is immutable'; END IF;
      RETURN NEW;
    END $identity$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.identity_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_identity_immutable BEFORE UPDATE ON yunipals_arena.tournament_identity
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.identity_immutable()`
] as const;

const checksum = createHash("sha256")
  .update(
    JSON.stringify({ statements, tables: arenaPrivateTables, version: 1 })
  )
  .digest("hex");

/** Caller holds the Arena migration lock in one transaction. All private FKs
 * become durable; deleting/replaying a public tournament cannot erase them.
 */
export async function migrateArenaIdentities(db: PoolClient) {
  await db.query(`CREATE TABLE IF NOT EXISTS yunipals_arena.operational_migration(
    version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=1"
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== checksum)
      throw new Error("Arena identity migration checksum changed.");
    await migrateIdentityEvidence(db);
    return;
  }
  for (const sql of statements) await db.query(sql);
  const origins = [
    "SELECT deployment,id AS tournament_id FROM yunipals_arena.tournament",
    ...arenaPrivateTables.map(
      (table) => `SELECT deployment,tournament_id FROM yunipals_arena.${table}`
    )
  ].join(" UNION ");
  await db.query(`INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,cipher_context)
    SELECT deployment,tournament_id,'legacy',deployment||'/'||tournament_id::text FROM (${origins}) origins`);
  for (const table of arenaPrivateTables) {
    await db.query(
      `ALTER TABLE yunipals_arena.${table} ADD COLUMN incarnation text NOT NULL DEFAULT 'legacy'`
    );
    const constraints = (
      await db.query<{
        name: string;
        kind: string;
        columns: string[];
        referenced: string | null;
      }>(
        `SELECT c.conname AS name,c.contype AS kind,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY key(attnum,position)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum ORDER BY key.position) AS columns,
        CASE WHEN c.confrelid<>0 THEN c.confrelid::regclass::text END AS referenced
        FROM pg_constraint c WHERE c.conrelid=$1::regclass`,
        [`yunipals_arena.${table}`]
      )
    ).rows;
    const primary = constraints.find((row) => row.kind === "p");
    if (!primary || primary.columns.includes("incarnation"))
      throw new Error("Unexpected Arena private primary key.");
    for (const row of constraints) {
      if (row.kind === "f" && row.referenced === "yunipals_arena.tournament")
        await db.query(
          `ALTER TABLE yunipals_arena.${table} DROP CONSTRAINT "${row.name.replaceAll('"', '""')}"`
        );
    }
    await db.query(`ALTER TABLE yunipals_arena.${table} DROP CONSTRAINT "${primary.name.replaceAll('"', '""')}",
      ADD PRIMARY KEY(${[...primary.columns, "incarnation"].map((name) => `"${name.replaceAll('"', '""')}"`).join(",")}),
      ADD CONSTRAINT arena_${table}_identity FOREIGN KEY(deployment,tournament_id,incarnation)
      REFERENCES yunipals_arena.tournament_identity(deployment,tournament_id,incarnation) ON UPDATE CASCADE`);
    await db.query(`CREATE TRIGGER arena_legacy_identity BEFORE INSERT ON yunipals_arena.${table}
      FOR EACH ROW EXECUTE FUNCTION yunipals_arena.ensure_legacy_identity()`);
  }
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(1,$1)",
    [checksum]
  );
  await migrateIdentityEvidence(db);
}

// PostgreSQL CHECK permits NULL results. A bound identity must supply every
// evidence field, rather than let a half-bound row satisfy the regex checks.
const evidenceSql = `ALTER TABLE yunipals_arena.tournament_identity ADD CONSTRAINT arena_identity_bound_evidence
  CHECK(incarnation='legacy' OR (opened_event_id IS NOT NULL AND length(opened_event_id)>0
    AND opened_block_hash IS NOT NULL AND bound_release_id IS NOT NULL AND bound_at IS NOT NULL))`;
const evidenceChecksum = createHash("sha256").update(evidenceSql).digest("hex");
async function migrateIdentityEvidence(db: PoolClient) {
  const previous = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=2"
    )
  ).rows[0];
  if (previous) {
    if (previous.checksum !== evidenceChecksum)
      throw new Error("Arena identity evidence migration checksum changed.");
    return;
  }
  await db.query(evidenceSql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(2,$1)",
    [evidenceChecksum]
  );
}

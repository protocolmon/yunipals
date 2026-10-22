import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `ALTER TABLE yunipals_arena.provider_task
    ADD COLUMN native_check_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN native_check_lease uuid`,
  `CREATE INDEX arena_native_provider_queue ON yunipals_arena.provider_task(deployment,native_check_at)
    WHERE incarnation<>'legacy' AND state NOT IN('completed','failed','incomplete','cancelled')`,
  `CREATE TABLE yunipals_arena.provider_action_evidence (
    request_id text PRIMARY KEY REFERENCES yunipals_arena.provider_task(request_id),
    evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=8192),
    recorded_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE FUNCTION yunipals_arena.provider_evidence_binding() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $provider$
    DECLARE task yunipals_arena.provider_task; BEGIN
      SELECT * INTO task FROM yunipals_arena.provider_task WHERE request_id=NEW.request_id;
      IF NOT COALESCE(task.incarnation~'^0x[0-9a-f]{64}$' AND task.deployment=NEW.evidence->>'deployment'
        AND task.tournament_id::text=NEW.evidence->>'tournamentId' AND task.incarnation=NEW.evidence->>'incarnation'
        AND (NEW.evidence->>'releaseId')~'^0x[0-9a-f]{64}$' AND (NEW.evidence->>'openedBlockHash')~'^0x[0-9a-f]{64}$'
        AND (NEW.evidence->>'frozenBlockHash')~'^0x[0-9a-f]{64}$' AND (NEW.evidence->>'inputHash')~'^0x[0-9a-f]{64}$'
        AND length(NEW.evidence->>'openedEventId')>0 AND length(NEW.evidence->>'frozenEventId')>0
        AND ((task.kind='referee' AND NEW.evidence->'resultHash'='null'::jsonb)
          OR (task.kind='media' AND (NEW.evidence->>'resultHash')~'^0x[0-9a-f]{64}$')),false)
        THEN RAISE EXCEPTION 'Arena provider evidence binding is invalid'; END IF;
      RETURN NEW;
    END $provider$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.provider_evidence_binding() FROM PUBLIC`,
  `CREATE TRIGGER arena_provider_evidence_binding BEFORE INSERT ON yunipals_arena.provider_action_evidence
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.provider_evidence_binding()`,
  `CREATE FUNCTION yunipals_arena.provider_task_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $provider$
    BEGIN
      IF (OLD.deployment,OLD.tournament_id,OLD.kind,OLD.asset,OLD.request_id,OLD.request,OLD.reserved_microusd)
        IS DISTINCT FROM (NEW.deployment,NEW.tournament_id,NEW.kind,NEW.asset,NEW.request_id,NEW.request,NEW.reserved_microusd)
        OR (OLD.incarnation<>'legacy' AND OLD.incarnation IS DISTINCT FROM NEW.incarnation)
        OR (OLD.provider_id IS NOT NULL AND OLD.provider_id IS DISTINCT FROM NEW.provider_id)
        OR (OLD.state IN('completed','failed','incomplete','cancelled') AND (OLD.state,OLD.response) IS DISTINCT FROM (NEW.state,NEW.response))
        THEN RAISE EXCEPTION 'Arena provider request history is immutable'; END IF;
      RETURN NEW;
    END $provider$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.provider_task_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_provider_task_immutable BEFORE UPDATE ON yunipals_arena.provider_task
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.provider_task_immutable()`,
  `CREATE FUNCTION yunipals_arena.provider_evidence_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $provider$
    BEGIN
      IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Arena provider action evidence is immutable'; END IF;
      RETURN NEW;
    END $provider$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.provider_evidence_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_provider_evidence_immutable BEFORE UPDATE ON yunipals_arena.provider_action_evidence
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.provider_evidence_immutable()`
] as const;
const checksum = createHash("sha256")
  .update(JSON.stringify(statements))
  .digest("hex");
export const arenaProviderMigration = { version: 7, checksum } as const;

export async function migrateArenaProviders(db: PoolClient) {
  const prior = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=7"
    )
  ).rows[0];
  if (prior) {
    if (prior.checksum !== checksum)
      throw new Error("Arena provider migration checksum changed.");
    return;
  }
  for (const sql of statements) await db.query(sql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(7,$1)",
    [checksum]
  );
}

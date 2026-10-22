import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const statements = [
  `CREATE TABLE yunipals_arena.media_publication (
    deployment text NOT NULL,tournament_id numeric(78) NOT NULL,incarnation text NOT NULL CHECK(incarnation~'^0x[0-9a-f]{64}$'),
    publication_hash text NOT NULL CHECK(publication_hash~'^0x[0-9a-f]{64}$'),
    manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=16384),
    source_evidence jsonb NOT NULL CHECK(jsonb_typeof(source_evidence)='object' AND octet_length(source_evidence::text)<=8192),
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(deployment,tournament_id,incarnation,publication_hash),
    UNIQUE(deployment,tournament_id,incarnation),
    FOREIGN KEY(deployment,tournament_id,incarnation) REFERENCES yunipals_arena.tournament_identity(deployment,tournament_id,incarnation))`,
  `CREATE FUNCTION yunipals_arena.media_publication_binding() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN
      IF NOT COALESCE(NEW.manifest->>'deployment'=NEW.deployment AND NEW.manifest->>'tournamentId'=NEW.tournament_id::text
        AND NEW.manifest->>'incarnation'=NEW.incarnation AND NEW.source_evidence->>'deployment'=NEW.deployment
        AND NEW.source_evidence->>'tournamentId'=NEW.tournament_id::text AND NEW.source_evidence->>'incarnation'=NEW.incarnation
        AND (NEW.manifest->>'inputHash')~'^0x[0-9a-f]{64}$' AND (NEW.manifest->>'outcomeHash')~'^0x[0-9a-f]{64}$'
        AND NEW.source_evidence->>'inputHash'=NEW.manifest->>'inputHash' AND NEW.source_evidence->>'resultHash'=NEW.manifest->>'outcomeHash'
        AND (NEW.source_evidence->>'releaseId')~'^0x[0-9a-f]{64}$' AND (NEW.source_evidence->>'openedBlockHash')~'^0x[0-9a-f]{64}$'
        AND (NEW.source_evidence->>'frozenBlockHash')~'^0x[0-9a-f]{64}$' AND length(NEW.source_evidence->>'openedEventId')>0
        AND length(NEW.source_evidence->>'frozenEventId')>0,false) THEN RAISE EXCEPTION 'Arena media publication evidence is invalid'; END IF;
      RETURN NEW;
    END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_publication_binding() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_publication_binding BEFORE INSERT ON yunipals_arena.media_publication
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_publication_binding()`,
  `ALTER TABLE yunipals_arena.media_job ADD COLUMN input_hash text,ADD COLUMN outcome_hash text,ADD COLUMN publication_hash text,
    ADD COLUMN native_check_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN native_check_lease uuid,
    ADD CONSTRAINT arena_media_input_pair CHECK((input_hash IS NULL AND outcome_hash IS NULL) OR
      (input_hash IS NOT NULL AND outcome_hash IS NOT NULL AND input_hash~'^0x[0-9a-f]{64}$' AND outcome_hash~'^0x[0-9a-f]{64}$')),
    ADD CONSTRAINT arena_media_publication_parent FOREIGN KEY(deployment,tournament_id,incarnation,publication_hash)
      REFERENCES yunipals_arena.media_publication(deployment,tournament_id,incarnation,publication_hash),
    ADD CONSTRAINT arena_media_publication_ready CHECK(publication_hash IS NULL OR (state='ready' AND input_hash IS NOT NULL
      AND outcome_hash IS NOT NULL AND film_sha256 IS NOT NULL AND film_sha256~'^[0-9a-f]{64}$'))`,
  `CREATE INDEX arena_native_media_queue ON yunipals_arena.media_job(deployment,native_check_at) WHERE incarnation<>'legacy'`,
  `CREATE FUNCTION yunipals_arena.media_publication_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Arena media publication is immutable'; END IF; RETURN NEW; END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_publication_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_publication_immutable BEFORE UPDATE ON yunipals_arena.media_publication
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_publication_immutable()`,
  `CREATE FUNCTION yunipals_arena.media_job_binding() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN
      IF TG_OP='UPDATE' AND OLD.input_hash IS NOT NULL AND (OLD.input_hash,OLD.outcome_hash)
        IS DISTINCT FROM (NEW.input_hash,NEW.outcome_hash) THEN RAISE EXCEPTION 'Arena media input binding is immutable'; END IF;
      IF NEW.publication_hash IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM yunipals_arena.media_publication p WHERE p.deployment=NEW.deployment AND p.tournament_id=NEW.tournament_id
          AND p.incarnation=NEW.incarnation AND p.publication_hash=NEW.publication_hash
          AND p.manifest->>'inputHash'=NEW.input_hash AND p.manifest->>'outcomeHash'=NEW.outcome_hash
          AND p.manifest->>'filmSha256'=NEW.film_sha256 AND p.manifest->>'incarnation'=NEW.incarnation
          AND p.manifest->>'deployment'=NEW.deployment AND p.manifest->>'tournamentId'=NEW.tournament_id::text
      ) THEN RAISE EXCEPTION 'Arena media publication binding is invalid'; END IF;
      RETURN NEW;
    END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_job_binding() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_job_binding BEFORE INSERT OR UPDATE ON yunipals_arena.media_job
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_job_binding()`
] as const;
const checksum = createHash("sha256")
  .update(JSON.stringify(statements))
  .digest("hex");
export const arenaMediaMigration = { version: 8, checksum } as const;
export async function migrateArenaMedia(db: PoolClient) {
  const prior = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=8"
    )
  ).rows[0];
  if (prior) {
    if (prior.checksum !== checksum)
      throw new Error("Arena media migration checksum changed.");
    return;
  }
  for (const sql of statements) await db.query(sql);
  await db.query(
    "INSERT INTO yunipals_arena.operational_migration(version,checksum) VALUES(8,$1)",
    [checksum]
  );
}

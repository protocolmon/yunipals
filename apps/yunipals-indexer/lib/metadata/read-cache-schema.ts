import type { PoolClient } from "pg";
import { bnbSchema, physicalPonderSchema } from "../offchain/sql.js";
import { collectionSlugs } from "../constants.js";

export const readCacheSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS metadata_projection.read_epoch (
    collection text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.read_guard (
    collection text NOT NULL, relation text NOT NULL, relation_oid oid NOT NULL,
    PRIMARY KEY(collection,relation))`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.read_set (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    collection text NOT NULL, revision bigint NOT NULL, guard_count integer NOT NULL,
    source_mode text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(generation_id,collection))`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.read_member (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    collection text NOT NULL, token_id numeric NOT NULL, lifecycle integer NOT NULL,
    has_search boolean NOT NULL, metadata_available boolean NOT NULL,
    rarity_points numeric, rarity_points_capped numeric,
    PRIMARY KEY(generation_id,collection,token_id))
    WITH(vacuum_truncate=false,toast.vacuum_truncate=false,
      autovacuum_vacuum_scale_factor=0.05,autovacuum_analyze_scale_factor=0.05)`,
  `CREATE INDEX IF NOT EXISTS read_member_missing_idx
    ON metadata_projection.read_member(generation_id,collection,token_id)
    INCLUDE(lifecycle) WHERE NOT has_search`,
  `CREATE INDEX IF NOT EXISTS read_member_available_idx
    ON metadata_projection.read_member(generation_id,collection,metadata_available,token_id,lifecycle)`,
  `CREATE OR REPLACE FUNCTION metadata_projection.read_cache_dirty()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path=pg_catalog,metadata_projection AS $$
    DECLARE kind text:=TG_ARGV[0]; old_collection text; new_collection text;

    BEGIN
      IF TG_OP='TRUNCATE' THEN
        UPDATE metadata_projection.read_epoch SET revision=revision+1
          WHERE collection=ANY(string_to_array(TG_ARGV[1],','));
        RETURN NULL;
      END IF;
      IF TG_OP='UPDATE' THEN
        IF kind='token' THEN IF (OLD.collection,OLD.token_id,OLD.lifecycle)
          IS NOT DISTINCT FROM (NEW.collection,NEW.token_id,NEW.lifecycle) THEN RETURN NULL; END IF; END IF;
        IF kind='document' THEN IF (OLD.collection,OLD.token_id,OLD.lifecycle,OLD.document,OLD.content_hash,OLD.fetch_status)
          IS NOT DISTINCT FROM (NEW.collection,NEW.token_id,NEW.lifecycle,NEW.document,NEW.content_hash,NEW.fetch_status)
          THEN RETURN NULL; END IF; END IF;
        IF kind='lifecycle' THEN IF (OLD.collection,OLD.token_id,OLD.lifecycle,OLD.mint_block,OLD.mint_transaction_hash)
          IS NOT DISTINCT FROM (NEW.collection,NEW.token_id,NEW.lifecycle,NEW.mint_block,NEW.mint_transaction_hash)
          THEN RETURN NULL; END IF; END IF;
        IF kind='publication' THEN IF (OLD.collection,OLD.token_id,OLD.lifecycle,OLD.source_kind,OLD.release_id,
          OLD.publication_status,OLD.publication_content_hash,OLD.mint_transaction_hash,OLD.mint_log_index,OLD.chain_event_key)
          IS NOT DISTINCT FROM (NEW.collection,NEW.token_id,NEW.lifecycle,NEW.source_kind,NEW.release_id,
          NEW.publication_status,NEW.publication_content_hash,NEW.mint_transaction_hash,NEW.mint_log_index,NEW.chain_event_key)
          THEN RETURN NULL; END IF; END IF;
        IF kind='runtime' THEN IF OLD.base_error IS NOT DISTINCT FROM NEW.base_error THEN RETURN NULL; END IF; END IF;
        IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
      END IF;
      IF kind='mint' THEN
        IF TG_OP='INSERT' AND NEW."from"<>'0x0000000000000000000000000000000000000000' THEN RETURN NULL; END IF;
        IF TG_OP='DELETE' AND OLD."from"<>'0x0000000000000000000000000000000000000000' THEN RETURN NULL; END IF;
        IF TG_OP='UPDATE' AND OLD."from"<>'0x0000000000000000000000000000000000000000'
          AND NEW."from"<>'0x0000000000000000000000000000000000000000' THEN RETURN NULL; END IF;
      END IF;
      IF kind='release' THEN
        UPDATE metadata_projection.read_epoch SET revision=revision+1;
      ELSIF kind IN('base','runtime') THEN
        UPDATE metadata_projection.read_epoch SET revision=revision+1 WHERE collection='base';
      ELSE
        IF TG_OP<>'INSERT' THEN old_collection:=OLD.collection; END IF;
        IF TG_OP<>'DELETE' THEN new_collection:=NEW.collection; END IF;
        UPDATE metadata_projection.read_epoch SET revision=revision+1
          WHERE collection IN(old_collection,new_collection);
      END IF;
      RETURN NULL;
    END $$`,
  // Projection refreshes insert millions of rows. Transition tables let us
  // invalidate each collection once per statement, without per-row lookups.
  `CREATE OR REPLACE FUNCTION metadata_projection.read_cache_projection_dirty()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path=pg_catalog,metadata_projection AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
        UPDATE metadata_projection.read_epoch e SET revision=revision+1
        WHERE e.collection IN (SELECT changed.collection FROM new_rows changed
          JOIN metadata_projection.read_set s ON s.generation_id=changed.generation_id
          JOIN metadata_projection.active a ON s.generation_id IN(a.current_id,a.previous_id));
      ELSIF TG_OP='DELETE' THEN
        UPDATE metadata_projection.read_epoch e SET revision=revision+1
        WHERE e.collection IN (SELECT changed.collection FROM old_rows changed
          JOIN metadata_projection.read_set s ON s.generation_id=changed.generation_id
          JOIN metadata_projection.active a ON s.generation_id IN(a.current_id,a.previous_id));
      ELSE
        UPDATE metadata_projection.read_epoch e SET revision=revision+1
        WHERE e.collection IN (SELECT changed.collection FROM (
          SELECT generation_id,collection FROM old_rows UNION SELECT generation_id,collection FROM new_rows) changed
          JOIN metadata_projection.read_set s ON s.generation_id=changed.generation_id
          JOIN metadata_projection.active a ON s.generation_id IN(a.current_id,a.previous_id));
      END IF;
      RETURN NULL;
    END $$`
] as const;

export async function installReadCache(db: Pick<PoolClient, "query">) {
  for (const sql of readCacheSchemaStatements) await db.query(sql);
  await db.query(
    `INSERT INTO metadata_projection.read_epoch(collection)
    SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`,
    [collectionSlugs]
  );
  const common = [
    ["metadata.token_metadata", "document"],
    ["metadata.token_publication", "publication"],
    ["metadata_projection.search", "projection"],
    ["metadata_projection.revision", "projection"],
    ["metadata_source.archive_release", "release"]
  ];
  const definitions = new Map<string, { kind: string; chains: string[] }>();
  for (const collection of collectionSlugs) {
    const schema = collection === "bnb" ? bnbSchema : physicalPonderSchema;
    const sources = [
      ...common,
      [`${schema}.token`, "token"],
      [`${schema}.token_lifecycle`, "lifecycle"],
      [`${schema}.transfer_event`, "mint"],
      ...(collection === "base"
        ? [
            ["metadata_source.chain_metadata_event", "base"],
            ["metadata_source.chain_metadata_scan", "base"],
            ["metadata.publication_runtime", "runtime"]
          ]
        : [])
    ];
    for (const [relation, kind] of sources) {
      const existing = definitions.get(relation!);
      if (existing) existing.chains.push(collection);
      else definitions.set(relation!, { kind: kind!, chains: [collection] });
    }
  }
  for (const [relation, { kind, chains }] of definitions) {
    if (
      !/^(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*$/i.test(
        relation
      )
    )
      throw new Error("Invalid cache source relation");
    if (kind === "projection") {
      await db.query(`DROP TRIGGER IF EXISTS read_cache_dirty ON ${relation}`);
      for (const [name, event, transition] of [
        ["read_cache_dirty", "INSERT", "NEW TABLE AS new_rows"],
        [
          "read_cache_dirty_update",
          "UPDATE",
          "OLD TABLE AS old_rows NEW TABLE AS new_rows"
        ],
        ["read_cache_dirty_delete", "DELETE", "OLD TABLE AS old_rows"]
      ]) {
        await db.query(`CREATE OR REPLACE TRIGGER ${name} AFTER ${event} ON ${relation}
          REFERENCING ${transition} FOR EACH STATEMENT
          EXECUTE FUNCTION metadata_projection.read_cache_projection_dirty()`);
        await db.query(`ALTER TABLE ${relation} ENABLE ALWAYS TRIGGER ${name}`);
      }
    } else {
      await db.query(`CREATE OR REPLACE TRIGGER read_cache_dirty
        AFTER INSERT OR UPDATE OR DELETE ON ${relation}
        FOR EACH ROW EXECUTE FUNCTION metadata_projection.read_cache_dirty('${kind}')`);
      await db.query(
        `ALTER TABLE ${relation} ENABLE ALWAYS TRIGGER read_cache_dirty`
      );
    }
    await db.query(`CREATE OR REPLACE TRIGGER read_cache_truncate AFTER TRUNCATE ON ${relation}
      FOR EACH STATEMENT EXECUTE FUNCTION metadata_projection.read_cache_dirty('${kind}','${chains.join(",")}')`);
    await db.query(
      `ALTER TABLE ${relation} ENABLE ALWAYS TRIGGER read_cache_truncate`
    );
    await db.query(
      `INSERT INTO metadata_projection.read_guard(collection,relation,relation_oid)
      SELECT unnest($1::text[]),$2::text,$2::text::regclass::oid
      ON CONFLICT(collection,relation) DO UPDATE SET relation_oid=EXCLUDED.relation_oid`,
      [chains, relation]
    );
  }
  // Match the existing projection readers; do not grant cache writes to API roles.
  const readers = await db.query<{ sql: string }>(`SELECT DISTINCT format(
    'GRANT SELECT ON metadata_projection.read_epoch,metadata_projection.read_guard,metadata_projection.read_set,metadata_projection.read_member TO %I',role.rolname) AS sql
    FROM pg_catalog.pg_class relation CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) acl
    JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE relation.oid='metadata_projection.search'::regclass AND acl.privilege_type='SELECT'`);
  for (const { sql } of readers.rows) await db.query(sql);
  // Reinstalling triggers must invalidate sets built before a schema change.
  await db.query(
    "UPDATE metadata_projection.read_epoch SET revision=revision+1"
  );
}

import { pool } from "../offchain/db.js";
import { ponderSchema } from "../offchain/sql.js";
import { collectionSlugs } from "../constants.js";
import {
  localRarityJoin,
  rarityPointsCappedSql,
  rarityPointsSql,
  rarityReadSource
} from "../rarity/read-source.js";

export const scoreVersion = "collector-score-v1";
export const scoreFormula = "1000*ln(1+totalRarity) + 50*monsterCount + 500*uniqueTypes + 750*specialCount + 250*glitterCount";
export const collectionScopes = Array.from({ length: (1 << collectionSlugs.length) - 1 }, (_, index) => {
  const chains = collectionSlugs.filter((_, bit) => (index + 1) & (1 << bit));
  return chains.length === collectionSlugs.length ? "all" : chains.join("+");
});

export async function refreshTraitIndex() {
  const client = await pool.connect();
  const updatedAt = new Date();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('yunipals:trait-refresh'))");
    await client.query("DROP TABLE IF EXISTS metadata.token_search_build, metadata.token_trait_build, metadata.token_search_retired, metadata.token_trait_retired");
    await client.query("CREATE TABLE metadata.token_search_build (LIKE metadata.token_search INCLUDING ALL)");
    await client.query("CREATE TABLE metadata.token_trait_build (LIKE metadata.token_trait INCLUDING ALL)");
    await client.query(`
      INSERT INTO metadata.token_search_build(collection, token_id, lifecycle, metadata_available,
        rarity_points, rarity_points_capped, updated_at)
      SELECT m.collection, m.token_id, m.lifecycle,
        (m.fetch_status = 'success' AND m.document IS NOT NULL),
        ${rarityPointsSql},
        ${rarityPointsCappedSql}, $1
      FROM metadata.token_metadata m
      ${localRarityJoin}
      LEFT JOIN LATERAL (
        SELECT a->>'value' AS value FROM jsonb_array_elements(COALESCE(m.attributes, '[]')) a
        WHERE a->>'trait_type' = 'Rarity Points' LIMIT 1
      ) rp ON true
    `, [updatedAt]);
    await client.query(`
      INSERT INTO metadata.token_trait_build(collection, token_id, lifecycle, trait_type, value, value_numeric)
      SELECT DISTINCT m.collection, m.token_id, m.lifecycle, a->>'trait_type', a->>'value',
        CASE WHEN a->>'value' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (a->>'value')::numeric END
      FROM metadata.token_metadata m
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.attributes, '[]')) a
      WHERE m.fetch_status = 'success' AND m.document IS NOT NULL
        AND a ? 'trait_type' AND a ? 'value'
        AND a->>'trait_type' IS NOT NULL AND a->>'value' IS NOT NULL
    `);
    await client.query("ANALYZE metadata.token_search_build");
    await client.query("ANALYZE metadata.token_trait_build");
    await client.query("BEGIN");
    await client.query("DELETE FROM metadata.trait_facet");
    await client.query("DELETE FROM metadata.trait_facet_status");
    for (const scope of collectionScopes) {
      await client.query(`
        INSERT INTO metadata.trait_facet(scope, trait_type, kind, min_value, max_value, values, updated_at)
        WITH counts AS (
          SELECT f.trait_type, f.value, count(*)::int AS count,
            min(f.value_numeric) AS min_value, max(f.value_numeric) AS max_value,
            bool_and(f.value_numeric IS NOT NULL) AS numeric_value
          FROM metadata.token_trait_build f
          JOIN ${ponderSchema}.token t ON t.collection=f.collection
            AND t.token_id::numeric=f.token_id AND t.lifecycle=f.lifecycle
          WHERE NOT t.burned AND ($1 = 'all' OR t.collection = ANY(string_to_array($1, '+')))
          GROUP BY f.trait_type, f.value
        ), type_stats AS (
          SELECT trait_type, bool_and(numeric_value) AS is_numeric,
            min(min_value) AS min_value, max(max_value) AS max_value FROM counts GROUP BY trait_type
        )
        SELECT $1, s.trait_type, CASE WHEN s.is_numeric THEN 'numeric' ELSE 'categorical' END,
          CASE WHEN s.is_numeric THEN s.min_value END, CASE WHEN s.is_numeric THEN s.max_value END,
          CASE WHEN s.is_numeric THEN NULL ELSE (
            SELECT jsonb_agg(jsonb_build_object('value', c.value, 'count', c.count) ORDER BY c.count DESC, c.value)
            FROM counts c WHERE c.trait_type=s.trait_type
          ) END, $2 FROM type_stats s
      `, [scope, updatedAt]);
      await client.query(`
        INSERT INTO metadata.trait_facet_status(scope, singleton, available, missing, updated_at)
        SELECT $1, true, count(*) FILTER (WHERE s.metadata_available)::int,
          count(*) FILTER (WHERE NOT COALESCE(s.metadata_available,false))::int, $2
        FROM ${ponderSchema}.token t LEFT JOIN metadata.token_search_build s
          ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
        WHERE NOT t.burned AND ($1 = 'all' OR t.collection = ANY(string_to_array($1, '+')))
      `, [scope, updatedAt]);
    }
    await client.query(`
-- Execute in the metadata rebuild transaction before its table-name swap.
-- LIKE INCLUDING ALL does not copy privileges. Keep existing SELECT grants on
-- the replacements, without granting readers access to other metadata tables.
DO $preserve_read_grants$
DECLARE
  source_name text;
  reader record;
BEGIN
  FOREACH source_name IN ARRAY ARRAY['token_search','token_trait'] LOOP
    FOR reader IN
      SELECT acl.grantee,acl.is_grantable
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
      WHERE c.oid=format('metadata.%I',source_name)::regclass
        AND acl.privilege_type='SELECT' AND acl.grantee<>c.relowner
    LOOP
      EXECUTE format('GRANT SELECT ON TABLE metadata.%I TO %s%s',
        source_name||'_build',
        CASE WHEN reader.grantee=0 THEN 'PUBLIC'
          ELSE quote_ident(pg_get_userbyid(reader.grantee)) END,
        CASE WHEN reader.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;
END
$preserve_read_grants$;
    `);
    await client.query("ALTER TABLE metadata.token_search RENAME TO token_search_retired");
    await client.query("ALTER TABLE metadata.token_search_build RENAME TO token_search");
    await client.query("ALTER TABLE metadata.token_trait RENAME TO token_trait_retired");
    await client.query("ALTER TABLE metadata.token_trait_build RENAME TO token_trait");
    await client.query("COMMIT");
    // Rebuilt tables can retain zero all-visible pages after an early vacuum.
    // Refresh visibility after publication so covering indexes stay useful.
    // VACUUM must run outside the publication transaction and must not truncate.
    const settings = (await client.query<{ lockTimeout: string; statementTimeout: string }>(
      `SELECT current_setting('lock_timeout') AS "lockTimeout",
        current_setting('statement_timeout') AS "statementTimeout"`
    )).rows[0]!;
    try {
      await client.query("SELECT set_config('lock_timeout','1500ms',false), set_config('statement_timeout','120s',false)");
      await client.query("VACUUM (ANALYZE, TRUNCATE FALSE, PARALLEL 0) metadata.token_search, metadata.token_trait");
    } catch {
      // Publication has committed. A maintenance conflict must not undo it.
      console.warn("Metadata published; post-publication vacuum deferred");
    } finally {
      await client.query("SELECT set_config('lock_timeout',$1,false), set_config('statement_timeout',$2,false)",
        [settings.lockTimeout, settings.statementTimeout]);
    }
    await client.query("DROP TABLE metadata.token_search_retired, metadata.token_trait_retired");
    return { updatedAt };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("DROP TABLE IF EXISTS metadata.token_search_build, metadata.token_trait_build").catch(() => undefined);
    await client.query("SELECT pg_advisory_unlock(hashtext('yunipals:trait-refresh'))").catch(() => undefined);
    client.release();
  }
}

export async function refreshLeaderboard() {
  const client = await pool.connect();
  const updatedAt = new Date();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('yunipals:leaderboard-refresh'))");
    await client.query("CREATE TEMP TABLE next_wallet_stats (LIKE leaderboard.wallet_stats INCLUDING ALL) ON COMMIT DROP");
    await client.query(`
      INSERT INTO next_wallet_stats(scope, owner, monster_count, total_rarity, unique_types,
        special_count, glitter_count, collector_score, score_version, updated_at)
      WITH scopes(scope) AS (SELECT unnest($3::text[])),
      token_traits AS (
        SELECT m.collection, m.token_id, m.lifecycle,
          COALESCE(${rarityPointsCappedSql}, 0) AS rarity,
          max(a->>'value') FILTER (WHERE a->>'trait_type' = 'Type') AS monster_type,
          bool_or(a->>'trait_type' = 'Special' AND a->>'value' = 'Yes') AS is_special,
          bool_or(a->>'trait_type' = 'Glitter' AND a->>'value' <> 'None') AS is_glitter
        FROM metadata.token_metadata m
        ${localRarityJoin}
        LEFT JOIN LATERAL (
          SELECT rarity_attribute->>'value' AS value
          FROM jsonb_array_elements(COALESCE(m.attributes, '[]')) rarity_attribute
          WHERE rarity_attribute->>'trait_type' = 'Rarity Points' LIMIT 1
        ) rp ON true
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.attributes, '[]')) a ON true
        GROUP BY m.collection, m.token_id, m.lifecycle, m.document, rp.value
          ${rarityReadSource === "local" ? ", local_rarity.status, local_rarity.rarity_points_capped" : ""}
      ), aggregates AS (
        SELECT s.scope, lower(t.owner) AS owner, count(*)::int AS monster_count,
          sum(COALESCE(x.rarity, 0)) AS total_rarity,
          count(DISTINCT x.monster_type)::int AS unique_types,
          count(*) FILTER (WHERE x.is_special)::int AS special_count,
          count(*) FILTER (WHERE x.is_glitter)::int AS glitter_count
        FROM scopes s JOIN ${ponderSchema}.token t ON s.scope='all' OR t.collection = ANY(string_to_array(s.scope, '+'))
        LEFT JOIN token_traits x ON x.collection=t.collection
          AND x.token_id=t.token_id::numeric AND x.lifecycle=t.lifecycle
        WHERE NOT t.burned GROUP BY s.scope, lower(t.owner)
      )
      SELECT scope, owner, monster_count, total_rarity, unique_types, special_count, glitter_count,
        round((1000*ln(1+total_rarity) + 50*monster_count + 500*unique_types + 750*special_count + 250*glitter_count)::numeric, 4),
        $1, $2 FROM aggregates
    `, [scoreVersion, updatedAt, collectionScopes]);
    await client.query("DELETE FROM leaderboard.wallet_stats");
    await client.query(`INSERT INTO leaderboard.wallet_stats(scope, owner, monster_count, total_rarity,
      unique_types, special_count, glitter_count, collector_score, score_version, updated_at)
      SELECT scope, owner, monster_count, total_rarity, unique_types, special_count, glitter_count,
        collector_score, score_version, updated_at FROM next_wallet_stats`);
    await client.query("COMMIT");
    return { updatedAt, wallets: Number((await pool.query("SELECT count(*) FROM leaderboard.wallet_stats WHERE scope='all'")).rows[0].count) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

import { statfs } from "node:fs/promises";
import type { PoolClient } from "pg";

import { collectionSlugs } from "../constants.js";
import { pool } from "../offchain/db.js";
import { ponderSchema } from "../offchain/sql.js";
import {
  localRarityJoin,
  rarityPointsCappedSql,
  rarityPointsSql
} from "../rarity/read-source.js";
import { assertChainReady } from "./chain-readiness.js";
import { metadataSourceMode } from "./publication.js";
import { metadataScanReadRelation } from "./read-source.js";

const scopes = Array.from(
  { length: (1 << collectionSlugs.length) - 1 },
  (_, index) => {
    const chains = collectionSlugs.filter((_, bit) => (index + 1) & (1 << bit));
    return chains.length === collectionSlugs.length ? "all" : chains.join("+");
  }
);
const payloadTables = ["trait", "search", "revision", "facet", "facet_status"] as const;
const archiveMode = metadataSourceMode() === "archive";

function bytes(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid projection capacity setting");
  return number;
}

export async function assertProjectionBuildCapacity(client: PoolClient) {
  if (process.env.PROJECTION_TEST_BYPASS_CAPACITY === "1") {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
      !url.pathname.endsWith("_test")) throw new Error("Capacity bypass requires an isolated local test database");
    return;
  }
  const storagePath = process.env.PROJECTION_STORAGE_PATH ?? (await client.query<{ directory: string }>(
    "SELECT current_setting('data_directory') AS directory"
  )).rows[0]!.directory;
  const disk = await statfs(storagePath);
  const free = Number(disk.bavail) * Number(disk.bsize);
  const size = await client.query<{ estimated: string }>(`
    SELECT sum(pg_total_relation_size(relation))::text AS estimated
    FROM unnest(ARRAY['metadata.token_search','metadata.token_trait','metadata.projection_revision']::regclass[]) relation`);
  const nextGeneration = Math.max(8e9, Math.ceil(Number(size.rows[0]?.estimated ?? 0) * 1.5));
  const required = bytes(process.env.PROJECTION_MIN_FREE_BYTES, 25e9)
    + bytes(process.env.PROJECTION_BACKUP_PEAK_BYTES, 65e9)
    + nextGeneration;
  if (free < required) {
    throw new Error(`projection_capacity_insufficient: free=${free} required=${required}`);
  }
}

async function validateGeneration(client: PoolClient, id: string, insertedSearch: number) {
  const counts = await client.query<{
    search_count: string;
    revision_count: string;
    trait_count: string;
    facet_count: string;
    scope_count: string;
    missing_revision: boolean;
  }>(`SELECT
    (SELECT count(*) FROM metadata_projection.search WHERE generation_id=$1) AS search_count,
    (SELECT count(*) FROM metadata_projection.revision WHERE generation_id=$1) AS revision_count,
    (SELECT count(*) FROM metadata_projection.trait WHERE generation_id=$1) AS trait_count,
    (SELECT count(*) FROM metadata_projection.facet WHERE generation_id=$1) AS facet_count,
    (SELECT count(*) FROM metadata_projection.facet_status WHERE generation_id=$1) AS scope_count,
    EXISTS(SELECT 1 FROM metadata_projection.search s LEFT JOIN metadata_projection.revision r
      ON r.generation_id=s.generation_id AND r.collection=s.collection AND r.token_id=s.token_id
      AND r.lifecycle=s.lifecycle WHERE s.generation_id=$1 AND r.token_id IS NULL) AS missing_revision`, [id]);
  const row = counts.rows[0]!;
  if (Number(row.search_count) === 0 || Number(row.search_count) !== insertedSearch ||
    Number(row.scope_count) !== scopes.length ||
    (archiveMode && (row.search_count !== row.revision_count || row.missing_revision))) {
    throw new Error(`projection_validation_failed: ${JSON.stringify(row)}`);
  }
  const coverage = await client.query<{ collection: string; count: string }>(`
    SELECT collection,count(*)::text AS count FROM metadata_projection.search
    WHERE generation_id=$1 GROUP BY collection`, [id]);
  if (coverage.rows.some((row) => !collectionSlugs.includes(row.collection as (typeof collectionSlugs)[number]))) {
    throw new Error("projection_invalid_collection");
  }
  return { ...row, collections: coverage.rows };
}

async function publishGeneration(client: PoolClient, id: string, release: string | null, predecessor: string | null) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout='500ms'");
    await client.query("SET LOCAL statement_timeout='2s'");
    const active = await client.query<{ current_id: string | null }>(
      "SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE");
    if (active.rows[0]?.current_id !== predecessor) throw new Error("projection_predecessor_changed");
    const candidate = await client.query<{ state: string; metadata_release_id: string | null; format_version: number; source_mode: string; validated: boolean }>(
      "SELECT state,metadata_release_id,format_version,source_mode,validation IS NOT NULL AS validated FROM metadata_projection.generation WHERE id=$1", [id]);
    if (candidate.rows[0]?.state !== "ready" || candidate.rows[0].metadata_release_id !== release ||
      candidate.rows[0].format_version !== 1 || candidate.rows[0].source_mode !== (archiveMode ? "archive" : "legacy") ||
      !candidate.rows[0].validated) {
      throw new Error("projection_candidate_not_ready");
    }
    if (archiveMode) {
      const currentRelease = await client.query<{ release_id: string }>(
        "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE");
      if (currentRelease.rows[0]?.release_id !== release) throw new Error("projection_source_release_changed");
    }
    await client.query(`UPDATE metadata_projection.active
      SET current_id=$1,previous_id=current_id,updated_at=now() WHERE singleton`, [id]);
    await client.query("UPDATE metadata_projection.generation SET published_at=now() WHERE id=$1", [id]);
    if (archiveMode) await client.query(`INSERT INTO metadata.derived_snapshot(name,metadata_release_id)
      VALUES('traits',$1) ON CONFLICT(name) DO UPDATE
      SET metadata_release_id=EXCLUDED.metadata_release_id,updated_at=now()`, [release]);
    await client.query("COMMIT");
    return active.rows[0]?.current_id ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    // A lost commit response is ambiguous. The caller checks the pointer.
    throw error;
  }
}

async function cleanupGenerations(client: PoolClient) {
  await client.query("BEGIN");
  let retired: string[];
  try {
    await client.query("SET LOCAL lock_timeout='500ms'");
    await client.query("SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE");
    const rows = await client.query<{ id: string }>(`
      UPDATE metadata_projection.generation g SET state='retired',retired_at=now()
      WHERE state IN ('ready','failed','building')
        AND started_at < now()-interval '15 minutes'
        AND (published_at IS NULL OR published_at < now()-interval '15 minutes')
        AND id NOT IN (SELECT current_id FROM metadata_projection.active WHERE current_id IS NOT NULL
          UNION SELECT previous_id FROM metadata_projection.active WHERE previous_id IS NOT NULL)
      RETURNING id`);
    retired = rows.rows.map((row) => row.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  for (const id of retired) {
    for (const table of payloadTables) {
      while (true) {
        const result = await client.query(`DELETE FROM metadata_projection.${table}
          WHERE ctid IN (SELECT ctid FROM metadata_projection.${table}
            WHERE generation_id=$1 LIMIT 10000)`, [id]);
        if ((result.rowCount ?? 0) < 10000) break;
      }
    }
  }
}

/** Build into stable tables; readers never see the candidate until the pointer commits. */
export async function refreshProjectionGeneration() {
  const client = await pool.connect();
  const updatedAt = new Date();
  let id: string | undefined;
  let committed = false;
  let insertedSearch = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('yunipals:trait-refresh'))");
    if (archiveMode) await client.query("SELECT pg_advisory_lock_shared(hashtext('metadata:chain-recovery'))");
    await cleanupGenerations(client);
    await assertProjectionBuildCapacity(client);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    // The full-generation facet hash joins spill heavily at PostgreSQL's 4 MB default.
    await client.query("SET LOCAL work_mem = '64MB'");
    if (archiveMode) await assertChainReady(client, collectionSlugs);
    const release = archiveMode
      ? (await client.query<{ release_id: string }>(
          "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE"
        )).rows[0]?.release_id ?? null
      : null;
    if (archiveMode && !release) throw new Error("archive_unavailable");
    const created = await client.query<{ id: string }>(`
      INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state)
      VALUES($1,$2,'building') RETURNING id`, [archiveMode ? "archive" : "legacy", release]);
    id = created.rows[0]!.id;
    const predecessor = (await client.query<{ current_id: string | null }>(
      "SELECT current_id FROM metadata_projection.active WHERE singleton"
    )).rows[0]?.current_id ?? null;
    const searchInsert = await client.query(`INSERT INTO metadata_projection.search
      (generation_id,collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped,updated_at)
      SELECT $1::bigint,m.collection,m.token_id,m.lifecycle,(m.document IS NOT NULL),
        ${rarityPointsSql},${rarityPointsCappedSql},$2
      FROM ${metadataScanReadRelation} m ${localRarityJoin}
      LEFT JOIN LATERAL (SELECT a->>'value' AS value
        FROM jsonb_array_elements(COALESCE(m.attributes,'[]')) a
        WHERE a->>'trait_type'='Rarity Points' LIMIT 1) rp ON true`, [id, updatedAt]);
    insertedSearch = searchInsert.rowCount ?? 0;
    await client.query(`INSERT INTO metadata_projection.trait
      (generation_id,collection,token_id,lifecycle,trait_type,value,value_numeric)
      SELECT DISTINCT $1::bigint,m.collection,m.token_id,m.lifecycle,a->>'trait_type',a->>'value',
        CASE WHEN a->>'value' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (a->>'value')::numeric END
      FROM ${metadataScanReadRelation} m
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.attributes,'[]')) a
      WHERE m.document IS NOT NULL AND a ? 'trait_type' AND a ? 'value'
        AND a->>'trait_type' IS NOT NULL AND a->>'value' IS NOT NULL`, [id]);
    if (archiveMode) await client.query(`INSERT INTO metadata_projection.revision
      (generation_id,collection,token_id,lifecycle,metadata_content_hash)
      SELECT $1::bigint,m.collection,m.token_id,m.lifecycle,m.content_hash
      FROM ${metadataScanReadRelation} m`, [id]);
    for (const scope of scopes) {
      await client.query(`INSERT INTO metadata_projection.facet
        (generation_id,scope,trait_type,kind,min_value,max_value,values,updated_at)
        WITH counts AS (SELECT f.trait_type,f.value,count(*)::int AS count,
          min(f.value_numeric) AS min_value,max(f.value_numeric) AS max_value,
          bool_and(f.value_numeric IS NOT NULL) AS numeric_value
          FROM metadata_projection.trait f JOIN ${ponderSchema}.token t
            ON t.collection=f.collection AND t.token_id::numeric=f.token_id AND t.lifecycle=f.lifecycle
          WHERE f.generation_id=$1 AND NOT t.burned
            AND ($2='all' OR t.collection=ANY(string_to_array($2,'+')))
          GROUP BY f.trait_type,f.value),
        type_stats AS (SELECT trait_type,bool_and(numeric_value) AS is_numeric,
          min(min_value) AS min_value,max(max_value) AS max_value FROM counts GROUP BY trait_type)
        SELECT $1::bigint,$2,s.trait_type,CASE WHEN s.is_numeric THEN 'numeric' ELSE 'categorical' END,
          CASE WHEN s.is_numeric THEN s.min_value END,CASE WHEN s.is_numeric THEN s.max_value END,
          CASE WHEN s.is_numeric THEN NULL ELSE (SELECT jsonb_agg(
            jsonb_build_object('value',c.value,'count',c.count) ORDER BY c.count DESC,c.value)
            FROM counts c WHERE c.trait_type=s.trait_type) END,$3 FROM type_stats s`,
        [id, scope, updatedAt]);
      await client.query(`INSERT INTO metadata_projection.facet_status
        (generation_id,scope,singleton,available,missing,updated_at)
        SELECT $1::bigint,$2,true,count(*) FILTER(WHERE s.metadata_available)::int,
          count(*) FILTER(WHERE NOT COALESCE(s.metadata_available,false))::int,$3
        FROM ${ponderSchema}.token t LEFT JOIN metadata_projection.search s
          ON s.generation_id=$1 AND s.collection=t.collection
            AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
        WHERE NOT t.burned AND ($2='all' OR t.collection=ANY(string_to_array($2,'+')))`,
        [id, scope, updatedAt]);
    }
    await client.query("COMMIT");
    committed = true;
    const validation = await validateGeneration(client, id, insertedSearch);
    await client.query("VACUUM (ANALYZE, TRUNCATE FALSE, PARALLEL 0) metadata_projection.search, metadata_projection.trait, metadata_projection.revision");
    await client.query(`UPDATE metadata_projection.generation
      SET state='ready',completed_at=now(),validation=$2::jsonb WHERE id=$1 AND state='building'`,
      [id, JSON.stringify(validation)]);
    const publicationStarted = performance.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await publishGeneration(client, id, release, predecessor);
        break;
      } catch (error) {
        const pointer = await pool.query<{ current_id: string | null }>(
          "SELECT current_id FROM metadata_projection.active WHERE singleton");
        if (pointer.rows[0]?.current_id === id) break;
        const code = typeof error === "object" && error !== null && "code" in error
          ? String(error.code) : "";
        if (attempt === 2 || !["55P03", "57014"].includes(code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    console.info("Projection generation published", {
      generationId: id,
      publicationDurationMs: Math.round((performance.now() - publicationStarted) * 10) / 10
    });
    try {
      await cleanupGenerations(client);
    } catch (error) {
      console.warn("Projection published; cleanup deferred", error);
    }
    return { updatedAt, generationId: id };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    if (committed && id) await client.query(`UPDATE metadata_projection.generation
      SET state='failed',failure_reason=$2 WHERE id=$1 AND state='building'`,
      [id, error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)]).catch(() => undefined);
    throw error;
  } finally {
    if (archiveMode) await client.query("SELECT pg_advisory_unlock_shared(hashtext('metadata:chain-recovery'))").catch(() => undefined);
    await client.query("SELECT pg_advisory_unlock(hashtext('yunipals:trait-refresh'))").catch(() => undefined);
    client.release();
  }
}

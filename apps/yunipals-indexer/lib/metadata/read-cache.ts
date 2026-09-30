import type { PoolClient } from "pg";
import { collectionSlugs, type CollectionSlug } from "../constants.js";
import { bnbSchema, physicalPonderSchema } from "../offchain/sql.js";
import { metadataSourceMode } from "./publication.js";
import {
  metadataSearchReadRelationFor,
  projectionGenerationMode
} from "./read-source.js";

function idSql(id: string) {
  if (!/^[1-9][0-9]*$/.test(id))
    throw new Error("Invalid read cache generation");
  return `${id}::bigint`;
}
function selected(chains: readonly CollectionSlug[], schema?: string) {
  if (
    !chains.length ||
    chains.some((chain) => !collectionSlugs.includes(chain))
  )
    throw new Error("Invalid cache collections");
  return chains.filter(
    (chain) =>
      !schema || (schema === bnbSchema ? chain === "bnb" : chain !== "bnb")
  );
}
function chainsSql(chains: readonly CollectionSlug[]) {
  return `ARRAY[${chains.map((chain) => `'${chain}'`).join(",")}]::text[]`;
}
export function readCacheFreshSql(
  id: string,
  chains: readonly CollectionSlug[]
) {
  const generation = idSql(id);
  const list = chainsSql(selected(chains));
  return `(SELECT count(*)=${chains.length} FROM metadata_projection.read_set s
    JOIN metadata_projection.read_epoch e USING(collection)
    JOIN metadata_projection.generation g ON g.id=s.generation_id
    WHERE s.generation_id=${generation} AND s.collection=ANY(${list})
      AND s.revision=e.revision AND s.source_mode='${metadataSourceMode()}'
      AND g.state='ready' AND g.source_mode=s.source_mode AND EXISTS(SELECT 1 FROM metadata_projection.active a
        WHERE s.generation_id IN(a.current_id,a.previous_id))
      AND s.guard_count=(SELECT count(*) FROM metadata_projection.read_guard guard WHERE guard.collection=s.collection)
      AND NOT EXISTS(SELECT 1 FROM metadata_projection.read_guard guard
        LEFT JOIN pg_catalog.pg_trigger trigger ON trigger.tgrelid=guard.relation_oid
          AND trigger.tgname='read_cache_dirty'
        LEFT JOIN pg_catalog.pg_trigger truncate_trigger ON truncate_trigger.tgrelid=guard.relation_oid
          AND truncate_trigger.tgname='read_cache_truncate'
        WHERE guard.collection=s.collection AND (trigger.oid IS NULL OR trigger.tgenabled<>'A'
          OR truncate_trigger.oid IS NULL OR truncate_trigger.tgenabled<>'A'
          OR (guard.relation IN('metadata_projection.search','metadata_projection.revision')
            AND (SELECT count(*) FROM pg_catalog.pg_trigger extra
              WHERE extra.tgrelid=guard.relation_oid AND extra.tgenabled='A'
                AND extra.tgname IN('read_cache_dirty_update','read_cache_dirty_delete'))<>2)
          OR guard.relation_oid IS DISTINCT FROM to_regclass(guard.relation)::oid)))`;
}
export function cachedSearchReadRelationFor(
  schema: string,
  chains: readonly CollectionSlug[],
  id: string
) {
  const chosen = selected(chains, schema);
  const original = metadataSearchReadRelationFor(
    schema,
    schema !== bnbSchema,
    chosen,
    id
  );
  if (!chosen.length) return original;
  const fresh = readCacheFreshSql(id, chosen);
  return `(SELECT m.generation_id,m.collection,m.token_id,m.lifecycle,m.metadata_available,
      m.rarity_points,m.rarity_points_capped
    FROM metadata_projection.read_member m WHERE m.generation_id=${idSql(id)}
      AND m.collection=ANY(${chainsSql(chosen)}) AND m.has_search AND ${fresh}
    UNION ALL SELECT original.generation_id,original.collection,original.token_id,original.lifecycle,
        original.metadata_available,original.rarity_points,original.rarity_points_capped
      FROM ${original} original WHERE NOT ${fresh})`;
}
export function cachedSearchReadRelation(
  chains: readonly CollectionSlug[],
  id: string
) {
  const relations = [
    ...(chains.some((chain) => chain !== "bnb")
      ? [cachedSearchReadRelationFor(physicalPonderSchema, chains, id)]
      : []),
    ...(chains.includes("bnb")
      ? [cachedSearchReadRelationFor(bnbSchema, chains, id)]
      : [])
  ];
  return `(${relations.map((relation) => `SELECT * FROM ${relation} cached`).join(" UNION ALL ")})`;
}
export function cachedMissingKeys(
  schema: string,
  chains: readonly CollectionSlug[],
  id: string
) {
  const chosen = selected(chains, schema);
  return {
    fresh: chosen.length ? readCacheFreshSql(id, chosen) : "false",
    relation: `(SELECT * FROM metadata_projection.read_member WHERE generation_id=${idSql(id)}
      AND collection=ANY(${chainsSql(chosen)}) AND NOT has_search)`
  };
}

/** Build one chain's exact proof set under one MVCC snapshot, off the HTTP path. */
export async function buildReadCache(
  db: PoolClient,
  id: string,
  chain: CollectionSlug
) {
  if (!projectionGenerationMode)
    throw new Error("Read cache requires generation mode");
  idSql(id);
  selected([chain]);
  const schema = chain === "bnb" ? bnbSchema : physicalPonderSchema;
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await db.query("SET LOCAL statement_timeout='60s'");
    await db.query("SET LOCAL lock_timeout='1s'");
    await db.query("SET LOCAL work_mem='64MB'");
    await db.query("SET LOCAL jit=off");
    await db.query("SET LOCAL enable_nestloop=off");
    await db.query("SET LOCAL random_page_cost=1.1");
    const epoch = (
      await db.query<{ revision: string; guard_count: number }>(
        `
      SELECT revision,(SELECT count(*)::int FROM metadata_projection.read_guard WHERE collection=$1) AS guard_count
      FROM metadata_projection.read_epoch WHERE collection=$1`,
        [chain]
      )
    ).rows[0];
    if (!epoch || epoch.guard_count < 8)
      throw new Error("read_cache_guards_missing");
    await db.query(
      "DELETE FROM metadata_projection.read_set WHERE generation_id=$1 AND collection=$2",
      [id, chain]
    );
    await db.query(
      "DELETE FROM metadata_projection.read_member WHERE generation_id=$1 AND collection=$2",
      [id, chain]
    );
    const original = metadataSearchReadRelationFor(
      schema,
      chain === "base",
      [chain],
      id
    );
    const inserted = await db.query(
      `INSERT INTO metadata_projection.read_member
      (generation_id,collection,token_id,lifecycle,has_search,metadata_available,rarity_points,rarity_points_capped)
      SELECT $1::bigint,t.collection,t.token_id::numeric,t.lifecycle,s.token_id IS NOT NULL,
        COALESCE(s.metadata_available,false),s.rarity_points,s.rarity_points_capped
      FROM ${schema}.token t LEFT JOIN ${original} s
        ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE t.collection=$2`,
      [id, chain]
    );
    await db.query(
      `INSERT INTO metadata_projection.read_set(generation_id,collection,revision,guard_count,source_mode)
      VALUES($1,$2,$3,$4,$5)`,
      [id, chain, epoch.revision, epoch.guard_count, metadataSourceMode()]
    );
    await db.query("COMMIT");
    return inserted.rowCount ?? 0;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

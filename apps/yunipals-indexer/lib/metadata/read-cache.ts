import type { PoolClient } from "pg";
import {
  collectionSlugs,
  ZERO_ADDRESS,
  type CollectionSlug
} from "../constants.js";
import {
  ownershipBnbSchema as bnbSchema,
  ownershipPonderSchema as physicalPonderSchema,
  ownershipCollectionsFor,
  ownershipBnbOnlySchema,
  unifiedOwnershipReads
} from "../offchain/sql.js";
import { metadataSourceMode } from "./publication.js";
import {
  physicalPonderSchema as nativeOwnershipSchema,
  ponderSchema,
  ownershipReadConfig
} from "../offchain/sql.js";
import { generationOwnershipProof } from "../ownership/projection-proof.js";
import { unifiedOwnershipStatus } from "../ownership/readiness.js";
import { nativeBaseMetadataReads } from "./base-mode.js";
import {
  metadataSearchReadRelationFor,
  metadataRawSearchReadRelationAt,
  metadataRawTraitReadRelationAt,
  metadataTraitReadRelationFor,
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
  return schema ? ownershipCollectionsFor(schema, chains) : [...chains];
}
function chainsSql(chains: readonly CollectionSlug[]) {
  return `ARRAY[${chains.map((chain) => `'${chain}'`).join(",")}]::text[]`;
}
const baseRuntimeErrorSql =
  "metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL";
/** A read set stores each token's identity, lifecycle, burned state and
 * metadata proof, and no owner. Among transfers, only a mint or a burn changes
 * those. The dirty triggers fire when Ponder indexes a transfer, which can be
 * before the confirmation boundary reaches its block, so a mint or burn that
 * the boundary crosses later is found here instead.
 */
function membershipTransferSql(alias: string) {
  return `(${alias}."from"='${ZERO_ADDRESS}' OR ${alias}."to"='${ZERO_ADDRESS}')`;
}
export function readCacheFreshSql(
  id: string,
  chains: readonly CollectionSlug[],
  options: { preparing?: boolean } = {}
) {
  const generation = idSql(id);
  const list = chainsSql(selected(chains));
  const nativeMetadataProof =
    nativeBaseMetadataReads() && chains.includes("base")
      ? `AND EXISTS(SELECT 1 FROM ${ponderSchema}.base_metadata_frame(true))`
      : "";
  // While a Base check has failed, readers use the live path, which reports
  // Base metadata as unavailable. buildReadCache refuses this state.
  const baseRuntimeProof = chains.includes("base")
    ? `AND NOT EXISTS(SELECT 1 FROM ${baseRuntimeErrorSql})`
    : "";
  const ownershipJoin = unifiedOwnershipReads
    ? `JOIN LATERAL ${ponderSchema}.source_boundary(s.collection) ownership_source ON true
    JOIN ${ponderSchema}._unified_read_release ownership_release ON ownership_release.singleton`
    : "";
  const ownershipProof = unifiedOwnershipReads
    ? `
    AND s.ownership_release_id=ownership_source.release_id AND s.ownership_release_id='${ownershipReadConfig.releaseId}'
    AND s.ownership_read_identity=ownership_release.identity AND s.ownership_policy=ownership_source.policy
    AND s.ownership_boundary<=ownership_source.block_number
    AND (EXISTS(SELECT 1 FROM ${nativeOwnershipSchema}.chain_block b WHERE b.chain_id=ownership_source.chain_id
        AND b.block_number=s.ownership_boundary AND b.block_hash=s.ownership_boundary_hash)
      OR EXISTS(SELECT 1 FROM yunipals_indexer_control.chain_anchor a JOIN ${nativeOwnershipSchema}.chain_block b
        ON b.chain_id=a.chain_id AND b.block_number=a.witness_number AND b.block_hash=a.witness_hash
        WHERE a.release_id=s.ownership_release_id AND a.chain_id=ownership_source.chain_id
          AND a.block_number=s.ownership_boundary AND a.block_hash=s.ownership_boundary_hash))
    AND NOT EXISTS(SELECT 1 FROM ${nativeOwnershipSchema}.transfer_event changed WHERE changed.collection=s.collection
      AND changed.block_number>s.ownership_boundary AND changed.block_number<=ownership_source.block_number
      AND ${membershipTransferSql("changed")})`
    : `AND COALESCE(to_jsonb(s)->>'ownership_release_id','')=''`;
  return `(SELECT count(*)=${chains.length} FROM metadata_projection.read_set s
    JOIN metadata_projection.read_epoch e USING(collection)
    JOIN metadata_projection.generation g ON g.id=s.generation_id
    ${ownershipJoin}
    WHERE s.generation_id=${generation} AND s.collection=ANY(${list})
      AND s.revision=e.revision AND s.source_mode='${metadataSourceMode()}'
      AND ${generationOwnershipProof("g")} ${ownershipProof} ${nativeMetadataProof} ${baseRuntimeProof}
      AND g.state='ready' AND g.source_mode=CASE WHEN s.source_mode='legacy-http' THEN 'legacy' ELSE s.source_mode END
      AND (EXISTS(SELECT 1 FROM metadata_projection.active a
        WHERE s.generation_id IN(a.current_id,a.previous_id))
        ${
          options.preparing
            ? `OR EXISTS(SELECT 1 FROM metadata_projection.read_preparation p
          WHERE p.generation_id=s.generation_id AND p.expires_at>statement_timestamp())`
            : ""
        })
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
/** Operator proof: normal preparation lease and freshness checks, plus an
 * unpublished candidate and the complete count fields used by runtime readers. */
export function preparedReadCacheFreshSql(
  id: string,
  chains: readonly CollectionSlug[]
) {
  const generation = idSql(id);
  selected(chains);
  return `(${readCacheFreshSql(id, chains, { preparing: true })}
    AND EXISTS(SELECT 1 FROM metadata_projection.generation g WHERE g.id=${generation}
      AND g.published_at IS NULL AND NOT EXISTS(SELECT 1 FROM metadata_projection.active a
        WHERE g.id IN(a.current_id,a.previous_id)))
    AND (SELECT count(*)=${chains.length} FROM metadata_projection.read_set s
      WHERE s.generation_id=${generation} AND s.collection=ANY(${chainsSql(chains)})
        AND s.member_count IS NOT NULL AND s.burned_count IS NOT NULL))`;
}
export function cachedSearchReadRelationFor(
  schema: string,
  chains: readonly CollectionSlug[],
  id: string
) {
  const chosen = selected(chains, schema);
  const original = metadataSearchReadRelationFor(
    schema,
    !ownershipBnbOnlySchema(schema),
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
  if (unifiedOwnershipReads)
    return cachedSearchReadRelationFor(physicalPonderSchema, chains, id);
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

/** Search and traits share a revision/publication proof. Keep the canonical
 * trait proof for identities without a search row; missing search is not proof
 * that a trait is invalid. Raw trait values are always read from this snapshot.
 */
export function cachedTraitReadRelationFor(
  schema: string,
  chains: readonly CollectionSlug[],
  id: string
) {
  const rawTraits = metadataRawTraitReadRelationAt(id);
  const rawSearch = metadataRawSearchReadRelationAt(id);
  const canonical = metadataTraitReadRelationFor(schema, chains, id);
  const search = cachedSearchReadRelationFor(schema, chains, id);
  return `(SELECT trait.* FROM ${rawTraits} trait JOIN ${search} proof
      USING(generation_id,collection,token_id,lifecycle)
    UNION ALL SELECT missing.* FROM (
      SELECT candidate.* FROM ${rawTraits} candidate WHERE NOT EXISTS (
        SELECT 1 FROM ${rawSearch} search WHERE search.collection=candidate.collection
          AND search.token_id=candidate.token_id AND search.lifecycle=candidate.lifecycle)
    ) missing JOIN LATERAL (
      SELECT 1 FROM ${canonical} validated WHERE validated.collection=missing.collection
        AND validated.token_id=missing.token_id AND validated.lifecycle=missing.lifecycle
        AND validated.trait_type=missing.trait_type AND validated.value=missing.value OFFSET 0
    ) proof ON true)`;
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

/** Materialize only this collection's guarded mint evidence within the cache's
 * repeatable-read transaction. Real statistics prevent repeated full view scans.
 * These temporary relations disappear on commit or rollback.
 */
export async function stageReadCacheOwnership(
  db: Pick<PoolClient, "query">,
  schema: string,
  chain: CollectionSlug
) {
  selected([chain], schema);
  await db.query(
    `CREATE TEMP TABLE token_lifecycle ON COMMIT DROP AS
      SELECT collection,token_id,lifecycle,mint_transaction_hash,mint_block
      FROM ${schema}.token_lifecycle WHERE collection=$1`,
    [chain]
  );
  await db.query(
    `CREATE TEMP TABLE transfer_event ON COMMIT DROP AS
      SELECT collection,token_id,lifecycle,transaction_hash,block_number,log_index,"from"
      FROM ${schema}.transfer_event WHERE collection=$1
        AND "from"='0x0000000000000000000000000000000000000000'`,
    [chain]
  );
  await db.query("ANALYZE pg_temp.token_lifecycle");
  await db.query("ANALYZE pg_temp.transfer_event");
}

/** Renew a read set's boundary proof once its witness is this many blocks old.
 * The proof expires at 4,096 blocks: Ponder then prunes the boundary's header
 * and the observer prunes the anchor. Renewal leaves room for a worker that is
 * busy rebuilding another chain.
 */
const readCacheAnchorRenewalBlocks = 1024;

/** Keep a read set provable for as long as its data is unchanged. Otherwise its
 * proof expires by block count alone, which forces a full rebuild every 4,096
 * blocks, or every 14 minutes on a chain with 200 ms blocks. chain_block holds
 * only Ponder's canonical branch, so a boundary proven here is an ancestor of
 * the current witness, without an RPC call. A reorg still invalidates the read
 * set: a reverted boundary or witness leaves chain_block.
 */
export async function renewReadCacheAnchor(
  db: Pick<PoolClient, "query">,
  id: string,
  chain: CollectionSlug
) {
  if (!unifiedOwnershipReads) return 0;
  selected([chain]);
  const result = await db.query(
    `INSERT INTO yunipals_indexer_control.chain_anchor
      (release_id,chain_id,block_number,block_hash,witness_number,witness_hash)
    SELECT s.ownership_release_id,status.chain_id,s.ownership_boundary,s.ownership_boundary_hash,
      status.witness_number,status.witness_hash
    FROM metadata_projection.read_set s
    JOIN LATERAL ${ponderSchema}.source_boundary(s.collection) ownership_source
      ON ownership_source.release_id=s.ownership_release_id
    JOIN yunipals_indexer_control.chain_status status
      ON status.release_id=s.ownership_release_id AND status.chain_id=ownership_source.chain_id
    JOIN ${nativeOwnershipSchema}.chain_block witness ON witness.chain_id=status.chain_id
      AND witness.block_number=status.witness_number AND witness.block_hash=status.witness_hash
    LEFT JOIN yunipals_indexer_control.chain_anchor held
      ON held.release_id=s.ownership_release_id AND held.chain_id=status.chain_id
        AND held.block_number=s.ownership_boundary AND held.block_hash=s.ownership_boundary_hash
    WHERE s.generation_id=${idSql(id)} AND s.collection=$1
      AND s.ownership_release_id='${ownershipReadConfig.releaseId}'
      AND NOT status.halted AND status.error_code IS NULL
      AND COALESCE(held.witness_number,s.ownership_boundary)<status.witness_number-${readCacheAnchorRenewalBlocks}
      AND (EXISTS(SELECT 1 FROM ${nativeOwnershipSchema}.chain_block boundary
          WHERE boundary.chain_id=status.chain_id AND boundary.block_number=s.ownership_boundary
            AND boundary.block_hash=s.ownership_boundary_hash)
        OR EXISTS(SELECT 1 FROM ${nativeOwnershipSchema}.chain_block previous
          WHERE previous.chain_id=held.chain_id AND previous.block_number=held.witness_number
            AND previous.block_hash=held.witness_hash))
    ON CONFLICT(release_id,chain_id,block_number) DO UPDATE
      SET witness_number=EXCLUDED.witness_number,witness_hash=EXCLUDED.witness_hash
      WHERE chain_anchor.block_hash=EXCLUDED.block_hash
        AND chain_anchor.witness_number<EXCLUDED.witness_number
    RETURNING block_number`,
    [chain]
  );
  return result.rows.length;
}

/** Renewal only saves a rebuild, so it must never stop the worker. If it fails,
 * the proof expires and the worker rebuilds the read set. An unavailable source
 * is not reported as a failure: the freshness check that follows reports it.
 */
export async function tryRenewReadCacheAnchor(
  db: Pick<PoolClient, "query">,
  id: string,
  chain: CollectionSlug
): Promise<{ renewed: boolean; failure: string | null }> {
  try {
    return {
      renewed: (await renewReadCacheAnchor(db, id, chain)) > 0,
      failure: null
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "renewal_failed";
    return { renewed: false, failure: code === "YI001" ? null : code };
  }
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
  const timeout = Number(process.env.READ_CACHE_BUILD_TIMEOUT_MS ?? 180000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 900000)
    throw new Error("read_cache_build_timeout_out_of_bounds");
  const schema = chain === "bnb" ? bnbSchema : physicalPonderSchema;
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await db.query("SELECT set_config('statement_timeout',$1,true)", [
      `${timeout}ms`
    ]);
    await db.query("SET LOCAL lock_timeout='1s'");
    await db.query("SET LOCAL work_mem='64MB'");
    await db.query("SET LOCAL jit=off");
    await db.query(
      unifiedOwnershipReads
        ? "SET LOCAL enable_nestloop=on"
        : "SET LOCAL enable_nestloop=off"
    );
    // Guarded views underestimate the size of a full collection. Avoid a
    // materialized inner scan repeated once for every token in the outer join.
    if (unifiedOwnershipReads) await db.query("SET LOCAL enable_material=off");
    await db.query("SET LOCAL random_page_cost=1.1");
    const ownership = unifiedOwnershipReads
      ? await unifiedOwnershipStatus(db, [chain])
      : null;
    if (ownership && !ownership.ready)
      throw new Error("ownership_source_unavailable");
    if (
      !(
        await db.query(
          `SELECT 1 FROM metadata_projection.generation g WHERE g.id=$1
      AND g.state='ready' AND ${generationOwnershipProof("g")}`,
          [id]
        )
      ).rowCount
    )
      throw new Error("projection_generation_unavailable");
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
    // Built now, every Base token would be stored as unavailable, and the set
    // would stay fresh after the error clears.
    if (
      chain === "base" &&
      (await db.query(`SELECT 1 FROM ${baseRuntimeErrorSql}`)).rowCount
    )
      throw new Error("base_replay_unavailable");
    await db.query(
      "DELETE FROM metadata_projection.read_set WHERE generation_id=$1 AND collection=$2",
      [id, chain]
    );
    await db.query(
      "DELETE FROM metadata_projection.read_member WHERE generation_id=$1 AND collection=$2",
      [id, chain]
    );
    const stagedCanonical =
      unifiedOwnershipReads &&
      chain !== "bnb" &&
      metadataSourceMode() === "archive";
    if (stagedCanonical) await stageReadCacheOwnership(db, schema, chain);
    const original = metadataSearchReadRelationFor(
      schema,
      chain === "base",
      [chain],
      id,
      stagedCanonical
    );
    const inserted = await db.query(
      `INSERT INTO metadata_projection.read_member
      (generation_id,collection,token_id,lifecycle,has_search,metadata_available,rarity_points,rarity_points_capped,burned)
      SELECT $1::bigint,t.collection,t.token_id::numeric,t.lifecycle,s.token_id IS NOT NULL,
        COALESCE(s.metadata_available,false),s.rarity_points,s.rarity_points_capped,t.burned
      FROM ${schema}.token t LEFT JOIN ${original} s
        ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE t.collection=$2`,
      [id, chain]
    );
    await db.query(
      `INSERT INTO metadata_projection.read_set(generation_id,collection,revision,guard_count,source_mode,
        ownership_release_id,ownership_read_identity,ownership_boundary,ownership_boundary_hash,ownership_policy,
        member_count,burned_count)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,count(*),count(*) FILTER(WHERE burned)
      FROM metadata_projection.read_member WHERE generation_id=$1 AND collection=$2`,
      [
        id,
        chain,
        epoch.revision,
        epoch.guard_count,
        metadataSourceMode(),
        ownership?.identity.release_id ?? null,
        ownership?.identity.identity ?? null,
        ownership?.collections[0]?.block_number ?? null,
        ownership?.collections[0]?.block_hash ?? null,
        ownership?.collections[0]?.policy ?? null
      ]
    );
    await db.query("COMMIT");
    return inserted.rowCount ?? 0;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

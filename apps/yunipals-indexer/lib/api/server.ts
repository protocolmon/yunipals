import { metadataReadRelation, metadataSearchReadRelation, metadataSearchReadRelationAt, metadataSearchReadRelationFor, metadataRawSearchReadRelationAt, metadataRawTraitReadRelationAt, metadataTraitReadRelation, metadataTraitReadRelationAt, leaderboardReadRelation, readActiveProjectionId } from "../metadata/read-source.js";
import { LocalMetadataReader } from "../metadata/resolve.js";
import { metadataSourceMode } from "../metadata/publication.js";
import { metadataReadiness, publicationStatus } from "../metadata/status.js";
import { chainReadiness } from "../metadata/chain-readiness.js";
import { legacyMetadataRouter } from "./legacy-metadata.js";
import { serve } from "@hono/node-server";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { apiPool as pool } from "../offchain/db.js";
import { bnbSchema, physicalPonderSchema, ponderSchema, readSchemaName } from "../offchain/sql.js";
import { docsHtml, openApiDocument } from "./openapi.js";
import { scoreFormula, scoreVersion } from "../leaderboard/refresh.js";
import { collectionSlugs, collections, type CollectionSlug } from "../constants.js";
import { EnsUnavailableError, InvalidOwnerError, OwnerNameUnresolvedError, resolveOwner, type ResolvedOwner } from "../ens/resolver.js";
import {
  visibilitySignatureTtlSeconds, visibilitySigningDataJson, verifyVisibilitySignature,
  type VisibilityMessage
} from "./visibility.js";
import { ExactCountCache } from "./exact-count-cache.js";
import { rarityPageQueries, type RarityCandidate } from "./rarity-page-query.js";
import { chainSelection, chainSelectionJson } from "./chains.js";

import { activeVisibilityPredicate, activeVisibilityRowPredicate } from "./visibility-query.js";
import { registerCollectorRoutes } from "./collector-routes.js";

export const app = new Hono();
const localMetadata = new LocalMetadataReader(pool, readSchemaName);
const port = Number(process.env.API_PORT ?? 9011);
const exactCountCache = new ExactCountCache(
  Number(process.env.API_EXACT_COUNT_CACHE_TTL_MS ?? 15_000),
  Number(process.env.API_EXACT_COUNT_CACHE_MAX ?? 1_000)
);

const isDatabaseUnavailable = (error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return ["55P03", "57014", "53300", "57P01", "57P02", "57P03", "08000", "08003", "08006"].includes(code)
    || /timeout|connection terminated|connection refused|projection_generation_unavailable/i.test(message);
};

app.onError((error, c) => {
  if (error instanceof InvalidOwnerError) return c.json({ error: "invalid_owner", message: error.message }, 400);
  if (error instanceof OwnerNameUnresolvedError) return c.json({ error: "owner_name_unresolved", message: error.message }, 404);
  if (error instanceof EnsUnavailableError) return c.json({ error: "ens_resolution_unavailable" }, 503);
  if (isDatabaseUnavailable(error)) {
    console.error("API database request unavailable", { path: c.req.path, error: error.message });
    return c.json({ error: "database_unavailable" }, 503);
  }
  console.error("API request failed", { path: c.req.path, error });
  return c.json({ error: "internal_server_error" }, 500);
});
const limitOf = (raw?: string) => Math.min(100, Math.max(1, Number(raw ?? 50) || 50));
const leaderboardMetrics = {
  "total-rarity": { column: "total_rarity", label: "Total rarity" },
  "monster-count": { column: "monster_count", label: "Monster count" },
  "unique-types": { column: "unique_types", label: "Unique types" },
  "special-count": { column: "special_count", label: "Special count" },
  "glitter-count": { column: "glitter_count", label: "Glitter count" },
  "collector-score": { column: "collector_score", label: "Collector score" }
} as const;
type LeaderboardSlug = keyof typeof leaderboardMetrics;
type RankCursor = { score: string; monsterCount: number; owner: string; scope?: string };
const encodeRankCursor = (value: RankCursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeRankCursor = (raw?: string): RankCursor | undefined => {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString()) as RankCursor;
    if (typeof value.score !== "string" || !Number.isInteger(value.monsterCount) || !/^0x[0-9a-f]{40}$/.test(value.owner)) return undefined;
    return value;
  } catch { return undefined; }
};
const tokenSorts = ["token-id-asc", "token-id-desc", "rarity-desc", "rarity-asc", "rarity-capped-desc", "rarity-capped-asc"] as const;
type TokenSort = typeof tokenSorts[number];
type TokenCursor = { v: 2; config: string; collection: CollectionSlug; tokenId: string; rarity: string | null };
const encodeTokenCursor = (value: TokenCursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeTokenCursor = (raw: string): TokenCursor | undefined => {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString()) as TokenCursor;
    if (value.v !== 2 || typeof value.config !== "string" || !collectionSlugs.includes(value.collection) || !/^\d+$/.test(value.tokenId) || (value.rarity !== null && !/^-?\d+(\.\d+)?$/.test(value.rarity))) return undefined;
    return value;
  } catch { return undefined; }
};
const configHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
const chainOf = (raw?: string): CollectionSlug | undefined => raw && collectionSlugs.includes(raw as CollectionSlug) ? raw as CollectionSlug : undefined;
const requireResolvedOwner = async (input: string, chains: readonly CollectionSlug[]) => {
  const resolved = await resolveOwner(input, chains);
  if (!Object.keys(resolved.addresses).length) throw new OwnerNameUnresolvedError(`No address record found for ${input}`);
  return resolved;
};
const ownerResolutionJson = (resolved: ResolvedOwner) => ({
  ownerInput: resolved.input,
  ownerName: resolved.normalizedName,
  resolvedAddresses: resolved.addresses
});
const canonicalOwnerAddress = (resolved: ResolvedOwner, chains: readonly CollectionSlug[]) =>
  chains.map((slug) => resolved.addresses[slug]).find(Boolean);
const ensChainIds = collectionSlugs.map((slug) => collections[slug].chainId);
const ensScopeChainCase = collectionSlugs
  .map((slug) => `WHEN '${slug}' THEN ${collections[slug].chainId}`)
  .join(" ");
const verifiedEnsJoin = (ownerSql: string, scopeSql: string) => `LEFT JOIN LATERAL (
  SELECT identity.name FROM metadata.ens_identity identity
  WHERE identity.address=${ownerSql} AND identity.verified
    AND identity.chain_id = ANY(CASE WHEN ${scopeSql}='all' THEN ARRAY[${ensChainIds.join(",")}]
      ELSE ARRAY(SELECT CASE selected.slug ${ensScopeChainCase} END
        FROM unnest(string_to_array(${scopeSql}, '+')) selected(slug)) END)
  ORDER BY array_position(ARRAY[${ensChainIds.join(",")}], identity.chain_id) LIMIT 1
) selected_ens ON true`;
const visibilityModes = ["visible", "hidden", "all"] as const;
type VisibilityMode = typeof visibilityModes[number];
type OwnerCursor = { v: 3; scope: string; visibility: VisibilityMode; collection: CollectionSlug; tokenId: string };
const encodeOwnerCursor = (value: OwnerCursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeOwnerCursor = (raw?: string): OwnerCursor | undefined => {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString()) as OwnerCursor;
    if (value.v !== 3 || typeof value.scope !== "string" || !collectionSlugs.includes(value.collection) || !/^\d+$/.test(value.tokenId) || !visibilityModes.includes(value.visibility)) return undefined;
    return value;
  } catch { return undefined; }
};

const visibilityMessageSchema = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenId: z.string().regex(/^\d+$/),
  lifecycle: z.number().int().positive(),
  ownershipTransactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ownershipLogIndex: z.number().int().nonnegative(),
  hidden: z.boolean(),
  nonce: z.string().regex(/^\d+$/),
  deadline: z.number().int().positive()
});
const visibilityRequestSchema = z.object({
  message: visibilityMessageSchema,
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/)
});

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
async function currentVisibilityState(client: Queryable, collection: CollectionSlug, tokenId: string) {
  const result = await client.query(`
    SELECT t.owner, t.burned, t.lifecycle,
      e.id AS "eventId", e.block_number AS "blockNumber",
      e.transaction_hash AS "transactionHash", e.transaction_index AS "transactionIndex", e.log_index AS "logIndex"
    FROM ${ponderSchema}.token t
    JOIN LATERAL (
      SELECT id, block_number, transaction_hash, transaction_index, log_index
      FROM ${ponderSchema}.transfer_event
      WHERE collection=t.collection AND token_id=t.token_id AND lifecycle=t.lifecycle
      ORDER BY block_number DESC, transaction_index DESC, log_index DESC LIMIT 1
    ) e ON true
    WHERE t.collection=$1 AND t.token_id=$2
  `, [collection, tokenId]);
  return result.rows[0];
}

app.use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"], allowHeaders: ["Content-Type","If-None-Match"],
  exposeHeaders:["ETag","X-Metadata-Release","X-Metadata-Ownership"] }));
app.use('/v1/*',async(c,next)=>{
  if(metadataSourceMode()==='archive'&&!['/v1/status','/v1/indexing-status'].includes(c.req.path)){
    const specific=c.req.path.match(/^\/v1\/tokens\/(ethereum|base|polygon|bnb)\//)?.[1] as CollectionSlug|undefined;
    const selected=specific?[specific]:chainSelection(c.req.url)?.chains??collectionSlugs;
    const ownership=await chainReadiness(pool,selected);
    if(!ownership.ready)return c.json({error:'ownership_rebuilding',ownership},503);
  }
  await next();
});
app.get('/v1/indexing-status',async c=>c.json(metadataSourceMode()==='archive'?await chainReadiness(pool):{ready:true,mode:'legacy-http'}));
// No candidate release can be selected through an HTTP request.
if (metadataSourceMode() === "archive") app.route("/legacy-meta", legacyMetadataRouter(localMetadata));
app.get("/docs", (c) => c.html(docsHtml));
app.get("/docs/", (c) => c.html(docsHtml));
app.get("/docs/openapi.json", (c) => c.json(openApiDocument));
app.get("/openapi.json", (c) => c.json(openApiDocument));

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/ready", async (c) => {
  try {
    await pool.query("SELECT 1");
    const metadata = await metadataReadiness(pool);
    if (!metadata.ready) return c.json({ status: "not_ready", metadata }, 503);
    return c.json({ status: "ready", databasePool: {
      total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount
    } });
  } catch (error) {
    return c.json({ status: "not_ready", databasePool: {
      total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount
    }, error: error instanceof Error ? error.message : String(error) }, 503);
  }
});

app.get("/v1/tokens", async (c) => {
  const limit = limitOf(c.req.query("limit"));
  const cursorRaw = c.req.query("cursor");
  const ownerInput = c.req.query("owner");
  const burned = c.req.query("burned");
  const url = new URL(c.req.url);
  const traitTypes = url.searchParams.getAll("traitType");
  const traitValues = url.searchParams.getAll("traitValue");
  const rarityMin = c.req.query("rarityMin");
  const rarityMax = c.req.query("rarityMax");
  const rarityCappedMin = c.req.query("rarityCappedMin");
  const rarityCappedMax = c.req.query("rarityCappedMax");
  const metadata = c.req.query("metadata") ?? "all";
  const sort = (c.req.query("sort") ?? "token-id-asc") as TokenSort;
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chain, chains } = selection;
  if (traitTypes.length !== traitValues.length || traitTypes.some((value) => !value) || traitValues.some((value) => !value)) return c.json({ error: "Each traitType must have a positional traitValue" }, 400);
  if (!tokenSorts.includes(sort)) return c.json({ error: "Invalid sort", available: tokenSorts }, 400);
  if (!(["all", "available", "missing"] as const).includes(metadata as "all")) return c.json({ error: "Invalid metadata filter" }, 400);
  if (burned !== undefined && burned !== "true" && burned !== "false") return c.json({ error: "Invalid burned filter" }, 400);
  if (rarityMin !== undefined && !/^-?\d+(\.\d+)?$/.test(rarityMin)) return c.json({ error: "Invalid rarityMin" }, 400);
  if (rarityMax !== undefined && !/^-?\d+(\.\d+)?$/.test(rarityMax)) return c.json({ error: "Invalid rarityMax" }, 400);
  if (rarityMin !== undefined && rarityMax !== undefined && Number(rarityMin) > Number(rarityMax)) return c.json({ error: "rarityMin cannot exceed rarityMax" }, 400);
  if (rarityCappedMin !== undefined && !/^-?\d+(\.\d+)?$/.test(rarityCappedMin)) return c.json({ error: "Invalid rarityCappedMin" }, 400);
  if (rarityCappedMax !== undefined && !/^-?\d+(\.\d+)?$/.test(rarityCappedMax)) return c.json({ error: "Invalid rarityCappedMax" }, 400);
  if (rarityCappedMin !== undefined && rarityCappedMax !== undefined && Number(rarityCappedMin) > Number(rarityCappedMax)) return c.json({ error: "rarityCappedMin cannot exceed rarityCappedMax" }, 400);
  const traitGroups = new Map<string, string[]>();
  traitTypes.forEach((type, index) => {
    const values = traitGroups.get(type) ?? [];
    if (!values.includes(traitValues[index]!)) values.push(traitValues[index]!);
    traitGroups.set(type, values);
  });
  const ownerResolution = ownerInput ? await requireResolvedOwner(ownerInput, chains) : undefined;
  const projectionId = await readActiveProjectionId();
  const searchRelation = projectionId ? metadataSearchReadRelationAt(projectionId) : metadataSearchReadRelation;
  const traitRelation = projectionId ? metadataTraitReadRelationAt(projectionId) : metadataTraitReadRelation;
  const filterConfig = { visibility: "visible", chains, owner: ownerResolution?.addresses ?? null, burned: burned ?? null, traits: [...traitGroups].sort(([a], [b]) => a.localeCompare(b)).map(([type, values]) => [type, [...values].sort()]), rarityMin: rarityMin ?? null, rarityMax: rarityMax ?? null, rarityCappedMin: rarityCappedMin ?? null, rarityCappedMax: rarityCappedMax ?? null, metadata, sort };
  const expectedConfig = configHash(projectionId ? { ...filterConfig, projectionId } : filterConfig);
  const { sort: _countSort, ...countFilterConfig } = filterConfig;
  const visibilityRevision = (await pool.query<{ revision: string }>(`SELECT md5(coalesce(jsonb_agg(
    jsonb_build_array(collection,token_id::text,owner,lifecycle,anchor_event_id,anchor_block::text,
      anchor_transaction_index,anchor_log_index) ORDER BY collection,token_id)::text,'[]')) AS revision
    FROM metadata.token_visibility`)).rows[0]!.revision;
  const countConfig = configHash({ ...countFilterConfig, projectionId, visibilityRevision });
  let cursor: TokenCursor | undefined;
  if (cursorRaw) {
    cursor = decodeTokenCursor(cursorRaw);
    // Preserve legacy numeric cursors for the original default ordering.
    if (!cursor && /^\d+$/.test(cursorRaw) && sort === "token-id-asc") cursor = { v: 2, config: expectedConfig, collection: "ethereum", tokenId: cursorRaw, rarity: null };
    if (!cursor || cursor.config !== expectedConfig) return c.json({ error: "Cursor does not match this filter and sort configuration" }, 400);
  }
  const params: unknown[] = [];
  const where: string[] = [`NOT ${activeVisibilityPredicate()}`];
  params.push(chains); where.push(`t.collection = ANY($${params.length}::text[])`);
  if (ownerResolution) {
    const clauses: string[] = [];
    for (const [ownerChain, address] of Object.entries(ownerResolution.addresses)) {
      params.push(ownerChain, address!.toLowerCase());
      clauses.push(`(t.collection = $${params.length - 1} AND t.owner = $${params.length})`);
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (burned === "true" || burned === "false") { params.push(burned === "true"); where.push(`t.burned = $${params.length}`); }
  const indexedRarityBrowse = sort.startsWith("rarity") && metadata === "available";
  if(indexedRarityBrowse)where.push('s.collection = ANY($1::text[])');
  const tokenOnlyBrowse = !sort.startsWith("rarity") && metadata === "all"
    && rarityMin === undefined && rarityMax === undefined && rarityCappedMin === undefined && rarityCappedMax === undefined;
  if (metadata !== "all") {
    params.push(metadata === "available");
    where.push(indexedRarityBrowse ? `s.metadata_available = $${params.length}` : `COALESCE(s.metadata_available, false) = $${params.length}`);
  }
  if (rarityMin !== undefined) { params.push(rarityMin); where.push(`s.rarity_points >= $${params.length}::numeric`); }
  if (rarityMax !== undefined) { params.push(rarityMax); where.push(`s.rarity_points <= $${params.length}::numeric`); }
  if (rarityCappedMin !== undefined) { params.push(rarityCappedMin); where.push(`s.rarity_points_capped >= $${params.length}::numeric`); }
  if (rarityCappedMax !== undefined) { params.push(rarityCappedMax); where.push(`s.rarity_points_capped <= $${params.length}::numeric`); }
  let traitCandidateParams: { type: number; values: number } | undefined;
  for (const [type, values] of traitGroups) {
    params.push(type, values);
    traitCandidateParams ??= { type: params.length - 1, values: params.length };
    where.push(`EXISTS (SELECT 1 FROM ${traitRelation} f WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle AND f.trait_type=$${params.length - 1} AND f.value=ANY($${params.length}::text[]))`);
  }
  const baseWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const cursorWhere: string[] = tokenOnlyBrowse ? [...where.slice(1)] : [...where];
  if (cursor) {
    if (sort === "token-id-asc" || sort === "token-id-desc") {
      params.push(cursor.tokenId, cursor.collection);
      const op = sort === "token-id-asc" ? ">" : "<";
      cursorWhere.push(`(t.token_id::numeric ${op} $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`);
    } else if (cursor.rarity === null) {
      const rarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
      params.push(cursor.tokenId, cursor.collection); cursorWhere.push(`s.${rarityColumn} IS NULL AND (t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`);
    } else {
      const rarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
      params.push(cursor.rarity, cursor.tokenId, cursor.collection);
      const op = sort.endsWith("-desc") ? "<" : ">";
      cursorWhere.push(`(s.${rarityColumn} ${op} $${params.length - 2}::numeric OR s.${rarityColumn} IS NULL OR (s.${rarityColumn} = $${params.length - 2}::numeric AND (t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))))`);
    }
  }
  const sortRarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
  const orderBy = sort === "token-id-asc" ? "t.token_id::numeric ASC, t.collection ASC" : sort === "token-id-desc" ? "t.token_id::numeric DESC, t.collection ASC" : `s.${sortRarityColumn} ${sort.endsWith("-desc") ? "DESC" : "ASC"} NULLS LAST, t.token_id::numeric ASC, t.collection ASC`;
  const cursorParamCount = cursor ? (sort.startsWith("rarity") && cursor.rarity !== null ? 3 : 2) : 0;
  const countParams = params.slice(0, params.length - cursorParamCount);
  const includesBnb = chains.includes("bnb");
  const includesPhysical = chains.some((slug) => slug !== "bnb");
  const tokenRelation = includesBnb && !includesPhysical ? `${bnbSchema}.token` : `${physicalPonderSchema}.token`;
  const selectiveTokenSource = (relation: string) => {
    if (!traitCandidateParams) return relation;
    const rawTraits = metadataRawTraitReadRelationAt(projectionId ?? undefined);
    // Raw traits only narrow candidates. Every validated trait and publication
    // predicate remains in WHERE before ordering and LIMIT.
    return `(SELECT current.* FROM (SELECT DISTINCT collection,token_id,lifecycle
      FROM ${rawTraits} candidates WHERE candidates.collection=ANY($1::text[])
        AND candidates.trait_type=$${traitCandidateParams.type}::text
        AND candidates.value=ANY($${traitCandidateParams.values}::text[])) candidate_keys
      JOIN LATERAL (SELECT * FROM ${relation} current
        WHERE current.collection=candidate_keys.collection AND current.token_id=candidate_keys.token_id::text
          AND current.lifecycle=candidate_keys.lifecycle OFFSET 0) current ON true)`;
  };
  const sourceFor = (relation: string, pointRead = false) => {
    const schema = relation.slice(0, -".token".length);
    const search = pointRead ? searchRelation : metadataSearchReadRelationFor(schema, schema !== bnbSchema && chains.includes("base"), chains, projectionId ?? undefined);
    const tokens = selectiveTokenSource(relation);
    return tokenOnlyBrowse ? `${tokens} t` : indexedRarityBrowse
      ? `${search} s JOIN ${tokens} t ON t.collection=s.collection AND t.token_id::numeric=s.token_id AND t.lifecycle=s.lifecycle`
      : `${tokens} t LEFT JOIN ${search} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle`;
  };
  const candidateSource = sourceFor(tokenRelation);
  const countNeedsSearch = metadata !== "all" || rarityMin !== undefined || rarityMax !== undefined
    || rarityCappedMin !== undefined || rarityCappedMax !== undefined;
  const simpleExactCount = !countNeedsSearch && !ownerResolution && traitGroups.size === 0;
  const countWithoutVisibility = where.slice(1);
  const countWhere = countWithoutVisibility.length ? `WHERE ${countWithoutVisibility.join(" AND ")}` : "";
  const selectedRelations = [includesPhysical ? `${physicalPonderSchema}.token` : null, includesBnb ? `${bnbSchema}.token` : null].filter((value): value is string => Boolean(value));
  const baseCountSql = selectedRelations.map((relation) => `(SELECT count(*) FROM ${relation} t ${countWhere})`).join(" + ");
  const hiddenProbe = (relation: string) => `EXISTS (SELECT 1 FROM ${relation} t
    WHERE t.collection=visibility.collection AND t.token_id::numeric=visibility.token_id
      AND ${activeVisibilityRowPredicate("t")}
      ${countWithoutVisibility.length ? `AND ${countWithoutVisibility.join(" AND ")}` : ""})`;
  const hiddenCountSql = `(SELECT count(*) FROM metadata.token_visibility visibility WHERE (${selectedRelations.map(hiddenProbe).join(" OR ")}))`;
  const countSourceFor = (relation: string) => {
    const tokens = selectiveTokenSource(relation);
    if (!countNeedsSearch) return `${tokens} t`;
    if (ownerResolution || traitGroups.size > 0)
      return `${tokens} t LEFT JOIN LATERAL (SELECT * FROM ${searchRelation} validated
        WHERE validated.collection=t.collection AND validated.token_id=t.token_id::numeric
          AND validated.lifecycle=t.lifecycle OFFSET 0) s ON true`;
    const schema = relation.slice(0, -".token".length);
    const search = metadataSearchReadRelationFor(schema, schema !== bnbSchema && chains.includes("base"), chains, projectionId ?? undefined);
    return `${tokens} t LEFT JOIN ${search} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle`;
  };
  const filteredCountSql = selectedRelations.map((relation) => `SELECT count(*)::bigint AS total FROM ${countSourceFor(relation)} ${baseWhere}`).join(" UNION ALL ");
  const countSql = simpleExactCount
    ? `SELECT (${baseCountSql} - ${hiddenCountSql})::int AS total`
    : `SELECT COALESCE(sum(total), 0)::int AS total FROM (${filteredCountSql}) filtered_counts`;
  // A cold exact count validates every publication and chain anchor. Give that
  // bounded read-only query its own budget; ordinary API reads retain 10 s.
  const queryExactCount = async () => {
    if (simpleExactCount) return Number((await pool.query(countSql, countParams)).rows[0].total);
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SET LOCAL work_mem = '32MB'");
      await client.query("SET LOCAL jit = off");
      if (!ownerResolution && traitGroups.size === 0) {
        await client.query("SET LOCAL work_mem = '64MB'");
        await client.query("SET LOCAL enable_nestloop = off");
        await client.query("SET LOCAL random_page_cost = 1.1");
        await client.query("SET LOCAL join_collapse_limit = 1");
        await client.query("SET LOCAL from_collapse_limit = 1");
      }
      const total = Number((await client.query(countSql, countParams)).rows[0].total);
      await client.query("COMMIT");
      return total;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const countPromise = (async () => {
    const started = performance.now();
    const cached = await exactCountCache.get(countConfig, queryExactCount);
    return { ...cached, durationMs: performance.now() - started };
  })();
  params.push(limit + 1);
  const candidateColumns = `t.collection, t.chain_id, t.contract_address, t.token_id, t.owner, t.burned, t.lifecycle,
      t.mint_block, t.last_transfer_block,
      ${tokenOnlyBrowse ? "false" : "COALESCE(s.metadata_available, false)"} AS metadata_available,
      ${tokenOnlyBrowse ? "NULL::numeric" : "s.rarity_points"} AS rarity_points,
      ${tokenOnlyBrowse ? "NULL::numeric" : "s.rarity_points_capped"} AS rarity_points_capped`;
  const candidateLimit = tokenOnlyBrowse
    ? `($${params.length} + (SELECT count(*) FROM metadata.token_visibility))`
    : `$${params.length}`;
  const candidateWhere = cursorWhere.length ? `WHERE ${cursorWhere.join(" AND ")}` : "";
  const branch = (relation: string) => `SELECT ${candidateColumns} FROM ${relation} t
    ${candidateWhere} ORDER BY ${orderBy} LIMIT ${candidateLimit}`;
  const sourceBranch = (relation: string) => {
    const source = sourceFor(relation, true);
    return `SELECT ${candidateColumns} FROM ${source} ${candidateWhere} ORDER BY ${orderBy} LIMIT ${candidateLimit}`;
  };
  const candidateQuery = selectedRelations.length > 1
    ? `SELECT * FROM ((${selectedRelations.map(sourceBranch).join(") UNION ALL (")})) merged
       ORDER BY ${orderBy.replaceAll("t.", "merged.").replaceAll("s.", "merged.")} LIMIT ${candidateLimit}`
    : sourceBranch(selectedRelations[0]!);
  const rarityQueries = sort.startsWith("rarity") ? rarityPageQueries({
    relations: selectedRelations,
    rawSearch: metadataRawSearchReadRelationAt(projectionId ?? undefined),
    validatedSearch: searchRelation,
    bulkSearch: (relation) => {
      const schema = relation.slice(0, -".token".length);
      return metadataSearchReadRelationFor(schema, schema !== bnbSchema && chains.includes("base"), chains, projectionId ?? undefined);
    },
    columns: candidateColumns, filters: where, cursorFilters: cursorWhere,
    values: params, sort, cursor,
    selective: Boolean(ownerResolution) || traitGroups.size > 0,
    selectiveTokens: selectiveTokenSource,
    nullsExcluded: sort.startsWith("rarity-capped")
      ? rarityCappedMin !== undefined || rarityCappedMax !== undefined
      : rarityMin !== undefined || rarityMax !== undefined,
    missingExcluded: metadata === "available" || rarityMin !== undefined || rarityMax !== undefined
      || rarityCappedMin !== undefined || rarityCappedMax !== undefined
  }) : null;
  // Keep metadata enrichment dependent on the bounded page. Otherwise an
  // uncertain overfetch estimate can make PostgreSQL scan the entire archive.
  let pagePhase = sort.startsWith("rarity") ? "rank-page" : "token-page";
  const resultPromise = (async () => {
    const started = performance.now();
    const pageSql = (candidates: string) => `WITH candidates AS MATERIALIZED (${candidates})
    SELECT c.collection AS chain, c.chain_id AS "chainId", c.contract_address AS "contractAddress",
      c.token_id AS "tokenId", c.owner, c.burned, c.lifecycle,
      c.mint_block AS "mintBlock", c.last_transfer_block AS "lastTransferBlock",
      m.name, m.image, m.attributes, m.token_uri AS "tokenUri",
      m.uri_provenance AS "uriProvenance", m.audit_status AS "uriAuditStatus",
      ${tokenOnlyBrowse ? "COALESCE(search.metadata_available, false)" : "c.metadata_available"} AS "metadataAvailable",
      ${tokenOnlyBrowse ? "search.rarity_points" : "c.rarity_points"}::text AS "rarityPoints",
      ${tokenOnlyBrowse ? "search.rarity_points_capped" : "c.rarity_points_capped"}::text AS "rarityPointsCapped"
    FROM candidates c
    LEFT JOIN LATERAL (SELECT * FROM ${metadataReadRelation} metadata_page
      WHERE metadata_page.collection=c.collection AND metadata_page.token_id=c.token_id::numeric AND metadata_page.lifecycle=c.lifecycle OFFSET 0) m ON true
    ${tokenOnlyBrowse ? `LEFT JOIN LATERAL (SELECT * FROM ${searchRelation} search_page
      WHERE search_page.collection=c.collection AND search_page.token_id=c.token_id::numeric AND search_page.lifecycle=c.lifecycle OFFSET 0) search ON true` : ""}
    ${tokenOnlyBrowse ? `WHERE NOT ${activeVisibilityPredicate("c")}` : ""}
    ORDER BY ${orderBy.replaceAll("t.", "c.").replaceAll("s.", "c.")}
    ${tokenOnlyBrowse ? `LIMIT $${params.length}` : ""}
    `;
    const rows = rarityQueries
      ? (rarityQueries.nonnull ? (await pool.query(pageSql(rarityQueries.nonnull), params)).rows : [])
      : (await pool.query(pageSql(candidateQuery), params)).rows;
    if (rarityQueries?.nulls && rows.length <= limit) {
      pagePhase = "null-candidates";
      const client = await pool.connect();
      let nullCandidates: RarityCandidate[];
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL work_mem = '32MB'");
        await client.query("SET LOCAL jit = off");
        if (!ownerResolution && traitGroups.size === 0) {
          await client.query("SET LOCAL work_mem = '64MB'");
          await client.query("SET LOCAL enable_nestloop = off");
          await client.query("SET LOCAL random_page_cost = 1.1");
          await client.query("SET LOCAL join_collapse_limit = 1");
          await client.query("SET LOCAL from_collapse_limit = 1");
        }
        nullCandidates = (await client.query<RarityCandidate>(rarityQueries.nulls, params)).rows;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      // Bulk-proof planner settings must not reach the correlated document
      // lookups: they would scan whole proof tables for every page token.
      if (nullCandidates.length) {
        pagePhase = "null-page-enrichment";
        const bounded = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS page(
          collection text,chain_id integer,contract_address text,token_id text,
          owner text,burned boolean,lifecycle integer,mint_block numeric,last_transfer_block numeric,
          metadata_available boolean,rarity_points numeric,rarity_points_capped numeric)`;
        rows.push(...(await pool.query(pageSql(bounded), [JSON.stringify(nullCandidates)])).rows.slice(0, limit + 1 - rows.length));
      }
    }
    const result = { rows };
    return { result, durationMs: performance.now() - started };
  })();
  // Shared count work has its own deadline. Settle both branches without
  // cancelling a loader still used by another request.
  const [pageRead, countRead] = await Promise.allSettled([resultPromise, countPromise]);
  if (pageRead.status === "rejected" || countRead.status === "rejected") {
    console.error("API token query failed", { chains, sort, projectionId,
      pagePhase,
      pageFailed: pageRead.status === "rejected", countFailed: countRead.status === "rejected" });
    throw pageRead.status === "rejected" ? pageRead.reason : countRead.status === "rejected" ? countRead.reason : new Error("token_query_failed");
  }
  const result = pageRead.value;
  const countResult = countRead.value;
  const resultMs = result.durationMs;
  const countMs = countResult.durationMs;
  c.header("Server-Timing", `page;dur=${resultMs.toFixed(1)}, count;dur=${countMs.toFixed(1)};desc="${countResult.hit ? "hit" : "miss"}"`);
  if (resultMs > 1_000 || countMs > 1_000) console.info("API token query timing", {
    chains, sort, filters: where.length - 1, pageMs: Math.round(resultMs),
    countMs: Math.round(countMs), countCacheHit: countResult.hit
  });
  const hasMore = result.result.rows.length > limit;
  const items = result.result.rows.slice(0, limit);
  const last = items.at(-1);
  const cursorRarity = sort.startsWith("rarity-capped") ? last?.rarityPointsCapped : last?.rarityPoints;
  return c.json({ ...chainSelectionJson(selection), items, nextCursor: hasMore && last ? encodeTokenCursor({ v: 2, config: expectedConfig, collection: last.chain, tokenId: last.tokenId, rarity: cursorRarity ?? null }) : null, total: countResult.value,
    ...(ownerResolution ? ownerResolutionJson(ownerResolution) : {}) });
});

app.get("/v1/traits", async (c) => {
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection;
  const projectionId = await readActiveProjectionId();
  const table = projectionId ? "metadata_projection" : "metadata";
  const facet = projectionId ? "facet" : "trait_facet";
  const statusTable = projectionId ? "facet_status" : "trait_facet_status";
  const generationFilter = projectionId ? ` AND generation_id=${projectionId}::bigint` : "";
  const [facets, status] = await Promise.all([
    pool.query(`SELECT trait_type AS "traitType", kind, min_value::text AS min, max_value::text AS max, values FROM ${table}.${facet} WHERE scope=$1${generationFilter} ORDER BY trait_type`, [scope]),
    pool.query(`SELECT available, missing, updated_at, ${metadataSourceMode() === "archive" ? projectionId ? `(SELECT metadata_release_id FROM metadata_projection.generation WHERE id=${projectionId}::bigint) AS metadata_release_id` : "(SELECT metadata_release_id FROM metadata.derived_snapshot WHERE name='traits') AS metadata_release_id" : "NULL::text AS metadata_release_id"} FROM ${table}.${statusTable} WHERE scope=$1${generationFilter}`, [scope])
  ]);
  if (metadataSourceMode() === "archive") {
    const release = await localMetadata.release();
    if (status.rows[0]?.metadata_release_id !== release) return c.json({error:"trait_snapshot_pending"},503);
  }
  const items = facets.rows.map((row) => row.kind === "numeric"
    ? { traitType: row.traitType, kind: row.kind, min: row.min, max: row.max }
    : { traitType: row.traitType, kind: row.kind, values: row.values });
  return c.json({ ...chainSelectionJson(selection), items, metadata: { available: status.rows[0]?.available ?? 0, missing: status.rows[0]?.missing ?? 0 }, updatedAt: status.rows[0]?.updated_at ?? null });
});

async function tokenDetail(collection: CollectionSlug, tokenId: string) {
  const results = await Promise.all([
    pool.query(`SELECT t.*, t.collection AS chain, m.name, m.description, m.image, m.animation_url, m.attributes,
      m.document, s.rarity_points::text AS "rarityPoints", s.rarity_points_capped::text AS "rarityPointsCapped",
      m.token_uri, m.uri_provenance, m.uri_verified_at_block, m.audit_status,
      m.fetch_status, m.fetched_at FROM ${ponderSchema}.token t
      LEFT JOIN ${metadataReadRelation} m ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
      LEFT JOIN ${metadataSearchReadRelation} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE t.collection=$1 AND t.token_id=$2`, [collection, tokenId]),
    pool.query(`SELECT * FROM ${ponderSchema}.transfer_event WHERE collection=$1 AND token_id=$2 ORDER BY block_number, transaction_index, log_index`, [collection, tokenId]),
    pool.query(`SELECT l.*, m.token_uri, m.uri_provenance, m.audit_status, m.name, m.image
      FROM ${ponderSchema}.token_lifecycle l LEFT JOIN ${metadataReadRelation} m
      ON m.collection=l.collection AND m.token_id=l.token_id::numeric AND m.lifecycle=l.lifecycle
      WHERE l.collection=$1 AND l.token_id=$2 ORDER BY l.lifecycle`, [collection, tokenId])
  ]);
  if (metadataSourceMode() === "archive" && results[0].rows.length) {
    const local = await localMetadata.token(collection, tokenId);
    Object.assign(results[0].rows[0], { document: local?.document ?? null,
      publication_status: local?.status ?? "unavailable", publication_error: local?.reason ?? null,
      metadata_release: local?.release ?? null, metadata_ownership_source: "indexed_chain" });
  }
  return results;
}

app.get("/v1/tokens/:chain/:tokenId/visibility/signing-data", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection) return c.json({ error: "invalid_chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "invalid_token_id" }, 400);
  const hiddenRaw = c.req.query("hidden");
  if (hiddenRaw !== "true" && hiddenRaw !== "false") return c.json({ error: "invalid_hidden", message: "hidden must be true or false" }, 400);

  const state = await currentVisibilityState(pool, collection, tokenId);
  if (!state) return c.json({ error: "token_not_found" }, 404);
  if (state.burned) return c.json({ error: "token_not_active" }, 409);
  const owner = String(state.owner).toLowerCase();
  const nonceResult = await pool.query("SELECT next_nonce::text FROM metadata.wallet_visibility_nonce WHERE owner=$1", [owner]);
  const message: VisibilityMessage = {
    owner: owner as Address,
    tokenId,
    lifecycle: Number(state.lifecycle),
    ownershipTransactionHash: state.transactionHash as Hex,
    ownershipLogIndex: Number(state.logIndex),
    hidden: hiddenRaw === "true",
    nonce: nonceResult.rows[0]?.next_nonce ?? "0",
    deadline: Math.floor(Date.now() / 1_000) + visibilitySignatureTtlSeconds
  };
  return c.json({ typedData: visibilitySigningDataJson(collection, message) });
});

app.put("/v1/tokens/:chain/:tokenId/visibility", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection) return c.json({ error: "invalid_chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "invalid_token_id" }, 400);
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "invalid_json" }, 400); }
  const parsed = visibilityRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
  if (parsed.data.message.tokenId !== tokenId) return c.json({ error: "token_mismatch" }, 400);

  const now = Math.floor(Date.now() / 1_000);
  if (parsed.data.message.deadline < now) return c.json({ error: "signature_expired" }, 410);
  if (parsed.data.message.deadline > now + visibilitySignatureTtlSeconds) return c.json({ error: "invalid_deadline" }, 400);

  const message = parsed.data.message as VisibilityMessage;
  const owner = message.owner.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if(metadataSourceMode()==='archive'){
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))");
      const ownership=await chainReadiness(client,[collection]);
      if(!ownership.ready){await client.query('ROLLBACK');return c.json({error:'ownership_rebuilding',ownership},503);}
    }
    await client.query(`INSERT INTO metadata.wallet_visibility_nonce(owner, next_nonce)
      VALUES ($1, 0) ON CONFLICT (owner) DO NOTHING`, [owner]);
    const nonceResult = await client.query(`SELECT next_nonce::text FROM metadata.wallet_visibility_nonce
      WHERE owner=$1 FOR UPDATE`, [owner]);
    if (nonceResult.rows[0].next_nonce !== message.nonce) {
      await client.query("ROLLBACK");
      return c.json({ error: "nonce_conflict", nextNonce: nonceResult.rows[0].next_nonce }, 409);
    }

    const state = await currentVisibilityState(client, collection, tokenId);
    if (!state) {
      await client.query("ROLLBACK");
      return c.json({ error: "token_not_found" }, 404);
    }
    if (state.burned) {
      await client.query("ROLLBACK");
      return c.json({ error: "token_not_active" }, 409);
    }
    const stateChanged = String(state.owner).toLowerCase() !== owner
      || Number(state.lifecycle) !== message.lifecycle
      || String(state.transactionHash).toLowerCase() !== message.ownershipTransactionHash.toLowerCase()
      || Number(state.logIndex) !== message.ownershipLogIndex;
    if (stateChanged) {
      await client.query("ROLLBACK");
      return c.json({ error: "ownership_changed" }, 409);
    }

    let validSignature = false;
    try { validSignature = await verifyVisibilitySignature(collection, message, parsed.data.signature as Hex); }
    catch { validSignature = false; }
    if (!validSignature) {
      await client.query("ROLLBACK");
      return c.json({ error: "invalid_signature" }, 401);
    }

    if (message.hidden) {
      await client.query(`INSERT INTO metadata.token_visibility(
          collection, token_id, owner, lifecycle, anchor_event_id, anchor_block,
          anchor_transaction_index, anchor_log_index, hidden_at, updated_at)
        VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, $8, now(), now())
        ON CONFLICT (collection, token_id) DO UPDATE SET
          owner=EXCLUDED.owner, lifecycle=EXCLUDED.lifecycle, anchor_event_id=EXCLUDED.anchor_event_id,
          anchor_block=EXCLUDED.anchor_block, anchor_transaction_index=EXCLUDED.anchor_transaction_index,
          anchor_log_index=EXCLUDED.anchor_log_index, hidden_at=now(), updated_at=now()`,
      [collection, tokenId, owner, message.lifecycle, state.eventId, state.blockNumber, state.transactionIndex, state.logIndex]);
    } else {
      await client.query("DELETE FROM metadata.token_visibility WHERE collection=$1 AND token_id=$2::numeric", [collection, tokenId]);
    }
    await client.query(`UPDATE metadata.wallet_visibility_nonce
      SET next_nonce=next_nonce+1, updated_at=now() WHERE owner=$1`, [owner]);
    await client.query("COMMIT");
    return c.json({ chain: collection, tokenId, owner, hidden: message.hidden });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
});

app.get("/v1/tokens/:chain/:tokenId", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400);
  const [tokenResult, transfers, lifecycles] = await tokenDetail(collection, tokenId);
  if (!tokenResult.rows[0]) return c.json({ error: "Token not found" }, 404);
  return c.json({ token: tokenResult.rows[0], transfers: transfers.rows, lifecycles: lifecycles.rows });
});

app.get("/v1/tokens/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400);
  const [tokenResult, transfers, lifecycles] = await tokenDetail("ethereum", tokenId);
  if (!tokenResult.rows[0]) return c.json({ error: "Token not found" }, 404);
  return c.json({ token: tokenResult.rows[0], transfers: transfers.rows, lifecycles: lifecycles.rows });
});

registerCollectorRoutes(app, { pool, resolveOwner: requireResolvedOwner,
  checkReadiness: async (chains) => metadataSourceMode() === "archive" ? chainReadiness(pool, chains) : { ready: true }
});

app.get("/v1/owners/:address/tokens", async (c) => {
  const ownerInput = c.req.param("address");
  const limit = limitOf(c.req.query("limit"));
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chains, scope } = selection;
  const visibility = (c.req.query("visibility") ?? "visible") as VisibilityMode;
  if (!visibilityModes.includes(visibility)) return c.json({ error: "Invalid visibility", available: visibilityModes }, 400);
  const ownerResolution = await requireResolvedOwner(ownerInput, chains);
  const cursorRaw = c.req.query("cursor");
  let cursor = decodeOwnerCursor(cursorRaw);
  if (cursorRaw && (!cursor || cursor.scope !== scope || cursor.visibility !== visibility)) return c.json({ error: "Invalid cursor for this chain and visibility filter" }, 400);
  const params: unknown[] = [];
  const ownerClauses: string[] = [];
  for (const [ownerChain, address] of Object.entries(ownerResolution.addresses)) {
    params.push(ownerChain, address!.toLowerCase());
    ownerClauses.push(`(t.collection=$${params.length - 1} AND t.owner=$${params.length})`);
  }
  const where = [`(${ownerClauses.join(" OR ")})`, `NOT t.burned`];
  if (visibility === "visible") where.push(`NOT ${activeVisibilityPredicate()}`);
  else if (visibility === "hidden") where.push(activeVisibilityPredicate());
  params.push(chains); where.push(`t.collection=ANY($${params.length}::text[])`);
  if (cursor) {
    params.push(cursor.tokenId, cursor.collection);
    where.push(`(t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`);
  }
  params.push(limit + 1);
  const result = await pool.query(`SELECT t.collection AS chain, t.chain_id AS "chainId",
      t.contract_address AS "contractAddress", t.token_id AS "tokenId", t.lifecycle, m.name, m.image, m.attributes,
      s.rarity_points::text AS "rarityPoints", s.rarity_points_capped::text AS "rarityPointsCapped",
      ${activeVisibilityPredicate()} AS hidden
    FROM ${ponderSchema}.token t LEFT JOIN ${metadataReadRelation} m
    ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
    LEFT JOIN ${metadataSearchReadRelation} s
    ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
    WHERE ${where.join(" AND ")}
    ORDER BY t.token_id::numeric, t.collection LIMIT $${params.length}`, params);
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const last = items.at(-1);
  const canonicalOwner = canonicalOwnerAddress(ownerResolution, chains);
  return c.json({ owner: canonicalOwner?.toLowerCase(), ...ownerResolutionJson(ownerResolution), ...chainSelectionJson(selection), visibility, items,
    nextCursor: hasMore && last ? encodeOwnerCursor({ v: 3, scope, visibility, collection: last.chain, tokenId: last.tokenId }) : null });
});

app.get("/v1/leaderboards", async (c) => {
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection;
  const snapshot = await pool.query(`SELECT max(updated_at) AS updated_at, count(*)::int AS wallets FROM ${leaderboardReadRelation} WHERE scope=$1`, [scope]);
  return c.json({
    items: Object.entries(leaderboardMetrics).map(([slug, value]) => ({ slug, label: value.label })),
    collectorScore: { version: scoreVersion, formula: scoreFormula },
    ...chainSelectionJson(selection), wallets: snapshot.rows[0].wallets,
    updatedAt: snapshot.rows[0].updated_at
  });
});

app.get("/v1/leaderboards/:metric", async (c) => {
  const slug = c.req.param("metric") as LeaderboardSlug;
  const definition = leaderboardMetrics[slug];
  if (!definition) return c.json({ error: "Unknown leaderboard", available: Object.keys(leaderboardMetrics) }, 404);
  const limit = limitOf(c.req.query("limit"));
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection;
  const cursorRaw = c.req.query("cursor");
  const cursor = decodeRankCursor(cursorRaw);
  if (cursorRaw && (!cursor || (cursor.scope ?? "all") !== scope)) return c.json({ error: "Invalid cursor for this chain filter" }, 400);
  const params: unknown[] = [];
  let cursorWhere = "";
  if (cursor) {
    params.push(cursor.score, cursor.monsterCount, cursor.owner);
    cursorWhere = `WHERE (ranked.score < $1::numeric OR (ranked.score = $1::numeric AND ranked.monster_count < $2) OR (ranked.score = $1::numeric AND ranked.monster_count = $2 AND ranked.owner > $3))`;
  }
  params.push(scope);
  const scopeParam = params.length;
  params.push(limit + 1);
  const limitParam = params.length;
  const result = await pool.query(`
    WITH ranked AS (
      SELECT owner, ${definition.column}::numeric AS score, monster_count, total_rarity,
        unique_types, special_count, glitter_count, collector_score, updated_at,
        dense_rank() OVER (ORDER BY ${definition.column} DESC) AS rank
      FROM ${leaderboardReadRelation}
      WHERE scope=$${scopeParam} AND ${definition.column} > 0
    )
    SELECT rank::int, ranked.owner, score::text, monster_count AS "monsterCount",
      total_rarity::text AS "totalRarity", unique_types AS "uniqueTypes",
      special_count AS "specialCount", glitter_count AS "glitterCount",
      collector_score::text AS "collectorScore", ranked.updated_at AS "updatedAt",
      selected_ens.name AS "ensName"
    FROM ranked
    ${verifiedEnsJoin("ranked.owner", `$${scopeParam}`)}
    ${cursorWhere}
    ORDER BY ranked.score DESC, ranked.monster_count DESC, ranked.owner ASC LIMIT $${limitParam}
  `, params);
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    metric: slug, label: definition.label, ...chainSelectionJson(selection), scoreVersion: slug === "collector-score" ? scoreVersion : null,
    items, nextCursor: hasMore && last ? encodeRankCursor({ score: last.score, monsterCount: last.monsterCount, owner: last.owner, scope }) : null,
    updatedAt: items[0]?.updatedAt ?? null
  });
});

app.get("/v1/owners/:address/leaderboard", async (c) => {
  const ownerInput = c.req.param("address");
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chains, scope } = selection;
  const ownerResolution = await requireResolvedOwner(ownerInput, chains);
  const address = canonicalOwnerAddress(ownerResolution, chains)!.toLowerCase();
  const result = await pool.query(`
    WITH ranks AS (
      SELECT *, dense_rank() OVER (ORDER BY total_rarity DESC) AS total_rarity_rank,
        dense_rank() OVER (ORDER BY monster_count DESC) AS monster_count_rank,
        dense_rank() OVER (ORDER BY unique_types DESC) AS unique_types_rank,
        dense_rank() OVER (ORDER BY special_count DESC) AS special_count_rank,
        dense_rank() OVER (ORDER BY glitter_count DESC) AS glitter_count_rank,
        dense_rank() OVER (ORDER BY collector_score DESC) AS collector_score_rank
      FROM ${leaderboardReadRelation} WHERE scope=$2
    )
    SELECT ranks.owner, monster_count AS "monsterCount", total_rarity::text AS "totalRarity",
      unique_types AS "uniqueTypes", special_count AS "specialCount", glitter_count AS "glitterCount",
      collector_score::text AS "collectorScore", score_version AS "scoreVersion", ranks.updated_at AS "updatedAt",
      total_rarity_rank::int AS "totalRarityRank", monster_count_rank::int AS "monsterCountRank",
      unique_types_rank::int AS "uniqueTypesRank", special_count_rank::int AS "specialCountRank",
      glitter_count_rank::int AS "glitterCountRank", collector_score_rank::int AS "collectorScoreRank",
      selected_ens.name AS "ensName"
    FROM ranks
    ${verifiedEnsJoin("ranks.owner", "$2")}
    WHERE ranks.owner=$1
  `, [address, scope]);
  if (!result.rows[0]) return c.json({ error: "Wallet has no active Yunipals" }, 404);
  return c.json({ ...result.rows[0], ...ownerResolutionJson(ownerResolution), ...chainSelectionJson(selection) });
});

app.get("/v1/collection", async (c) => {
  const selection = chainSelection(c.req.url);
  if (!selection) return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const params: unknown[] = [selection.chains];
  const where = `WHERE collection=ANY($1::text[])`;
  const result = await pool.query(`SELECT count(*)::int AS "knownTokens",
    count(*) FILTER (WHERE NOT burned)::int AS "activeSupply",
    count(*) FILTER (WHERE burned)::int AS "burnedTokens",
    COALESCE(sum(lifecycle), 0)::int AS "lifecycles" FROM ${ponderSchema}.token ${where}`, params);
  return c.json({ ...chainSelectionJson(selection), ...result.rows[0] });
});

app.get("/v1/collections", async (c) => {
  const counts = await pool.query(`SELECT collection AS chain, count(*)::int AS "knownTokens",
    count(*) FILTER (WHERE NOT burned)::int AS "activeSupply" FROM ${ponderSchema}.token GROUP BY collection`);
  const byChain = new Map(counts.rows.map((row) => [row.chain, row]));
  return c.json({ items: collectionSlugs.map((slug) => ({ ...collections[slug], ...(byChain.get(slug) ?? { knownTokens: 0, activeSupply: 0 }) })) });
});

app.get("/v1/status", async (c) => {
  const publication = await publicationStatus(pool);
  const [metadata, indexing, bnbIngestion] = await Promise.all([
    pool.query("SELECT collection, fetch_status, count(*)::int AS count FROM metadata.token_metadata GROUP BY collection, fetch_status"),
    pool.query(`SELECT collection, count(*)::int AS "knownTokens", max(last_transfer_block)::text AS "lastEventBlock"
      FROM ${ponderSchema}.token GROUP BY collection`),
    pool.query(`SELECT next_block::text AS "nextBlock", last_scanned_block::text AS "lastScannedBlock",
      caught_up_at AS "caughtUpAt", last_error AS "lastError", updated_at AS "updatedAt"
      FROM ${bnbSchema}.sync_state WHERE singleton`)
  ]);
  const indexedByCollection = new Map(indexing.rows.map((row) => [row.collection, row]));
  return c.json({
    publication,
    collections: collectionSlugs.map((slug) => ({ ...collections[slug],
      ...(indexedByCollection.get(slug) ?? { knownTokens: 0, lastEventBlock: null }),
      metadata: Object.fromEntries(metadata.rows.filter((row) => row.collection === slug).map((row) => [row.fetch_status, row.count])) })),
    uriMode: metadataSourceMode() === "archive"
      ? { ethereum: "verified_archive_binding", base: "verified_archive_binding", polygon: "verified_archive_binding", bnb: "verified_archive_binding" }
      : { ethereum: "current_base_formula", base: "current_token_uri_call", polygon: "current_token_uri_call", bnb: "current_token_uri_call" },
    bnbIngestion: bnbIngestion.rows[0] ?? null,
    verificationTokenId: process.env.URI_VERIFY_TOKEN_ID ?? "1000000000000",
    metadata: Object.fromEntries(metadata.rows.map((r) => [`${r.collection}:${r.fetch_status}`, r.count]))
  });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hostname = process.env.API_HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, hostname, port }, (info) => console.log(`Yunipals API listening on http://${hostname}:${info.port}`));
}

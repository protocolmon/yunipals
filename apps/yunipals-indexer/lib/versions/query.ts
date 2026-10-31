import {
  normalizeCollectorRarityRange,
  normalizeCollectorSearch
} from "../api/collector-filters.js";
import { createHash } from "node:crypto";
import {
  parseCollectionFilters,
  hasMarketFilters,
  serializeCollectionFilters
} from "@protopals/yunipals-market-core/collectionFilters";
import {
  isIndexedChain,
  tokenSorts
} from "@protopals/yunipals-market-core/collectionTypes";
import { collectionSlugs } from "../constants.js";
import {
  metadataReadRelation,
  metadataSearchReadRelation,
  metadataTraitReadRelation
} from "../metadata/read-source.js";
import { isSolanaAddress } from "@protopals/yunipals-market-core/monsterVersions";
import {
  versionMembership,
  versionTokenSource,
  versionVisibility,
  versionSqlAssetKey,
  solanaVersionReadsEnabled
} from "./read.js";

export class VersionQueryError extends Error {
  constructor(
    message: string,
    public status: 400 | 409 = 400
  ) {
    super(message);
  }
}
type Position = { score: string | null; tokenId: string; chain: string };
type Cursor = Position & { config: string; expires: number; previous: boolean };

export function parseVersionQuery(params: URLSearchParams) {
  if (params.toString().length > 4096)
    throw new VersionQueryError("Too many filters.");
  const allowed = new Set([
    "chain",
    "sort",
    "metadata",
    "rarityMode",
    "rarityMin",
    "rarityMax",
    "rarityCappedMin",
    "rarityCappedMax",
    "sale",
    "currency",
    "priceMin",
    "priceMax",
    "owner",
    "visibility",
    "q",
    "limit",
    "cursor"
  ]);
  for (const [key, value] of params) {
    if (!allowed.has(key) && !key.startsWith("t."))
      throw new VersionQueryError("Unsupported filter.");
    if (
      key !== "chain" &&
      !key.startsWith("t.") &&
      params.getAll(key).length !== 1
    )
      throw new VersionQueryError("Repeated filter.");
    if (key === "chain" && !isIndexedChain(value) && value !== "solana")
      throw new VersionQueryError("Unsupported chain.");
    if (
      /^rarity.*(?:Min|Max)$/.test(key) &&
      !/^\d{1,80}(\.\d{1,30})?$/.test(value)
    )
      throw new VersionQueryError("Invalid rarity bound.");
    if (
      key.startsWith("t.") &&
      (!key.slice(2).trim() ||
        key.length > 130 ||
        !value.trim() ||
        value.length > 80 ||
        params.getAll(key).length > 20)
    )
      throw new VersionQueryError("Invalid trait filter.");
  }
  if (params.has("sort") && !tokenSorts.some((s) => s === params.get("sort")))
    throw new VersionQueryError("Grouped price sorting is unavailable.");
  if (
    params.has("metadata") &&
    !["all", "available", "missing"].includes(params.get("metadata")!)
  )
    throw new VersionQueryError("Invalid metadata filter.");
  if (
    params.has("rarityMode") &&
    !["raw", "capped"].includes(params.get("rarityMode")!)
  )
    throw new VersionQueryError("Invalid rarity mode.");
  if (
    (params.has("sale") &&
      !["all", "listed", "unlisted"].includes(params.get("sale")!)) ||
    (params.has("currency") &&
      !["all", "native", "weth"].includes(params.get("currency")!))
  )
    throw new VersionQueryError("Invalid sale filter.");
  if (new Set([...params.keys()].filter((k) => k.startsWith("t."))).size > 20)
    throw new VersionQueryError("Too many trait filters.");
  if (params.has("owner") && !params.get("owner")?.trim())
    throw new VersionQueryError("Invalid collector.");
  if (
    (params.has("rarityMin") || params.has("rarityMax")) &&
    (params.has("rarityCappedMin") || params.has("rarityCappedMax"))
  )
    throw new VersionQueryError("Choose one rarity mode.");
  try {
    normalizeCollectorRarityRange(
      params.get("rarityMin") ?? "",
      params.get("rarityMax") ?? ""
    );
    normalizeCollectorRarityRange(
      params.get("rarityCappedMin") ?? "",
      params.get("rarityCappedMax") ?? ""
    );
  } catch {
    throw new VersionQueryError("Invalid rarity range.");
  }
  const filters = parseCollectionFilters(params);
  if (hasMarketFilters(filters))
    throw new VersionQueryError("Sale and price filters show individual NFTs.");
  const limitText = params.get("limit") ?? "24";
  if (
    !/^\d+$/.test(limitText) ||
    Number(limitText) < 1 ||
    Number(limitText) > 24
  )
    throw new VersionQueryError("Invalid page size.");
  const visibility = params.get("visibility") ?? "visible";
  if (
    !["visible", "hidden"].includes(visibility) ||
    (visibility === "hidden" && !params.get("owner"))
  )
    throw new VersionQueryError("Invalid visibility.");
  let search: string;
  try {
    search = normalizeCollectorSearch(params.get("q") ?? "");
  } catch {
    throw new VersionQueryError("Invalid search.");
  }
  return {
    filters,
    chains: params.has("chain")
      ? [...new Set(params.getAll("chain"))]
      : [
          ...collectionSlugs,
          ...(solanaVersionReadsEnabled() ? ["solana"] : [])
        ],
    limit: Number(limitText),
    visibility,
    search,
    cursor: params.get("cursor"),
    owner: params.get("owner")
  };
}

export function buildVersionQuery(
  request: ReturnType<typeof parseVersionQuery>,
  revision: string,
  ownerAddresses: Partial<Record<string, string>>,
  ownershipRevision: string,
  now = Date.now()
) {
  const values: unknown[] = [revision];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const config = createHash("sha256")
    .update(
      JSON.stringify([
        revision,
        ownershipRevision,
        request.chains,
        serializeCollectionFilters(request.filters).toString(),
        request.search,
        request.visibility,
        request.limit,
        ownerAddresses
      ])
    )
    .digest("hex");
  let cursor: Cursor | undefined;
  if (request.cursor) {
    try {
      if (
        request.cursor.length > 2048 ||
        !/^[A-Za-z0-9_-]+$/.test(request.cursor)
      )
        throw new Error();
      cursor = JSON.parse(
        Buffer.from(request.cursor, "base64url").toString()
      ) as Cursor;
      if (
        cursor.config !== config ||
        !Number.isSafeInteger(cursor.expires) ||
        cursor.expires <= now ||
        cursor.expires > now + 900_000 ||
        typeof cursor.previous !== "boolean" ||
        !request.chains.includes(
          cursor.chain as (typeof request.chains)[number]
        ) ||
        typeof cursor.tokenId !== "string" ||
        (cursor.chain === "solana"
          ? !isSolanaAddress(cursor.tokenId)
          : !/^\d{1,78}$/.test(cursor.tokenId) ||
            BigInt(cursor.tokenId) >= 2n ** 256n) ||
        (cursor.score !== null &&
          (typeof cursor.score !== "string" ||
            !/^\d{1,80}(\.\d{1,30})?$/.test(cursor.score)))
      )
        throw new Error();
    } catch {
      throw new VersionQueryError(
        "This page has expired. Refresh the collection.",
        409
      );
    }
  }
  const previous = cursor?.previous ?? false;
  const sort = request.filters.sort;
  const numericSort = sort.startsWith("token-id");
  const ascending = !sort.endsWith("desc");
  const score = numericSort
    ? "NULL::numeric"
    : sort.startsWith("rarity-capped")
      ? "COALESCE(s.rarity_points_capped,s.rarity_points)"
      : "s.rarity_points";
  const idDirection = numericSort && !ascending ? "DESC" : "ASC";
  const normalOrder = numericSort
    ? `identity_kind ${idDirection},id_number ${idDirection},id_text ${idDirection},collection ASC`
    : `score ${ascending ? "ASC" : "DESC"} NULLS LAST,identity_kind ASC,id_number ASC,id_text ASC,collection ASC`;
  const pageOrder = previous
    ? normalOrder
        .replaceAll("ASC", "TEMP")
        .replaceAll("DESC", "ASC")
        .replaceAll("TEMP", "DESC")
        .replace("NULLS LAST", "NULLS FIRST")
    : normalOrder;
  const solana = solanaVersionReadsEnabled();
  const evmId = (alias: string) =>
    `(CASE WHEN ${alias}.collection='solana' THEN NULL::numeric ELSE ${alias}.token_id::numeric END)`;
  // Keep EVM metadata lookups on their numeric indexes; Solana IDs retain case.
  const metadata = (
    alias: string
  ) => `SELECT m.name,m.image,m.attributes,m.token_uri FROM ${metadataReadRelation} m
    WHERE m.collection=${alias}.collection AND m.token_id=${evmId(alias)} AND m.lifecycle=${alias}.lifecycle
    ${solana ? `UNION ALL SELECT m.name,m.image,m.attributes,st.metadata_uri FROM solana_indexer.asset_metadata m JOIN solana_indexer.token st ON st.mint=m.mint WHERE ${alias}.collection='solana' AND m.mint=${alias}.token_id` : ""}`;
  const where = [
    `t.collection=ANY(${bind(request.chains)}::text[])`,
    "NOT t.burned",
    `${request.visibility === "visible" ? "NOT " : ""}${versionVisibility("t", Boolean(request.owner))}`
  ];
  if (request.owner)
    where.push(
      `EXISTS(SELECT 1 FROM jsonb_each_text(${bind(JSON.stringify(ownerAddresses))}::jsonb) o WHERE o.key=t.collection AND CASE WHEN t.collection='solana' THEN t.owner=o.value ELSE lower(t.owner)=lower(o.value) END)`
    );
  if (request.search)
    where.push(
      /^\d+$/.test(request.search) || isSolanaAddress(request.search)
        ? `t.token_id=${bind(request.search)}`
        : `EXISTS(SELECT 1 FROM (${metadata("t")}) n WHERE lower(n.name) LIKE ${bind(request.search.toLowerCase().replace(/[\\%_]/g, "\\$&") + "%")} ESCAPE E'\\\\')`
    );
  for (const [trait, choices] of Object.entries(request.filters.traits)) {
    const type = bind(trait),
      selected = bind(choices);
    const evm = `EXISTS(SELECT 1 FROM ${metadataTraitReadRelation} f WHERE f.collection=t.collection AND f.token_id=${evmId("t")} AND f.lifecycle=t.lifecycle AND f.trait_type=${type} AND f.value=ANY(${selected}::text[]))`;
    where.push(
      solana
        ? `(CASE WHEN t.collection='solana' THEN EXISTS(SELECT 1 FROM solana_indexer.asset_metadata sm CROSS JOIN LATERAL jsonb_array_elements(sm.attributes) f WHERE sm.mint=t.token_id AND f->>'trait_type'=${type} AND f->>'value'=ANY(${selected}::text[])) ELSE ${evm} END)`
        : evm
    );
  }
  const rarity =
    request.filters.rarityMode === "capped"
      ? "COALESCE(s.rarity_points_capped,s.rarity_points)"
      : "s.rarity_points";
  if (request.filters.rarityMin)
    where.push(`${rarity}>=${bind(request.filters.rarityMin)}::numeric`);
  if (request.filters.rarityMax)
    where.push(`${rarity}<=${bind(request.filters.rarityMax)}::numeric`);
  if (request.filters.metadata !== "all")
    where.push(
      `COALESCE(s.metadata_available,false)=${bind(request.filters.metadata === "available")}`
    );
  let boundary = "true";
  if (cursor) {
    const identity = `(${cursor.chain === "solana" ? 1 : 0},${bind(cursor.chain === "solana" ? "0" : cursor.tokenId)}::numeric,${bind(cursor.chain === "solana" ? cursor.tokenId : "")}::text COLLATE "C")`,
      chain = bind(cursor.chain);
    const ties = `((identity_kind,id_number,id_text) ${previous !== (idDirection === "DESC") ? "<" : ">"} ${identity} OR ((identity_kind,id_number,id_text)=${identity} AND collection ${previous ? "<" : ">"} ${chain}))`;
    if (numericSort) boundary = ties;
    else if (cursor.score === null)
      boundary = previous
        ? `(score IS NOT NULL OR (score IS NULL AND ${ties}))`
        : `(score IS NULL AND ${ties})`;
    else {
      const scoreParam = bind(cursor.score);
      boundary = `(score ${ascending !== previous ? ">" : "<"} ${scoreParam}::numeric OR (score=${scoreParam}::numeric AND ${ties})${previous ? "" : " OR score IS NULL"})`;
    }
  }
  const text = `WITH tokens AS (${versionTokenSource()}), membership AS (${versionMembership("$1")}),
  matching AS MATERIALIZED (
    SELECT t.*,s.metadata_available,s.rarity_points,s.rarity_points_capped,${score} AS score,
      CASE WHEN t.collection='solana' THEN 1 ELSE 0 END AS identity_kind,
      CASE WHEN t.collection='solana' THEN 0::numeric ELSE t.token_id::numeric END AS id_number,
      (CASE WHEN t.collection='solana' THEN t.token_id ELSE '' END) COLLATE "C" AS id_text,
      COALESCE(v.group_id,'nft:'||${versionSqlAssetKey("t")}) AS group_id
    FROM tokens t LEFT JOIN membership v ON v.collection=t.collection AND v.contract_address=lower(t.contract_address) AND v.token_id=t.token_id AND v.lifecycle=t.lifecycle
    LEFT JOIN ${metadataSearchReadRelation} evm_search ON evm_search.collection=t.collection AND evm_search.token_id=${evmId("t")} AND evm_search.lifecycle=t.lifecycle
    ${solana ? "LEFT JOIN solana_indexer.asset_metadata solana_search ON t.collection='solana' AND solana_search.mint=t.token_id" : ""}
    CROSS JOIN LATERAL(SELECT ${solana ? "CASE WHEN t.collection='solana' THEN solana_search.mint IS NOT NULL ELSE evm_search.metadata_available END" : "evm_search.metadata_available"} AS metadata_available,
      ${solana ? "CASE WHEN t.collection='solana' THEN solana_search.rarity_points ELSE evm_search.rarity_points END" : "evm_search.rarity_points"} AS rarity_points,
      ${solana ? "CASE WHEN t.collection='solana' THEN solana_search.rarity_points_capped ELSE evm_search.rarity_points_capped END" : "evm_search.rarity_points_capped"} AS rarity_points_capped) s
    WHERE ${where.join(" AND ")}
  ), ranked AS MATERIALIZED (SELECT *,row_number() OVER(PARTITION BY group_id ORDER BY ${normalOrder}) AS rn FROM matching),
  representatives AS MATERIALIZED (SELECT * FROM ranked WHERE rn=1),
  page AS MATERIALIZED (SELECT * FROM representatives WHERE ${boundary} ORDER BY ${pageOrder} LIMIT ${bind(request.limit + 1)}),
  enriched AS (SELECT r.group_id,r.rn,jsonb_build_object('chain',r.collection,'chainId',r.chain_id,'contractAddress',NULLIF(r.contract_address,''),'tokenId',r.token_id,'owner',r.owner,'burned',r.burned,'lifecycle',r.lifecycle,
    'mintBlock',r.mint_block::text,'lastTransferBlock',r.last_transfer_block::text,'name',m.name,'image',m.image,'attributes',m.attributes,'tokenUri',m.token_uri,'metadataAvailable',COALESCE(r.metadata_available,false),
    'rarityPoints',r.rarity_points::text,'rarityPointsCapped',r.rarity_points_capped::text,'hidden',${request.visibility === "hidden"}) || ${solana ? "CASE WHEN r.collection='solana' THEN jsonb_build_object('ownershipObservedAt',(SELECT observed_at FROM solana_indexer.token WHERE mint=r.token_id),'legacyAlias',(SELECT legacy_alias FROM solana_indexer.manifest_asset WHERE mint=r.token_id)) ELSE '{}'::jsonb END" : "'{}'::jsonb"} AS token
    FROM ranked r JOIN page p USING(group_id) LEFT JOIN LATERAL(${metadata("r")}) m ON true),
  grouped AS (SELECT group_id,jsonb_agg(token ORDER BY rn) AS members FROM enriched GROUP BY group_id)
  SELECT (SELECT count(*)::int FROM representatives) AS "groupTotal",(SELECT count(*)::int FROM matching) AS "nftTotal",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.group_id,'members',g.members,'position',jsonb_build_object('score',p.score::text,'chain',p.collection,'tokenId',p.token_id)) ORDER BY ${pageOrder
      .split(",")
      .map((part) => `p.${part}`)
      .join(
        ","
      )}) FROM page p JOIN grouped g ON g.group_id=p.group_id),'[]'::jsonb) AS groups`;
  return {
    text,
    values,
    page<T extends { id: string; members: unknown[]; position: Position }>(
      rows: T[]
    ) {
      const more = rows.length > request.limit;
      const items = rows.slice(0, request.limit);
      if (previous) items.reverse();
      const encode = (item: T, back: boolean) =>
        Buffer.from(
          JSON.stringify({
            ...item.position,
            config,
            previous: back,
            expires: cursor?.expires ?? now + 900_000
          })
        ).toString("base64url");
      return {
        groups: items.map(({ position: _position, ...g }) => g),
        nextCursor:
          items.length && (previous ? Boolean(cursor) : more)
            ? encode(items[items.length - 1]!, false)
            : null,
        previousCursor:
          items.length && (previous ? more : Boolean(cursor))
            ? encode(items[0]!, true)
            : null
      };
    }
  };
}

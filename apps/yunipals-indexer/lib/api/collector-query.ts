import { metadataReadRelation, metadataSearchReadRelation, metadataTraitReadRelation } from "../metadata/read-source.js";
import { createHash } from "node:crypto";
import { collectionSlugs, type CollectionSlug } from "../constants.js";
import type { ResolvedOwner } from "../ens/resolver.js";
import { bnbSchema, physicalPonderSchema } from "../offchain/sql.js";
import { activeVisibilityPredicate } from "./visibility-query.js";
import {
  collectorFiltersKey,
  parseCollectorFilters,
  type CollectorFilters,
} from "./collector-filters.js";

export class CollectorQueryError extends Error {
  constructor(
    public code: "invalid_collector_query" | "invalid_collector_cursor",
    message: string,
  ) {
    super(message);
  }
}
type Boundary = {
  chain: CollectionSlug;
  tokenId: string;
  rarity: string | null;
};
type Cursor = Boundary & {
  v: 1;
  config: string;
  direction: "next" | "previous";
  expires: number;
};
export type CollectorRequest = {
  filters: CollectorFilters;
  chains: CollectionSlug[];
  visibility: "visible" | "hidden";
  limit: number;
  rawCursor: string | null;
};
export function parseCollectorRequest(
  params: URLSearchParams,
): CollectorRequest {
  try {
    const allowed = new Set([
      "chain",
      "t.Type",
      "t.Color",
      "rarityMin",
      "rarityMax",
      "sort",
      "q",
      "visibility",
      "limit",
      "cursor",
    ]);
    for (const key of params.keys())
      if (!allowed.has(key)) throw new Error(`Unsupported filter: ${key}`);
    for (const key of ["visibility", "limit", "cursor"]) {
      if (params.getAll(key).length > 1)
        throw new Error(`Use one ${key} value.`);
    }
    const filters = parseCollectorFilters(params);
    const visibility = params.get("visibility") ?? "visible";
    if (visibility !== "visible" && visibility !== "hidden")
      throw new Error("Invalid visibility.");
    const rawLimit = params.get("limit") ?? "24";
    if (!/^\d+$/.test(rawLimit)) throw new Error("Invalid page size.");
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 48)
      throw new Error("Page size must be between 1 and 48.");
    return {
      filters,
      chains: filters.chains.length ? filters.chains : [...collectionSlugs],
      visibility,
      limit,
      rawCursor: params.get("cursor"),
    };
  } catch (error) {
    throw new CollectorQueryError(
      "invalid_collector_query",
      error instanceof Error ? error.message : "Invalid filters.",
    );
  }
}

export type CollectorRow = {
  chain: CollectionSlug;
  tokenId: string;
  rarityPoints: string | null;
  rarityPointsCapped: string | null;
};

export function collectorQuery(
  request: CollectorRequest,
  owner: ResolvedOwner,
  now = Date.now(),
) {
  const { filters, chains, visibility, limit } = request;
  const query = collectorFiltersKey(filters);
  const owners = chains.flatMap((chain) =>
    owner.addresses[chain]
      ? [[chain, owner.addresses[chain]!.toLowerCase()]]
      : [],
  );
  const config = createHash("sha256")
    .update(JSON.stringify([1, owners, visibility, query, limit]))
    .digest("hex");
  let cursor: Cursor | undefined;
  if (request.rawCursor !== null) {
    try {
      if (
        !request.rawCursor ||
        request.rawCursor.length > 2048 ||
        !/^[A-Za-z0-9_-]+$/.test(request.rawCursor)
      )
        throw new Error();
      const value = JSON.parse(
        Buffer.from(request.rawCursor, "base64url").toString(),
      ) as Cursor;
      if (
        value.v !== 1 ||
        value.config !== config ||
        !chains.includes(value.chain) ||
        typeof value.tokenId !== "string" ||
        !/^\d{1,78}$/.test(value.tokenId) ||
        BigInt(value.tokenId) >= 2n ** 256n ||
        (value.rarity !== null &&
          (typeof value.rarity !== "string" ||
            !/^\d{1,80}(\.\d{1,30})?$/.test(value.rarity))) ||
        !["next", "previous"].includes(value.direction) ||
        !Number.isSafeInteger(value.expires) ||
        value.expires <= now ||
        value.expires > now + 15 * 60_000
      )
        throw new Error();
      cursor = value;
    } catch {
      throw new CollectorQueryError(
        "invalid_collector_cursor",
        "This page has expired or belongs to different filters. Start from the first page.",
      );
    }
  }
  const previous = cursor?.direction === "previous";
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  // Explicit owner predicates in each physical branch also permit FDW pushdown.
  const branches = owners.map(([chain, address]) => {
    const relation = chain === "bnb" ? bnbSchema : physicalPonderSchema;
    const ownerParam = bind(address);
    const chainParam = bind(chain);
    const tokenParam = /^\d+$/.test(filters.search)
      ? ` AND t.token_id=${bind(filters.search)}`
      : "";
    return `SELECT t.collection,t.chain_id,t.contract_address,t.token_id,t.owner,t.burned,t.lifecycle,t.mint_block,t.last_transfer_block
      FROM ${relation}.token t WHERE t.owner=${ownerParam} AND t.collection=${chainParam} AND NOT t.burned${tokenParam}${visibility === "hidden" ? ` AND t.token_id IN (SELECT token_id::text FROM metadata.token_visibility WHERE collection=${chainParam} AND owner=${ownerParam})` : ""}`;
  });
  if (!branches.length)
    throw new CollectorQueryError(
      "invalid_collector_query",
      "No resolved owner on the selected chains.",
    );
  const rarity = "COALESCE(s.rarity_points_capped,s.rarity_points)";
  // OFFSET 0 keeps rarity and page enrichment correlated with owned tokens.
  // Trait/name predicates can use their selective collection indexes. Sorting
  // is fenced separately so visibility checks run before the bounded page limit.
  const hidden = activeVisibilityPredicate("t", true);
  const where: string[] = [];
  const visibleWhere = visibility === "visible" ? `NOT ${hidden}` : hidden;
  for (const [trait, selected] of [
    ["Type", filters.types],
    ["Color", filters.colors],
  ] as const) {
    if (selected.length)
      where.push(
        `EXISTS (SELECT 1 FROM ${metadataTraitReadRelation} f WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle AND f.trait_type=${bind(trait)} AND f.value=ANY(${bind(selected)}::text[]) AND f.collection=ANY(${bind(chains)}::text[]))`,
      );
  }
  if (filters.search && !/^\d+$/.test(filters.search)) {
    const prefix = filters.search.replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      `EXISTS (SELECT 1 FROM ${metadataReadRelation} n WHERE n.collection=t.collection AND n.token_id=t.token_id::numeric AND n.lifecycle=t.lifecycle AND lower(n.name) LIKE ${bind(prefix)} ESCAPE E'\\\\' AND n.collection=ANY(${bind(chains)}::text[]))`,
    );
  }
  if (filters.rarityMin)
    where.push(`${rarity} >= ${bind(filters.rarityMin)}::numeric`);
  if (filters.rarityMax)
    where.push(`${rarity} <= ${bind(filters.rarityMax)}::numeric`);
  const ascending = filters.sort.endsWith("-asc");
  if (cursor) {
    const id = bind(cursor.tokenId);
    const chain = bind(cursor.chain);
    const tie = `(t.token_id::numeric,t.collection) ${previous ? "<" : ">"} (${id}::numeric,${chain}::text)`;
    if (cursor.rarity === null) {
      where.push(
        previous
          ? `(${rarity} IS NOT NULL OR (${rarity} IS NULL AND ${tie}))`
          : `(${rarity} IS NULL AND ${tie})`,
      );
    } else {
      const score = bind(cursor.rarity);
      const op = ascending !== previous ? ">" : "<";
      where.push(
        `(${rarity} ${op} ${score}::numeric OR (${rarity}=${score}::numeric AND ${tie})${previous ? "" : ` OR ${rarity} IS NULL`})`,
      );
    }
  }
  const rarityDirection = ascending !== previous ? "ASC" : "DESC";
  const tieDirection = previous ? "DESC" : "ASC";
  const nulls = previous ? "FIRST" : "LAST";
  // Every currently hidden result needs a visibility row for one resolved owner.
  // Counting those small rows (including stale ones) gives a safe overfetch bound,
  // allowing a top-N sort without walking or sorting the whole wallet's tail.
  const candidateLimit = bind(limit + 1);
  const overfetch = visibility === "visible"
    ? `${candidateLimit} + (SELECT count(*) FROM metadata.token_visibility WHERE owner=ANY(${bind(owners.map(([, address]) => address))}::text[]))`
    : candidateLimit;
  const text = `WITH owned AS MATERIALIZED (${branches.join(" UNION ALL ")}), ranked AS (
    SELECT t.*,s.metadata_available,s.rarity_points,s.rarity_points_capped,${rarity} AS effective_rarity
    FROM owned t LEFT JOIN LATERAL (SELECT s.metadata_available,s.rarity_points,s.rarity_points_capped FROM ${metadataSearchReadRelation} s WHERE s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle OFFSET 0) s ON true
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  ), candidates AS MATERIALIZED (
    SELECT t.* FROM (SELECT * FROM ranked ORDER BY effective_rarity ${rarityDirection} NULLS ${nulls},token_id::numeric ${tieDirection},collection ${tieDirection} LIMIT ${visibility === "visible" ? overfetch : "ALL"} OFFSET 0) t WHERE ${visibleWhere} LIMIT ${candidateLimit}
  ) SELECT c.collection AS chain,c.chain_id AS "chainId",c.contract_address AS "contractAddress",c.token_id AS "tokenId",
    c.owner,c.burned,c.lifecycle,c.mint_block::text AS "mintBlock",c.last_transfer_block::text AS "lastTransferBlock",
    m.name,m.image,m.attributes,m.token_uri AS "tokenUri",COALESCE(c.metadata_available,false) AS "metadataAvailable",
    c.rarity_points::text AS "rarityPoints",c.rarity_points_capped::text AS "rarityPointsCapped",${visibility === "hidden"} AS hidden
    FROM candidates c LEFT JOIN LATERAL (SELECT * FROM ${metadataReadRelation} page_metadata WHERE page_metadata.collection=c.collection AND page_metadata.token_id=c.token_id::numeric AND page_metadata.lifecycle=c.lifecycle OFFSET 0) m ON true
    ORDER BY c.effective_rarity ${rarityDirection} NULLS ${nulls},c.token_id::numeric ${tieDirection},c.collection ${tieDirection}`;
  const encode = (row: CollectorRow, direction: Cursor["direction"]) =>
    Buffer.from(
      JSON.stringify({
        v: 1,
        config,
        direction,
        expires: cursor?.expires ?? now + 15 * 60_000,
        chain: row.chain,
        tokenId: row.tokenId,
        rarity: row.rarityPointsCapped ?? row.rarityPoints,
      } satisfies Cursor),
    ).toString("base64url");
  return {
    text,
    values,
    page<T extends CollectorRow>(rows: T[]) {
      const more = rows.length > limit;
      const items = rows.slice(0, limit);
      if (previous) items.reverse();
      return {
        version: 1 as const,
        query,
        items,
        nextCursor:
          items.length && (previous ? Boolean(cursor) : more)
            ? encode(items[items.length - 1]!, "next")
            : null,
        previousCursor:
          items.length && (previous ? more : Boolean(cursor))
            ? encode(items[0]!, "previous")
            : null,
      };
    },
  };
}

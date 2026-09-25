import type { PoolClient } from "pg";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  parseCollectionFilters,
  isPriceSort
} from "@protopals/yunipals-market-core/collectionFilters";
import {
  indexedChains,
  tokenSorts
} from "@protopals/yunipals-market-core/collectionTypes";
import { validateCatalogFilters } from "@protopals/yunipals-market-core/catalogFilters";
import { catalogCurrencies } from "@protopals/yunipals-market-core/catalogCurrency";
import {
  parseCatalogToken,
  type CatalogToken
} from "@protopals/yunipals-market-core/catalogToken";
import {
  parseMarketOrder,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";

import { BnbOrderError } from "@/bnb/orders";
import { marketOrderRowsSql } from "@/reads/orderRows";
import { observedOrderStateSql, type readOrderSources } from "@/reads/orders";
import { parsePageRequest } from "@/reads/snapshots";
import {
  indexedTokenHiddenSql,
  indexedTokenNumberSql
} from "@/reads/visibility";

export type CatalogSources = Awaited<ReturnType<typeof readOrderSources>>;
export type CatalogPosition = {
  chainId: number;
  tokenId: string;
  value: string | null;
};
export type CatalogRow = {
  token: CatalogToken;
  market: {
    status: "listed" | "unlisted" | "unknown" | "updating" | "unavailable";
    listings: MarketOrder[];
  };
};

export function parseCatalogRequest(params: URLSearchParams) {
  try {
    const allowed = [
      "chain",
      "sale",
      "currency",
      "priceMin",
      "priceMax",
      "sort",
      "rarityMode",
      "rarityMin",
      "rarityMax",
      "rarityCappedMin",
      "rarityCappedMax",
      "metadata",
      "limit",
      "cursor",
      "snapshot"
    ];
    for (const [name, value] of params) {
      if (name.startsWith("t.")) {
        if (!name.slice(2).trim() || !value.trim()) throw new Error();
      } else if (
        !allowed.includes(name) ||
        (name !== "chain" && params.getAll(name).length > 1)
      )
        throw new Error();
    }
    const enums: Record<string, readonly string[]> = {
      chain: indexedChains,
      sale: ["all", "listed", "unlisted"],
      currency: ["all", "native", "weth"],
      sort: [...tokenSorts, "price-asc", "price-desc"],
      rarityMode: ["raw", "capped"],
      metadata: ["all", "available", "missing"]
    };
    for (const [key, values] of Object.entries(enums))
      for (const value of params.getAll(key))
        if (!values.includes(value)) throw new Error();
    const raw = ["rarityMin", "rarityMax"].some((key) => params.has(key));
    const capped = ["rarityCappedMin", "rarityCappedMax"].some((key) =>
      params.has(key)
    );
    if (raw && capped) throw new Error();
    for (const key of [
      "rarityMin",
      "rarityMax",
      "rarityCappedMin",
      "rarityCappedMax"
    ]) {
      const value = params.get(key);
      if (value !== null && (!value.trim() || !Number.isFinite(Number(value))))
        throw new Error();
    }
    const filters = parseCollectionFilters(params);
    const validated = validateCatalogFilters(filters);
    const page = parsePageRequest(
      new URLSearchParams({
        ...Object.fromEntries(params),
        limit: params.get("limit") ?? "24"
      })
    );
    if (page.limit > 24) throw new Error();
    return {
      filters,
      ...validated,
      page,
      chains: filters.chains.length ? filters.chains : [...indexedChains]
    };
  } catch {
    throw new BnbOrderError("invalid_catalog_query", 400);
  }
}
export type CatalogQuery = ReturnType<typeof parseCatalogRequest>;

function orderBookSql(
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources
) {
  const currencies = indexedChains.flatMap((chain) =>
    catalogCurrencies(chain).map(
      (currency) =>
        `(${marketplaceChains[chain].chainId},'${currency.address.toLowerCase()}')`
    )
  );
  const values: unknown[] = [
    observedAt,
    query.chains,
    query.chains
      .filter((chain) => sources.statuses[chain] === "available")
      .map((chain) => marketplaceChains[chain].chainId),
    query.currency?.address.toLowerCase() ?? null
  ];
  const ctes = `allowed_currency(chain_id,currency) AS (VALUES ${currencies.join(",")}),
    best AS MATERIALIZED (
      SELECT DISTINCT ON (o.chain_id,o.contract_address,o.token_id,o.maker,o.lifecycle,o.currency)
        o.chain_id,o.contract_address,o.token_id,o.maker,o.lifecycle,o.currency,o.gross_amount,
        o.summary||jsonb_build_object('status','active') AS summary
      FROM ${marketOrderRowsSql} o JOIN allowed_currency a ON a.chain_id=o.chain_id AND a.currency=o.currency
      WHERE o.chain_id=ANY($3::integer[]) AND o.browse_candidate AND o.side='listing'
        AND o.protocol_address='${seaportDeployment.address.toLowerCase()}'
        AND (${observedOrderStateSql})='active'
        AND o.start_time<=extract(epoch FROM $1::timestamptz) AND o.end_time>extract(epoch FROM $1::timestamptz)
        AND ($4::text IS NULL OR o.currency=$4)
      ORDER BY o.chain_id,o.contract_address,o.token_id,o.maker,o.lifecycle,o.currency,o.gross_amount,o.order_hash),
    books AS MATERIALIZED (
      SELECT chain_id,contract_address,token_id,maker,lifecycle,min(gross_amount) AS price,
        jsonb_agg(summary ORDER BY currency) AS listings FROM best GROUP BY chain_id,contract_address,token_id,maker,lifecycle)`;
  return { ctes, values };
}

/** Complete eligible books from the held marketplace snapshot, with exact amounts. */
export async function fetchCatalogBooks(
  db: PoolClient,
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources
) {
  if (!query.chains.some((chain) => sources.statuses[chain] === "available"))
    return "[]";
  const statement = orderBookSql(query, observedAt, sources);
  const result = await db.query({
    text: `WITH request AS (SELECT $2::text[] AS chains), ${statement.ctes}
      SELECT chain_id,contract_address,token_id::text,maker,lifecycle,price::text,listings FROM books`,
    values: statement.values
  });
  return JSON.stringify(result.rows);
}

function tokenSourceQueries(query: CatalogQuery): CatalogQuery[] {
  const ponder = query.chains.filter((chain) => chain !== "bnb");
  return [
    ...(ponder.length ? [{ ...query, chains: ponder }] : []),
    ...(query.chains.includes("bnb")
      ? [{ ...query, chains: ["bnb" as const] }]
      : [])
  ];
}

function catalogClients(db: PoolClient | PoolClient[]) {
  return Array.isArray(db) ? db : [db];
}

export async function fetchCatalogCounts(
  db: PoolClient | PoolClient[],
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources,
  books?: string
) {
  let total = 0n;
  let listed = 0n;
  const clients = catalogClients(db);
  const results = await Promise.all(
    tokenSourceQueries(query).map((part, index) =>
      clients[index % clients.length]!.query<{
        total: string;
        listed: string;
      }>(
        catalogSql(part, observedAt, sources, undefined, "all", false, books)
          .count
      )
    )
  );
  for (const result of results) {
    total += BigInt(result.rows[0]!.total);
    listed += BigInt(result.rows[0]!.listed);
  }
  return { total, listed };
}

export function catalogSql(
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources,
  position?: CatalogPosition,
  phase: "all" | "nonnull" | "null-known" | "null-missing" = "all",
  readAll = false,
  books?: string,
  combineFirstPage = false
) {
  if (
    combineFirstPage &&
    (books === undefined || position || phase !== "all" || readAll)
  )
    throw new Error(
      "Combined catalog reads require an unpositioned direct source query."
    );
  const indexedScore = phase === "nonnull" || phase === "null-known";
  // The source UNION view prevents PostgreSQL from using the token/rank
  // indexes efficiently. Each family is queried directly; callers merge their
  // bounded pages and sum their complete filtered counts on the held snapshot.
  const tokens = query.chains.every((chain) => chain === "bnb")
    ? "bnb_indexer.token"
    : query.chains.every((chain) => chain !== "bnb")
      ? "yunipals_indexer_v3.token"
      : "yunipals_read_v4.token";
  const score = isPriceSort(query.filters.sort)
    ? "price"
    : query.filters.sort.startsWith("rarity-capped")
      ? "rarity_points_capped"
      : "rarity_points";
  const available = query.chains.filter(
    (chain) => sources.statuses[chain] === "available"
  );
  const orderBooks = orderBookSql(query, observedAt, sources);
  const params: unknown[] = [...orderBooks.values];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const bookCtes =
    books === undefined
      ? orderBooks.ctes
      : `request AS (SELECT $1::timestamptz AS observed_at,$2::text[] AS chains,$3::integer[] AS available,$4::text AS currency),
     books AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(${bind(books)}::jsonb)
       AS b(chain_id integer,contract_address text,token_id numeric,maker text,lifecycle integer,price numeric,listings jsonb))`;
  const conditions = [
    "t.collection=ANY($2::text[])",
    // The union view has no multi-column statistics. Joining a four-row registry
    // makes PostgreSQL estimate one surviving NFT and choose a million lookups.
    // This equivalent CASE keeps the exact identity checks and a usable estimate.
    `CASE t.collection ${indexedChains.map((chain) => `WHEN '${chain}' THEN t.chain_id=${marketplaceChains[chain].chainId} AND t.contract_address='${marketplaceChains[chain].contractAddress.toLowerCase()}'`).join(" ")} ELSE false END`,
    "NOT t.burned",
    "t.owner<>'0x0000000000000000000000000000000000000000'",
    `NOT (t.collection||':'||t.token_id=ANY(ARRAY(SELECT h.collection||':'||h.token_id FROM hidden h)))`
  ];
  if (phase !== "all")
    conditions.push(
      phase === "null-missing"
        ? "s.token_id IS NULL"
        : `s.${score} IS ${phase === "nonnull" ? "NOT " : ""}NULL`
    );
  if (indexedScore) conditions.push("s.collection=ANY($2::text[])");
  // PostgreSQL 16's FDW supports BoolExpr/NullTest, but not CoalesceExpr or
  // BooleanTest. Keep the nullable predicate shippable as well as equivalent.
  if (query.filters.metadata !== "all")
    conditions.push(
      query.filters.metadata === "available"
        ? "s.metadata_available=true"
        : "(s.metadata_available=false OR s.metadata_available IS NULL)"
    );
  const rarityField =
    query.filters.rarityMode === "raw"
      ? "s.rarity_points"
      : "s.rarity_points_capped";
  if (query.filters.rarityMin)
    conditions.push(
      `${rarityField}>=${bind(query.filters.rarityMin)}::numeric`
    );
  if (query.filters.rarityMax)
    conditions.push(
      `${rarityField}<=${bind(query.filters.rarityMax)}::numeric`
    );
  const traitJoins: string[] = [];
  for (const [type, values] of Object.entries(query.filters.traits)) {
    const typeParam = bind(type),
      valuesParam = bind(values);
    const f = `f${traitJoins.length}`;
    if (books !== undefined) {
      // This source-owned relation is updated in the same transaction as
      // token_metadata. EXISTS avoids multiplying NFTs for OR values and lets
      // PostgreSQL use a parallel plain count on direct source connections.
      conditions.push(`EXISTS(SELECT 1 FROM metadata.market_catalog_trait ${f}
        WHERE ${f}.collection=t.collection AND ${f}.token_id=${indexedTokenNumberSql} AND ${f}.lifecycle=t.lifecycle
          AND ${f}.collection=ANY($2::text[]) AND ${f}.trait_type=${typeParam} AND ${f}.value=ANY(${valuesParam}::text[]))`);
      continue;
    }
    // Inner joins ship through postgres_fdw; correlated EXISTS does not.
    // Count/page deduplication below preserves OR semantics for repeated values.
    traitJoins.push(`JOIN metadata.market_catalog_trait ${f}
      ON ${f}.collection=t.collection AND ${f}.token_id=${indexedTokenNumberSql} AND ${f}.lifecycle=t.lifecycle
        AND ${f}.collection=ANY($2::text[]) AND ${f}.trait_type=${typeParam} AND ${f}.value=ANY(${valuesParam}::text[])`);
  }
  if (query.filters.sale === "listed")
    conditions.push(available.length ? "b.listings IS NOT NULL" : "false");
  if (query.filters.sale === "unlisted")
    conditions.push(available.length ? "b.listings IS NULL" : "false");
  if (query.min !== undefined)
    conditions.push(
      available.length
        ? `b.price>=${bind(query.min.toString())}::numeric`
        : "false"
    );
  if (query.max !== undefined)
    conditions.push(
      available.length
        ? `b.price<=${bind(query.max.toString())}::numeric`
        : "false"
    );
  // Unknown sources have no eligible books. Omitting that empty local join lets
  // postgres_fdw aggregate the public catalog on the indexer. The service still
  // returns listedTotal=null and rejects financial filters for those sources.
  const base = `WITH ${bookCtes},
    hidden AS MATERIALIZED (
      SELECT t.collection,t.token_id FROM metadata.token_visibility visibility
      JOIN LATERAL (SELECT current.* FROM yunipals_read_v4.token current
        WHERE current.collection=visibility.collection AND current.token_id=pg_catalog.textin(pg_catalog.numeric_out(visibility.token_id)) LIMIT 1) t ON true
      WHERE ${indexedTokenHiddenSql}),
    candidates AS ${phase === "null-missing" || combineFirstPage ? "MATERIALIZED" : ""} (
      SELECT t.collection,t.chain_id,t.contract_address,t.token_id,${indexedScore ? "s.token_id" : indexedTokenNumberSql} AS id_number,t.owner,t.lifecycle,
        t.mint_block,t.last_transfer_block,s.metadata_available,
        s.rarity_points,s.rarity_points_capped,${available.length ? "b.price,b.listings" : "NULL::numeric AS price,NULL::jsonb AS listings"}
      FROM ${
        indexedScore
          ? `metadata.token_search s
        JOIN ${tokens} t ON t.collection=s.collection
          AND t.token_id=pg_catalog.textin(pg_catalog.numeric_out(s.token_id)) AND t.lifecycle=s.lifecycle`
          : `${tokens} t`
      }
      ${indexedScore ? "" : `LEFT JOIN metadata.token_search s ON s.collection=ANY($2::text[]) AND s.collection=t.collection AND s.token_id=${indexedTokenNumberSql} AND s.lifecycle=t.lifecycle`}
      ${traitJoins.join("\n")}
      ${
        available.length
          ? `LEFT JOIN books b ON b.chain_id=t.chain_id AND b.contract_address=t.contract_address
        AND b.token_id=${indexedTokenNumberSql} AND b.maker=lower(t.owner) AND b.lifecycle=t.lifecycle`
          : ""
      }
      WHERE ${conditions.join(" AND ")})`;
  const counted = traitJoins.length
    ? "DISTINCT collection||':'||token_id"
    : "*";
  const countRows = `SELECT count(${counted})::text AS total,${available.length ? `count(${counted}) FILTER(WHERE listings IS NOT NULL)::text` : "'0'::text"} AS listed FROM candidates`;
  const count = {
    text: `${base} ${countRows}`,
    values: [...params]
  };
  const tokenSort = query.filters.sort.startsWith("token-id");
  const desc = query.filters.sort.endsWith("desc");
  const direction = desc ? "DESC" : "ASC";
  const orderBy = tokenSort
    ? `id_number ${direction},chain_id ASC`
    : phase.startsWith("null-")
      ? "id_number ASC,chain_id ASC"
      : `${score} ${direction}${phase === "nonnull" ? "" : " NULLS LAST"},id_number ASC,chain_id ASC`;
  let after = "";
  if (position) {
    const token = bind(position.tokenId),
      chain = bind(position.chainId);
    const tie = `(id_number>${token}::numeric OR (id_number=${token}::numeric AND chain_id>${chain}::integer))`;
    if (tokenSort)
      after = `WHERE (id_number${desc ? "<" : ">"}${token}::numeric OR (id_number=${token}::numeric AND chain_id>${chain}::integer))`;
    else if (position.value === null)
      after = `WHERE ${score} IS NULL AND ${tie}`;
    else {
      const value = bind(position.value);
      after = `WHERE (${score}${desc ? "<" : ">"}${value}::numeric OR ${score} IS NULL OR (${score}=${value}::numeric AND ${tie}))`;
    }
  }
  // A complete held count <= one page proves that no early limit is useful.
  // Removing it avoids plans that scan a large ordered index searching for
  // more sparse matches than actually exist. The caller bounds this by count.
  const limit = readAll ? "" : `LIMIT ${bind(query.page.limit + 1)}`;
  const group = traitJoins.length
    ? "GROUP BY collection,chain_id,contract_address,token_id,id_number,owner,lifecycle,mint_block,last_transfer_block,metadata_available,rarity_points,rarity_points_capped,price,listings"
    : "";
  const pageCte = `page AS MATERIALIZED (SELECT * FROM candidates ${after} ${group} ${readAll ? "" : `ORDER BY ${orderBy}`} ${limit})`;
  const pageRows = `SELECT jsonb_build_object('chain',p.collection,'chainId',p.chain_id,'contractAddress',p.contract_address,'tokenId',p.token_id,
      'owner',p.owner,'lifecycle',p.lifecycle,'burned',false,'hidden',false,'mintBlock',p.mint_block::text,
      'lastTransferBlock',p.last_transfer_block::text,'metadataAvailable',coalesce(p.metadata_available,false),'rarityPoints',p.rarity_points::text,
      'rarityPointsCapped',p.rarity_points_capped::text,'name',m.name,'image',m.image,'tokenUri',m.token_uri,'attributes',m.attributes) AS token,
      coalesce(p.listings,'[]'::jsonb) AS listings,${tokenSort ? "NULL::text" : `p.${score}::text`} AS position_value
    FROM page p LEFT JOIN LATERAL (SELECT current.* FROM metadata.token_metadata current
      WHERE current.collection=p.collection AND current.token_id=p.id_number AND current.lifecycle=p.lifecycle LIMIT 1) m ON true
    ORDER BY ${orderBy
      .split(",")
      .map((part) => "p." + part.trim())
      .join(",")}`;
  const page = {
    text: `${base}, ${pageCte} ${pageRows}`,
    values: params
  };
  const firstPage = {
    text: `${base}, totals AS MATERIALIZED (${countRows}), ${pageCte}
      SELECT totals.total,totals.listed,result.* FROM totals
      LEFT JOIN LATERAL (${pageRows}) result ON true ORDER BY ${catalogRowOrder(query)}`,
    values: params
  };
  return { count, page, firstPage };
}

type RawRow = {
  token: unknown;
  listings: unknown[];
  position_value: string | null;
};

function catalogRowOrder(query: CatalogQuery) {
  const direction = query.filters.sort.endsWith("desc") ? "DESC" : "ASC";
  return `${query.filters.sort.startsWith("token-id") ? `(token->>'tokenId')::numeric ${direction}` : `position_value::numeric ${direction} NULLS LAST,(token->>'tokenId')::numeric ASC`},(token->>'chainId')::integer ASC`;
}

/** One source scan supplies exact totals and a bounded first page per family. */
export async function fetchCatalogFirstPage(
  db: PoolClient | PoolClient[],
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources,
  books: string
) {
  let total = 0n,
    listed = 0n;
  const candidates: RawRow[] = [];
  const parts = tokenSourceQueries(query);
  const clients = catalogClients(db);
  const results = await Promise.all(
    parts.map((part, index) =>
      clients[index % clients.length]!.query<
        RawRow & { total: string; listed: string }
      >(
        catalogSql(
          part,
          observedAt,
          sources,
          undefined,
          "all",
          false,
          books,
          true
        ).firstPage
      )
    )
  );
  for (const result of results) {
    total += BigInt(result.rows[0]!.total);
    listed += BigInt(result.rows[0]!.listed);
    // The aggregate/left join also returns totals for an empty family.
    candidates.push(...result.rows.filter((row) => row.token !== null));
  }
  return {
    total,
    listed,
    page: await mergeCatalogPage(
      clients[0]!,
      query,
      sources,
      candidates,
      parts.length
    )
  };
}

async function fetchCatalogRows(
  db: PoolClient,
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources,
  position?: CatalogPosition,
  state = { missingSearchEmpty: false },
  completeCount?: number,
  books?: string
) {
  // Sparse listed/trait populations should drive their own joins. A score-index
  // scan is useful for general rarity browsing, not for hunting a few listings
  // through an otherwise million-token collection.
  const rarity =
    query.filters.sort.startsWith("rarity") &&
    query.filters.sale !== "listed" &&
    Object.keys(query.filters.traits).length === 0;
  const readAll =
    completeCount !== undefined && completeCount <= query.page.limit;
  const nullRows = async (after?: CatalogPosition) => {
    const known = await db.query<RawRow>(
      catalogSql(
        query,
        observedAt,
        sources,
        after,
        "null-known",
        readAll,
        books
      ).page
    );
    const missing = state.missingSearchEmpty
      ? { rows: [] }
      : await db.query<RawRow>(
          catalogSql(
            query,
            observedAt,
            sources,
            after,
            "null-missing",
            readAll,
            books
          ).page
        );
    // Only an unpositioned query proves the entire filtered population has no
    // search gaps. A tail page alone cannot establish that fact.
    if (after === undefined && missing.rows.length === 0)
      state.missingSearchEmpty = true;
    return [...known.rows, ...missing.rows]
      .map((row) => ({ ...row, token: parseCatalogToken(row.token) }))
      .sort((a, b) =>
        BigInt(a.token.tokenId) < BigInt(b.token.tokenId)
          ? -1
          : BigInt(a.token.tokenId) > BigInt(b.token.tokenId)
            ? 1
            : a.token.chainId - b.token.chainId
      )
      .slice(0, query.page.limit + 1);
  };
  const phase = rarity
    ? position?.value === null
      ? "null"
      : "nonnull"
    : "all";
  const result = {
    rows:
      phase === "null"
        ? await nullRows(position)
        : (
            await db.query<RawRow>(
              catalogSql(
                query,
                observedAt,
                sources,
                position,
                phase,
                readAll,
                books
              ).page
            )
          ).rows
  };
  if (phase === "nonnull" && result.rows.length <= query.page.limit) {
    // Known null scores can use the score index; absent search rows need a
    // separate anti-join. Merge both by numeric NFT ID before pagination.
    result.rows.push(
      ...(await nullRows()).slice(0, query.page.limit + 1 - result.rows.length)
    );
  }
  return result.rows;
}

export async function fetchCatalogPage(
  db: PoolClient | PoolClient[],
  query: CatalogQuery,
  observedAt: Date,
  sources: CatalogSources,
  position?: CatalogPosition,
  state = { missingSearchEmpty: false },
  completeCount?: number,
  books?: string
) {
  const parts = tokenSourceQueries(query);
  const clients = catalogClients(db);
  const candidates: RawRow[] = [];
  const results = await Promise.all(
    parts.map(async (part, index) => {
      const partState = { missingSearchEmpty: state.missingSearchEmpty };
      const rows = await fetchCatalogRows(
        clients[index % clients.length]!,
        part,
        observedAt,
        sources,
        position,
        partState,
        completeCount,
        books
      );
      return { rows, state: partState };
    })
  );
  for (const result of results) candidates.push(...result.rows);
  state.missingSearchEmpty = results.every(
    (result) => result.state.missingSearchEmpty
  );
  return mergeCatalogPage(
    clients[0]!,
    query,
    sources,
    candidates,
    parts.length
  );
}

async function mergeCatalogPage(
  db: PoolClient,
  query: CatalogQuery,
  sources: CatalogSources,
  candidates: RawRow[],
  partCount: number
) {
  // Merge at most two (limit + 1) candidate pages. PostgreSQL numeric ordering
  // retains exact decimal scores and uint256 IDs, including ties across chains.
  const result =
    partCount === 1
      ? { rows: candidates }
      : await db.query<RawRow>(
          `SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS p(token jsonb,listings jsonb,position_value text)
        ORDER BY ${catalogRowOrder(query)} LIMIT $2`,
          [JSON.stringify(candidates), query.page.limit + 1]
        );
  const rows = result.rows.slice(0, query.page.limit);
  const items: CatalogRow[] = rows.map((row) => {
    const token = parseCatalogToken(row.token);
    const listings = row.listings.map(parseMarketOrder);
    const source = sources.statuses[token.chain];
    for (const order of listings)
      if (
        order.asset.chainId !== token.chainId ||
        order.asset.tokenId !== token.tokenId ||
        order.asset.contractAddress !== token.contractAddress ||
        order.lifecycle !== token.lifecycle ||
        order.maker !== token.owner ||
        order.side !== "listing" ||
        order.status !== "active" ||
        !catalogCurrencies(token.chain).some(
          (currency) =>
            currency.address.toLowerCase() ===
              order.currency.address.toLowerCase() &&
            currency.symbol === order.currency.symbol &&
            currency.decimals === order.currency.decimals
        )
      )
        throw new BnbOrderError("stored_order_mismatch", 503);
    return {
      token,
      market: {
        status: sources.readVersion
          ? listings.length
            ? "listed"
            : sources.availability?.[token.chain]?.evidence !== "current"
              ? "unavailable"
              : sources.availability[token.chain].listings.status === "complete"
                ? "unlisted"
                : sources.availability[token.chain].listings.status ===
                    "partial"
                  ? "updating"
                  : "unavailable"
          : source !== "available"
            ? "unknown"
            : listings.length
              ? "listed"
              : "unlisted",
        listings
      }
    };
  });
  const last = items.at(-1)?.token;
  return {
    items,
    next:
      result.rows.length > query.page.limit && last
        ? {
            chainId: last.chainId,
            tokenId: last.tokenId,
            value: rows.at(-1)!.position_value
          }
        : null
  };
}

export async function visibilityFingerprint(db: Pick<PoolClient, "query">) {
  return (
    await db.query<{
      fingerprint: string;
    }>(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(collection,token_id::text,owner,lifecycle,
    anchor_event_id,anchor_block::text,anchor_transaction_index,anchor_log_index) ORDER BY collection,token_id)::text,'[]')) AS fingerprint
    FROM metadata.token_visibility`)
  ).rows[0]!.fingerprint;
}

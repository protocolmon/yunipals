import { pool, closePool } from "../lib/offchain/db.js";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { collectionSlugs, collections, type CollectionSlug } from "../lib/constants.js";
import { bnbSchema, physicalPonderSchema, ponderSchema } from "../lib/offchain/sql.js";
import { bnbRpcUrlOf } from "../lib/rpc.js";
import { metadataReadRelation, leaderboardReadRelation } from "../lib/metadata/read-source.js";

const apiRoot = process.env.VERIFY_API_ROOT ?? "http://127.0.0.1:9011";
const requireReady = process.env.REQUIRE_PONDER_READY === "true";
const snapshotMaxAgeMinutes = Math.max(15, Number(process.env.VERIFY_SNAPSHOT_MAX_AGE_MINUTES ?? 120));
const bnbClient = createPublicClient({ chain: bsc, transport: http(bnbRpcUrlOf()) });
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function api(path: string, expectedStatus = 200) {
  const response = await fetch(`${apiRoot}${path}`);
  const body = await response.json();
  invariant(response.status === expectedStatus,
    `${path}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`);
  return body as any;
}

async function allOwnerTokens(owner: string, chain?: CollectionSlug) {
  const items: any[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (chain) query.set("chain", chain);
    if (cursor) query.set("cursor", cursor);
    const page = await api(`/v1/owners/${owner}/tokens?${query}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

try {
  const ready = await api("/ready");
  invariant(ready.status === "ready", "API is not ready");

  const collectionList = await api("/v1/collections");
  for (const slug of collectionSlugs) {
    const item = collectionList.items.find((candidate: any) => candidate.slug === slug);
    invariant(item?.chainId === collections[slug].chainId && item.knownTokens > 0, `${slug} collection is missing`);
  }

  const combinedTotals = await api("/v1/collection");
  const totals = Object.fromEntries(await Promise.all(collectionSlugs.map(async (slug) =>
    [slug, await api(`/v1/collection?chain=${slug}`)] as const))) as Record<CollectionSlug, any>;
  invariant(combinedTotals.knownTokens === collectionSlugs.reduce((sum, slug) => sum + totals[slug].knownTokens, 0),
    "Combined token totals do not equal their chain partitions");
  const bnbCursor = await pool.query<{ blockNumber: string }>(`SELECT last_scanned_block::text AS "blockNumber"
    FROM ${bnbSchema}.sync_state WHERE singleton`);
  invariant(bnbCursor.rows[0]?.blockNumber, "BNB finalized cursor is missing");
  const bnbSupply = await bnbClient.readContract({
    address: collections.bnb.address,
    abi: supplyAbi,
    functionName: "totalSupply",
    blockNumber: BigInt(bnbCursor.rows[0].blockNumber)
  });
  invariant(totals.bnb.activeSupply === Number(bnbSupply),
    `BNB active supply ${totals.bnb.activeSupply} does not match on-chain ${bnbSupply}`);

  const firstPage = await api("/v1/tokens?limit=25");
  const secondPage = await api(`/v1/tokens?limit=25&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
  const firstKeys = new Set(firstPage.items.map((item: any) => `${item.chain}:${item.tokenId}`));
  invariant(!secondPage.items.some((item: any) => firstKeys.has(`${item.chain}:${item.tokenId}`)),
    "Mixed-chain token cursor produced overlapping pages");
  await api(`/v1/tokens?chain=base&limit=25&cursor=${encodeURIComponent(firstPage.nextCursor)}`, 400);

  const ownerResult = await pool.query(`SELECT eth.owner, eth.token_id AS "collisionTokenId"
    FROM ${ponderSchema}.token eth JOIN ${ponderSchema}.token base
      ON base.collection='base' AND eth.collection='ethereum'
      AND base.owner=eth.owner AND base.token_id=eth.token_id
    WHERE NOT eth.burned AND NOT base.burned LIMIT 1`);
  const owner = ownerResult.rows[0]?.owner;
  invariant(owner, "No cross-chain owner is available for verification");
  const allHoldings = await allOwnerTokens(owner);
  const holdings = Object.fromEntries(await Promise.all(collectionSlugs.map(async (slug) =>
    [slug, await allOwnerTokens(owner, slug)] as const))) as Record<CollectionSlug, any[]>;
  const ethereumHoldings = holdings.ethereum;
  const baseHoldings = holdings.base;
  invariant(allHoldings.length === collectionSlugs.reduce((sum, slug) => sum + holdings[slug].length, 0),
    "Unified owner holdings do not equal their chain partitions");
  invariant(allHoldings.some((item) => item.chain === "ethereum") && allHoldings.some((item) => item.chain === "base"),
    "Unified owner response does not include both chains");
  const collisionTokenId = ownerResult.rows[0]?.collisionTokenId;
  invariant(collisionTokenId && ethereumHoldings.some((item) => item.tokenId === collisionTokenId)
    && baseHoldings.some((item) => item.tokenId === collisionTokenId),
  "Verification owner does not demonstrate a cross-chain token-ID collision");

  const [ethereumDetail, baseDetail] = await Promise.all([
    api(`/v1/tokens/${collisionTokenId}`),
    api(`/v1/tokens/base/${collisionTokenId}`)
  ]);
  invariant(ethereumDetail.token.chain === "ethereum", "Legacy token detail route no longer resolves Ethereum");
  invariant(baseDetail.token.chain === "base", "Chain-qualified Base detail route resolved incorrectly");

  const [baseTraits, polygonTraits, bnbTraits, combinedLeaderboard, baseLeaderboard, polygonLeaderboard, bnbLeaderboard] = await Promise.all([
    api("/v1/traits?chain=base"), api("/v1/traits?chain=polygon"),
    api("/v1/traits?chain=bnb"),
    api("/v1/leaderboards/monster-count?limit=3"), api("/v1/leaderboards/monster-count?chain=base&limit=3"),
    api("/v1/leaderboards/monster-count?chain=polygon&limit=3"),
    api("/v1/leaderboards/monster-count?chain=bnb&limit=3")
  ]);
  invariant(baseTraits.items.length > 0 && baseTraits.metadata.available > 0, "Base trait search is not populated");
  invariant(polygonTraits.items.length > 0 && polygonTraits.metadata.available > 0, "Polygon trait search is not populated");
  invariant(bnbTraits.items.length > 0 && bnbTraits.metadata.available > 0, "BNB trait search is not populated");
  invariant(combinedLeaderboard.items.length > 0 && baseLeaderboard.items.length > 0
    && polygonLeaderboard.items.length > 0 && bnbLeaderboard.items.length > 0,
    "Combined or per-chain leaderboard is not populated");

  const databaseState = await pool.query(`SELECT
      (SELECT value->>'is_ready' FROM ${physicalPonderSchema}._ponder_meta WHERE key='app') AS "ponderReady",
      (SELECT count(*)::int FROM ${metadataReadRelation} m WHERE collection='base') AS "baseMetadata",
      (SELECT count(*)::int FROM ${metadataReadRelation} m WHERE collection='polygon') AS "polygonMetadata",
      (SELECT count(*)::int FROM ${metadataReadRelation} m WHERE collection='bnb') AS "bnbMetadata",
      (SELECT caught_up_at IS NOT NULL AND last_error IS NULL FROM ${bnbSchema}.sync_state WHERE singleton) AS "bnbReady",
      (SELECT count(*)::int FROM ${leaderboardReadRelation} stats WHERE scope='all') AS "combinedWallets",
      (SELECT bool_and(updated_at > now() - ($1 * interval '1 minute')) FROM
        (SELECT scope,max(updated_at) AS updated_at FROM leaderboard.wallet_stats GROUP BY scope) snapshots) AS "leaderboardsFresh",
      (SELECT bool_and(updated_at > now() - ($1 * interval '1 minute')) FROM metadata.trait_facet_status) AS "traitsFresh",
      EXISTS (SELECT 1 FROM metadata.chain_event_cursor WHERE name='base_metadata_update') AS "updateCursorReady"`, [snapshotMaxAgeMinutes]);
  const state = databaseState.rows[0];
  invariant(state.baseMetadata > 0, "No Base metadata has been fetched");
  invariant(state.polygonMetadata > 0, "No Polygon metadata has been fetched");
  invariant(state.bnbMetadata > 0, "No BNB metadata has been fetched");
  invariant(state.combinedWallets > 0, "Combined leaderboard snapshot is empty");
  if (requireReady) {
    invariant(state.ponderReady === "1", "Ponder historical backfill is not complete");
    invariant(state.bnbReady, "BNB filtered-log indexer is not caught up");
    invariant(state.leaderboardsFresh, "Combined and per-chain leaderboard snapshots are not fresh");
    invariant(state.traitsFresh, "Combined and per-chain trait snapshots are not fresh");
    invariant(state.updateCursorReady, "Base metadata Update event cursor is not initialized");
  }

  console.log(JSON.stringify({
    ponderReady: state.ponderReady === "1", bnbReady: state.bnbReady,
    ethereumTokens: totals.ethereum.knownTokens, baseTokens: totals.base.knownTokens,
    polygonTokens: totals.polygon.knownTokens, bnbTokens: totals.bnb.knownTokens, combinedTokens: combinedTotals.knownTokens,
    crossChainOwner: owner, combinedHoldings: allHoldings.length,
    collisionSafeTokenId: collisionTokenId, baseMetadata: state.baseMetadata,
    polygonMetadata: state.polygonMetadata, bnbMetadata: state.bnbMetadata,
    combinedWallets: state.combinedWallets, leaderboardsFresh: state.leaderboardsFresh,
    traitsFresh: state.traitsFresh, updateCursorReady: state.updateCursorReady
  }, null, 2));
} finally {
  await closePool();
}

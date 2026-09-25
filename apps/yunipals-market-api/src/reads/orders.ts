import type { Pool, PoolClient } from "pg";
import { getAddress, zeroAddress } from "viem";
import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import type { MarketChainAvailability } from "@protopals/yunipals-market-core/marketAvailability";
import {
  parseMarketAssetId,
  parseMarketOrder,
  type MarketAssetId
} from "@protopals/yunipals-market-core/marketOrder";
import { address } from "@protopals/yunipals-market-core/validation";

import { BnbOrderError } from "@/bnb/orders";
import { isOpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { summarizeDiscoveredOpenSeaOrder } from "@/opensea/discoveryOrder";
import { readOpenSeaSources } from "@/reads/openseaSources";
import { marketOrderRowsSql } from "@/reads/orderRows";
import { transaction } from "@/db/pool";
import { indexedTokenHiddenSql } from "@/reads/visibility";
import {
  parsePageRequest,
  readSnapshotPage,
  snapshotLimits
} from "@/reads/snapshots";

export type SourceStatus = "available" | "unavailable" | "syncing";
export type OrderSources = {
  statuses: Record<MarketplaceChain, SourceStatus>;
  availability?: Record<MarketplaceChain, MarketChainAvailability>;
  readVersion?: 2;
  provenance: Record<string, unknown>;
};
type Db = Pick<PoolClient, "query">;
const protocol = seaportDeployment.address.toLowerCase();

// Observation freshness, rather than the last stored label, controls membership.
// Terminal observations also expire because a reorg can revive an order.
export const orderObservationStaleSql = `(o.state_observed_at IS NULL
  OR o.state_observed_at>$1::timestamptz+interval '30 seconds'
  OR o.state_observed_at<$1::timestamptz-interval '7 hours')`;
export const observedOrderStateSql = `CASE WHEN o.origin='validated' THEN o.state
  WHEN ${orderObservationStaleSql} THEN 'unavailable' ELSE o.state END`;

export async function readOrderSources(
  db: Db,
  observedAt: Date
): Promise<OrderSources> {
  // The BNB indexer and order worker advance on independent schedules. Their
  // fresh checkpoints prove each source separately; comparing their block
  // numbers made every indexer refresh look incomplete until the next worker
  // heartbeat, even though no order evidence depended on that comparison.
  const result = await db.query<{
    status: SourceStatus;
    provenance: Record<string, unknown>;
  }>(
    `SELECT CASE
      WHEN v.mode='live' THEN CASE
        WHEN s.last_error IS NOT NULL OR s.last_scanned_block IS NULL OR s.last_scanned_hash IS NULL
          OR s.updated_at NOT BETWEEN $1::timestamptz-interval '720 seconds' AND $1::timestamptz+interval '30 seconds'
          OR v.last_error_code IS NOT NULL OR v.updated_at NOT BETWEEN
            $1::timestamptz-interval '720 seconds' AND $1::timestamptz+interval '30 seconds'
          THEN 'unavailable'
        WHEN s.caught_up_at IS NULL OR v.target_block IS NULL OR v.next_block<=v.target_block
          OR EXISTS (SELECT 1 FROM yunipals_market.bnb_discovered_order d
            WHERE d.bound_lifecycle IS NULL AND d.end_time>extract(epoch FROM $1::timestamptz))
          OR EXISTS (SELECT 1 FROM yunipals_market.bnb_discovered_order d
            WHERE d.state IN ('active','unavailable','inconsistent')
              AND d.end_time>extract(epoch FROM $1::timestamptz)
              AND (d.state_observed_at IS NULL OR d.state_observed_at<
                $1::timestamptz-interval '720 seconds'))
          THEN 'syncing' ELSE 'available' END
      WHEN h.state IS DISTINCT FROM 'available' OR h.checked_at IS NULL
        OR h.checked_at NOT BETWEEN $1::timestamptz-interval '120 seconds' AND $1::timestamptz+interval '30 seconds'
        OR s.last_error IS NOT NULL OR s.last_scanned_block IS NULL OR s.last_scanned_hash IS NULL OR s.updated_at IS NULL
        OR s.updated_at NOT BETWEEN $1::timestamptz-interval '720 seconds' AND $1::timestamptz+interval '30 seconds'
        THEN 'unavailable'
      WHEN s.caught_up_at IS NULL OR h.block_number IS NULL
        OR EXISTS(SELECT 1 FROM yunipals_market.orders o WHERE o.chain_id=56 AND o.publication_state='accepted'
          AND (${orderObservationStaleSql} OR o.state_block_number IS NULL OR o.state_block_hash IS NULL
            OR (o.state='unavailable' AND (o.state_reason IS NULL OR o.state_reason NOT IN (
              'asset_changed','maker_ownership_mismatch','order_invalidated','nft_approval_required',
              'offer_funding_required','invalid_maker_signature','order_policy_rejected','order_not_active')))))
        THEN 'syncing' ELSE 'available' END AS status,
      jsonb_build_object('workerBlock',h.block_number::text,'workerHash',h.block_hash,'workerCheckedAt',h.checked_at,
        'indexerBlock',s.last_scanned_block::text,'indexerHash',s.last_scanned_hash,'indexerUpdatedAt',s.updated_at,
        'discoveryMode',v.mode,'discoveryNext',v.next_block::text,
        'discoveryTarget',v.target_block::text,'discoveryUpdatedAt',v.updated_at) AS provenance
    FROM bnb_indexer.sync_state s LEFT JOIN yunipals_market.checkpoint h
      ON h.source='chain' AND h.chain_id=56 AND h.name='bnb-order-worker'
    LEFT JOIN yunipals_market.bnb_discovery_cursor v ON v.singleton
    WHERE s.singleton`,
    [observedAt]
  );
  const row = result.rows.length === 1 ? result.rows[0] : undefined;
  const opensea = await readOpenSeaSources(
    db,
    observedAt,
    orderObservationStaleSql
  );
  const bnbStatus = row?.status ?? "unavailable";
  const bnbCoverage =
    bnbStatus === "available"
      ? "complete"
      : bnbStatus === "syncing"
        ? "partial"
        : "unavailable";
  const availability = Object.fromEntries([
    ...opensea.map((item) => [
      item.chain,
      {
        chain: item.chain,
        evidence: item.evidence,
        listings: {
          status: item.listing_coverage,
          completedAt: item.listing_completed_at?.toISOString() ?? null,
          revision: item.listing_revision
        },
        offers: {
          status: item.offer_coverage,
          completedAt: item.offer_completed_at?.toISOString() ?? null,
          revision: item.offer_revision
        }
      }
    ]),
    [
      "bnb",
      {
        chain: "bnb",
        evidence:
          bnbStatus === "available"
            ? "current"
            : bnbStatus === "syncing"
              ? "recovering"
              : "unavailable",
        listings: { status: bnbCoverage, completedAt: null, revision: null },
        offers: { status: bnbCoverage, completedAt: null, revision: null }
      }
    ]
  ]) as Record<MarketplaceChain, MarketChainAvailability>;
  return {
    statuses: {
      ethereum: "unavailable",
      base: "unavailable",
      polygon: "unavailable",
      ...Object.fromEntries(opensea.map((item) => [item.chain, item.status])),
      bnb: bnbStatus
    } satisfies Record<MarketplaceChain, SourceStatus>,
    availability,
    provenance: {
      ...(row?.provenance ?? {}),
      opensea: Object.fromEntries(
        opensea.map((item) => [item.chain, item.provenance])
      )
    }
  };
}

const currentAssetSql = `jsonb_build_object('owner',t.owner,'lifecycle',t.lifecycle,
  'burned',t.burned,'hidden',${indexedTokenHiddenSql})`;
const orderSummarySql = `o.summary || jsonb_build_object('status',${observedOrderStateSql})`;
type OrderRow = {
  summary: unknown;
  recovery_components: unknown;
  side: "listing" | "offer";
  state: string;
  chain_id: number;
  contract_address: string;
  token_id: string;
  order_hash: string;
  protocol_address: string;
  maker: string;
  lifecycle: number;
  current_asset: {
    owner: string | null;
    lifecycle: number | null;
    hidden: boolean;
    burned: boolean | null;
  };
};

function readItem(row: OrderRow) {
  let summary = row.summary;
  if (summary === null && row.recovery_components) {
    const chain = Object.entries(marketplaceChains).find(
      ([, config]) => config.chainId === row.chain_id
    )?.[0] as MarketplaceChain | undefined;
    if (!chain || !isOpenSeaChain(chain))
      throw new BnbOrderError("stored_order_mismatch", 503);
    summary = {
      ...summarizeDiscoveredOpenSeaOrder(
        decodeSeaportOrder(row.recovery_components),
        chain,
        row.side,
        getAddress(row.protocol_address),
        row.lifecycle
      ),
      status: row.state
    };
  }
  const order = parseMarketOrder(summary);
  if (
    order.asset.chainId !== row.chain_id ||
    order.asset.contractAddress.toLowerCase() !== row.contract_address ||
    order.asset.tokenId !== row.token_id ||
    order.orderHash.toLowerCase() !== row.order_hash ||
    order.maker.toLowerCase() !== row.maker ||
    order.lifecycle !== row.lifecycle
  )
    throw new BnbOrderError("stored_order_mismatch", 503);
  const current = row.current_asset;
  if (
    !current.owner ||
    !Number.isSafeInteger(current.lifecycle) ||
    current.lifecycle === null ||
    current.lifecycle < 0 ||
    typeof current.burned !== "boolean" ||
    typeof current.hidden !== "boolean"
  )
    throw new BnbOrderError("asset_observation_unavailable", 503);
  return {
    order,
    currentAsset: {
      ...current,
      owner: getAddress(current.owner),
      lifecycle: current.lifecycle,
      burned: current.burned
    }
  };
}

export function readAssetIdentity(
  chain: string,
  contract: string,
  tokenId: string
): MarketAssetId {
  try {
    if (!Object.hasOwn(marketplaceChains, chain)) throw new Error();
    return parseMarketAssetId({
      chain,
      chainId: marketplaceChains[chain as MarketplaceChain].chainId,
      contractAddress: contract,
      tokenId
    });
  } catch {
    throw new BnbOrderError("invalid_asset", 400);
  }
}

export class OrderReadService {
  constructor(private readonly pool: Pool) {}

  async wallet(walletValue: string, params: URLSearchParams) {
    let wallet;
    try {
      wallet = address(walletValue);
    } catch {
      throw new BnbOrderError("invalid_wallet", 400);
    }
    if (wallet === zeroAddress) throw new BnbOrderError("invalid_wallet", 400);
    const allowed = ["view", "chain", "limit", "cursor", "snapshot"];
    for (const key of params.keys())
      if (!allowed.includes(key) || params.getAll(key).length !== 1)
        throw new BnbOrderError("invalid_wallet_query", 400);
    const view = params.get("view") ?? "listings";
    const chain = params.get("chain") ?? "all";
    if (
      !["listings", "offers-made", "offers-received", "history"].includes(
        view
      ) ||
      (chain !== "all" && !Object.hasOwn(marketplaceChains, chain))
    )
      throw new BnbOrderError("invalid_wallet_query", 400);
    const page = parsePageRequest(params);
    const query = `wallet:${wallet}:${chain}:${view}`;
    const selected = (
      Object.keys(marketplaceChains) as MarketplaceChain[]
    ).filter((name) => chain === "all" || name === chain);
    return readSnapshotPage(
      this.pool,
      "orders",
      query,
      page,
      async (db, observedAt) => {
        const sources = await readOrderSources(db, observedAt);
        // Own-maker queries deliberately LEFT JOIN current inventory. Missing
        // observations fail explicitly; they must not erase cancellation history.
        const rows = await db.query<OrderRow>(
          `SELECT ${orderSummarySql} AS summary,o.recovery_components,o.side,${observedOrderStateSql} AS state,o.chain_id,o.protocol_address,o.contract_address,o.token_id::text,o.order_hash,o.maker,o.lifecycle,
          ${currentAssetSql} AS current_asset
        FROM ${marketOrderRowsSql} o JOIN yunipals_market.collection c ON c.chain_id=o.chain_id AND c.contract_address=o.contract_address
        -- Preserve the per-order token lookup across the foreign-table boundary.
        CROSS JOIN LATERAL (
          SELECT o.contract_address::text AS contract_key,o.token_id::text AS token_key OFFSET 0
        ) wallet_key
        LEFT JOIN LATERAL (
          SELECT t.collection,t.token_id,t.owner,t.lifecycle,t.burned
          FROM yunipals_read_v4.token t
          WHERE t.collection=c.slug AND t.chain_id=o.chain_id
            AND lower(t.contract_address)=wallet_key.contract_key AND t.token_id=wallet_key.token_key
          LIMIT 1
        ) t ON true
        WHERE o.protocol_address=$2 AND o.chain_id=ANY($3::integer[])
          AND CASE WHEN $4='offers-received' THEN o.side='offer' AND o.maker<>$5 AND lower(t.owner)=$5 AND NOT t.burned
            ELSE o.maker=$5 AND ($4='history' OR o.side=CASE WHEN $4='listings' THEN 'listing' ELSE 'offer' END) END
          AND CASE WHEN $4='history' THEN (${observedOrderStateSql}) NOT IN ('active','unavailable')
            ELSE (${observedOrderStateSql}) IN ('active','unavailable') END
        ORDER BY o.created_at DESC,o.chain_id,o.protocol_address,o.order_hash LIMIT $6`,
          [
            observedAt,
            protocol,
            selected.map((name) => marketplaceChains[name].chainId),
            view,
            wallet.toLowerCase(),
            snapshotLimits.perQueryRows + 1
          ]
        );
        if (rows.rows.length > snapshotLimits.perQueryRows)
          throw new BnbOrderError("snapshot_capacity", 503);
        return {
          header: {
            wallet,
            view,
            chain,
            sources: Object.fromEntries(
              selected.map((name) => [name, sources.statuses[name]])
            ),
            provenance: sources.provenance
          },
          items: rows.rows.map(readItem)
        };
      }
    );
  }

  async asset(asset: MarketAssetId) {
    return this.assetByVersion(asset, 1);
  }

  async assetV2(asset: MarketAssetId) {
    return this.assetByVersion(asset, 2);
  }

  private async assetByVersion(asset: MarketAssetId, readVersion: 1 | 2) {
    return transaction(this.pool, async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      const clock = await db.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now"
      );
      const observedAt = clock.rows[0]!.now;
      const token = await db.query<{
        current_asset: OrderRow["current_asset"];
      }>(
        `SELECT ${currentAssetSql} AS current_asset FROM yunipals_read_v4.token t
        WHERE t.collection=$1 AND t.chain_id=$2 AND lower(t.contract_address)=$3 AND t.token_id=$4`,
        [
          asset.chain,
          asset.chainId,
          asset.contractAddress.toLowerCase(),
          asset.tokenId
        ]
      );
      const current = token.rows[0]?.current_asset;
      if (token.rows.length !== 1 || !current)
        throw new BnbOrderError("asset_not_found", 404);
      if (current.hidden) throw new BnbOrderError("asset_not_found", 404);
      if (
        !current.owner ||
        current.lifecycle === null ||
        !Number.isSafeInteger(current.lifecycle) ||
        current.lifecycle < 0 ||
        typeof current.burned !== "boolean"
      )
        throw new BnbOrderError("asset_observation_unavailable", 503);
      const owner = getAddress(current.owner);
      const sources = await readOrderSources(db, observedAt);
      const sourceStatus = sources.statuses[asset.chain];
      const availability = sources.availability?.[asset.chain] ?? {
        chain: asset.chain,
        evidence:
          sourceStatus === "available"
            ? ("current" as const)
            : sourceStatus === "syncing"
              ? ("recovering" as const)
              : ("unavailable" as const),
        listings: {
          status:
            sourceStatus === "available"
              ? ("complete" as const)
              : sourceStatus === "syncing"
                ? ("partial" as const)
                : ("unavailable" as const),
          completedAt: null,
          revision: null
        },
        offers: {
          status:
            sourceStatus === "available"
              ? ("complete" as const)
              : sourceStatus === "syncing"
                ? ("partial" as const)
                : ("unavailable" as const),
          completedAt: null,
          revision: null
        }
      };
      const result = {
        schemaVersion: readVersion,
        asset,
        ...current,
        owner,
        sourceStatus,
        updatedAt: observedAt.toISOString()
      };
      if (
        (readVersion === 1
          ? sourceStatus !== "available"
          : availability.evidence !== "current") ||
        current.burned ||
        owner === zeroAddress
      )
        return {
          ...result,
          ...(readVersion === 2
            ? {
                availability,
                listingState: "unavailable" as const,
                offerAvailability: "unavailable" as const
              }
            : {}),
          listings: [],
          offers: []
        };
      const orders = await db.query<OrderRow>(
        `WITH eligible AS (SELECT ${orderSummarySql} AS summary,o.recovery_components,o.side,${observedOrderStateSql} AS state,o.chain_id,o.protocol_address,o.contract_address,o.token_id::text,o.order_hash,o.maker,o.lifecycle,
          $8::jsonb AS current_asset,row_number() OVER (PARTITION BY o.side
            ORDER BY CASE WHEN o.side='listing' THEN o.gross_amount ELSE -o.gross_amount END,o.order_hash) AS rank
          FROM ${marketOrderRowsSql} o
        WHERE o.chain_id=$2 AND o.contract_address=$3 AND o.token_id=$4 AND o.protocol_address=$5
          AND o.browse_candidate AND o.lifecycle=$6
          AND (${observedOrderStateSql})='active' AND o.start_time<=extract(epoch FROM $1::timestamptz)
          AND o.end_time>extract(epoch FROM $1::timestamptz) AND (o.side='offer' OR o.maker=$7)
        ) SELECT * FROM eligible WHERE rank<=100 ORDER BY side,rank`,
        [
          observedAt,
          asset.chainId,
          asset.contractAddress.toLowerCase(),
          asset.tokenId,
          protocol,
          current.lifecycle,
          owner.toLowerCase(),
          current
        ]
      );
      // Bound each side independently: popular offers cannot crowd out listings.
      const items = orders.rows.map(readItem).map((item) => item.order);
      const listings = items
        .filter((order) => order.side === "listing")
        .slice(0, 100);
      const offers = items
        .filter((order) => order.side === "offer")
        .slice(0, 100);
      const response = {
        ...result,
        ...(readVersion === 2
          ? {
              availability,
              listingState: listings.length
                ? ("listed" as const)
                : availability.listings.status === "complete"
                  ? ("unlisted" as const)
                  : availability.listings.status === "partial"
                    ? ("updating" as const)
                    : ("unavailable" as const),
              offerAvailability: availability.offers.status
            }
          : {}),
        listings,
        offers
      };
      if (
        Buffer.byteLength(JSON.stringify(response)) >
        snapshotLimits.responseBytes
      )
        throw new BnbOrderError("response_capacity", 503);
      return response;
    });
  }
}

import type { Pool, PoolClient } from "pg";
import {
  activityScopeKey,
  activityViews,
  parseSale,
  type ActivityScope,
  type ActivityPage
} from "@protopals/yunipals-market-core/activity";
import {
  marketplaceAssetKey,
  marketplaceChains,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import {
  parseMarketAssetId,
  type MarketAssetId
} from "@protopals/yunipals-market-core/marketOrder";
import {
  address,
  enumeration
} from "@protopals/yunipals-market-core/validation";

import { BnbOrderError } from "@/bnb/orders";
import { indexedTokenHiddenSql } from "@/reads/visibility";
import {
  parsePageRequest,
  readSnapshotPage,
  snapshotLimits,
  type SnapshotPageRequest,
  type SnapshotRow
} from "@/reads/snapshots";

type Db = Pick<PoolClient, "query">;
type Visibility = "public" | "hidden" | "burned" | "unknown";
type ActivitySources = {
  chains: ActivityPage["chains"];
  epochs: Partial<Record<MarketplaceChain, string>>;
  checkpoints: Partial<Record<MarketplaceChain, Record<string, unknown>>>;
};
const visibilitySql = `CASE WHEN t.collection IS NULL OR t.owner IS NULL OR t.owner!~'^0x[0-9a-fA-F]{40}$'
  OR t.lifecycle IS NULL OR t.lifecycle<0 OR t.burned IS NULL THEN 'unknown'
  WHEN ${indexedTokenHiddenSql} THEN 'hidden'
  WHEN t.burned OR lower(t.owner)='0x0000000000000000000000000000000000000000' THEN 'burned'
  ELSE 'public' END`;
export async function readActivitySources(
  db: Db,
  selected: MarketplaceChain[],
  observedAt: Date
): Promise<ActivitySources> {
  const chains: ActivityPage["chains"] = {};
  const epochs: ActivitySources["epochs"] = {};
  const checkpoints: ActivitySources["checkpoints"] = {};
  for (const chain of selected)
    chains[chain] = { status: "unavailable", confirmedThrough: null };
  const result = await db.query<{
    chain_id: number;
    canonical_generation: string;
    block_number: string | null;
    block_hash: `0x${string}` | null;
    state: "available" | "syncing" | "unavailable";
    established: boolean;
    coverage_start: string | null;
    coverage_start_time: string | null;
    checked_at: Date | null;
    policy: string | null;
    excluded_events: number;
  }>(
    `SELECT c.chain_id,c.canonical_generation::text,c.block_number::text,c.block_hash,c.state,
    c.coverage_start::text,c.coverage_start_time::text,c.checked_at,
    CASE WHEN c.chain_id=56 THEN CASE WHEN d.environment='production'
      THEN 'bnb-finalized-tag-v1' ELSE 'bnb-local-validation-depth-20-v1' END ELSE p.policy END AS policy,
    (SELECT count(*)::integer FROM yunipals_market.sale_exclusion e WHERE e.chain_id=c.chain_id AND e.canonical
      AND e.block_number BETWEEN c.coverage_start AND c.block_number) AS excluded_events,
    (c.block_number IS NOT NULL AND c.block_hash<>'0x'||repeat('0',64)
      AND c.coverage_start IS NOT NULL AND c.coverage_start_time IS NOT NULL
      AND (c.chain_id=56 OR (p.chain_id IS NOT NULL AND c.coverage_start=p.start_block))
      AND c.checked_at BETWEEN $1::timestamptz-interval '360 seconds' AND $1::timestamptz+interval '30 seconds'
      AND ((c.state IN ('available','syncing') AND (c.last_error_code IS NULL OR c.last_error_code='canonical_replay_required'))
        OR (c.state='unavailable' AND c.last_error_code IN ('admission_coverage_missing','unsupported_sale_events')))) AS established
    FROM yunipals_market.checkpoint c CROSS JOIN yunipals_market.deployment d
    LEFT JOIN yunipals_market.sale_replay_config p USING(chain_id)
    WHERE c.source='chain' AND c.chain_id=ANY($2::integer[])
      AND c.name=CASE WHEN c.chain_id=56 THEN 'bnb-sales' ELSE 'seaport-sales' END`,
    [observedAt, selected.map((chain) => marketplaceChains[chain].chainId)]
  );
  for (const row of result.rows) {
    const chain = selected.find(
      (chain) => marketplaceChains[chain].chainId === row.chain_id
    )!;
    epochs[chain] = row.canonical_generation;
    checkpoints[chain] = {
      source: chain === "bnb" ? "yunipals" : "seaport",
      coverageStartBlock: row.coverage_start,
      coverageStartTime: row.coverage_start_time,
      checkedAt: row.checked_at?.toISOString() ?? null,
      confirmationPolicy: row.policy
    };
    if (
      row.established &&
      row.block_number !== null &&
      row.block_hash !== null
    ) {
      chains[chain] = {
        status: row.excluded_events > 0 ? "unavailable" : row.state,
        confirmedThrough: {
          blockNumber: row.block_number,
          blockHash: row.block_hash
        },
        coverage: {
          source: chain === "bnb" ? "yunipals" : "seaport",
          fromBlock: row.coverage_start!,
          fromTimestamp: row.coverage_start_time!,
          excludedEvents: row.excluded_events
        }
      };
    }
  }
  return { chains, epochs, checkpoints };
}

function queryParameters(params: URLSearchParams, wallet: boolean) {
  const allowed = wallet
    ? ["chain", "view", "limit", "snapshot", "cursor"]
    : ["limit", "snapshot", "cursor"];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new BnbOrderError("invalid_activity_query", 400);
  return parsePageRequest(params);
}
function selectedChains(scope: ActivityScope): MarketplaceChain[] {
  return scope.kind === "asset"
    ? [scope.asset.chain]
    : scope.chain === "all"
      ? (Object.keys(marketplaceChains) as MarketplaceChain[])
      : [scope.chain];
}

export class ActivityReadService {
  constructor(private readonly pool: Pool) {}

  async wallet(value: string, params: URLSearchParams) {
    const page = queryParameters(params, true);
    let scope: ActivityScope;
    try {
      scope = {
        kind: "wallet",
        wallet: address(value),
        chain: enumeration(params.get("chain") ?? "all", [
          "all",
          ...Object.keys(marketplaceChains)
        ]) as MarketplaceChain | "all",
        view: enumeration(params.get("view") ?? "all", activityViews)
      };
      activityScopeKey(scope);
    } catch {
      throw new BnbOrderError("invalid_activity_query", 400);
    }
    return this.page(scope, page);
  }

  async asset(value: MarketAssetId, params: URLSearchParams) {
    const page = queryParameters(params, false);
    let asset;
    try {
      asset = parseMarketAssetId(value);
    } catch {
      throw new BnbOrderError("invalid_asset", 400);
    }
    return this.page({ kind: "asset", asset }, page);
  }

  private async assetVisibility(db: Db, asset: MarketAssetId) {
    const rows = await db.query<{ visibility: Visibility }>(
      `SELECT ${visibilitySql} AS visibility FROM yunipals_read_v4.token t WHERE t.collection=$1
        AND t.chain_id=$2 AND t.contract_address=$3 AND t.token_id=$4`,
      [
        asset.chain,
        asset.chainId,
        asset.contractAddress.toLowerCase(),
        asset.tokenId
      ]
    );
    if (rows.rows.length !== 1 || rows.rows[0]?.visibility === "hidden")
      throw new BnbOrderError("asset_not_found", 404);
    if (rows.rows[0]!.visibility === "unknown")
      throw new BnbOrderError("asset_observation_unavailable", 503);
  }

  // Query the remote indexer with scalar/array parameters, separately from local
  // sales and snapshots. Joining those local rows to foreign tokens prevents
  // token-ID pushdown and can scan whole collections during each validation.
  private async visibilities(db: Db, assets: MarketAssetId[]) {
    const groups = new Map<MarketplaceChain, Set<string>>();
    for (const asset of assets) {
      const ids = groups.get(asset.chain) ?? new Set<string>();
      ids.add(asset.tokenId);
      groups.set(asset.chain, ids);
    }
    const result = new Map<string, Visibility>();
    for (const [chain, ids] of groups) {
      const config = marketplaceChains[chain];
      const rows = await db.query<{ token_id: string; visibility: Visibility }>(
        `SELECT t.token_id,${visibilitySql} AS visibility
          FROM yunipals_read_v4.token t WHERE t.collection=$1 AND t.chain_id=$2
            AND t.contract_address=$3 AND t.token_id=ANY($4::text[])`,
        [chain, config.chainId, config.contractAddress.toLowerCase(), [...ids]]
      );
      for (const row of rows.rows)
        result.set(
          marketplaceAssetKey({ ...config, tokenId: row.token_id }),
          row.visibility
        );
    }
    return result;
  }

  private async page(scope: ActivityScope, page: SnapshotPageRequest) {
    const query = activityScopeKey(scope);
    const selected = selectedChains(scope);
    let readingId: string | undefined;
    try {
      return await readSnapshotPage(
        this.pool,
        "activity",
        query,
        page,
        async (db, observedAt) => {
          if (scope.kind === "asset")
            await this.assetVisibility(db, scope.asset);
          const sources = await readActivitySources(db, selected, observedAt);
          const bounds = selected.flatMap((chain) => {
            const through = sources.chains[chain]?.confirmedThrough;
            return through
              ? [
                  {
                    chainId: marketplaceChains[chain].chainId,
                    number: through.blockNumber,
                    hash: through.blockHash,
                    from: sources.chains[chain]?.coverage?.fromBlock ?? "0"
                  }
                ]
              : [];
          });
          const rows = await db.query<{
            observation: unknown;
            chain_id: number;
            contract_address: string;
            token_id: string;
            order_hash: string;
            seller: string;
            nft_recipient: string;
            block_number: string;
            block_hash: string;
            protocol_address: string;
            log_index: number;
            transaction_hash: string;
            block_timestamp: Date;
            proof_valid: boolean;
          }>(
            `SELECT s.observation,s.chain_id,s.contract_address,s.token_id::text,s.order_hash,s.seller,s.nft_recipient,
            s.block_number::text,s.block_hash,s.log_index,s.transaction_hash,s.block_timestamp,s.protocol_address,
            (r.transaction_hash IS NOT NULL AND r.confirmation_policy=CASE WHEN s.chain_id=56
              THEN CASE WHEN d.environment='production' THEN 'bnb-finalized-tag-v1'
                ELSE 'bnb-local-validation-depth-20-v1' END ELSE p.policy END
              AND r.receipt->>'status'='success' AND lower(r.receipt->>'transactionHash')=s.transaction_hash
              AND lower(r.receipt->>'blockHash')=s.block_hash AND r.receipt->>'blockNumber'=s.block_number::text
              AND lower(r.block->>'hash')=s.block_hash AND r.block->>'number'=s.block_number::text
              AND r.block->>'timestamp'=s.observation->>'blockTimestamp'
              AND (s.chain_id<>56 OR (o.publication_state='accepted' AND o.source='yunipals'))) AS proof_valid
          FROM yunipals_market.sale s CROSS JOIN yunipals_market.deployment d
          JOIN jsonb_to_recordset($1::jsonb) AS bound("chainId" integer,number numeric,hash text,"from" numeric)
            ON bound."chainId"=s.chain_id AND s.block_number BETWEEN bound."from" AND bound.number
          JOIN yunipals_market.collection c ON c.chain_id=s.chain_id AND c.contract_address=s.contract_address
          LEFT JOIN yunipals_market.sale_replay_config p ON p.chain_id=s.chain_id
          LEFT JOIN yunipals_market.sale_receipt r ON r.chain_id=s.chain_id AND r.block_hash=s.block_hash AND r.transaction_hash=s.transaction_hash
          LEFT JOIN yunipals_market.orders o ON o.chain_id=s.chain_id AND o.protocol_address=s.protocol_address AND o.order_hash=s.order_hash
          WHERE s.canonical AND CASE WHEN $2='asset' THEN s.chain_id=$3 AND s.contract_address=$4 AND s.token_id=$5::numeric
            ELSE CASE WHEN $6='sales' THEN s.seller=$7 WHEN $6='received' THEN s.nft_recipient=$7
              ELSE s.seller=$7 OR s.nft_recipient=$7 END END
          ORDER BY s.block_timestamp DESC,s.chain_id,s.block_number DESC,s.log_index DESC LIMIT $8`,
            [
              JSON.stringify(bounds),
              scope.kind,
              scope.kind === "asset" ? scope.asset.chainId : null,
              scope.kind === "asset"
                ? scope.asset.contractAddress.toLowerCase()
                : null,
              scope.kind === "asset" ? scope.asset.tokenId : null,
              scope.kind === "wallet" ? scope.view : null,
              scope.kind === "wallet" ? scope.wallet.toLowerCase() : null,
              snapshotLimits.perQueryRows + 1
            ]
          );
          const verified = rows.rows.map((row) => {
            const sale = parseSale(row.observation);
            const through = sources.chains[sale.asset.chain]?.confirmedThrough;
            if (
              !row.proof_valid ||
              sale.protocolAddress.toLowerCase() !== row.protocol_address ||
              sale.asset.chainId !== row.chain_id ||
              sale.asset.contractAddress.toLowerCase() !==
                row.contract_address ||
              sale.asset.tokenId !== row.token_id ||
              sale.orderHash.toLowerCase() !== row.order_hash ||
              sale.seller.toLowerCase() !== row.seller ||
              sale.nftRecipient.toLowerCase() !== row.nft_recipient ||
              sale.blockNumber !== row.block_number ||
              sale.blockHash.toLowerCase() !== row.block_hash ||
              sale.fulfillmentLogIndex !== row.log_index ||
              sale.transactionHash.toLowerCase() !== row.transaction_hash ||
              BigInt(sale.blockTimestamp) * 1000n !==
                BigInt(row.block_timestamp.getTime()) ||
              BigInt(sale.blockTimestamp) >
                BigInt(Math.floor(observedAt.getTime() / 1000)) ||
              !through ||
              (sale.blockNumber === through.blockNumber &&
                sale.blockHash !== through.blockHash)
            )
              throw new BnbOrderError("sale_proof_unavailable", 503);
            return {
              sale,
              status: "confirmed" as const
            };
          });
          const visibility = await this.visibilities(
            db,
            verified.map(({ sale }) => sale.asset)
          );
          const items = verified.map((item) => ({
            ...item,
            currentVisibility:
              visibility.get(marketplaceAssetKey(item.sale.asset)) ?? "unknown"
          }));
          const complete = selected.every(
            (chain) => sources.chains[chain]?.status === "available"
          );
          return {
            header: {
              query,
              chains: sources.chains,
              total: complete ? items.length : null,
              provenance: {
                epochs: sources.epochs,
                checkpoints: sources.checkpoints
              }
            },
            items
          };
        },
        async (db, row) => {
          readingId = row.id;
          await this.validate(db, row, selected);
          if (scope.kind === "asset")
            await this.assetVisibility(db, scope.asset);
        }
      );
    } catch (error) {
      if (readingId && error instanceof BnbOrderError && error.status === 409)
        await this.pool.query(
          "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE id=$1 AND kind='activity' AND query_key=$2",
          [readingId, query]
        );
      throw error;
    }
  }

  private async validate(
    db: Db,
    row: SnapshotRow,
    selected: MarketplaceChain[]
  ) {
    const now = (
      await db.query<{ now: Date }>("SELECT clock_timestamp() AS now")
    ).rows[0]!.now;
    const current = await readActivitySources(db, selected, now);
    const prior = row.header.chains as ActivityPage["chains"];
    const provenance = row.header.provenance as {
      epochs: ActivitySources["epochs"];
    };
    for (const chain of selected) {
      if (current.epochs[chain] !== provenance.epochs[chain])
        throw new BnbOrderError("snapshot_refresh_required", 409);
      const captured = prior[chain]?.confirmedThrough;
      if (!captured) continue;
      const latest = current.chains[chain]?.confirmedThrough;
      if (!latest)
        throw new BnbOrderError("activity_observation_unavailable", 503);
      if (
        BigInt(latest.blockNumber) < BigInt(captured.blockNumber) ||
        (latest.blockNumber === captured.blockNumber &&
          latest.blockHash !== captured.blockHash)
      )
        throw new BnbOrderError("snapshot_refresh_required", 409);
    }
    const retained = await db.query<{ asset: unknown; visibility: Visibility }>(
      `SELECT payload->'sale'->'asset' AS asset,payload->>'currentVisibility' AS visibility
        FROM yunipals_market.snapshot_item WHERE snapshot_id=$1`,
      [row.id]
    );
    const assets = retained.rows.map((item) => parseMarketAssetId(item.asset));
    const currentVisibility = await this.visibilities(db, assets);
    if (
      retained.rows.some(
        (item, index) =>
          item.visibility !==
          (currentVisibility.get(marketplaceAssetKey(assets[index]!)) ??
            "unknown")
      )
    )
      throw new BnbOrderError("snapshot_refresh_required", 409);
  }
}

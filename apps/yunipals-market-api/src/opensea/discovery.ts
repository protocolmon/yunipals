import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { transaction } from "@/db/pool";
import { OpenSeaError, type OpenSeaClient } from "@/opensea/client";
import { parseOpenSeaDiscoveredOrder } from "@/opensea/discoveryOrder";

type Side = "listing" | "offer";
type Scan = {
  chain_id: number;
  side: Side;
  collection_slug: string;
  run_id: string;
  generation: string;
  page_count: number;
  provider_cursor: string | null;
  state: "available" | "syncing" | "unavailable";
  lease_token: string;
  failures: number;
  stream_scan_seq: string;
};
const digest = (value: string) =>
  `0x${createHash("sha256").update(value).digest("hex")}`;
const cursorHash = (cursor: string | null) => digest(JSON.stringify(cursor));
export class OpenSeaDiscoveryError extends Error {
  constructor(
    readonly code: string,
    readonly restart = false
  ) {
    super(code);
  }
}
export class DiscoveryLeaseLostError extends Error {}

// Timer wakeups do not spend provider quota when both sides are waiting for
// their next scan/backoff or another process holds the lease.
export async function isOpenSeaDiscoveryDue(pool: Pool, chain: OpenSeaChain) {
  if (!isOpenSeaChain(chain)) throw new Error("Invalid discovery chain.");
  const result = await pool.query<{ due: boolean }>(
    `SELECT count(*)<>2 OR coalesce(bool_or(
    (s.next_scan_at<=clock_timestamp() OR (
      coalesce(w.version,0)>s.stream_ack_seq AND
      (s.completed_at IS NULL OR s.completed_at<=clock_timestamp()-interval '15 seconds')
    )) AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp())),false) AS due
    FROM yunipals_market.opensea_discovery_scan s
    LEFT JOIN yunipals_market.opensea_stream_wakeup w ON w.chain_id=s.chain_id AND w.target='scan'
    WHERE s.chain_id=$1`,
    [marketplaceChains[chain].chainId]
  );
  return result.rows[0]!.due;
}

/** A dedicated scan lease fences the page, its orders, and the next cursor together. */
export async function claimOpenSeaDiscovery(
  pool: Pool,
  chain: OpenSeaChain,
  side: Side,
  slug: string,
  leaseMs = 30000
): Promise<Scan | null> {
  if (
    !isOpenSeaChain(chain) ||
    !["listing", "offer"].includes(side) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug) ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1000 ||
    leaseMs > 90000
  )
    throw new Error("Invalid discovery scope.");
  const chainId = marketplaceChains[chain].chainId;
  return transaction(pool, async (db) => {
    await db.query(
      `INSERT INTO yunipals_market.opensea_discovery_scan(chain_id,side,collection_slug,run_id)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [chainId, side, slug, randomUUID()]
    );
    const found = await db.query<Scan>(
      `SELECT s.*,s.generation::text,coalesce(w.version,0)::text AS wake_sequence
      FROM yunipals_market.opensea_discovery_scan s
      LEFT JOIN yunipals_market.opensea_stream_wakeup w ON w.chain_id=s.chain_id AND w.target='scan'
      WHERE s.chain_id=$1 AND s.side=$2 AND (
        s.next_scan_at<=clock_timestamp() OR (
          coalesce(w.version,0)>s.stream_ack_seq AND
          (s.completed_at IS NULL OR s.completed_at<=clock_timestamp()-interval '15 seconds')
        )) AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp())
      FOR UPDATE OF s SKIP LOCKED`,
      [chainId, side]
    );
    const row = found.rows[0];
    if (!row) return null;
    const restart = row.state === "available" || row.collection_slug !== slug;
    const captureWake =
      restart || (row.page_count === 0 && row.provider_cursor === null);
    const result = await db.query<Scan>(
      `UPDATE yunipals_market.opensea_discovery_scan SET
      generation=generation+1,lease_token=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond',
      collection_slug=$5,run_id=CASE WHEN $6 THEN $7::uuid ELSE run_id END,
      provider_cursor=CASE WHEN $6 THEN NULL ELSE provider_cursor END,page_count=CASE WHEN $6 THEN 0 ELSE page_count END,
      run_started_at=CASE WHEN $6 THEN clock_timestamp() ELSE run_started_at END,
      completed_at=CASE WHEN collection_slug<>$5 THEN NULL ELSE completed_at END,state='syncing',
      stream_scan_seq=CASE WHEN $8 THEN $9::bigint ELSE stream_scan_seq END
      WHERE chain_id=$1 AND side=$2 RETURNING *,generation::text,stream_scan_seq::text`,
      [
        chainId,
        side,
        randomUUID(),
        leaseMs,
        slug,
        restart,
        randomUUID(),
        captureWake,
        (row as Scan & { wake_sequence: string }).wake_sequence
      ]
    );
    return result.rows[0]!;
  });
}

export async function processOpenSeaDiscoveryPage(
  pool: Pool,
  provider: Pick<OpenSeaClient, "listCollectionOrders">,
  chain: OpenSeaChain,
  scan: Scan,
  options: { pageDelayMs?: number; scanIntervalMs?: number } = {}
) {
  const pageDelayMs = options.pageDelayMs ?? 5000;
  const scanIntervalMs = options.scanIntervalMs ?? 300000;
  if (
    !isOpenSeaChain(chain) ||
    marketplaceChains[chain].chainId !== scan.chain_id ||
    !Number.isSafeInteger(pageDelayMs) ||
    pageDelayMs < 1000 ||
    pageDelayMs > 3600000 ||
    !Number.isSafeInteger(scanIntervalMs) ||
    scanIntervalMs < 10000 ||
    scanIntervalMs > 86400000
  )
    throw new Error("Invalid discovery processing settings.");
  try {
    if (scan.page_count >= 10000)
      throw new OpenSeaDiscoveryError("discovery_page_limit", true);
    const page = await provider.listCollectionOrders({
      slug: scan.collection_slug,
      side: scan.side,
      cursor: scan.provider_cursor,
      limit: 50
    });
    let orders;
    try {
      orders = page.orders.map((value) =>
        parseOpenSeaDiscoveredOrder(value, chain, scan.side)
      );
    } catch {
      throw new OpenSeaDiscoveryError("discovery_invalid_page");
    }
    const cursor = cursorHash(scan.provider_cursor);
    const nextCursor = page.next === null ? null : cursorHash(page.next);
    if (nextCursor === cursor)
      throw new OpenSeaDiscoveryError("discovery_cursor_cycle", true);
    return await transaction(pool, async (db) => {
      const locked = await db.query(
        `SELECT chain_id FROM yunipals_market.opensea_discovery_scan
        WHERE chain_id=$1 AND side=$2 AND generation=$3 AND lease_token=$4 AND lease_until>clock_timestamp() FOR UPDATE`,
        [scan.chain_id, scan.side, scan.generation, scan.lease_token]
      );
      if (locked.rowCount !== 1) throw new DiscoveryLeaseLostError();
      if (
        nextCursor &&
        (
          await db.query(
            `SELECT 1 FROM yunipals_market.opensea_discovery_page
        WHERE chain_id=$1 AND side=$2 AND run_id=$3 AND cursor_hash=$4`,
            [scan.chain_id, scan.side, scan.run_id, nextCursor]
          )
        ).rowCount
      )
        throw new OpenSeaDiscoveryError("discovery_cursor_cycle", true);
      for (const item of orders) {
        const result = await db.query(
          `INSERT INTO yunipals_market.opensea_discovered_order
          (chain_id,protocol_address,order_hash,contract_address,side,token_id,maker,classification,provider_status,
          components,signature,provider_observation,last_seen_run_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT(chain_id,protocol_address,order_hash) DO UPDATE SET
            classification=EXCLUDED.classification,provider_status=EXCLUDED.provider_status,
            signature=coalesce(yunipals_market.opensea_discovered_order.signature,EXCLUDED.signature),
            provider_observation=EXCLUDED.provider_observation,last_seen_at=clock_timestamp(),
            last_seen_run_id=EXCLUDED.last_seen_run_id,present=true,missing_since=NULL
          WHERE yunipals_market.opensea_discovered_order.components=EXCLUDED.components
            AND yunipals_market.opensea_discovered_order.side=EXCLUDED.side`,
          [
            item.chainId,
            item.protocolAddress,
            item.orderHash,
            item.contractAddress,
            item.side,
            item.tokenId,
            item.maker,
            item.classification,
            item.providerStatus,
            JSON.stringify(item.components),
            item.signature,
            JSON.stringify(item.observation),
            scan.run_id
          ]
        );
        if (result.rowCount !== 1)
          throw new OpenSeaDiscoveryError("discovery_identity_conflict");
      }
      const count = (
        await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM yunipals_market.opensea_discovered_order
        WHERE chain_id=$1 AND side=$2`,
          [scan.chain_id, scan.side]
        )
      ).rows[0]!.count;
      if (count > 100000) throw new OpenSeaDiscoveryError("discovery_capacity");
      await db.query(
        `INSERT INTO yunipals_market.opensea_discovery_page
        (chain_id,side,run_id,cursor_hash,page_number,next_cursor_hash,order_count,response_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          scan.chain_id,
          scan.side,
          scan.run_id,
          cursor,
          scan.page_count + 1,
          nextCursor,
          orders.length,
          digest(JSON.stringify(page))
        ]
      );
      if (page.next === null)
        await db.query(
          `UPDATE yunipals_market.opensea_discovered_order SET present=false,missing_since=coalesce(missing_since,clock_timestamp())
          WHERE chain_id=$1 AND side=$2 AND last_seen_run_id<>$3`,
          [scan.chain_id, scan.side, scan.run_id]
        );
      const finished = await db.query(
        `UPDATE yunipals_market.opensea_discovery_scan SET
        provider_cursor=$5,page_count=page_count+1,state=$6,checked_at=clock_timestamp(),
        completed_at=CASE WHEN $6='available' THEN clock_timestamp() ELSE completed_at END,
        stream_ack_seq=CASE WHEN $6='available' THEN greatest(stream_ack_seq,stream_scan_seq) ELSE stream_ack_seq END,
        failures=0,last_error_code=NULL,next_scan_at=clock_timestamp()+$7*interval '1 millisecond',lease_token=NULL,lease_until=NULL
        WHERE chain_id=$1 AND side=$2 AND generation=$3 AND lease_token=$4 AND lease_until>clock_timestamp()`,
        [
          scan.chain_id,
          scan.side,
          scan.generation,
          scan.lease_token,
          page.next,
          page.next === null ? "available" : "syncing",
          page.next === null ? scanIntervalMs : pageDelayMs
        ]
      );
      if (finished.rowCount !== 1) throw new DiscoveryLeaseLostError();
      return {
        completed: page.next === null,
        orders: orders.length,
        page: scan.page_count + 1
      };
    });
  } catch (error) {
    if (error instanceof DiscoveryLeaseLostError) throw error;
    const code =
      error instanceof OpenSeaError || error instanceof OpenSeaDiscoveryError
        ? error.code
        : "discovery_processing_failed";
    const reset = error instanceof OpenSeaDiscoveryError && error.restart;
    const failures = Math.min(scan.failures + 1, 16);
    const retryMs = Math.max(
      Math.min(300000, 10000 * 2 ** Math.min(failures, 5)),
      error instanceof OpenSeaError ? (error.retryAfterMs ?? 0) : 0
    );
    await pool.query(
      `UPDATE yunipals_market.opensea_discovery_scan SET state='unavailable',last_error_code=$5,
      checked_at=clock_timestamp(),failures=$6,next_scan_at=clock_timestamp()+$7*interval '1 millisecond',
      lease_token=NULL,lease_until=NULL,run_id=CASE WHEN $8 THEN $9::uuid ELSE run_id END,
      provider_cursor=CASE WHEN $8 THEN NULL ELSE provider_cursor END,page_count=CASE WHEN $8 THEN 0 ELSE page_count END,
      run_started_at=CASE WHEN $8 THEN clock_timestamp() ELSE run_started_at END
      WHERE chain_id=$1 AND side=$2 AND generation=$3 AND lease_token=$4 AND lease_until>clock_timestamp()`,
      [
        scan.chain_id,
        scan.side,
        scan.generation,
        scan.lease_token,
        code,
        failures,
        retryMs,
        reset,
        randomUUID()
      ]
    );
    throw new OpenSeaDiscoveryError(code);
  }
}

export type OpenSeaDiscoveryStatusRow = {
  side: Side;
  discovery_state: "available" | "syncing" | "unavailable";
  collection_slug: string;
  run_id: string;
  page_count: number;
  has_more: boolean;
  completed_at: Date | null;
  checked_at: Date | null;
  next_scan_at: Date;
  failures: number;
  last_error_code: string | null;
  present_orders: number;
  unsupported_orders: number;
  unsigned_observations: number;
};

export async function readOpenSeaDiscoveryStatus(
  pool: Pool,
  chain: OpenSeaChain
) {
  if (!isOpenSeaChain(chain)) throw new Error("Invalid discovery chain.");
  const result = await pool.query<OpenSeaDiscoveryStatusRow>(
    `SELECT s.side,s.state AS discovery_state,s.collection_slug,s.run_id,s.page_count,
    s.provider_cursor IS NOT NULL AS has_more,s.completed_at,s.checked_at,s.next_scan_at,s.failures,s.last_error_code,
    (SELECT count(*)::int FROM yunipals_market.opensea_discovered_order o WHERE o.chain_id=s.chain_id AND o.side=s.side AND o.present) AS present_orders,
    (SELECT count(*)::int FROM yunipals_market.opensea_discovered_order o WHERE o.chain_id=s.chain_id AND o.side=s.side AND o.present AND o.classification<>'item') AS unsupported_orders,
    (SELECT count(*)::int FROM yunipals_market.opensea_discovered_order o WHERE o.chain_id=s.chain_id AND o.side=s.side AND o.present AND o.signature IS NULL) AS unsigned_observations
    FROM yunipals_market.opensea_discovery_scan s WHERE s.chain_id=$1 ORDER BY s.side`,
    [marketplaceChains[chain].chainId]
  );
  return {
    chain,
    source: "opensea",
    scope:
      "Provider scan provenance only; chain reconciliation, maker authorization and fulfillment remain separate.",
    scans: result.rows
  };
}

export async function pruneOpenSeaDiscoveryPages(pool: Pool, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid cleanup limit.");
  const result =
    await pool.query(`DELETE FROM yunipals_market.opensea_discovery_page WHERE (chain_id,side,run_id,cursor_hash) IN (
    SELECT p.chain_id,p.side,p.run_id,p.cursor_hash FROM yunipals_market.opensea_discovery_page p
      JOIN yunipals_market.opensea_discovery_scan s USING(chain_id,side)
    WHERE p.run_id<>s.run_id AND p.observed_at<clock_timestamp()-interval '7 days'
    ORDER BY p.observed_at LIMIT ${limit} FOR UPDATE OF p SKIP LOCKED)`);
  return result.rowCount ?? 0;
}

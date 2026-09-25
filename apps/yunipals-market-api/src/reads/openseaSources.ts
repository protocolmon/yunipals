import type { PoolClient } from "pg";
import type {
  MarketChainEvidence,
  MarketDiscoveryCoverage
} from "@protopals/yunipals-market-core/marketAvailability";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { openSeaOrderRowsSql } from "@/reads/orderRows";

const registeredSources = Object.entries(marketplaceChains)
  .filter(([, config]) => config.source === "opensea")
  .map(([chain, config]) => ({
    chain,
    chain_id: config.chainId,
    collection_slug: config.collectionSlug
  }));

export type OpenSeaSourceAvailability = {
  chain: OpenSeaChain;
  status: "available" | "unavailable" | "syncing";
  evidence: MarketChainEvidence;
  listing_coverage: MarketDiscoveryCoverage;
  listing_completed_at: Date | null;
  listing_revision: string | null;
  offer_coverage: MarketDiscoveryCoverage;
  offer_completed_at: Date | null;
  offer_revision: string | null;
  provenance: Record<string, unknown>;
};

export async function readOpenSeaSources(
  db: Pick<PoolClient, "query">,
  observedAt: Date,
  staleOrderSql: string
) {
  return (
    await db.query<OpenSeaSourceAvailability>(
      `WITH chains AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb)
          AS c(chain text,chain_id integer,collection_slug text)
      ), health AS (
        SELECT c.*,h.state AS head_state,h.checked_at AS head_checked_at,
          h.block_number AS head_block,h.block_hash AS head_hash,
          i.state AS indexer_state,i.checked_at AS indexer_checked_at,
          i.progress_at AS indexer_progress_at,i.block_number AS indexer_block,
          i.block_hash AS indexer_hash,r.checked_at AS reorg_at,
          CASE
            WHEN h.checked_at IS NULL OR i.checked_at IS NULL OR h.block_number IS NULL
              OR i.block_number IS NULL OR h.block_hash IS NULL OR i.block_hash IS NULL
              THEN 'unavailable'
            WHEN h.state IS DISTINCT FROM 'available' OR i.state IS DISTINCT FROM 'available'
              OR h.block_number<i.block_number
              OR h.checked_at NOT BETWEEN $1::timestamptz-interval '180 seconds' AND $1::timestamptz+interval '30 seconds'
              OR i.checked_at NOT BETWEEN $1::timestamptz-interval '960 seconds' AND $1::timestamptz+interval '30 seconds'
              OR i.progress_at IS NULL
              OR i.progress_at NOT BETWEEN $1::timestamptz-interval '360 seconds' AND $1::timestamptz+interval '30 seconds'
              THEN 'recovering'
            ELSE 'current'
          END AS evidence
        FROM chains c
        LEFT JOIN yunipals_market.checkpoint h ON h.source='chain' AND h.chain_id=c.chain_id AND h.name='opensea-order-worker'
        LEFT JOIN yunipals_market.checkpoint i ON i.source='indexer' AND i.chain_id=c.chain_id AND i.name='opensea-order-worker'
        LEFT JOIN yunipals_market.checkpoint r ON r.source='chain' AND r.chain_id=c.chain_id AND r.name='opensea-read-reorg'
      ), scans AS (
        SELECT h.*,s.side,s.completed_at,s.generation::text AS revision,
          CASE
            WHEN s.chain_id IS NULL OR s.completed_at IS NULL THEN 'unavailable'
            WHEN (s.last_error_code IS NULL
                AND s.completed_at BETWEEN $1::timestamptz-interval '300 seconds' AND $1::timestamptz+interval '30 seconds'
                AND ((s.state='syncing' AND s.run_started_at>s.completed_at) OR
                  (s.state='available'
                    AND s.page_count=(SELECT count(*) FROM yunipals_market.opensea_discovery_page p
                      WHERE p.chain_id=s.chain_id AND p.side=s.side AND p.run_id=s.run_id)
                    AND EXISTS(SELECT 1 FROM yunipals_market.opensea_discovery_page p
                      WHERE p.chain_id=s.chain_id AND p.side=s.side AND p.run_id=s.run_id
                        AND p.page_number=s.page_count AND p.next_cursor_hash IS NULL)
                    AND NOT EXISTS(SELECT 1 FROM yunipals_market.opensea_discovered_order d
                      WHERE d.chain_id=s.chain_id AND d.side=s.side AND d.present
                        AND d.last_seen_run_id<>s.run_id)
                    AND s.page_count>0 AND s.provider_cursor IS NULL)))
              OR (s.state='unavailable' AND s.failures=1
                AND s.last_error_code IN ('provider_busy','provider_timeout','provider_network','provider_rate_limited')
                AND s.completed_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1::timestamptz+interval '30 seconds')
              THEN 'complete'
            WHEN s.completed_at BETWEEN $1::timestamptz-interval '15 minutes' AND $1::timestamptz+interval '30 seconds'
              THEN 'partial'
            ELSE 'unavailable'
          END AS coverage
        FROM health h LEFT JOIN yunipals_market.opensea_discovery_scan s
          ON s.chain_id=h.chain_id AND s.collection_slug=h.collection_slug
      ), rolled AS (
        SELECT h.chain,h.chain_id,h.collection_slug,h.evidence,
          h.head_block,h.head_hash,h.head_checked_at,h.indexer_block,h.indexer_hash,
          h.indexer_checked_at,h.indexer_progress_at,h.reorg_at,
          coalesce(max(coverage) FILTER(WHERE side='listing'),'unavailable') AS listing_coverage,
          max(completed_at) FILTER(WHERE side='listing') AS listing_completed_at,
          max(revision) FILTER(WHERE side='listing') AS listing_revision,
          coalesce(max(coverage) FILTER(WHERE side='offer'),'unavailable') AS offer_coverage,
          max(completed_at) FILTER(WHERE side='offer') AS offer_completed_at,
          max(revision) FILTER(WHERE side='offer') AS offer_revision
        FROM health h LEFT JOIN scans s ON s.chain=h.chain AND s.chain_id=h.chain_id
        GROUP BY h.chain,h.chain_id,h.collection_slug,h.evidence,h.head_block,h.head_hash,
          h.head_checked_at,h.indexer_block,h.indexer_hash,h.indexer_checked_at,h.indexer_progress_at,h.reorg_at
      )
      SELECT c.chain,
        CASE WHEN c.evidence<>'current' THEN 'unavailable'
          WHEN c.listing_coverage<>'complete' OR c.offer_coverage<>'complete'
            OR EXISTS(SELECT 1 FROM ${openSeaOrderRowsSql} o
              WHERE o.chain_id=c.chain_id AND o.browse_candidate
                AND o.end_time>extract(epoch FROM $1::timestamptz) AND (
                  (${staleOrderSql}) OR o.state_block_number IS NULL OR o.state_block_hash IS NULL
                  OR o.state_block_number>c.head_block
                  OR (c.reorg_at IS NOT NULL AND o.state_observed_at<=c.reorg_at)
                  OR (o.state='unavailable' AND (o.state_reason IS NULL OR o.state_reason NOT IN (
                    'asset_changed','maker_ownership_mismatch','order_invalidated','nft_approval_required',
                    'offer_funding_required','invalid_maker_signature','order_policy_rejected','order_not_active',
                    'provider_order_unavailable','order_predates_lifecycle')))))
            THEN 'syncing' ELSE 'available' END AS status,
        c.evidence,c.listing_coverage,c.listing_completed_at,c.listing_revision,
        c.offer_coverage,c.offer_completed_at,c.offer_revision,
        jsonb_build_object(
          'workerBlock',c.head_block::text,'workerHash',c.head_hash,'workerCheckedAt',c.head_checked_at,
          'indexerBlock',c.indexer_block::text,'indexerHash',c.indexer_hash,
          'indexerCheckedAt',c.indexer_checked_at,'indexerProgressAt',c.indexer_progress_at,
          'reorgAt',c.reorg_at) AS provenance
      FROM rolled c`,
      [observedAt, JSON.stringify(registeredSources)]
    )
  ).rows;
}

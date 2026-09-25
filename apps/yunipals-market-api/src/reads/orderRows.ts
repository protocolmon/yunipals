import { indexedTokenHiddenSql } from "@/reads/visibility";

const bnbTokenHiddenSql = indexedTokenHiddenSql.replaceAll("t.", "bt.");
const bnbAssetEligibleSql = `(bt.token_id IS NOT NULL AND bt.owner IS NOT NULL
  AND bt.lifecycle IS NOT NULL AND bt.lifecycle=d.bound_lifecycle
  AND bt.burned IS FALSE AND NOT (${bnbTokenHiddenSql}) AND
  (CASE WHEN d.side='listing' THEN lower(bt.owner)=d.maker ELSE lower(bt.owner)<>d.maker END))`;

// Both sources retain their original storage/provenance. A discovered order is
// never inserted into the admission table or described as locally accepted.
// $1 is the read snapshot's observation time throughout the enclosing query.
const providerObservationCurrent = `(d.last_seen_at BETWEEN $1::timestamptz-interval '300 seconds' AND $1::timestamptz+interval '30 seconds'
  OR (scan.state='unavailable' AND scan.failures=1
    AND scan.last_error_code IN ('provider_busy','provider_timeout','provider_network','provider_rate_limited')
    AND scan.completed_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1::timestamptz+interval '30 seconds'
    AND d.last_seen_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1::timestamptz+interval '30 seconds'))`;
const retainedProviderCurrent = `(o.source='yunipals' OR (
  d.present AND d.provider_status='ACTIVE' AND d.components=o.components
    AND ${providerObservationCurrent}
  OR d.order_hash IS NULL AND o.provider_ack->>'providerStatus'='ACTIVE'
    AND (o.provider_ack->>'remainingQuantity')::numeric=1
    AND (o.provider_ack->>'observedAt')::timestamptz BETWEEN $1::timestamptz-interval '300 seconds' AND $1::timestamptz+interval '30 seconds'
    AND (scan.completed_at IS NULL OR scan.completed_at<o.accepted_at)))`;

const openSeaRowsSql = `SELECT o.chain_id,o.protocol_address,o.order_hash,o.contract_address,o.token_id,o.maker,o.lifecycle,
    o.source,o.side,o.currency,o.gross_amount,o.start_time,o.end_time,o.summary,
    CASE WHEN o.signature IS NOT NULL AND o.publication_state='accepted' AND (o.source='yunipals' OR o.provider_ack IS NOT NULL)
      THEN CASE WHEN o.state<>'active' OR ${retainedProviderCurrent} THEN o.state ELSE 'unavailable' END
      ELSE 'unavailable' END AS state,
    CASE WHEN o.publication_state<>'accepted' THEN 'publication_unconfirmed'
      WHEN o.signature IS NULL THEN 'maker_signature_required'
      WHEN o.state='active' AND NOT coalesce(${retainedProviderCurrent},false) THEN
        CASE WHEN d.present=false OR d.provider_status<>'ACTIVE' OR
          (d.order_hash IS NULL AND scan.completed_at>=o.accepted_at) THEN 'provider_order_unavailable'
          ELSE 'provider_observation_stale' END ELSE o.state_reason END AS state_reason,
    o.state_observed_at,o.state_block_number,o.state_block_hash,o.created_at,
    (o.publication_state<>'rejected' OR d.present) AS browse_candidate,
    'retained'::text AS origin,NULL::jsonb AS recovery_components
  FROM yunipals_market.orders o
  LEFT JOIN yunipals_market.opensea_discovered_order d ON d.chain_id=o.chain_id AND d.protocol_address=o.protocol_address AND d.order_hash=o.order_hash
  LEFT JOIN yunipals_market.opensea_discovery_scan scan ON scan.chain_id=o.chain_id AND scan.side=o.side
  WHERE NOT (o.chain_id=56 AND EXISTS (
    SELECT 1 FROM yunipals_market.bnb_discovery_cursor mode
    WHERE mode.singleton AND mode.mode='live'))
  UNION ALL
  SELECT d.chain_id,d.protocol_address,d.order_hash,d.contract_address,d.token_id,d.maker,
    coalesce(s.bound_lifecycle,0) AS lifecycle,'opensea'::text AS source,d.side,
    lower(CASE WHEN d.side='listing' THEN d.components->'consideration'->0->>'token'
      ELSE d.components->'offer'->0->>'token' END) AS currency,
    CASE WHEN d.side='listing' THEN (SELECT sum((item->>'startAmount')::numeric)
      FROM jsonb_array_elements(d.components->'consideration') item)
      ELSE (d.components->'offer'->0->>'startAmount')::numeric END AS gross_amount,
    (d.components->>'startTime')::numeric AS start_time,(d.components->>'endTime')::numeric AS end_time,
    s.summary,
    CASE WHEN s.state IN ('filled','cancelled','counter-changed','expired') THEN s.state
      WHEN NOT d.present OR d.provider_status<>'ACTIVE'
        OR NOT ${providerObservationCurrent}
        OR s.provider_seen_at IS DISTINCT FROM d.last_changed_at THEN 'unavailable'
      WHEN s.state='eligible' OR (s.state='authorization-required' AND s.reason='provider_authorization_required')
        THEN 'active' ELSE 'unavailable' END AS state,
    CASE WHEN NOT d.present OR d.provider_status<>'ACTIVE' THEN 'provider_order_unavailable'
      WHEN NOT ${providerObservationCurrent}
        THEN 'provider_observation_stale'
      WHEN s.provider_seen_at IS DISTINCT FROM d.last_changed_at THEN 'discovery_projection_stale'
      ELSE s.reason END AS state_reason,
    s.observed_at AS state_observed_at,s.block_number AS state_block_number,s.block_hash AS state_block_hash,
    d.first_seen_at AS created_at,true AS browse_candidate,'discovered'::text AS origin,
    CASE WHEN s.summary IS NULL THEN d.components ELSE NULL END AS recovery_components
  FROM yunipals_market.opensea_discovered_order d
  LEFT JOIN yunipals_market.opensea_discovered_state s USING(chain_id,protocol_address,order_hash)
  LEFT JOIN yunipals_market.opensea_discovery_scan scan ON scan.chain_id=d.chain_id AND scan.side=d.side
  WHERE d.classification='item' AND NOT EXISTS(SELECT 1 FROM yunipals_market.orders retained
    WHERE retained.chain_id=d.chain_id AND retained.protocol_address=d.protocol_address AND retained.order_hash=d.order_hash)`;

// OpenSea availability checks must not plan the BNB token indexer's foreign
// table, which can make an otherwise tiny source-health query time out.
export const openSeaOrderRowsSql = `(${openSeaRowsSql})`;

export const marketOrderRowsSql = `(${openSeaRowsSql}
  UNION ALL
  SELECT 56 AS chain_id,d.protocol_address,d.order_hash,d.contract_address,d.token_id,d.maker,
    d.bound_lifecycle AS lifecycle,'yunipals'::text AS source,d.side,d.currency,
    d.gross_amount,d.start_time,d.end_time,d.summary,
    CASE WHEN d.state IN ('filled','cancelled','counter-changed') THEN d.state
      WHEN d.end_time<=extract(epoch FROM $1::timestamptz) THEN 'expired'
      WHEN NOT ${bnbAssetEligibleSql} THEN 'unavailable'
      WHEN d.state='active' AND d.state_observed_at BETWEEN
        $1::timestamptz-interval '720 seconds' AND $1::timestamptz+interval '30 seconds'
        THEN 'active' ELSE 'unavailable' END AS state,
    CASE WHEN NOT ${bnbAssetEligibleSql} THEN 'asset_changed'
      WHEN d.state_observed_at IS NULL OR d.state_observed_at<
      $1::timestamptz-interval '720 seconds' THEN 'discovery_observation_stale'
      ELSE d.state END AS state_reason,
    d.state_observed_at,d.state_block AS state_block_number,d.state_hash AS state_block_hash,
    d.bound_at AS created_at,true AS browse_candidate,'validated'::text AS origin,
    NULL::jsonb AS recovery_components
  FROM yunipals_market.bnb_discovered_order d
  -- Keep the casted key correlated so postgres_fdw pushes the token filter remotely.
  CROSS JOIN LATERAL (
    SELECT d.contract_address::text AS contract_key,d.token_id::text AS token_key OFFSET 0
  ) bnb_key
  LEFT JOIN LATERAL (
    SELECT bt.collection,bt.token_id,bt.owner,bt.lifecycle,bt.burned
    FROM yunipals_read_v4.token bt
    WHERE bt.collection='bnb' AND bt.chain_id=56
      AND lower(bt.contract_address)=bnb_key.contract_key AND bt.token_id=bnb_key.token_key
    LIMIT 1
  ) bt ON true
  WHERE d.bound_lifecycle IS NOT NULL AND d.summary IS NOT NULL
    AND EXISTS (SELECT 1 FROM yunipals_market.bnb_discovery_cursor mode
      WHERE mode.singleton AND mode.mode='live')
)`;

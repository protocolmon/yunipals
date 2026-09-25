// Fixed SQL fragments only. Keeping the aliases internal avoids interpolating
// caller-provided identifiers into reconciliation queries.
export const retainedStreamWakeSql = {
  joins: `LEFT JOIN yunipals_market.opensea_stream_wakeup stream_all
    ON stream_all.chain_id=o.chain_id AND stream_all.target='all'
  LEFT JOIN yunipals_market.opensea_stream_wakeup stream_order
    ON stream_order.chain_id=o.chain_id AND stream_order.target='order:'||o.order_hash
  LEFT JOIN yunipals_market.opensea_stream_wakeup stream_token
    ON stream_token.chain_id=o.chain_id AND stream_token.target='token:'||o.token_id::text`,
  version:
    "greatest(coalesce(stream_all.version,0),coalesce(stream_order.version,0),coalesce(stream_token.version,0))",
  requestedAt: `least(
    CASE WHEN coalesce(stream_all.version,0)>o.stream_ack_seq THEN stream_all.requested_at END,
    CASE WHEN coalesce(stream_order.version,0)>o.stream_ack_seq THEN stream_order.requested_at END,
    CASE WHEN coalesce(stream_token.version,0)>o.stream_ack_seq THEN stream_token.requested_at END
  )`
} as const;

export const discoveredStreamWakeSql = {
  joins: `LEFT JOIN yunipals_market.opensea_stream_wakeup stream_all
    ON stream_all.chain_id=s.chain_id AND stream_all.target='all'
  LEFT JOIN yunipals_market.opensea_stream_wakeup stream_order
    ON stream_order.chain_id=s.chain_id AND stream_order.target='order:'||s.order_hash
  LEFT JOIN yunipals_market.opensea_stream_wakeup stream_token
    ON stream_token.chain_id=s.chain_id AND stream_token.target=CASE
      WHEN d.token_id IS NULL THEN NULL ELSE 'token:'||d.token_id::text END`,
  version:
    "greatest(coalesce(stream_all.version,0),coalesce(stream_order.version,0),coalesce(stream_token.version,0))",
  requestedAt: `least(
    CASE WHEN coalesce(stream_all.version,0)>s.stream_ack_seq THEN stream_all.requested_at END,
    CASE WHEN coalesce(stream_order.version,0)>s.stream_ack_seq THEN stream_order.requested_at END,
    CASE WHEN coalesce(stream_token.version,0)>s.stream_ack_seq THEN stream_token.requested_at END
  )`
} as const;

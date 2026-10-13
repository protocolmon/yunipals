-- User approval is required to run this temporary allocation change.
-- The shared 1,000,000-CU cap and 200,000-CU foreground reserve remain enforced.
BEGIN;
DO $$
BEGIN
  PERFORM 1 FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea' FOR UPDATE;
  IF (SELECT daily_cu FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea')<>1000000
    OR (SELECT foreground_reserve_cu FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea')<>200000
    OR (SELECT daily_cu FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea' AND workload='source')<>200000
    OR (SELECT daily_cu FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea' AND workload='order_projection')<>400000
  THEN RAISE EXCEPTION 'RPC policy changed; re-review before rebalancing'; END IF;
  IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window
    WHERE scope='yunipals-opensea' AND workload='order_projection'
      AND window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date),0)>390000
  THEN RAISE EXCEPTION 'Marketplace allocation is already in use'; END IF;
END $$;
UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=CASE workload
  WHEN 'source' THEN 210000 WHEN 'order_projection' THEN 390000 END
  WHERE scope='yunipals-opensea' AND workload IN ('source','order_projection');
COMMIT;

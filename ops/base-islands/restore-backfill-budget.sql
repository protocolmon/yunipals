BEGIN;
UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=200000
  WHERE scope='yunipals-opensea' AND workload='source' AND daily_cu=210000;
UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=400000
  WHERE scope='yunipals-opensea' AND workload='order_projection' AND daily_cu=390000;
COMMIT;

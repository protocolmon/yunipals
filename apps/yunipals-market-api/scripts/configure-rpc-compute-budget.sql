-- Run as migration owner after configuring the shared provider-request scope.
-- Required psql variables: budget_scope, budget_enabled.
-- The fixed allocations total the normal one-million-CU operating envelope.
BEGIN;
INSERT INTO yunipals_market.rpc_compute_budget
  (scope,daily_cu,foreground_reserve_cu,enabled)
VALUES(:'budget_scope',1000000,200000,:'budget_enabled'::boolean)
ON CONFLICT(scope) DO UPDATE SET daily_cu=EXCLUDED.daily_cu,
  foreground_reserve_cu=EXCLUDED.foreground_reserve_cu,
  enabled=EXCLUDED.enabled;

INSERT INTO yunipals_market.rpc_compute_allocation(scope,workload,priority,daily_cu)
VALUES
  (:'budget_scope','source','background',200000),
  (:'budget_scope','order_projection','background',400000),
  (:'budget_scope','sale','background',200000),
  (:'budget_scope','foreground','foreground',150000),
  (:'budget_scope','incident','foreground',50000)
ON CONFLICT(scope,workload) DO UPDATE SET priority=EXCLUDED.priority,daily_cu=EXCLUDED.daily_cu;
COMMIT;

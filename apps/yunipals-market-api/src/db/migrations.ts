// Migrations are immutable once released. Amount domains intentionally use
// unconstrained numeric: numeric(78,0) would round a fractional input first.
export const migrations = [
  {
    version: 1,
    name: "durable_marketplace_foundation",
    sql: `
CREATE DOMAIN yunipals_market.uint256 AS numeric
  CHECK (VALUE >= 0 AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND scale(VALUE) = 0);
CREATE DOMAIN yunipals_market.address AS text CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN yunipals_market.hash AS text CHECK (VALUE ~ '^0x[0-9a-f]{64}$');

CREATE TABLE yunipals_market.deployment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('staging','production')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE yunipals_market.collection (
  chain_id integer NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  slug text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('yunipals','opensea')),
  PRIMARY KEY (chain_id, contract_address),
  UNIQUE (chain_id, contract_address, source)
);
INSERT INTO yunipals_market.collection VALUES
 (1,'0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d','ethereum','opensea'),
 (8453,'0x98433df878e8c898cb907345c3a7756e5f72240f','base','opensea'),
 (137,'0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d','polygon','opensea'),
 (56,'0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d','bnb','yunipals');

CREATE TABLE yunipals_market.preparation (
  id uuid PRIMARY KEY,
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  token_id yunipals_market.uint256 NOT NULL,
  lifecycle integer NOT NULL CHECK (lifecycle >= 0),
  maker yunipals_market.address NOT NULL,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 256),
  components jsonb NOT NULL CHECK (jsonb_typeof(components)='object' AND octet_length(components::text)<=131072),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (chain_id,contract_address) REFERENCES yunipals_market.collection
);
CREATE INDEX preparation_expiry ON yunipals_market.preparation(expires_at);

CREATE TABLE yunipals_market.orders (
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  token_id yunipals_market.uint256 NOT NULL,
  lifecycle integer NOT NULL CHECK (lifecycle >= 0),
  source text NOT NULL,
  side text NOT NULL CHECK (side IN ('listing','offer')),
  maker yunipals_market.address NOT NULL,
  currency yunipals_market.address NOT NULL,
  gross_amount yunipals_market.uint256 NOT NULL CHECK (gross_amount > 0),
  seller_proceeds yunipals_market.uint256 NOT NULL CHECK (seller_proceeds > 0 AND seller_proceeds <= gross_amount),
  start_time yunipals_market.uint256 NOT NULL,
  end_time yunipals_market.uint256 NOT NULL CHECK (end_time > start_time),
  counter yunipals_market.uint256 NOT NULL,
  components jsonb NOT NULL CHECK (jsonb_typeof(components)='object' AND octet_length(components::text)<=131072),
  signature text CHECK (signature ~ '^0x([0-9a-fA-F]{2})+$' AND length(signature)<=32770),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary)='object' AND octet_length(summary::text)<=131072),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 256),
  publication_state text NOT NULL CHECK (publication_state IN ('pending','accepted','rejected','indeterminate')),
  provider_ack jsonb CHECK (jsonb_typeof(provider_ack)='object' AND octet_length(provider_ack::text)<=131072),
  accepted_at timestamptz,
  state text NOT NULL DEFAULT 'unavailable' CHECK (state IN ('active','unavailable','filled','cancelled','expired','counter-changed')),
  state_reason text,
  state_observed_at timestamptz,
  state_block_number yunipals_market.uint256,
  state_block_hash yunipals_market.hash,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (chain_id,protocol_address,order_hash),
  FOREIGN KEY (chain_id,contract_address,source) REFERENCES yunipals_market.collection(chain_id,contract_address,source),
  CHECK (source <> 'yunipals' OR signature IS NOT NULL),
  CHECK (publication_state <> 'accepted' OR accepted_at IS NOT NULL),
  CHECK (publication_state <> 'accepted' OR source <> 'opensea' OR provider_ack IS NOT NULL),
  CHECK (state <> 'active' OR publication_state='accepted')
);
CREATE INDEX orders_asset ON yunipals_market.orders(chain_id,contract_address,token_id,side,state);
CREATE INDEX orders_maker ON yunipals_market.orders(maker,side,created_at DESC);
CREATE INDEX orders_reconcile ON yunipals_market.orders(state_observed_at NULLS FIRST) WHERE state IN ('active','unavailable');
CREATE INDEX orders_price ON yunipals_market.orders(chain_id,currency,gross_amount,token_id) WHERE side='listing' AND state='active';

CREATE TABLE yunipals_market.submission_attempt (
  id uuid PRIMARY KEY,
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','sending','accepted','rejected','indeterminate')),
  provider_request_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (chain_id,protocol_address,order_hash) REFERENCES yunipals_market.orders
);

CREATE TABLE yunipals_market.job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  deduplication_key text NOT NULL CHECK (length(deduplication_key) BETWEEN 1 AND 256),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=131072),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (kind,deduplication_key),
  CHECK ((state='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state<>'running' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX job_due ON yunipals_market.job(kind,available_at) WHERE state='pending';
CREATE INDEX job_expired_lease ON yunipals_market.job(lease_until) WHERE state='running';

CREATE TABLE yunipals_market.checkpoint (
  source text NOT NULL CHECK (source IN ('chain','opensea','indexer')),
  chain_id integer NOT NULL CHECK (chain_id IN (1,56,137,8453)),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  block_number yunipals_market.uint256,
  block_hash yunipals_market.hash,
  coverage_start yunipals_market.uint256,
  provider_cursor text CHECK (length(provider_cursor)<=4096),
  state text NOT NULL DEFAULT 'syncing' CHECK (state IN ('available','syncing','unavailable')),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  progress_at timestamptz,
  checked_at timestamptz,
  last_error_code text,
  PRIMARY KEY (source,chain_id,name),
  CHECK ((block_number IS NULL) = (block_hash IS NULL)),
  CHECK (coverage_start IS NULL OR (block_number IS NOT NULL AND coverage_start<=block_number))
);

CREATE TABLE yunipals_market.sale (
  chain_id integer NOT NULL,
  block_number yunipals_market.uint256 NOT NULL,
  block_hash yunipals_market.hash NOT NULL,
  log_index integer NOT NULL CHECK (log_index>=0),
  transaction_hash yunipals_market.hash NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  token_id yunipals_market.uint256 NOT NULL,
  seller yunipals_market.address NOT NULL,
  nft_recipient yunipals_market.address NOT NULL,
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object' AND octet_length(observation::text)<=131072),
  canonical boolean NOT NULL,
  block_timestamp timestamptz NOT NULL,
  PRIMARY KEY (chain_id,block_hash,log_index),
  FOREIGN KEY (chain_id,contract_address) REFERENCES yunipals_market.collection
);
CREATE INDEX sale_asset ON yunipals_market.sale(chain_id,contract_address,token_id,block_timestamp DESC) WHERE canonical;
CREATE INDEX sale_seller ON yunipals_market.sale(seller,block_timestamp DESC) WHERE canonical;
CREATE INDEX sale_recipient ON yunipals_market.sale(nft_recipient,block_timestamp DESC) WHERE canonical;
CREATE UNIQUE INDEX sale_canonical_order ON yunipals_market.sale(chain_id,protocol_address,order_hash) WHERE canonical;

CREATE TABLE yunipals_market.snapshot (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('catalog','orders','activity')),
  query_key text NOT NULL CHECK (length(query_key) BETWEEN 1 AND 8192),
  header jsonb NOT NULL CHECK (jsonb_typeof(header)='object' AND octet_length(header::text)<=131072),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at>observed_at),
  invalidated_at timestamptz,
  row_count bigint NOT NULL CHECK (row_count>=0)
);
CREATE INDEX snapshot_expiry ON yunipals_market.snapshot(expires_at);
CREATE TABLE yunipals_market.snapshot_item (
  snapshot_id uuid NOT NULL REFERENCES yunipals_market.snapshot ON DELETE CASCADE,
  ordinal bigint NOT NULL CHECK (ordinal>=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=131072),
  PRIMARY KEY (snapshot_id,ordinal)
);
`
  },
  {
    version: 2,
    name: "bnb_admission_lookup_indexes",
    sql: `
CREATE INDEX preparation_order_lookup ON yunipals_market.preparation(chain_id,protocol_address,order_hash,lifecycle,policy_version,expires_at DESC);
CREATE INDEX orders_outstanding_scope ON yunipals_market.orders(chain_id,protocol_address,contract_address,token_id,maker,side,counter,end_time)
  WHERE publication_state='accepted';
`
  },
  {
    version: 3,
    name: "recurring_order_reconciliation",
    sql: `
ALTER TABLE yunipals_market.orders
  ADD COLUMN reconcile_generation bigint NOT NULL DEFAULT 0 CHECK (reconcile_generation>=0),
  ADD COLUMN reconcile_failures integer NOT NULL DEFAULT 0 CHECK (reconcile_failures BETWEEN 0 AND 16),
  ADD COLUMN next_reconcile_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX orders_reconcile_due ON yunipals_market.orders(next_reconcile_at,order_hash)
  WHERE chain_id=56 AND source='yunipals' AND publication_state='accepted';
CREATE INDEX job_reconcile_cleanup ON yunipals_market.job(updated_at)
  WHERE kind='bnb_order_reconcile' AND state='completed';
`
  },
  {
    version: 4,
    name: "bounded_query_snapshots",
    sql: `
ALTER TABLE yunipals_market.snapshot ADD COLUMN byte_count bigint NOT NULL DEFAULT 0 CHECK (byte_count>=0);
UPDATE yunipals_market.snapshot s SET byte_count=octet_length(s.header::text)+coalesce(
  (SELECT sum(octet_length(i.payload::text)) FROM yunipals_market.snapshot_item i WHERE i.snapshot_id=s.id),0);
CREATE INDEX snapshot_query ON yunipals_market.snapshot(kind,query_key,observed_at DESC) WHERE invalidated_at IS NULL;
CREATE INDEX orders_received ON yunipals_market.orders(chain_id,contract_address,token_id,created_at DESC)
  WHERE side='offer' AND publication_state='accepted';
`
  },
  {
    version: 5,
    name: "confirmed_sale_replay",
    sql: `
ALTER TABLE yunipals_market.orders
  ADD COLUMN admission_block_number yunipals_market.uint256,
  ADD COLUMN admission_block_hash yunipals_market.hash,
  ADD CHECK ((admission_block_number IS NULL)=(admission_block_hash IS NULL));
-- Mutable reconciliation observations cannot reconstruct historical admission.
CREATE INDEX orders_admission_block ON yunipals_market.orders(admission_block_number)
  WHERE chain_id=56 AND source='yunipals' AND publication_state='accepted';
ALTER TABLE yunipals_market.checkpoint ADD COLUMN replay_from yunipals_market.uint256;
INSERT INTO yunipals_market.checkpoint(source,chain_id,name) VALUES ('chain',56,'bnb-sales');
CREATE TABLE yunipals_market.activity_block (
  chain_id integer NOT NULL CHECK (chain_id IN (1,56,137,8453)),
  block_number yunipals_market.uint256 NOT NULL,
  block_hash yunipals_market.hash NOT NULL,
  PRIMARY KEY (chain_id,block_number)
);
CREATE TABLE yunipals_market.sale_receipt (
  chain_id integer NOT NULL,
  block_hash yunipals_market.hash NOT NULL,
  transaction_hash yunipals_market.hash NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=2097152),
  block jsonb NOT NULL CHECK (jsonb_typeof(block)='object' AND octet_length(block::text)<=8192),
  confirmation_policy text NOT NULL CHECK (length(confirmation_policy) BETWEEN 1 AND 128),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (chain_id,block_hash,transaction_hash)
);
CREATE INDEX sale_reorg ON yunipals_market.sale(chain_id,block_number) WHERE canonical;
`
  },
  {
    version: 6,
    name: "sale_replay_time_coverage",
    sql: `
ALTER TABLE yunipals_market.checkpoint ADD COLUMN coverage_start_time yunipals_market.uint256;
-- An order can settle earlier on a replacement branch than its old admission
-- block. Replay must cover its signed start time, not only its admission height.
UPDATE yunipals_market.checkpoint SET replay_from=0,state='syncing',generation=generation+1
  WHERE source='chain' AND chain_id=56 AND name='bnb-sales';
`
  },
  {
    version: 7,
    name: "activity_snapshot_reorg_version",
    sql: `
ALTER TABLE yunipals_market.checkpoint ADD COLUMN canonical_generation bigint NOT NULL DEFAULT 0 CHECK (canonical_generation>=0);
`
  },
  {
    version: 8,
    name: "opensea_submission_recovery_indexes",
    sql: `
CREATE INDEX orders_opensea_submission_due ON yunipals_market.orders(next_reconcile_at,chain_id,order_hash)
  WHERE source='opensea' AND publication_state IN ('pending','indeterminate');
CREATE INDEX submission_attempt_order_history ON yunipals_market.submission_attempt(chain_id,protocol_address,order_hash,created_at DESC,id DESC);
CREATE INDEX job_opensea_submission_cleanup ON yunipals_market.job(updated_at)
  WHERE kind='opensea_submission' AND state='completed';
`
  },
  {
    version: 9,
    name: "opensea_discovery_provenance",
    sql: `
CREATE INDEX orders_opensea_reconcile_due ON yunipals_market.orders(next_reconcile_at,chain_id,order_hash)
  WHERE source='opensea' AND publication_state='accepted';
CREATE INDEX job_opensea_reconcile_cleanup ON yunipals_market.job(updated_at)
  WHERE kind='opensea_order_reconcile' AND state='completed';
CREATE TABLE yunipals_market.opensea_discovery_scan (
  chain_id integer NOT NULL CHECK (chain_id IN (1,137,8453)),
  side text NOT NULL CHECK (side IN ('listing','offer')),
  collection_slug text NOT NULL CHECK (collection_slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'),
  run_id uuid NOT NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 10000),
  provider_cursor text CHECK (length(provider_cursor) BETWEEN 1 AND 4096),
  state text NOT NULL DEFAULT 'syncing' CHECK (state IN ('syncing','available','unavailable')),
  run_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  checked_at timestamptz,
  next_scan_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 16),
  last_error_code text,
  lease_token uuid,
  lease_until timestamptz,
  PRIMARY KEY(chain_id,side),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE yunipals_market.opensea_discovery_page (
  chain_id integer NOT NULL,
  side text NOT NULL,
  run_id uuid NOT NULL,
  cursor_hash yunipals_market.hash NOT NULL,
  page_number integer NOT NULL CHECK (page_number BETWEEN 1 AND 10000),
  next_cursor_hash yunipals_market.hash,
  order_count integer NOT NULL CHECK (order_count BETWEEN 0 AND 50),
  response_hash yunipals_market.hash NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(chain_id,side,run_id,cursor_hash),
  UNIQUE(chain_id,side,run_id,page_number),
  FOREIGN KEY(chain_id,side) REFERENCES yunipals_market.opensea_discovery_scan
);
CREATE TABLE yunipals_market.opensea_discovered_order (
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  side text NOT NULL CHECK (side IN ('listing','offer')),
  token_id yunipals_market.uint256,
  maker yunipals_market.address NOT NULL,
  classification text NOT NULL CHECK (classification IN ('item','criteria','unsupported')),
  provider_status text NOT NULL CHECK (provider_status IN ('ACTIVE','INACTIVE','FULFILLED','EXPIRED','CANCELLED')),
  components jsonb NOT NULL CHECK (jsonb_typeof(components)='object' AND octet_length(components::text)<=65536),
  signature text CHECK (signature ~ '^0x([0-9a-fA-F]{2})+$' AND length(signature)<=32770),
  provider_observation jsonb NOT NULL CHECK (jsonb_typeof(provider_observation)='object' AND octet_length(provider_observation::text)<=131072),
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_run_id uuid NOT NULL,
  present boolean NOT NULL DEFAULT true,
  missing_since timestamptz,
  PRIMARY KEY(chain_id,protocol_address,order_hash),
  FOREIGN KEY(chain_id,contract_address) REFERENCES yunipals_market.collection,
  CHECK (classification<>'item' OR token_id IS NOT NULL)
);
CREATE INDEX opensea_discovered_scope ON yunipals_market.opensea_discovered_order(chain_id,side,last_seen_run_id);
CREATE INDEX opensea_discovered_asset ON yunipals_market.opensea_discovered_order(chain_id,contract_address,token_id) WHERE present;
CREATE INDEX opensea_discovered_maker ON yunipals_market.opensea_discovered_order(maker,chain_id,last_seen_at DESC);
`
  },
  {
    version: 10,
    name: "opensea_discovered_chain_observations",
    sql: `
CREATE TABLE yunipals_market.opensea_discovered_state (
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  state text NOT NULL DEFAULT 'unavailable' CHECK (state IN ('eligible','authorization-required','unavailable','filled','cancelled','counter-changed','expired')),
  reason text CHECK (reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  bound_lifecycle integer CHECK (bound_lifecycle>=1),
  bound_mint_hash yunipals_market.hash,
  summary jsonb CHECK (jsonb_typeof(summary)='object' AND octet_length(summary::text)<=32768),
  policy_version text CHECK (length(policy_version) BETWEEN 1 AND 128),
  observed_at timestamptz,
  block_number yunipals_market.uint256,
  block_hash yunipals_market.hash,
  provider_seen_at timestamptz,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 16),
  next_reconcile_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  PRIMARY KEY(chain_id,protocol_address,order_hash),
  FOREIGN KEY(chain_id,protocol_address,order_hash) REFERENCES yunipals_market.opensea_discovered_order,
  CHECK ((bound_lifecycle IS NULL)=(bound_mint_hash IS NULL)),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK ((observed_at IS NULL)=(block_number IS NULL) AND (block_number IS NULL)=(block_hash IS NULL)),
  CHECK (state NOT IN ('eligible','authorization-required') OR
    (bound_lifecycle IS NOT NULL AND summary IS NOT NULL AND policy_version IS NOT NULL AND observed_at IS NOT NULL AND provider_seen_at IS NOT NULL))
);
CREATE INDEX opensea_discovered_reconcile_due ON yunipals_market.opensea_discovered_state(chain_id,next_reconcile_at,order_hash);
`
  },
  {
    version: 11,
    name: "opensea_fulfillment_maker_signatures",
    sql: `
CREATE TABLE yunipals_market.opensea_maker_signature (
  chain_id integer NOT NULL,
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^0x([0-9a-fA-F]{2})+$' AND length(signature)<=32770),
  validation_actor yunipals_market.address NOT NULL,
  block_number yunipals_market.uint256 NOT NULL,
  block_hash yunipals_market.hash NOT NULL,
  validated_at timestamptz NOT NULL,
  provider_seen_at timestamptz NOT NULL,
  lifecycle integer NOT NULL CHECK (lifecycle>=1),
  mint_hash yunipals_market.hash NOT NULL,
  source text NOT NULL DEFAULT 'fulfillment' CHECK (source='fulfillment'),
  PRIMARY KEY(chain_id,protocol_address,order_hash),
  FOREIGN KEY(chain_id,protocol_address,order_hash)
    REFERENCES yunipals_market.opensea_discovered_order ON DELETE CASCADE
);
`
  },
  {
    version: 12,
    name: "opensea_shared_request_budget",
    sql: `
CREATE TABLE yunipals_market.opensea_request_budget (
  scope text PRIMARY KEY CHECK (scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  all_per_hour integer NOT NULL CHECK (all_per_hour BETWEEN 1 AND 1000000),
  fulfillment_per_minute integer NOT NULL CHECK (fulfillment_per_minute BETWEEN 1 AND 100000),
  publication_per_hour integer NOT NULL CHECK (publication_per_hour BETWEEN 1 AND 1000000),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE yunipals_market.opensea_request_budget_state (
  scope text PRIMARY KEY REFERENCES yunipals_market.opensea_request_budget,
  clock_at bigint NOT NULL DEFAULT 0 CHECK (clock_at>=0),
  blocked_until bigint NOT NULL DEFAULT 0 CHECK (blocked_until>=0)
);
CREATE TABLE yunipals_market.opensea_request_window (
  scope text NOT NULL REFERENCES yunipals_market.opensea_request_budget,
  reset_at bigint NOT NULL CHECK (reset_at>=0),
  remaining integer NOT NULL CHECK (remaining>=0),
  PRIMARY KEY(scope,reset_at)
);
CREATE TABLE yunipals_market.opensea_request_reservation (
  id uuid PRIMARY KEY,
  scope text NOT NULL REFERENCES yunipals_market.opensea_request_budget,
  kind text NOT NULL CHECK (kind IN ('read','fulfillment','publication')),
  reserved_at bigint NOT NULL CHECK (reserved_at>=0),
  completed boolean NOT NULL DEFAULT false
);
CREATE INDEX opensea_request_reservation_scope ON yunipals_market.opensea_request_reservation(scope,reserved_at);
`
  },
  {
    version: 13,
    name: "opensea_shared_policy_observations",
    sql: `
CREATE TABLE yunipals_market.opensea_policy_observation (
  scope text NOT NULL REFERENCES yunipals_market.opensea_request_budget,
  chain_id integer NOT NULL CHECK (chain_id IN (1,8453,137)),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  response jsonb CHECK (jsonb_typeof(response)='object' AND octet_length(response::text)<=65536),
  observed_at timestamptz,
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  retry_at timestamptz NOT NULL DEFAULT '-infinity',
  lease_token uuid,
  lease_until timestamptz,
  PRIMARY KEY(scope,chain_id),
  CHECK ((response IS NULL)=(observed_at IS NULL)),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL))
);
`
  },
  {
    version: 14,
    name: "collection_sale_replay_coverage",
    sql: `
CREATE TABLE yunipals_market.sale_replay_config (
  chain_id integer PRIMARY KEY CHECK (chain_id IN (1,137,8453)),
  start_block yunipals_market.uint256 NOT NULL,
  confirmations integer NOT NULL CHECK (confirmations BETWEEN 1 AND 100000),
  policy text NOT NULL UNIQUE CHECK (policy ~ '^[a-z0-9][a-z0-9_-]{0,127}$')
);
CREATE TABLE yunipals_market.sale_exclusion (
  chain_id integer NOT NULL REFERENCES yunipals_market.sale_replay_config,
  block_number yunipals_market.uint256 NOT NULL,
  block_hash yunipals_market.hash NOT NULL,
  log_index integer NOT NULL CHECK (log_index>=0),
  transaction_hash yunipals_market.hash NOT NULL,
  reason text NOT NULL CHECK (reason='unsupported_collection_sale'),
  canonical boolean NOT NULL,
  PRIMARY KEY(chain_id,block_hash,log_index),
  FOREIGN KEY(chain_id,block_hash,transaction_hash) REFERENCES yunipals_market.sale_receipt
);
CREATE INDEX sale_exclusion_canonical ON yunipals_market.sale_exclusion(chain_id,block_number) WHERE canonical;
INSERT INTO yunipals_market.checkpoint(source,chain_id,name)
  VALUES ('chain',1,'seaport-sales'),('chain',137,'seaport-sales'),('chain',8453,'seaport-sales');
CREATE FUNCTION yunipals_market.fence_sale_replay_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.chain_id<>OLD.chain_id THEN
    RAISE EXCEPTION 'Sale replay chain identity cannot change';
  END IF;
  UPDATE yunipals_market.checkpoint SET generation=generation+1,canonical_generation=canonical_generation+1,
    state='unavailable',last_error_code='sale_replay_configuration_changed',checked_at=clock_timestamp()
    WHERE source='chain' AND name='seaport-sales' AND chain_id=CASE WHEN TG_OP='DELETE' THEN OLD.chain_id ELSE NEW.chain_id END;
  UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE kind='activity' AND invalidated_at IS NULL;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER sale_replay_configuration_fence BEFORE INSERT OR UPDATE OR DELETE ON yunipals_market.sale_replay_config
  FOR EACH ROW EXECUTE FUNCTION yunipals_market.fence_sale_replay_configuration();
-- No chain is configured or enabled by this migration. Operators must choose
-- explicit history starts and confirmation policies before starting replay.
`
  },
  {
    version: 15,
    name: "partial_collection_sale_fills",
    sql: `
-- A partial criteria order can settle different ERC721s in separate receipts.
-- Individual events remain unique by (chain_id,block_hash,log_index).
DROP INDEX yunipals_market.sale_canonical_order;
CREATE INDEX sale_canonical_order ON yunipals_market.sale(chain_id,protocol_address,order_hash) WHERE canonical;
-- The admitted BNB order model supports only complete single-NFT fills.
CREATE UNIQUE INDEX sale_canonical_bnb_order ON yunipals_market.sale(chain_id,protocol_address,order_hash) WHERE canonical AND chain_id=56;
`
  },
  {
    version: 16,
    name: "opensea_substantive_provider_version",
    sql: `
-- Preserve existing exact projection/proof bindings on upgrade. Fetch freshness
-- remains last_seen_at; unchanged collection scans no longer change provenance.
ALTER TABLE yunipals_market.opensea_discovered_order ADD COLUMN last_changed_at timestamptz;
UPDATE yunipals_market.opensea_discovered_order SET last_changed_at=last_seen_at;
ALTER TABLE yunipals_market.opensea_discovered_order ALTER COLUMN last_changed_at SET NOT NULL;
ALTER TABLE yunipals_market.opensea_discovered_order ADD CONSTRAINT opensea_provider_version_finite CHECK (isfinite(last_changed_at));
CREATE FUNCTION yunipals_market.version_discovered_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.last_changed_at := NEW.last_seen_at;
  ELSIF (to_jsonb(NEW)-ARRAY['last_changed_at','last_seen_at','last_seen_run_id','missing_since'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_changed_at','last_seen_at','last_seen_run_id','missing_since']) THEN
    -- Strictly advance even for two changes within one microsecond or a clock
    -- adjustment. Changed-then-restored contents cannot reuse an earlier fence.
    NEW.last_changed_at := greatest(clock_timestamp(),OLD.last_changed_at+interval '1 microsecond');
  ELSE
    NEW.last_changed_at := OLD.last_changed_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opensea_discovered_order_version BEFORE INSERT OR UPDATE ON yunipals_market.opensea_discovered_order
  FOR EACH ROW EXECUTE FUNCTION yunipals_market.version_discovered_order();
COMMENT ON COLUMN yunipals_market.opensea_discovered_order.last_changed_at IS
  'Exact substantive source version; generated for contents, identity, signature and presence changes. Fetch freshness is last_seen_at.';
COMMENT ON COLUMN yunipals_market.opensea_discovered_state.provider_seen_at IS
  'Exact source version observed by reconciliation: matches opensea_discovered_order.last_changed_at as of schema 16.';
COMMENT ON COLUMN yunipals_market.opensea_maker_signature.provider_seen_at IS
  'Historical exact source version inspected when retaining the maker signature; never grants current eligibility.';
`
  },
  {
    version: 17,
    name: "opensea_stream_reconciliation_wakeups",
    sql: `
-- Stream events are advisory. They only advance durable reconciliation wakeups;
-- the existing REST, indexer and chain checks remain authoritative.
CREATE TABLE yunipals_market.opensea_stream_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence BETWEEN 0 AND 9223372036854775807),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation BETWEEN 0 AND 9223372036854775807),
  lease_token uuid,
  lease_until timestamptz,
  connected boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  heartbeat_at timestamptz,
  last_gap_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK (NOT connected OR lease_token IS NOT NULL)
);
INSERT INTO yunipals_market.opensea_stream_state(singleton) VALUES(true);

CREATE TABLE yunipals_market.opensea_stream_notice (
  chain_id integer NOT NULL CHECK (chain_id IN (1,137,8453)),
  event_hash yunipals_market.hash NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'item_listed','item_sold','item_transferred','item_metadata_updated',
    'item_received_bid','item_cancelled','collection_offer','trait_offer',
    'order_invalidate','order_revalidate'
  )),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(chain_id,event_hash)
);
CREATE INDEX opensea_stream_notice_retention ON yunipals_market.opensea_stream_notice(received_at);

CREATE TABLE yunipals_market.opensea_stream_wakeup (
  chain_id integer NOT NULL CHECK (chain_id IN (1,137,8453)),
  target text NOT NULL CHECK (
    target IN ('all','scan') OR
    target ~ '^order:0x[0-9a-f]{64}$' OR
    target ~ '^token:(0|[1-9][0-9]{0,77})$'
  ),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9223372036854775807),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  PRIMARY KEY(chain_id,target)
);
CREATE INDEX opensea_stream_wakeup_version ON yunipals_market.opensea_stream_wakeup(chain_id,version);

ALTER TABLE yunipals_market.orders
  ADD COLUMN stream_ack_seq bigint NOT NULL DEFAULT 0 CHECK (stream_ack_seq BETWEEN 0 AND 9223372036854775807);
ALTER TABLE yunipals_market.opensea_discovered_state
  ADD COLUMN stream_ack_seq bigint NOT NULL DEFAULT 0 CHECK (stream_ack_seq BETWEEN 0 AND 9223372036854775807);
ALTER TABLE yunipals_market.opensea_discovery_scan
  ADD COLUMN stream_scan_seq bigint NOT NULL DEFAULT 0 CHECK (stream_scan_seq BETWEEN 0 AND 9223372036854775807),
  ADD COLUMN stream_ack_seq bigint NOT NULL DEFAULT 0 CHECK (stream_ack_seq BETWEEN 0 AND 9223372036854775807);
`
  },
  {
    version: 18,
    name: "rpc_compute_budget_and_indexed_transfer_wakeups",
    sql: `
-- A changed indexed transfer wakes only projections for that NFT. Existing
-- projections intentionally receive one new observation after this migration.
ALTER TABLE yunipals_market.orders
  ADD COLUMN bound_transfer_hash yunipals_market.hash;
ALTER TABLE yunipals_market.opensea_discovered_state
  ADD COLUMN bound_transfer_hash yunipals_market.hash;

-- Provider request quotas and paid chain compute are separate budgets. The
-- policy rows are owner-controlled; runtime roles can only reserve durable CU.
CREATE TABLE yunipals_market.rpc_compute_budget (
  scope text PRIMARY KEY REFERENCES yunipals_market.opensea_request_budget,
  daily_cu bigint NOT NULL CHECK (daily_cu BETWEEN 1 AND 1000000000000),
  foreground_reserve_cu bigint NOT NULL CHECK (foreground_reserve_cu>=0 AND foreground_reserve_cu<daily_cu),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE yunipals_market.rpc_compute_allocation (
  scope text NOT NULL REFERENCES yunipals_market.rpc_compute_budget ON DELETE CASCADE,
  workload text NOT NULL CHECK (workload ~ '^[a-z][a-z0-9_-]{0,63}$'),
  priority text NOT NULL CHECK (priority IN ('background','foreground')),
  daily_cu bigint NOT NULL CHECK (daily_cu BETWEEN 1 AND 1000000000000),
  PRIMARY KEY(scope,workload)
);
CREATE TABLE yunipals_market.rpc_compute_window (
  scope text NOT NULL REFERENCES yunipals_market.rpc_compute_budget ON DELETE CASCADE,
  window_start date NOT NULL,
  granted_cu bigint NOT NULL DEFAULT 0 CHECK (granted_cu>=0),
  background_granted_cu bigint NOT NULL DEFAULT 0 CHECK (background_granted_cu>=0 AND background_granted_cu<=granted_cu),
  PRIMARY KEY(scope,window_start)
);
CREATE TABLE yunipals_market.rpc_compute_workload_window (
  scope text NOT NULL,
  workload text NOT NULL,
  window_start date NOT NULL,
  granted_cu bigint NOT NULL DEFAULT 0 CHECK (granted_cu>=0),
  PRIMARY KEY(scope,workload,window_start),
  FOREIGN KEY(scope,workload) REFERENCES yunipals_market.rpc_compute_allocation ON DELETE CASCADE
);
CREATE INDEX rpc_compute_window_retention ON yunipals_market.rpc_compute_window(window_start);
CREATE INDEX rpc_compute_workload_window_retention ON yunipals_market.rpc_compute_workload_window(window_start);
`
  },
  {
    version: 19,
    name: "bounded_indexed_transfer_checks",
    sql: `
-- Exact token batches replace local-to-foreign joins that made postgres_fdw
-- download a complete collection on every worker poll. These timestamps make
-- the one-minute fallback durable across worker restarts and replicas.
ALTER TABLE yunipals_market.orders
  ADD COLUMN indexed_transfer_checked_at timestamptz NOT NULL DEFAULT '-infinity';
ALTER TABLE yunipals_market.opensea_discovered_state
  ADD COLUMN indexed_transfer_checked_at timestamptz NOT NULL DEFAULT '-infinity';

CREATE INDEX orders_indexed_transfer_due
  ON yunipals_market.orders(chain_id,indexed_transfer_checked_at,order_hash)
  WHERE bound_transfer_hash IS NOT NULL;
CREATE INDEX opensea_discovered_indexed_transfer_due
  ON yunipals_market.opensea_discovered_state(chain_id,indexed_transfer_checked_at,order_hash)
  WHERE bound_lifecycle IS NOT NULL;
`
  },
  {
    version: 20,
    name: "provider_accounting_and_resilient_policy_cache",
    sql: `
-- A provider account has one coordinator. Attribute every reservation without
-- retaining authenticated paths, signed orders, keys or wallet payloads.
ALTER TABLE yunipals_market.opensea_request_budget
  ADD COLUMN coordinator_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE yunipals_market.opensea_request_reservation
  ADD COLUMN caller text NOT NULL DEFAULT 'legacy'
    CHECK (caller IN ('api','discovery','read_worker','signature','publication','probe','incident','retired_staging','test','legacy')),
  ADD COLUMN workload text NOT NULL DEFAULT 'legacy'
    CHECK (workload IN ('foreground','discovery','order_projection','signature','publication','incident','legacy')),
  ADD COLUMN priority text NOT NULL DEFAULT 'foreground'
    CHECK (priority IN ('background','foreground')),
  ADD COLUMN endpoint_class text NOT NULL DEFAULT 'unknown'
    CHECK (endpoint_class IN ('collection_policy','contract','listings','offers','order_lookup','fulfillment','publication','unknown')),
  ADD COLUMN response_status integer CHECK (response_status BETWEEN 100 AND 599),
  ADD COLUMN outcome text CHECK (outcome IN ('completed','provider_error','network_error','timeout','aborted','lost')),
  ADD COLUMN completed_at bigint CHECK (completed_at>=reserved_at),
  ADD COLUMN retry_after_ms bigint CHECK (retry_after_ms>=0 AND retry_after_ms<=86400000);

-- Keep the legacy aggregate window intact while the previous release is still
-- running during deployment. The new coordinator reads both tables until the
-- legacy windows expire, while new provider observations are isolated here.
CREATE TABLE yunipals_market.opensea_request_endpoint_window (
  scope text NOT NULL REFERENCES yunipals_market.opensea_request_budget,
  endpoint_class text NOT NULL
    CHECK (endpoint_class IN ('collection_policy','contract','listings','offers','order_lookup','fulfillment','publication','unknown')),
  reset_at bigint NOT NULL CHECK (reset_at>=0),
  remaining integer NOT NULL CHECK (remaining>=0),
  PRIMARY KEY(scope,endpoint_class,reset_at)
);
INSERT INTO yunipals_market.opensea_request_endpoint_window
  (scope,endpoint_class,reset_at,remaining)
SELECT scope,'unknown',reset_at,remaining
FROM yunipals_market.opensea_request_window;

CREATE TABLE yunipals_market.opensea_request_metric_minute (
  scope text NOT NULL REFERENCES yunipals_market.opensea_request_budget,
  bucket_at timestamptz NOT NULL,
  caller text NOT NULL CHECK (caller IN ('api','discovery','read_worker','signature','publication','probe','incident','retired_staging','test','legacy')),
  workload text NOT NULL CHECK (workload IN ('foreground','discovery','order_projection','signature','publication','incident','legacy')),
  priority text NOT NULL CHECK (priority IN ('background','foreground')),
  kind text NOT NULL CHECK (kind IN ('read','fulfillment','publication')),
  endpoint_class text NOT NULL CHECK (endpoint_class IN ('collection_policy','contract','listings','offers','order_lookup','fulfillment','publication','unknown')),
  outcome text NOT NULL CHECK (outcome IN ('completed','provider_error','network_error','timeout','aborted','lost','local_quota')),
  response_status integer NOT NULL DEFAULT 0 CHECK (response_status BETWEEN 0 AND 599),
  requests bigint NOT NULL DEFAULT 0 CHECK (requests>=0),
  latency_ms bigint NOT NULL DEFAULT 0 CHECK (latency_ms>=0),
  retry_after_ms bigint NOT NULL DEFAULT 0 CHECK (retry_after_ms>=0),
  PRIMARY KEY(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
);
CREATE INDEX opensea_request_metric_retention
  ON yunipals_market.opensea_request_metric_minute(scope,bucket_at);

-- Preserve the last successful policy while a refresh is leased or fails. The
-- attempt/error timestamps describe refresh health separately from browse data.
ALTER TABLE yunipals_market.opensea_policy_observation
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN response_version text CHECK (response_version IS NULL OR response_version ~ '^[0-9a-f]{64}$');
UPDATE yunipals_market.opensea_policy_observation
  SET last_attempt_at=observed_at WHERE observed_at IS NOT NULL;
`
  },
  {
    version: 21,
    name: "terminal_order_scheduling",
    sql: `
-- Expiry proven against a trusted chain observation is final and must not keep
-- consuming provider policy or RPC capacity. Other terminal chain outcomes keep
-- their existing canonical/reorg checks until their finality handling retires them.
ALTER TABLE yunipals_market.opensea_discovered_state
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN terminal_reason text CHECK (terminal_reason IS NULL OR terminal_reason='expired'),
  ADD CONSTRAINT opensea_discovered_terminal_pair CHECK ((terminal_at IS NULL)=(terminal_reason IS NULL));
ALTER TABLE yunipals_market.orders
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN terminal_reason text CHECK (terminal_reason IS NULL OR terminal_reason='expired'),
  ADD CONSTRAINT orders_terminal_pair CHECK ((terminal_at IS NULL)=(terminal_reason IS NULL));

CREATE INDEX opensea_discovered_active_due
  ON yunipals_market.opensea_discovered_state(chain_id,next_reconcile_at,order_hash)
  WHERE terminal_at IS NULL;
CREATE INDEX opensea_retained_active_due
  ON yunipals_market.orders(chain_id,next_reconcile_at,order_hash)
  WHERE source='opensea' AND terminal_at IS NULL;
`
  },
  {
    version: 22,
    name: "bnb_public_order_discovery",
    sql: `
-- A new operator can rebuild this entire read model from Seaport events.
-- Keep it separate from signed orders, whose existing admission constraints
-- intentionally require an off-chain maker signature.
CREATE TABLE yunipals_market.bnb_discovery_cursor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  launch_block yunipals_market.uint256 NOT NULL,
  next_block yunipals_market.uint256 NOT NULL,
  target_block yunipals_market.uint256,
  scanned_block_hash yunipals_market.hash,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text,
  CHECK(next_block>=launch_block)
);

CREATE TABLE yunipals_market.bnb_discovered_order (
  protocol_address yunipals_market.address NOT NULL,
  order_hash yunipals_market.hash NOT NULL,
  contract_address yunipals_market.address NOT NULL,
  token_id yunipals_market.uint256 NOT NULL,
  maker yunipals_market.address NOT NULL,
  side text NOT NULL CHECK(side IN ('listing','offer')),
  currency yunipals_market.address NOT NULL,
  gross_amount yunipals_market.uint256 NOT NULL,
  start_time yunipals_market.uint256 NOT NULL,
  end_time yunipals_market.uint256 NOT NULL,
  parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object' AND octet_length(parameters::text)<=131072),
  components jsonb CHECK(components IS NULL OR (jsonb_typeof(components)='object' AND octet_length(components::text)<=131072)),
  publication_block yunipals_market.uint256 NOT NULL,
  publication_hash yunipals_market.hash NOT NULL,
  publication_tx yunipals_market.hash NOT NULL,
  publication_log_index integer NOT NULL CHECK(publication_log_index>=0),
  publication_time yunipals_market.uint256 NOT NULL,
  state text NOT NULL DEFAULT 'unavailable' CHECK(state IN ('active','unavailable','filled','cancelled','expired','counter-changed','inconsistent')),
  state_block yunipals_market.uint256,
  state_hash yunipals_market.hash,
  state_observed_at timestamptz,
  PRIMARY KEY(protocol_address,order_hash),
  UNIQUE(publication_tx,publication_log_index)
);
CREATE INDEX bnb_discovered_asset ON yunipals_market.bnb_discovered_order(contract_address,token_id,side,state,gross_amount);
CREATE INDEX bnb_discovered_maker ON yunipals_market.bnb_discovered_order(maker,publication_block DESC);
CREATE INDEX bnb_discovered_due ON yunipals_market.bnb_discovered_order(state,end_time) WHERE state IN ('active','unavailable','inconsistent');
`
  },
  {
    version: 23,
    name: "bnb_public_discovery_policy_identity",
    sql: `
ALTER TABLE yunipals_market.bnb_discovery_cursor
  ADD COLUMN policy_fingerprint yunipals_market.hash NOT NULL
    DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE yunipals_market.bnb_discovery_cursor
  ALTER COLUMN policy_fingerprint DROP DEFAULT;
`
  },
  {
    version: 24,
    name: "bnb_publication_counter_and_lifecycle",
    sql: `
ALTER TABLE yunipals_market.bnb_discovered_order
  ADD COLUMN publication_transaction_index integer CHECK(publication_transaction_index>=0),
  ADD COLUMN published_counter yunipals_market.uint256,
  ADD COLUMN published_components jsonb CHECK(published_components IS NULL OR
    (jsonb_typeof(published_components)='object' AND octet_length(published_components::text)<=131072)),
  ADD COLUMN bound_lifecycle integer CHECK(bound_lifecycle>=0),
  ADD COLUMN summary jsonb CHECK(summary IS NULL OR jsonb_typeof(summary)='object'),
  ADD COLUMN bound_at timestamptz,
  ADD COLUMN bound_indexer_block yunipals_market.uint256,
  ADD COLUMN bound_indexer_hash yunipals_market.hash,
  ADD CONSTRAINT bnb_published_components_pair
    CHECK ((published_counter IS NULL) = (published_components IS NULL));
ALTER TABLE yunipals_market.bnb_discovery_cursor
  ADD COLUMN mode text NOT NULL DEFAULT 'preview'
    CHECK(mode IN ('preview','live'));
CREATE INDEX bnb_discovered_unbound
  ON yunipals_market.bnb_discovered_order(publication_block,order_hash)
  WHERE bound_lifecycle IS NULL;
-- This is a derived cache. Replay it so every row has a verified publication
-- counter and transaction position before the new read path can use it.
DELETE FROM yunipals_market.bnb_discovered_order;
DELETE FROM yunipals_market.bnb_discovery_cursor;
`
  }
] as const;

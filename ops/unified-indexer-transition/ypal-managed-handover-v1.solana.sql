-- Run only through the existing clean postgres peer, with ON_ERROR_STOP=1.
-- Set ledger_max_id to 0 for the stopped-writer baseline; reuse the returned
-- ledgerPrefix.throughId on later observations. No raw rows/owners/keys return.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';
SET LOCAL idle_in_transaction_session_timeout='10s';
SET LOCAL timezone='UTC';
WITH boundary AS (
  SELECT CASE WHEN :'ledger_max_id'::bigint=0
    THEN COALESCE((SELECT max(id) FROM solana_indexer.rpc_usage),0)
    ELSE :'ledger_max_id'::bigint END AS id
), prefix AS (
  SELECT u.* FROM solana_indexer.rpc_usage u, boundary b WHERE u.id<=b.id
), worker_lock AS (
  SELECT granted FROM pg_locks
  WHERE locktype='advisory'
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND classid=((hashtext('solana:indexer:worker')::bigint>>32)&4294967295)::oid
    AND objid=(hashtext('solana:indexer:worker')::bigint&4294967295)::oid
    AND objsubid=1
)
SELECT jsonb_build_object(
  'format','yunipals-solana-supervisor-handover-state-v1',
  'readOnly',current_setting('transaction_read_only')='on',
  'isolation',current_setting('transaction_isolation'),
  'observedAt',clock_timestamp(),
  'manifest',(SELECT jsonb_build_object('checksum',checksum,'count',asset_count)
    FROM solana_indexer.manifest WHERE singleton),
  'state',(SELECT jsonb_build_object('publishedRunId',published_run_id,
    'nextScanAt',next_scan_at,'lastErrorPresent',last_error IS NOT NULL,
    'rowSha256',encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'))
    FROM solana_indexer.sync_state s WHERE singleton),
  'publishedRun',(SELECT jsonb_build_object('id',r.id,'state',r.state,
    'assetCount',r.asset_count,'missingCount',r.missing_count,'completedAt',r.completed_at,
    'rowSha256',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'))
    FROM solana_indexer.scan_run r JOIN solana_indexer.sync_state s
      ON s.published_run_id=r.id WHERE s.singleton),
  'runningScans',(SELECT count(*) FROM solana_indexer.scan_run WHERE state='running'),
  'runningRunStates',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb)
    FROM (SELECT id,next_batch,batch_size,asset_count,manifest_checksum,request_count,started_at,
      encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') AS row_sha256
      FROM solana_indexer.scan_run s WHERE state='running' ORDER BY id LIMIT 5) r),
  'stage',(SELECT jsonb_build_object('rows',count(*),'sha256',
    encode(sha256(convert_to(COALESCE(string_agg(
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY run_id,mint),''),'UTF8')),'hex'))
    FROM solana_indexer.scan_stage t),
  'ledgerPrefix',(SELECT jsonb_build_object('throughId',b.id::text,
    'rows',(SELECT count(*) FROM prefix),
    'credits',(SELECT COALESCE(sum(credits),0)::text FROM prefix),
    'sha256',(SELECT encode(sha256(convert_to(COALESCE(string_agg(
      encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex'),'' ORDER BY id),''),'UTF8')),'hex') FROM prefix u))
    FROM boundary b),
  'ledgerCurrent',(SELECT jsonb_build_object('rows',count(*),
    'credits',COALESCE(sum(credits),0)::text,'latestId',max(id)::text)
    FROM solana_indexer.rpc_usage),
  'workerLock',jsonb_build_object('granted',(SELECT count(*) FROM worker_lock WHERE granted),
    'waiting',(SELECT count(*) FROM worker_lock WHERE NOT granted)),
  'databaseWrites',0,'providerCalls',0);
ROLLBACK;

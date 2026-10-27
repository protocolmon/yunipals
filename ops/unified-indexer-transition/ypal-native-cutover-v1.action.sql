-- Fixed read-only sample of existing truthful full receipts. No RPC/fabrication.
-- Failure to find a bounded matching BNB action is an explicit prerequisite gap.
WITH evidence AS MATERIALIZED (
 SELECT chain_id,block_number,block_hash,transaction_hash,payload_hash
 FROM yunipals_indexer_control.transaction_evidence
 WHERE chain_id=56 AND payload_hash~'^0x[0-9a-f]{64}$'
 ORDER BY block_hash,transaction_hash LIMIT 64
), known AS (
 SELECT r.name,r.transaction_hash,r.block_number,r.block_hash,r.log_index,
  CASE WHEN octet_length(r.args)<=8192 THEN r.args::jsonb ELSE NULL END AS arguments
 FROM evidence e
 JOIN unified_ypal_20261023_v1.transaction_candidate c
 ON c.id='56:'||e.block_hash||':'||e.transaction_hash AND c.chain_id=e.chain_id
  AND c.block_number=e.block_number AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash
 JOIN unified_ypal_20261023_v1.canonical_event r
 ON r.chain_id=c.chain_id AND r.block_hash=c.block_hash AND r.transaction_hash=c.transaction_hash AND r.block_number=c.block_number
 JOIN unified_ypal_20261023_v1.chain_block b
 ON b.chain_id=r.chain_id AND b.block_number=r.block_number AND b.block_hash=r.block_hash
 WHERE r.source_id='marketplace:bnb:seaport' AND r.name IN('OrderValidated','OrderCancelled')
), selected AS (
 SELECT *,arguments->>'orderHash' AS order_hash,
 CASE WHEN name='OrderValidated' THEN arguments#>>'{orderParameters,offerer}' ELSE arguments->>'offerer' END AS offerer
 FROM known
)
SELECT COALESCE((SELECT jsonb_build_object('format','yunipals-ypal-known-bnb-action-v1',
 'nativeSchema','unified_ypal_20261023_v1','request',jsonb_build_object(
 'version',1,'releaseId','0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
 'readIdentity','0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67',
 'chainId',56,'transactionHash',transaction_hash,'blockNumber',block_number::text,'blockHash',block_hash,
 'action',jsonb_build_object('kind',CASE WHEN name='OrderValidated'THEN'bnb-validate'ELSE'bnb-cancel'END,
 'orderHash',order_hash,'offerer',lower(offerer)))) FROM selected
 WHERE order_hash~'^0x[0-9a-f]{64}$'AND offerer~'^0x[0-9a-fA-F]{40}$'
 ORDER BY block_number DESC,transaction_hash,log_index DESC LIMIT 1),
 jsonb_build_object('format','yunipals-ypal-known-bnb-action-v1','actualFixtureAvailable',false))

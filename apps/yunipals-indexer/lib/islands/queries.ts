import { islandCollection, ZERO_ADDRESS } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";

export function islandTokenRelation(schemaName: string) {
  const schema = sqlIdentifier(schemaName);
  return `${schema}.token t
    LEFT JOIN ${schema}.token_lifecycle l ON l.collection=t.collection
      AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      AND l.mint_block=t.mint_block AND l.mint_timestamp=t.mint_timestamp
    LEFT JOIN ${schema}.transfer_event mint ON mint.collection=l.collection
      AND mint.token_id=l.token_id AND mint.lifecycle=l.lifecycle
      AND mint.transaction_hash=l.mint_transaction_hash AND mint.block_number=l.mint_block
      AND mint.chain_id=t.chain_id AND mint.contract_address=t.contract_address
      AND mint."to"=l.minted_to
      AND mint."from"='${ZERO_ADDRESS}'
    LEFT JOIN metadata.island_publication p ON p.collection=t.collection
      AND p.token_id=t.token_id::numeric AND p.lifecycle=t.lifecycle
      AND p.mint_transaction_hash=mint.transaction_hash AND p.mint_log_index=mint.log_index
    LEFT JOIN metadata_source.island_revision r ON r.revision_hash=p.revision_hash
      AND r.collection=t.collection AND r.token_id=t.token_id::numeric AND r.lifecycle=t.lifecycle
      AND r.mint_transaction_hash=mint.transaction_hash AND r.mint_log_index=mint.log_index`;
}

export const islandTokenColumns = `t.collection AS "collectionId",'ethereum' AS chain,
  t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",
  CASE WHEN t.burned THEN NULL ELSE t.owner END AS owner,t.burned,t.lifecycle,
  t.mint_block::text AS "mintBlock",t.mint_timestamp::text AS "mintTimestamp",
  t.last_transfer_block::text AS "lastTransferBlock",
  t.last_transfer_timestamp::text AS "lastTransferTimestamp",
  t.last_transaction_hash AS "lastTransactionHash",
  CASE WHEN t.token_id::numeric<=${islandCollection.genesisLimit} THEN 'Genesis' ELSE 'Personal' END AS edition,
  CASE WHEN p.status='published' THEN r.document END AS metadata,
  CASE WHEN p.status='retry' THEN 'retry' WHEN r.revision_hash IS NOT NULL THEN p.status ELSE 'pending' END AS "metadataStatus",
  NULL::numeric AS "rarityPoints",NULL::numeric AS "rarityPointsCapped",
  CASE WHEN p.status='published' AND r.revision_hash IS NOT NULL THEN
    jsonb_build_object('sourceKind','archive','tokenUri',r.token_uri,'sourceHash',r.source_hash,
      'contentHash',r.document_hash,'revisionHash',r.revision_hash,'rendererVersion',r.renderer_version,
      'uriBlock',r.uri_block::text,'uriBlockHash',r.uri_block_hash,'metadataStorage',r.metadata_storage,
      'checkedAt',p.uri_checked_at,'checkedBlock',p.uri_checked_block::text) END AS "metadataProvenance"`;

export const islandIdentityPredicate = `t.collection='${islandCollection.slug}'
  AND t.chain_id=${islandCollection.chainId} AND t.contract_address='${islandCollection.address}'`;

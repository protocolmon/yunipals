import { sqlIdentifier } from "../offchain/sql.js";
import { islandColumns, islandTokenRelation } from "./queries.js";
import { stakingColumns, stakingRelation } from "./staking-read.js";
import {
  baseIslandCollection,
  baseIslandReadSchema,
  legacyBaseIslandCollection,
  ethereumIslandCollection,
  type IslandCollection
} from "./collections.js";

export function islandReadModel(
  schemaName: string,
  collection: IslandCollection,
  staking: boolean,
  airdrop: boolean
) {
  const staked = staking && collection.slug === "ethereum-islands";
  let relation = `${islandTokenRelation(schemaName)} ${staked ? stakingRelation(schemaName) : ""}`;
  const counterpart =
    collection.slug === "base-islands-v2"
      ? ethereumIslandCollection
      : baseIslandCollection;
  if (airdrop)
    relation += ` LEFT JOIN metadata.island_airdrop_origin origin ON origin.token_id=t.token_id
    LEFT JOIN LATERAL (SELECT mint.* FROM ${sqlIdentifier(legacyBaseIslandCollection.schemaName)}.transfer_event mint
      WHERE mint.collection='${legacyBaseIslandCollection.slug}' AND mint.chain_id=${legacyBaseIslandCollection.chainId}
      AND mint.contract_address='${legacyBaseIslandCollection.address}'
      AND mint.token_id=origin.token_id AND mint."to"=origin.recipient
      AND mint."from"='0x0000000000000000000000000000000000000000'
      ORDER BY mint.block_number,mint.transaction_index,mint.log_index LIMIT 1) base_mint ON true
    LEFT JOIN metadata.island_replacement_origin replacement ON replacement.token_id=t.token_id
    LEFT JOIN LATERAL (SELECT mint.* FROM ${sqlIdentifier(baseIslandReadSchema())}.transfer_event mint
      WHERE mint.collection='${baseIslandCollection.slug}' AND mint.chain_id=${baseIslandCollection.chainId}
      AND mint.contract_address='${baseIslandCollection.address}'
      AND mint.token_id=replacement.token_id AND mint."to"=replacement.recipient
      AND mint."from"='0x0000000000000000000000000000000000000000'
      ORDER BY mint.block_number,mint.transaction_index,mint.log_index LIMIT 1) replacement_mint ON true`;
  const counterpartSql = airdrop
    ? `CASE WHEN base_mint.id IS NOT NULL AND replacement_mint.id IS NOT NULL THEN jsonb_build_object(
    'collectionId','${counterpart.slug}','chain','${counterpart.chain}','chainId',${counterpart.chainId},
    'contractAddress','${counterpart.address}','tokenId',t.token_id,
    'href','/collection/${counterpart.slug}/'||t.token_id) END`
    : "NULL::jsonb";
  const replacement = airdrop
    ? `CASE WHEN replacement_mint.id IS NOT NULL THEN jsonb_build_object(
    'sourceContract',replacement.source_contract,'snapshotBlock',replacement.snapshot_block::text,
    'snapshotBlockHash',replacement.snapshot_block_hash,'snapshotSha256',replacement.snapshot_sha256,
    'recipient',replacement.recipient,'distributionRoot',replacement.distribution_root,
    'mintTransactionHash',replacement_mint.transaction_hash,'mintBlock',replacement_mint.block_number::text) END`
    : "NULL::jsonb";
  const provenance = airdrop
    ? `CASE WHEN base_mint.id IS NOT NULL THEN jsonb_build_object(
    'snapshotBlock',origin.snapshot_block::text,'snapshotBlockHash',origin.snapshot_block_hash,
    'snapshotSha256',origin.snapshot_sha256,'sourceOwner',origin.source_owner,
    'recipient',origin.recipient,'mintTransactionHash',base_mint.transaction_hash,
    'mintBlock',base_mint.block_number::text) END`
    : "NULL::jsonb";
  return {
    relation,
    columns: `${islandColumns(collection)},
    ${staked ? stakingColumns : "NULL::jsonb AS staking"},'${collection.origin}' AS origin,
    ${counterpartSql} AS counterpart,${provenance} AS airdrop,${replacement} AS replacement`
  };
}

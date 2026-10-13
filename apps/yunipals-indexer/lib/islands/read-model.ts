import { sqlIdentifier } from "../offchain/sql.js";
import { islandColumns, islandTokenRelation } from "./queries.js";
import { stakingColumns, stakingRelation } from "./staking.js";
import {
  baseIslandCollection,
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
    collection.slug === "base-islands"
      ? ethereumIslandCollection
      : baseIslandCollection;
  if (airdrop)
    relation += ` LEFT JOIN metadata.island_airdrop_origin origin ON origin.token_id=t.token_id
    LEFT JOIN ${sqlIdentifier(baseIslandCollection.schemaName)}.transfer_event base_mint
      ON base_mint.token_id=origin.token_id AND base_mint."to"=origin.recipient
      AND base_mint."from"='0x0000000000000000000000000000000000000000'`;
  const counterpartSql = airdrop
    ? `CASE WHEN base_mint.id IS NOT NULL THEN jsonb_build_object(
    'collectionId','${counterpart.slug}','chain','${counterpart.chain}','chainId',${counterpart.chainId},
    'contractAddress','${counterpart.address}','tokenId',t.token_id,
    'href','/collection/${counterpart.slug}/'||t.token_id) END`
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
    ${counterpartSql} AS counterpart,${provenance} AS airdrop`
  };
}

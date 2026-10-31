import { parseMonsterAsset } from "@protopals/yunipals-market-core/monsterVersions";
import { activeVisibilityPredicate } from "../api/visibility-query.js";
import type { PoolClient } from "pg";
import { ownershipBnbSchema, ownershipPonderSchema } from "../offchain/sql.js";
import { solanaStatus } from "../solana/api.js";

export const solanaVersionReadsEnabled = () =>
  process.env.SOLANA_API_ENABLED === "true";
export class SolanaVersionUnavailableError extends Error {}

export async function versionSolanaSnapshot(
  db: Pick<PoolClient, "query">,
  required = false
) {
  if (!required && !solanaVersionReadsEnabled()) return null;
  const status = await solanaStatus(db);
  const release = (
    await db.query<{ release_id: string }>(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
    )
  ).rows[0]?.release_id;
  if (!status.ready || status.metadataReleaseId !== release)
    throw new SolanaVersionUnavailableError("solana_ownership_unavailable");
  return {
    fingerprint: `${status.manifestChecksum}:${status.publishedRunId}`,
    unavailableNfts: status.missingCount ?? 0
  };
}

export function versionVisibility(alias: string, bounded = false) {
  return `(CASE WHEN ${alias}.collection='solana' THEN false ELSE ${activeVisibilityPredicate(alias, bounded)} END)`;
}

export function versionSqlAssetKey(alias: string) {
  return `(CASE WHEN ${alias}.collection='solana' THEN 'solana:'||${alias}.token_id ELSE ${alias}.collection||':'||lower(${alias}.contract_address)||':'||${alias}.token_id END)`;
}

function ownershipSource(
  table: "token" | "token_lifecycle" | "transfer_event",
  columns: string
) {
  if (ownershipPonderSchema === ownershipBnbSchema)
    return `SELECT ${columns} FROM ${ownershipPonderSchema}.${table}`;
  return `SELECT ${columns} FROM ${ownershipPonderSchema}.${table} WHERE collection<>'bnb'
    UNION ALL SELECT ${columns} FROM ${ownershipBnbSchema}.${table} WHERE collection='bnb'`;
}

export function versionTokenSource(
  includeSolana = solanaVersionReadsEnabled()
) {
  const evm = ownershipSource(
    "token",
    "collection,chain_id,contract_address,token_id,owner,burned,lifecycle,mint_block,last_transfer_block"
  );
  return includeSolana
    ? `${evm} UNION ALL SELECT 'solana'::text AS collection,NULL::integer AS chain_id,''::text AS contract_address,t.mint AS token_id,t.owner,t.burnt AS burned,1::integer AS lifecycle,NULL::bigint AS mint_block,NULL::bigint AS last_transfer_block
    FROM solana_indexer.token t JOIN solana_indexer.manifest_asset a ON a.mint=t.mint
    JOIN solana_indexer.manifest m ON m.singleton AND m.release_id=a.release_id
    JOIN solana_indexer.sync_state state ON state.singleton AND state.published_run_id=t.published_run_id`
    : evm;
}

export function versionLifecycleSource() {
  return ownershipSource(
    "token_lifecycle",
    "collection,token_id,lifecycle,minted_to,mint_transaction_hash,mint_block"
  );
}

export function versionTransferSource() {
  return ownershipSource(
    "transfer_event",
    'collection,chain_id,contract_address,token_id,lifecycle,"from","to",transaction_hash,block_number,log_index'
  );
}

export async function versionRevision(db: Pick<PoolClient, "query">) {
  if (process.env.API_MONSTER_VERSIONS_ENABLED !== "true") return null;
  try {
    return (
      (
        await db.query<{
          revision: string;
        }>(`SELECT revision FROM metadata.monster_version_release
      WHERE active AND metadata_release_id=(SELECT release_id FROM metadata_source.archive_release WHERE state='active')`)
      ).rows[0]?.revision ?? null
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    )
      return null;
    throw error;
  }
}

/** Lifecycle and metadata evidence are rechecked at read time, including remints. */
export function versionMembership(revision: string) {
  if (!/^\$[1-9][0-9]*$/.test(revision))
    throw new Error("Invalid SQL parameter.");
  const evm = `SELECT v.* FROM metadata.monster_version_member v
    JOIN metadata.monster_version_release r ON r.revision=v.revision AND r.active
    JOIN metadata_source.archive_release a ON a.release_id=r.metadata_release_id AND a.state='active'
    JOIN metadata_source.lifecycle_binding b ON b.release_id=a.release_id AND b.chain_id=(CASE v.collection WHEN 'base' THEN '8453' WHEN 'ethereum' THEN '1' WHEN 'polygon' THEN '137' ELSE '56' END)
      AND b.contract_address=v.contract_address AND b.token_id=v.token_id
      AND b.mint_transaction_hash=v.mint_transaction_hash AND b.mint_log_index=v.mint_log_index AND b.asset_key=v.asset_key
    WHERE v.revision=${revision} AND v.collection<>'solana' AND EXISTS(SELECT 1 FROM (${versionLifecycleSource()}) l WHERE l.collection=v.collection AND l.token_id=v.token_id AND l.lifecycle=v.lifecycle AND l.mint_transaction_hash=v.mint_transaction_hash)`;
  return solanaVersionReadsEnabled()
    ? `${evm} UNION ALL SELECT v.* FROM metadata.monster_version_member v
    JOIN metadata.monster_version_release r ON r.revision=v.revision AND r.active
    JOIN metadata_source.archive_release archive ON archive.release_id=r.metadata_release_id AND archive.state='active'
    JOIN solana_indexer.manifest m ON m.singleton AND m.release_id=archive.release_id
    JOIN solana_indexer.manifest_asset a ON a.mint=v.token_id AND a.release_id=m.release_id AND a.asset_key=v.asset_key AND a.source_hash=v.evidence->>'memberSourceHash'
    WHERE v.revision=${revision} AND v.collection='solana' AND v.contract_address='' AND v.lifecycle=1`
    : evm;
}

export async function versionSummaries(
  db: Pick<PoolClient, "query">,
  revision: string,
  assets: ReturnType<typeof parseMonsterAsset>[]
) {
  const rows = await db.query<{ key: string; info: unknown }>(
    `WITH tokens AS (${versionTokenSource()}), membership AS (${versionMembership("$1")}), requested AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS a(chain text,"contractAddress" text,"tokenId" text,lifecycle integer)
  ) SELECT CASE WHEN a.chain='solana' THEN 'solana:'||a."tokenId" ELSE a.chain||':'||a."contractAddress"||':'||a."tokenId" END AS key,
    jsonb_build_object('groupId',v.group_id,'revision',$1::text,'role',v.role,'snapshotDate',v.snapshot_date::text,
      'versions',jsonb_agg(jsonb_build_object('chain',related.collection,'contractAddress',NULLIF(related.contract_address,''),'tokenId',related.token_id,'lifecycle',related.lifecycle,'role',related.role,'burned',COALESCE(peer.burned,false),'unavailable',peer.token_id IS NULL) ORDER BY CASE related.role WHEN 'original' THEN 0 WHEN 'version' THEN 1 ELSE 2 END,related.collection,related.token_id)) AS info
    FROM requested a JOIN tokens own ON own.collection=a.chain AND lower(own.contract_address)=COALESCE(a."contractAddress",'') AND own.token_id=a."tokenId" AND own.lifecycle=a.lifecycle
    JOIN membership v ON v.collection=own.collection AND v.contract_address=lower(own.contract_address) AND v.token_id=own.token_id AND v.lifecycle=own.lifecycle
    JOIN membership related ON related.group_id=v.group_id
    LEFT JOIN tokens peer ON peer.collection=related.collection AND lower(peer.contract_address)=related.contract_address AND peer.token_id=related.token_id AND peer.lifecycle=related.lifecycle
    WHERE related.collection='solana' OR (peer.token_id IS NOT NULL AND ((peer.collection=own.collection AND peer.token_id=own.token_id) OR NOT ${versionVisibility("peer")}))
    GROUP BY a.chain,a."contractAddress",a."tokenId",v.group_id,v.role,v.snapshot_date`,
    [revision, JSON.stringify(assets)]
  );
  return Object.fromEntries(rows.rows.map((r) => [r.key, r.info]));
}

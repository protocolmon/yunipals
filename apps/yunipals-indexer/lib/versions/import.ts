import type { PoolClient } from "pg";
import { collections } from "../constants.js";
import {
  versionTokenSource,
  versionLifecycleSource,
  versionTransferSource
} from "./read.js";
import { versionSolanaSnapshot } from "./read.js";
import { parseVersionManifest } from "./manifest.js";
import { monsterVersionMigrations } from "./schema.js";

/** The caller owns the transaction; validation completes before changing the active release. */
export async function storeVersionManifest(
  client: Pick<PoolClient, "query">,
  manifest: ReturnType<typeof parseVersionManifest>,
  revision: string,
  sourceSha: string,
  activate: boolean
) {
  if (
    !(
      await client.query(
        `SELECT 1 FROM metadata_source.archive_release WHERE state='active' AND release_id=$1${activate ? " FOR SHARE" : ""}`,
        [manifest.metadataReleaseId]
      )
    ).rows.length
  )
    throw new Error("The manifest does not match the active metadata release.");
  // Review the historical allocation separately; validate canonical identities in
  // fixed-size batches before publishing any relationship.
  const members = manifest.groups.flatMap((group) =>
    group.members.map((m) => ({
      ...m,
      contractAddress: m.chain === "solana" ? "" : m.contractAddress,
      chainId:
        m.chain === "solana"
          ? "mainnet-beta"
          : String(collections[m.chain].chainId),
      groupId: group.groupId,
      snapshotDate: group.snapshotDate,
      evidence:
        m.chain === "solana"
          ? { ...group.evidence, memberSourceHash: m.sourceHash }
          : group.evidence,
      reconstructed: group.evidence.kind === "base-mint-and-source-identity",
      initialRecipient:
        (
          group.evidence.initialOwners as
            | { tokenId: string; recipient: string }[]
            | undefined
        )?.find((o) => o.tokenId === m.tokenId)?.recipient ?? null
    }))
  );
  const batches = Array.from(
    { length: Math.ceil(members.length / 256) },
    (_, i) => members.slice(i * 256, i * 256 + 256)
  );
  if (members.some((m) => m.chain === "solana"))
    await versionSolanaSnapshot(client, true);
  for (const batch of batches) {
    const solana = batch.filter((m) => m.chain === "solana");
    if (solana.length) {
      const verified = await client.query<{ matched: number }>(
        `SELECT count(*)::int AS matched
        FROM jsonb_to_recordset($2::jsonb) AS x("tokenId" text,"assetKey" text,"sourceHash" text)
        JOIN solana_indexer.manifest_asset a ON a.mint=x."tokenId" AND a.asset_key=x."assetKey" AND a.source_hash=x."sourceHash" AND a.release_id=$1
        JOIN solana_indexer.manifest manifest ON manifest.singleton AND manifest.release_id=a.release_id
        WHERE EXISTS(SELECT 1 FROM metadata_source.source_record r WHERE r.release_id=$1 AND r.asset_key=a.asset_key AND r.legacy_id=a.mint AND r.content_hash=a.source_hash AND r.chain_id='mainnet-beta' AND r.origin_type='GEN1_EXOMON_DROP' AND r.issue IS NULL)`,
        [manifest.metadataReleaseId, JSON.stringify(solana)]
      );
      if (verified.rows[0]?.matched !== solana.length)
        throw new Error(
          "A Solana member has missing or conflicting archive and manifest evidence."
        );
    }
    const evm = batch.filter((m) => m.chain !== "solana");
    if (!evm.length) continue;
    const result = await client.query<{ matched: number }>(
      `WITH input AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS m(chain text,"chainId" text,"contractAddress" text,"tokenId" text,lifecycle integer,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text,role text,reconstructed boolean,"initialRecipient" text)), tokens AS (${versionTokenSource()}), lifecycles AS (${versionLifecycleSource()}), transfers AS (${versionTransferSource()})
      SELECT count(*)::int AS matched FROM input m JOIN tokens t ON t.collection=m.chain AND lower(t.contract_address)=m."contractAddress" AND t.token_id=m."tokenId" AND t.lifecycle=m.lifecycle
      JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=m."chainId" AND b.contract_address=m."contractAddress" AND b.token_id=m."tokenId" AND b.mint_transaction_hash=m."mintTransactionHash" AND b.mint_log_index=m."mintLogIndex" AND b.asset_key=m."assetKey"
      WHERE EXISTS(SELECT 1 FROM lifecycles l JOIN transfers e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle AND e.block_number=l.mint_block
        WHERE l.collection=m.chain AND l.token_id=m."tokenId" AND l.lifecycle=m.lifecycle AND l.mint_transaction_hash=m."mintTransactionHash"
        AND e.chain_id::text=m."chainId" AND lower(e.contract_address)=m."contractAddress" AND e."from"='0x0000000000000000000000000000000000000000'
        AND e.transaction_hash=m."mintTransactionHash" AND e.log_index=m."mintLogIndex"
        AND (NOT m.reconstructed OR m.role<>'airdrop' OR (lower(e."to")=m."initialRecipient" AND lower(l.minted_to)=m."initialRecipient" AND NOT EXISTS(SELECT 1 FROM lifecycles prior WHERE prior.collection=l.collection AND prior.token_id=l.token_id AND prior.lifecycle<l.lifecycle))))
      AND (NOT m.reconstructed OR m.role='airdrop' OR EXISTS(SELECT 1 FROM metadata_source.source_record r WHERE r.release_id=$1 AND r.asset_key=m."assetKey" AND r.issue IS NULL))`,
      [manifest.metadataReleaseId, JSON.stringify(evm)]
    );
    if (result.rows[0]?.matched !== evm.length)
      throw new Error(
        "A member has missing or conflicting canonical mint evidence."
      );
  }
  if (activate) {
    for (const sql of monsterVersionMigrations) await client.query(sql);
    await client.query(
      "UPDATE metadata.monster_version_release SET active=false WHERE active"
    );
    await client.query(
      `INSERT INTO metadata.monster_version_release(revision,metadata_release_id,source_sha256,active) VALUES($1,$2,$3,true)
      ON CONFLICT(revision) DO UPDATE SET active=true`,
      [revision, manifest.metadataReleaseId, sourceSha]
    );
    for (const batch of batches)
      await client.query(
        `INSERT INTO metadata.monster_version_member
      SELECT $1,m."groupId",m.chain,m."contractAddress",m."tokenId",m.lifecycle,m."mintTransactionHash",m."mintLogIndex",m."assetKey",m.role,m."snapshotDate"::date,m.evidence
      FROM jsonb_to_recordset($2::jsonb) AS m("groupId" text,chain text,"contractAddress" text,"tokenId" text,lifecycle integer,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text,role text,"snapshotDate" text,evidence jsonb)
      ON CONFLICT DO NOTHING`,
        [revision, JSON.stringify(batch)]
      );
  }
}

import type { PoolClient } from "pg";
import { monsterAssetKey } from "@protopals/yunipals-market-core/monsterVersions";
import { collections, ZERO_ADDRESS } from "../constants.js";
import { ownershipPonderSchema } from "../offchain/sql.js";
import type { classifyInitialOwner } from "./initial-owners.js";
import { parseVersionManifest } from "./manifest.js";

export type BaseIdentityAudit = Pick<
  ReturnType<typeof classifyInitialOwner>,
  | "tokenId"
  | "lifecycle"
  | "initialMint"
  | "initialOwner"
  | "archivedOriginals"
  | "status"
>;
type Manifest = ReturnType<typeof parseVersionManifest>;

/** Recheck archive identity and canonical Base mint; a wallet match alone is never a link. */
export async function solanaVersionCandidates(
  db: Pick<PoolClient, "query">,
  release: string,
  rows: BaseIdentityAudit[]
) {
  if (rows.length > 500) throw new Error("Invalid Solana version batch.");
  const wanted = rows.flatMap((row) => {
    const originals = row.archivedOriginals.filter(
      (o) => o.chainId === "mainnet-beta" && o.originType === "GEN1_EXOMON_DROP"
    );
    if (!originals.length) return [];
    if (
      new Set(originals.map((o) => o.tokenId)).size !== 1 ||
      row.lifecycle !== 1 ||
      !row.initialMint ||
      row.initialOwner !== row.initialMint.recipient ||
      !["matched", "original_not_indexed"].includes(row.status)
    )
      throw new Error(
        "A Solana relationship needs unambiguous original and initial mint evidence."
      );
    return [
      {
        tokenId: row.tokenId,
        mint: originals[0]!.tokenId,
        sourceHash: originals[0]!.sourceHash,
        ...row.initialMint
      }
    ];
  });
  if (!wanted.length) return [];
  const verified = (
    await db.query<{
      tokenId: string;
      mint: string;
      sourceHash: string;
      assetKey: string;
    }>(
      `WITH input AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x("tokenId" text,mint text,"sourceHash" text,"transactionHash" text,"logIndex" integer,recipient text))
    SELECT x."tokenId",a.mint,a.source_hash AS "sourceHash",a.asset_key AS "assetKey"
    FROM input x JOIN solana_indexer.manifest_asset a ON a.mint=x.mint AND a.release_id=$1 AND a.source_hash=x."sourceHash"
    JOIN solana_indexer.manifest manifest ON manifest.singleton AND manifest.release_id=a.release_id
    JOIN LATERAL(SELECT * FROM ${ownershipPonderSchema}.token t WHERE t.collection='base' AND t.token_id=x."tokenId" AND t.lifecycle=1 AND t.chain_id=8453 AND lower(t.contract_address)=$3 OFFSET 0) t ON true
    JOIN LATERAL(SELECT * FROM ${ownershipPonderSchema}.token_lifecycle l WHERE l.collection='base' AND l.token_id=t.token_id AND l.lifecycle=1 AND l.mint_transaction_hash=x."transactionHash" AND lower(l.minted_to)=x.recipient OFFSET 0) l ON true
    JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id='8453' AND b.contract_address=$3 AND b.token_id=t.token_id AND b.asset_key=a.asset_key AND b.mint_transaction_hash=x."transactionHash" AND b.mint_log_index=x."logIndex"
    JOIN LATERAL(SELECT * FROM ${ownershipPonderSchema}.transfer_event e WHERE e.collection='base' AND e.token_id=t.token_id AND e.lifecycle=1 OFFSET 0) e
      ON e.block_number=l.mint_block AND e.chain_id=8453 AND lower(e.contract_address)=$3 AND e."from"=$4 AND lower(e."to")=x.recipient AND e.transaction_hash=x."transactionHash" AND e.log_index=x."logIndex"
    WHERE EXISTS(SELECT 1 FROM metadata_source.source_record r WHERE r.release_id=$1 AND r.asset_key=a.asset_key AND r.content_hash=a.source_hash AND r.legacy_id=a.mint AND r.chain_id='mainnet-beta' AND r.origin_type='GEN1_EXOMON_DROP' AND r.issue IS NULL)`,
      [release, JSON.stringify(wanted), collections.base.address, ZERO_ADDRESS]
    )
  ).rows;
  if (
    verified.length !== wanted.length ||
    new Set(verified.map((r) => r.tokenId)).size !== wanted.length
  )
    throw new Error(
      "A Solana relationship has missing or conflicting canonical evidence."
    );
  return verified.map((row) => {
    const mint = wanted.find((w) => w.tokenId === row.tokenId)!;
    return {
      original: {
        chain: "solana" as const,
        contractAddress: null,
        tokenId: row.mint,
        lifecycle: 1 as const,
        assetKey: row.assetKey,
        sourceHash: row.sourceHash,
        mintTransactionHash: null,
        mintLogIndex: null,
        role: "original" as const
      },
      base: {
        chain: "base" as const,
        contractAddress: collections.base.address,
        tokenId: row.tokenId,
        lifecycle: 1,
        mintTransactionHash: mint.transactionHash,
        mintLogIndex: mint.logIndex,
        assetKey: row.assetKey,
        sourceHash: null,
        role: "airdrop" as const
      },
      initialOwner: {
        tokenId: row.tokenId,
        recipient: mint.recipient,
        transactionHash: mint.transactionHash,
        logIndex: mint.logIndex
      }
    };
  });
}

/** Merge the three-version cases into one lineage rather than publishing two overlapping pairs. */
export function addSolanaVersionGroups(
  manifest: Manifest,
  candidates: Awaited<ReturnType<typeof solanaVersionCandidates>>,
  auditSha256: string
) {
  const groups = structuredClone(manifest.groups);
  const byAsset = new Map(groups.map((g) => [g.members[0]!.assetKey, g]));
  if (byAsset.size !== groups.length)
    throw new Error("Conflicting original groups share an identity.");
  for (const candidate of candidates) {
    let group = byAsset.get(candidate.original.assetKey);
    if (!group) {
      group = {
        groupId: "",
        snapshotDate: null,
        members: [],
        evidence: {
          kind: "base-mint-and-source-identity",
          source: "canonical Base mint and verified Exomon archive manifest",
          auditSha256,
          initialOwners: []
        }
      };
      groups.push(group);
      byAsset.set(candidate.original.assetKey, group);
    }
    if (
      group.evidence.kind !== "base-mint-and-source-identity" ||
      group.evidence.auditSha256 !== auditSha256
    )
      throw new Error(
        "Solana extension requires the same complete initial mint audit."
      );
    for (const member of group.members)
      if (member.role === "original" && member.chain !== "solana")
        member.role = "version";
    for (const member of [candidate.original, candidate.base]) {
      const prior = group.members.find(
        (m) => monsterAssetKey(m) === monsterAssetKey(member)
      );
      if (!prior) group.members.push(member);
      else if (
        prior.assetKey !== member.assetKey ||
        prior.lifecycle !== member.lifecycle ||
        prior.mintTransactionHash !== member.mintTransactionHash ||
        prior.mintLogIndex !== member.mintLogIndex ||
        prior.sourceHash !== member.sourceHash
      )
        throw new Error("Conflicting Solana group member.");
    }
    const owners = group.evidence
      .initialOwners as (typeof candidate.initialOwner)[];
    const prior = owners.find(
      (o) => o.tokenId === candidate.initialOwner.tokenId
    );
    if (!prior) owners.push(candidate.initialOwner);
    else if (
      prior.recipient !== candidate.initialOwner.recipient ||
      prior.transactionHash !== candidate.initialOwner.transactionHash ||
      prior.logIndex !== candidate.initialOwner.logIndex
    )
      throw new Error("Conflicting initial recipient evidence.");
  }
  return parseVersionManifest({
    version: 1,
    metadataReleaseId: manifest.metadataReleaseId,
    groups
  });
}

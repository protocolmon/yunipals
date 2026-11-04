import { createHash } from "node:crypto";
import {
  parseMonsterAsset,
  monsterAssetKey,
  monsterVersionLimit
} from "@protopals/yunipals-market-core/monsterVersions";
import { collections } from "../constants.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Accept a historical allocation or a reconstruction backed by canonical mints. */
export function parseVersionManifest(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid allocation manifest.");
  const manifest = value as Record<string, unknown>;
  if (
    manifest.version !== 1 ||
    typeof manifest.metadataReleaseId !== "string" ||
    !manifest.metadataReleaseId ||
    !Array.isArray(manifest.groups) ||
    !manifest.groups.length ||
    manifest.groups.length > 500_000
  )
    throw new Error("Invalid allocation manifest.");
  const seen = new Set<string>();
  const groups = manifest.groups.map((raw) => {
    const group = raw as Record<string, unknown>;
    if (
      !group ||
      !Array.isArray(group.members) ||
      group.members.length < 2 ||
      group.members.length > monsterVersionLimit ||
      !group.evidence ||
      typeof group.evidence !== "object"
    )
      throw new Error("Invalid airdrop group.");
    const evidence = group.evidence as Record<string, unknown>;
    const reconstructed = evidence.kind === "base-mint-and-source-identity";
    if (
      typeof evidence.source !== "string" ||
      !evidence.source.trim() ||
      (reconstructed
        ? typeof evidence.auditSha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(evidence.auditSha256) ||
          !Array.isArray(evidence.initialOwners)
        : evidence.kind !== "ownership-snapshot-airdrop" ||
          typeof evidence.snapshotBlock !== "string" ||
          !/^\d+$/.test(evidence.snapshotBlock) ||
          typeof evidence.snapshotBlockHash !== "string" ||
          !/^0x[0-9a-f]{64}$/.test(evidence.snapshotBlockHash) ||
          typeof evidence.allocationSha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(evidence.allocationSha256))
    )
      throw new Error("Airdrop allocation evidence is required.");
    const snapshotDate = group.snapshotDate ?? null;
    if (
      snapshotDate !== null &&
      (typeof snapshotDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ||
        !Number.isFinite(Date.parse(snapshotDate)))
    )
      throw new Error("Invalid snapshot date.");
    if (reconstructed && snapshotDate !== null)
      throw new Error(
        "Mint reconstruction does not establish a snapshot date."
      );
    const members = group.members.map((rawMember) => {
      const asset = parseMonsterAsset(rawMember);
      const m = rawMember as Record<string, unknown>;
      const key = monsterAssetKey(asset);
      if (
        seen.has(key) ||
        (asset.chain !== "solana" &&
          asset.contractAddress !== collections[asset.chain].address) ||
        !["original", "airdrop", "version"].includes(String(m.role)) ||
        (m.role === "airdrop"
          ? asset.chain !== "base"
          : asset.chain === "base") ||
        (asset.chain === "solana"
          ? m.role !== "original" ||
            m.mintTransactionHash !== null ||
            m.mintLogIndex !== null ||
            typeof m.sourceHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(m.sourceHash)
          : typeof m.mintTransactionHash !== "string" ||
            !/^0x[0-9a-f]{64}$/.test(m.mintTransactionHash) ||
            !Number.isSafeInteger(m.mintLogIndex) ||
            Number(m.mintLogIndex) < 0) ||
        typeof m.assetKey !== "string" ||
        !/^[0-9a-f]{64}$/.test(m.assetKey)
      )
        throw new Error("Invalid or conflicting airdrop member.");
      seen.add(key);
      return {
        ...asset,
        role: m.role as "original" | "airdrop" | "version",
        mintTransactionHash:
          asset.chain === "solana" ? null : (m.mintTransactionHash as string),
        mintLogIndex: asset.chain === "solana" ? null : Number(m.mintLogIndex),
        sourceHash: asset.chain === "solana" ? (m.sourceHash as string) : null,
        assetKey: m.assetKey
      };
    });
    const original = members.filter((m) => m.role === "original");
    if (
      original.length !== 1 ||
      !members.some((m) => m.role === "airdrop") ||
      members.some((m) => m.assetKey !== original[0]!.assetKey)
    )
      throw new Error(
        "A group must have one original with verified matching metadata identity."
      );
    if (reconstructed) {
      const initialOwners = evidence.initialOwners as Record<string, unknown>[];
      const baseMembers = members.filter((m) => m.role === "airdrop");
      if (
        initialOwners.length !== baseMembers.length ||
        baseMembers.some(
          (m) =>
            initialOwners.filter(
              (o) =>
                o &&
                o.tokenId === m.tokenId &&
                o.transactionHash === m.mintTransactionHash &&
                o.logIndex === m.mintLogIndex &&
                typeof o.recipient === "string" &&
                /^0x[0-9a-f]{40}$/.test(o.recipient) &&
                !/^0x0{40}$/.test(o.recipient)
            ).length !== 1
        )
      )
        throw new Error(
          "Each Base version needs its own initial mint recipient."
        );
    }
    return {
      groupId: sha(
        original[0]!.chain === "solana"
          ? monsterAssetKey(original[0]!)
          : `${monsterAssetKey(original[0]!)}:${original[0]!.mintTransactionHash}:${original[0]!.mintLogIndex}`
      ),
      members,
      evidence,
      snapshotDate: snapshotDate as string | null
    };
  });
  return { metadataReleaseId: manifest.metadataReleaseId, groups };
}

export function versionEvidenceHash(evidence: Record<string, unknown>) {
  return evidence.kind === "base-mint-and-source-identity"
    ? evidence.auditSha256
    : evidence.allocationSha256;
}

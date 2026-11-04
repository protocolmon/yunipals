import { isIndexedChain, type IndexedChain } from "./collectionTypes";

export type EvmMonsterVersionAsset = {
  chain: IndexedChain;
  contractAddress: `0x${string}`;
  tokenId: string;
  lifecycle: number;
};
export type SolanaMonsterVersionAsset = {
  chain: "solana";
  contractAddress: null;
  tokenId: string;
  lifecycle: 1;
};
export type MonsterVersionAsset =
  | EvmMonsterVersionAsset
  | SolanaMonsterVersionAsset;
export type MonsterVersionChain = MonsterVersionAsset["chain"];
export type MonsterVersionRole = "original" | "airdrop" | "version";
export type MonsterVersionReference = MonsterVersionAsset & {
  role: MonsterVersionRole;
  burned: boolean;
  unavailable?: boolean;
};
export type MonsterVersionInfo = {
  groupId: string;
  revision: string;
  role: MonsterVersionRole;
  versions: MonsterVersionReference[];
  snapshotDate: string | null;
};
export const monsterVersionLimit = 8;

export function monsterAssetKey(asset: {
  chain: MonsterVersionChain;
  contractAddress?: string | null;
  tokenId: string;
}) {
  return asset.chain === "solana"
    ? `solana:${asset.tokenId}`
    : `${asset.chain}:${asset.contractAddress!.toLowerCase()}:${asset.tokenId}`;
}

/** Solana mint and wallet addresses are case-sensitive, base58-encoded 32 bytes. */
export function isSolanaAddress(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    number = number * 58n + BigInt(digit);
  }
  let bytes = 0;
  for (let remaining = number; remaining > 0n; remaining >>= 8n) bytes++;
  return (value.match(/^1*/)?.[0].length ?? 0) + bytes === 32;
}

export function parseMonsterAsset(value: unknown): MonsterVersionAsset {
  if (!value || typeof value !== "object")
    throw new Error("Invalid NFT identity.");
  const a = value as Record<string, unknown>;
  if (a.chain === "solana") {
    if (
      (a.contractAddress !== null && a.contractAddress !== undefined) ||
      typeof a.tokenId !== "string" ||
      !isSolanaAddress(a.tokenId) ||
      a.lifecycle !== 1
    )
      throw new Error("Invalid Solana NFT identity.");
    return {
      chain: "solana",
      contractAddress: null,
      tokenId: a.tokenId,
      lifecycle: 1
    };
  }
  if (
    typeof a.chain !== "string" ||
    !isIndexedChain(a.chain) ||
    typeof a.contractAddress !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(a.contractAddress) ||
    typeof a.tokenId !== "string" ||
    !/^(0|[1-9]\d{0,77})$/.test(a.tokenId) ||
    BigInt(a.tokenId) >= 2n ** 256n ||
    !Number.isSafeInteger(a.lifecycle) ||
    Number(a.lifecycle) < 1
  )
    throw new Error("Invalid NFT identity.");
  return {
    chain: a.chain,
    contractAddress: a.contractAddress.toLowerCase() as `0x${string}`,
    tokenId: a.tokenId,
    lifecycle: Number(a.lifecycle)
  };
}

export function parseMonsterVersionInfo(
  value: unknown,
  asset: MonsterVersionAsset
): MonsterVersionInfo | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object")
    throw new Error("Invalid version information.");
  const info = value as Record<string, unknown>;
  if (
    typeof info.groupId !== "string" ||
    !/^[0-9a-f]{64}$/.test(info.groupId) ||
    typeof info.revision !== "string" ||
    !/^[0-9a-f]{64}$/.test(info.revision) ||
    !["original", "airdrop", "version"].includes(String(info.role)) ||
    !Array.isArray(info.versions) ||
    info.versions.length > monsterVersionLimit ||
    (info.snapshotDate !== null &&
      (typeof info.snapshotDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(info.snapshotDate) ||
        !Number.isFinite(Date.parse(info.snapshotDate))))
  )
    throw new Error("Invalid version information.");
  const versions = info.versions.map((raw): MonsterVersionReference => {
    const a = parseMonsterAsset(raw);
    const r = raw as Record<string, unknown>;
    if (
      !["original", "airdrop", "version"].includes(String(r.role)) ||
      (a.chain === "base" ? r.role !== "airdrop" : r.role === "airdrop") ||
      (r.unavailable !== undefined && typeof r.unavailable !== "boolean") ||
      typeof r.burned !== "boolean"
    )
      throw new Error("Invalid related version.");
    return {
      ...a,
      role: r.role as MonsterVersionRole,
      burned: r.burned,
      unavailable: r.unavailable === true
    };
  });
  const own = versions.find(
    (v) =>
      monsterAssetKey(v) === monsterAssetKey(asset) &&
      v.lifecycle === asset.lifecycle
  );
  if (
    !own ||
    own.role !== info.role ||
    new Set(versions.map(monsterAssetKey)).size !== versions.length ||
    versions.filter((v) => v.role === "original").length > 1
  )
    throw new Error("Version information does not match this NFT.");
  return {
    groupId: info.groupId,
    revision: info.revision,
    role: own.role,
    versions,
    snapshotDate: info.snapshotDate as string | null
  };
}

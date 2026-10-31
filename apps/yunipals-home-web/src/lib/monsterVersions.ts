import { parseCatalogToken } from "@protopals/yunipals-market-core/catalogToken";
import {
  monsterAssetKey,
  parseMonsterVersionInfo,
  monsterVersionLimit,
  type MonsterVersionAsset,
  type MonsterVersionInfo
} from "@protopals/yunipals-market-core/monsterVersions";
import {
  parseMonsterAsset,
  isSolanaAddress
} from "@protopals/yunipals-market-core/monsterVersions";
import {
  record,
  integer,
  array,
  string
} from "@protopals/yunipals-market-core/validation";
import { environment } from "@/environment";
import { IndexerError, type YunipalToken } from "@/lib/yunipalsIndexer";
import type { ConfirmedSettlement } from "@/lib/marketplace/confirmedSettlements";
import type { CollectionToken } from "@/lib/collectionBrowser";
import type { ExomonToken } from "@/lib/solanaIndexer";
export { monsterAssetKey } from "@protopals/yunipals-market-core/monsterVersions";
export type { MonsterVersionInfo } from "@protopals/yunipals-market-core/monsterVersions";

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${environment.yunipalsIndexerUrl}${path}`, {
    signal
  });
  if (!response.ok)
    throw new IndexerError(
      response.status,
      "monster_versions_unavailable",
      response.status === 409
        ? "This page has expired. Refresh the collection."
        : "Monster versions are temporarily unavailable."
    );
  return response.json();
}
export async function fetchVersionCapabilities(signal?: AbortSignal) {
  const data = record(await read("/v1/monster-version-capabilities", signal));
  return data.version === 1 &&
    data.enabled === true &&
    typeof data.revision === "string" &&
    /^[a-f0-9]{64}$/.test(data.revision)
    ? {
        revision: data.revision,
        grouping: data.groupingEnabled === true,
        solanaGrouping: data.solanaGroupingEnabled === true
      }
    : null;
}
export async function fetchVersionSummaries(
  assets: MonsterVersionAsset[],
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  for (const asset of assets)
    params.append("asset", `${monsterAssetKey(asset)}:${asset.lifecycle}`);
  const data = record(await read(`/v1/monster-versions?${params}`, signal));
  const items = record(data.items);
  const result: Record<string, MonsterVersionInfo> = {};
  for (const a of assets) {
    const info = parseMonsterVersionInfo(items[monsterAssetKey(a)], a);
    if (info) {
      if (info.revision !== data.revision)
        throw new Error("Version mapping changed. Refresh the collection.");
      result[monsterAssetKey(a)] = info;
    }
  }
  return result;
}
export type MonsterGroup = { id: string; members: CollectionToken[] };
/** Remove a known sold version while the ownership index catches up. */
export function applyVersionSettlements(
  group: MonsterGroup,
  settlements: readonly ConfirmedSettlement[]
): MonsterGroup | null {
  const members = group.members.filter(
    (member) =>
      !settlements.some(
        (change) =>
          member.chain !== "solana" &&
          !change.synced &&
          monsterAssetKey(member) === monsterAssetKey(change.asset) &&
          /^\d+$/.test(member.lastTransferBlock) &&
          BigInt(member.lastTransferBlock) <= BigInt(change.blockNumber) &&
          member.owner.toLowerCase() !== change.to.toLowerCase()
      )
  );
  return members.length ? { ...group, members } : null;
}
export type MonsterGroupPage = {
  revision: string;
  groups: MonsterGroup[];
  groupTotal: number;
  nftTotal: number;
  unavailableNfts: number;
  nextCursor: string | null;
  previousCursor: string | null;
};

export function monsterTokenAsset(token: CollectionToken): MonsterVersionAsset {
  return token.chain === "solana"
    ? {
        chain: "solana",
        contractAddress: null,
        tokenId: token.tokenId,
        lifecycle: 1
      }
    : token;
}

function parseSolanaGroupToken(value: unknown): ExomonToken {
  const data = record(value),
    asset = parseMonsterAsset(data);
  if (
    asset.chain !== "solana" ||
    data.hidden !== false ||
    data.burned !== false ||
    typeof data.owner !== "string" ||
    !isSolanaAddress(data.owner)
  )
    throw new Error("Invalid Solana holding.");
  const nullable = (value: unknown, max = 256) =>
    value === null ? null : string(value, max);
  const rarity = (value: unknown) => {
    const text = nullable(value, 80);
    if (text !== null && !/^\d{1,80}(\.\d{1,30})?$/.test(text))
      throw new Error("Invalid Solana rarity.");
    return text;
  };
  const image = nullable(data.image, 2048);
  if (image) {
    const url = new URL(image, "https://yunipals.com");
    if (
      !["http:", "https:", "ipfs:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid artwork URL.");
  }
  const observed = string(data.ownershipObservedAt, 64);
  if (!Number.isFinite(Date.parse(observed)))
    throw new Error("Invalid Solana ownership observation.");
  return {
    chain: "solana",
    tokenId: asset.tokenId,
    owner: data.owner,
    burned: false,
    name: nullable(data.name),
    image,
    attributes:
      data.attributes === null
        ? null
        : array(
            data.attributes,
            (raw) => {
              const a = record(raw),
                value = a.value;
              if (
                value !== null &&
                typeof value !== "boolean" &&
                !(typeof value === "number" && Number.isFinite(value)) &&
                !(typeof value === "string" && value.length <= 512)
              )
                throw new Error("Invalid Solana trait.");
              return { trait_type: string(a.trait_type, 128), value };
            },
            64
          ),
    rarityPoints: rarity(data.rarityPoints),
    rarityPointsCapped: rarity(data.rarityPointsCapped),
    tokenUri: nullable(data.tokenUri, 2048),
    legacyAlias: nullable(data.legacyAlias, 80),
    ownershipObservedAt: observed,
    versionInfo: parseMonsterVersionInfo(data.versionInfo, asset)
  };
}

export function parseMonsterGroupPage(
  value: unknown,
  params: URLSearchParams
): MonsterGroupPage {
  const data = record(value);
  const query = new URLSearchParams(params);
  query.delete("cursor");
  query.sort();
  if (data.query !== query.toString())
    throw new Error("Monster groups do not match the requested filters.");
  if (
    data.version !== 1 ||
    typeof data.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.revision)
  )
    throw new Error("Invalid monster group response.");
  const resolved = record(data.resolvedAddresses);
  const hidden = params.get("visibility") === "hidden";
  const chains = params.getAll("chain");
  const seen = new Set<string>();
  const groups = array(
    data.groups,
    (raw): MonsterGroup => {
      const g = record(raw);
      const id = string(g.id, 200);
      const members = array(
        g.members,
        (rawMember): CollectionToken => {
          const m = record(rawMember);
          if (m.hidden !== hidden)
            throw new Error("Invalid version visibility.");
          const token =
            m.chain === "solana"
              ? parseSolanaGroupToken(m)
              : {
                  ...parseCatalogToken({ ...m, hidden: false }),
                  hidden
                };
          const key = monsterAssetKey(token);
          if (
            seen.has(key) ||
            (chains.length && !chains.includes(token.chain)) ||
            (params.has("owner") &&
              (token.chain === "solana"
                ? token.owner !== resolved.solana
                : token.owner.toLowerCase() !==
                  String(resolved[token.chain]).toLowerCase())) ||
            (token.versionInfo &&
              (token.versionInfo.groupId !== id ||
                token.versionInfo.revision !== data.revision))
          )
            throw new Error("Version group does not match this view.");
          seen.add(key);
          return token;
        },
        monsterVersionLimit
      );
      if (
        !members.length ||
        (members.length > 1 && members.some((m) => !m.versionInfo)) ||
        (!members[0]!.versionInfo &&
          id !== `nft:${monsterAssetKey(members[0]!)}`)
      )
        throw new Error("Invalid monster group.");
      return { id, members };
    },
    24
  );
  if (new Set(groups.map((g) => g.id)).size !== groups.length)
    throw new Error("Repeated monster group.");
  const groupTotal = integer(data.groupTotal),
    nftTotal = integer(data.nftTotal);
  if (
    groupTotal < groups.length ||
    nftTotal < groupTotal ||
    nftTotal < seen.size
  )
    throw new Error("Invalid version counts.");
  const cursor = (v: unknown) => {
    if (v === null) return null;
    const next = string(v, 2048);
    if (!next || next === params.get("cursor"))
      throw new Error("Invalid version cursor.");
    return next;
  };
  return {
    revision: data.revision,
    groups,
    groupTotal,
    nftTotal,
    unavailableNfts:
      data.unavailableNfts === undefined ? 0 : integer(data.unavailableNfts),
    nextCursor: cursor(data.nextCursor),
    previousCursor: cursor(data.previousCursor)
  };
}
export async function fetchMonsterGroups(
  params: URLSearchParams,
  signal?: AbortSignal
) {
  return parseMonsterGroupPage(
    await read(`/v1/monster-groups?${params}`, signal),
    params
  );
}

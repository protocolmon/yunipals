import { parseCollectionFilters } from "../../../../packages/yunipals-market-core/src/collectionFilters";
import {
  monsterAssetKey,
  type MonsterVersionInfo
} from "../../../../packages/yunipals-market-core/src/monsterVersions";
import type { YunipalToken } from "../../src/lib/yunipalsIndexer";
import type { CollectionToken } from "../../src/lib/collectionBrowser";
import { fixtureSolanaTokens } from "./solana";

export const fixtureVersionRevision = "a".repeat(64);
export function versionFixture(url: URL, tokens: YunipalToken[]) {
  const allTokens: CollectionToken[] = [...tokens, ...fixtureSolanaTokens];
  const path = url.pathname.replace("/__fixtures/indexer", "");
  if (!path.startsWith("/v1/monster-")) return null;
  const ok = (body: unknown) => ({ status: 200, body });
  if (path === "/v1/monster-version-capabilities")
    return ok({
      version: 1,
      enabled: true,
      groupingEnabled: true,
      solanaGroupingEnabled: true,
      revision: fixtureVersionRevision
    });
  const infoFor = (token: CollectionToken): MonsterVersionInfo | undefined => {
    const solanaPair = fixtureSolanaTokens
      .slice(0, 2)
      .findIndex((solana, index) =>
        token.chain === "solana"
          ? token.tokenId === solana.tokenId
          : token.tokenId === String(index + 7) &&
            (token.chain === "base" ||
              (index === 0 && token.chain === "polygon"))
      );
    if (solanaPair >= 0) {
      const original = fixtureSolanaTokens[solanaPair]!;
      const versions = allTokens.filter((t) =>
        t.chain === "solana"
          ? t.tokenId === original.tokenId
          : t.tokenId === String(solanaPair + 7) &&
            (t.chain === "base" || (solanaPair === 0 && t.chain === "polygon"))
      );
      return {
        groupId: String(solanaPair + 101).padStart(64, "0"),
        revision: fixtureVersionRevision,
        role:
          token.chain === "solana"
            ? "original"
            : token.chain === "base"
              ? "airdrop"
              : "version",
        snapshotDate: null,
        versions: versions.map((t) =>
          t.chain === "solana"
            ? {
                chain: "solana",
                tokenId: t.tokenId,
                contractAddress: null,
                lifecycle: 1,
                role: "original",
                burned: false
              }
            : {
                ...t,
                role: t.chain === "base" ? "airdrop" : "version",
                burned: false
              }
        )
      };
    }
    if (token.chain === "solana") return undefined;
    if (
      !["base", "ethereum"].includes(token.chain) ||
      Number(token.tokenId) > 6
    )
      return undefined;
    return {
      groupId: token.tokenId.padStart(64, "0"),
      revision: fixtureVersionRevision,
      role: token.chain === "base" ? "airdrop" : "original",
      snapshotDate: null,
      versions: tokens
        .filter(
          (t) =>
            ["base", "ethereum"].includes(t.chain) &&
            t.tokenId === token.tokenId
        )
        .map((t) => ({
          chain: t.chain,
          contractAddress: t.contractAddress,
          tokenId: t.tokenId,
          lifecycle: t.lifecycle,
          role: t.chain === "base" ? "airdrop" : "original",
          burned: false
        }))
    };
  };
  if (path === "/v1/monster-versions")
    return ok({
      revision: fixtureVersionRevision,
      items: Object.fromEntries(
        allTokens
          .filter((t) =>
            url.searchParams
              .getAll("asset")
              .includes(
                `${monsterAssetKey(t)}:${t.chain === "solana" ? 1 : t.lifecycle}`
              )
          )
          .map((t) => [monsterAssetKey(t), infoFor(t)])
      )
    });
  if (path !== "/v1/monster-groups") return null;
  const p = url.searchParams,
    filters = parseCollectionFilters(p);
  const owner = p.get("owner");
  const sort = filters.sort;
  const compare = (a: CollectionToken, b: CollectionToken) => {
    const score = sort.startsWith("rarity")
      ? (Number(a.rarityPointsCapped) - Number(b.rarityPointsCapped)) *
        (sort.endsWith("desc") ? -1 : 1)
      : 0;
    return (
      score ||
      ((a.chain === "solana") !== (b.chain === "solana")
        ? a.chain === "solana"
          ? 1
          : -1
        : a.chain === "solana"
          ? a.tokenId < b.tokenId
            ? -1
            : a.tokenId > b.tokenId
              ? 1
              : 0
          : Number(a.tokenId) - Number(b.tokenId)) *
        (sort === "token-id-desc" ? -1 : 1) ||
      a.chain.localeCompare(b.chain)
    );
  };
  const selectedChains = p.getAll("chain");
  const matches = allTokens.filter(
    (t) =>
      (!selectedChains.length || selectedChains.includes(t.chain)) &&
      (!owner || t.owner === owner) &&
      p.get("visibility") !== "hidden" &&
      (!p.get("q") || t.tokenId === p.get("q")) &&
      Object.entries(filters.traits).every(([trait, values]) =>
        t.attributes?.some(
          (a) => a.trait_type === trait && values.includes(String(a.value))
        )
      ) &&
      (!filters.rarityMin ||
        Number(t.rarityPointsCapped) >= Number(filters.rarityMin)) &&
      (!filters.rarityMax ||
        Number(t.rarityPointsCapped) <= Number(filters.rarityMax))
  );
  const groups = new Map<string, CollectionToken[]>();
  for (const t of [...matches].sort(compare)) {
    const versionInfo = infoFor(t),
      id = versionInfo?.groupId ?? `nft:${monsterAssetKey(t)}`;
    const member =
      t.chain === "solana"
        ? {
            ...t,
            contractAddress: null,
            lifecycle: 1,
            hidden: false,
            versionInfo
          }
        : { ...t, versionInfo };
    groups.set(id, [...(groups.get(id) ?? []), member]);
  }
  const all = [...groups]
    .map(([id, members]) => ({ id, members }))
    .sort((a, b) => compare(a.members[0]!, b.members[0]!));
  const offset = Number((p.get("cursor") ?? "page-0").replace("page-", ""));
  const query = new URLSearchParams(p);
  query.delete("cursor");
  query.sort();
  return ok({
    version: 1,
    revision: fixtureVersionRevision,
    query: query.toString(),
    groupTotal: groups.size,
    nftTotal: matches.length,
    groups: all.slice(offset, offset + 24),
    nextCursor: offset + 24 < all.length ? `page-${offset + 24}` : null,
    previousCursor: offset > 0 ? `page-${Math.max(0, offset - 24)}` : null,
    resolvedAddresses: Object.fromEntries(
      ["base", "ethereum", "polygon", "bnb", "solana"].map((c) => [c, owner])
    )
  });
}

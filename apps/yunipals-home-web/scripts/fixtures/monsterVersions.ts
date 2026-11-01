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
  return null;
}

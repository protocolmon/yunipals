import type { ExomonToken } from "@/lib/solanaIndexer";

const prefix = "/__fixtures/indexer";
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const stamp = "2026-01-01T00:00:00.000Z";
export const fixtureSolanaOwners = [
  "1".repeat(31) + "Z",
  "1".repeat(31) + "Y"
] as const;
export const fixtureSolanaTokens: ExomonToken[] = Array.from(
  { length: 36 },
  (_, index) => ({
    chain: "solana",
    tokenId: "1".repeat(31) + alphabet[index]!,
    owner: fixtureSolanaOwners[index % 2]!,
    burned: false,
    name: `Sample Exomon #${index + 1}`,
    image: "/__fixtures/artwork.svg",
    attributes: [
      { trait_type: "Type", value: index % 2 ? "Water" : "Fire" },
      { trait_type: "Color", value: index % 3 ? "Blue" : "Red" }
    ],
    rarityPoints: String(500 - index * 10),
    rarityPointsCapped: String(500 - index * 10),
    legacyAlias: null,
    tokenUri: null,
    ownershipObservedAt: stamp
  })
);
export const fixtureSolanaBurnedToken: ExomonToken = {
  ...fixtureSolanaTokens[0]!,
  tokenId: "1".repeat(31) + "z",
  owner: null,
  burned: true,
  name: "Sample Burned Exomon"
};
export const fixtureSolanaUnknownMint = "1".repeat(31) + "y";

type FixtureResponse = { status: number; body: unknown };
const ok = (body: unknown): FixtureResponse => ({ status: 200, body });
const error = (status: number, code: string): FixtureResponse => ({
  status,
  body: { error: code }
});
const page = <T>(rows: T[], offset: number, limit: number) => ({
  items: rows.slice(offset, offset + limit),
  nextCursor: offset + limit < rows.length ? String(offset + limit) : null
});

export function solanaFixtureResponse(url: URL): FixtureResponse | null {
  const path = url.pathname;
  const params = url.searchParams;
  if (
    !params.getAll("chain").includes("solana") &&
    !path.startsWith(`${prefix}/v1/tokens/solana/`)
  )
    return null;
  if (path === `${prefix}/v1/indexing-status`)
    return ok({
      enabled: true,
      ready: true,
      freshness: "fresh",
      publishedAt: stamp,
      missingCount: 1,
      lastError: null
    });
  if (path === `${prefix}/v1/collection`)
    return ok({
      chain: "solana",
      chains: ["solana"],
      collection: "exomon",
      knownTokens: 38,
      indexedTokens: 37,
      activeSupply: 36,
      burnedTokens: 1,
      missingCount: 1,
      ownershipObservedAt: stamp
    });
  if (path === `${prefix}/v1/traits`) {
    return ok({
      chain: "solana",
      metadata: { available: fixtureSolanaTokens.length, missing: 0 },
      updatedAt: stamp,
      items: ["Type", "Color"].map((traitType) => ({
        traitType,
        kind: "categorical",
        values: [
          ...new Set(
            fixtureSolanaTokens.map((token) =>
              String(
                token.attributes?.find(
                  (attribute) => attribute.trait_type === traitType
                )?.value
              )
            )
          )
        ].map((value) => ({
          value,
          count: fixtureSolanaTokens.filter((token) =>
            token.attributes?.some(
              (attribute) =>
                attribute.trait_type === traitType && attribute.value === value
            )
          ).length
        }))
      }))
    });
  }
  if (path.startsWith(`${prefix}/v1/tokens/solana/`)) {
    const mint = decodeURIComponent(
      path.slice(`${prefix}/v1/tokens/solana/`.length)
    );
    if (mint === fixtureSolanaUnknownMint)
      return error(503, "solana_ownership_unavailable");
    const token =
      mint === fixtureSolanaBurnedToken.tokenId
        ? fixtureSolanaBurnedToken
        : fixtureSolanaTokens.find((item) => item.tokenId === mint);
    return token
      ? ok({
          chain: "solana",
          token: {
            ...token,
            document: {
              description: "A fictional Exomon for local development."
            }
          },
          observedChanges: [],
          transfers: [],
          lifecycles: [],
          historyMode: "observed_changes"
        })
      : error(404, "Token not found");
  }
  const metric = path.startsWith(`${prefix}/v1/leaderboards/`)
    ? path.slice(`${prefix}/v1/leaderboards/`.length)
    : null;
  const ownerMatch = path.match(
    /^\/__fixtures\/indexer\/v1\/owners\/([^/]+)\/(tokens|leaderboard)$/
  );
  if (params.get("cursor") === "expired") return error(409, "cursor_expired");
  const offset = Number(params.get("cursor") ?? 0);
  const limit = Math.min(100, Number(params.get("limit") ?? 24));
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    return error(400, "invalid_cursor");
  const owner = ownerMatch
    ? decodeURIComponent(ownerMatch[1]!)
    : params.get("owner");
  const rows = fixtureSolanaTokens
    .filter(() => params.get("metadata") !== "missing")
    .filter((token) => !owner || token.owner === owner)
    .filter((token) => {
      const groups = new Map<string, string[]>();
      const types = params.getAll("traitType"),
        values = params.getAll("traitValue");
      if (types.length !== values.length) return false;
      for (let index = 0; index < types.length; index++)
        groups.set(types[index]!, [
          ...(groups.get(types[index]!) ?? []),
          values[index]!
        ]);
      return (
        [...groups].every(([type, selections]) =>
          token.attributes?.some(
            (attribute) =>
              attribute.trait_type === type &&
              selections.includes(String(attribute.value))
          )
        ) &&
        (!params.get("rarityCappedMin") ||
          Number(token.rarityPointsCapped) >=
            Number(params.get("rarityCappedMin"))) &&
        (!params.get("rarityCappedMax") ||
          Number(token.rarityPointsCapped) <=
            Number(params.get("rarityCappedMax"))) &&
        (!params.get("rarityMin") ||
          Number(token.rarityPoints) >= Number(params.get("rarityMin"))) &&
        (!params.get("rarityMax") ||
          Number(token.rarityPoints) <= Number(params.get("rarityMax")))
      );
    });
  const sort = params.get("sort") ?? "token-id-asc";
  rows.sort((a, b) =>
    sort.startsWith("token-id")
      ? (sort.endsWith("desc") ? -1 : 1) *
        (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0)
      : (sort.endsWith("desc") ? -1 : 1) *
        (Number(a.rarityPointsCapped) - Number(b.rarityPointsCapped))
  );
  if (path === `${prefix}/v1/tokens` || ownerMatch?.[2] === "tokens")
    return ok({
      chain: "solana",
      chains: ["solana"],
      owner,
      ...page(rows, offset, limit),
      total: rows.length,
      ownershipObservedAt: stamp,
      historyMode: "observed_changes"
    });
  const stats = fixtureSolanaOwners.map((address) => {
    const owned = fixtureSolanaTokens.filter(
      (token) => token.owner === address
    );
    const totalRarity = String(
      owned.reduce((sum, token) => sum + Number(token.rarityPoints), 0)
    );
    return {
      owner: address,
      monsterCount: owned.length,
      totalRarity,
      uniqueTypes: 1,
      specialCount: 0,
      glitterCount: 0,
      collectorScore: totalRarity,
      rank: address === fixtureSolanaOwners[0] ? 1 : 2
    };
  });
  if (path === `${prefix}/v1/leaderboards`)
    return ok({ chain: "solana", items: [], wallets: 2, updatedAt: stamp });
  if (metric) {
    const field = {
      "collector-score": "collectorScore",
      "total-rarity": "totalRarity",
      "monster-count": "monsterCount",
      "unique-types": "uniqueTypes",
      "special-count": "specialCount",
      "glitter-count": "glitterCount"
    }[metric] as keyof (typeof stats)[number] | undefined;
    if (!field) return error(404, "Unknown leaderboard");
    const ranked = stats
      .map((row) => ({ ...row, score: String(row[field]) }))
      .sort((a, b) => Number(b.score) - Number(a.score));
    return ok({
      chain: "solana",
      metric,
      label: metric,
      ...page(ranked, offset, limit),
      updatedAt: stamp
    });
  }
  if (ownerMatch?.[2] === "leaderboard") {
    const row = stats.find((item) => item.owner === owner);
    return row
      ? ok({
          ...row,
          chain: "solana",
          totalRarityRank: row.rank,
          monsterCountRank: row.rank,
          uniqueTypesRank: 1,
          specialCountRank: 1,
          glitterCountRank: 1,
          collectorScoreRank: row.rank
        })
      : error(404, "Wallet has no active Exomon");
  }
  return error(404, "fixture_unavailable");
}

import {
  collectorFiltersKey,
  parseCollectorFilters
} from "../../../../packages/yunipals-market-core/src/collectorFilters";
import { indexedChains } from "../../../../packages/yunipals-market-core/src/collectionTypes";
import type { YunipalToken } from "@/lib/yunipalsIndexer";

export const collectorFixtureOwner =
  "0x000000000000000000000000000000000000000c";

function compareDecimal(left: string, right: string) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const width = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = BigInt(`${leftInteger}${leftFraction.padEnd(width, "0")}`);
  const normalizedRight = BigInt(
    `${rightInteger}${rightFraction.padEnd(width, "0")}`
  );
  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
}
export function largeCollectorFixture(samples: YunipalToken[]) {
  return indexedChains.flatMap((chain) =>
    Array.from(
      { length: 32 },
      (_, index): YunipalToken => ({
        ...samples.find((token) => token.chain === chain)!,
        owner: collectorFixtureOwner,
        tokenId: String(index + 1),
        name: `Sample ${["Water", "Fire", "Earth"][index % 3]} ${index + 1}`,
        attributes: [
          { trait_type: "Type", value: ["Water", "Fire", "Earth"][index % 3] },
          { trait_type: "Color", value: index % 2 ? "Red" : "Blue" }
        ],
        hidden: index % 11 === 0,
        rarityPoints:
          index > 28 ? null : String(100 + Math.floor(index / 3) * 10),
        rarityPointsCapped:
          index > 25 ? null : String(100 + Math.floor(index / 3) * 5)
      })
    )
  );
}

export function collectorFixturePage(url: URL, samples: YunipalToken[]) {
  const fail = (status: number, error: string) => ({ status, body: { error } });
  try {
    const params = url.searchParams;
    const filters = parseCollectorFilters(params);
    const chains = filters.chains.length ? filters.chains : [...indexedChains];
    const owner = decodeURIComponent(
      url.pathname.split("/").at(-2)!
    ).toLowerCase();
    const visibility = params.get("visibility") ?? "visible";
    const limit = Number(params.get("limit") ?? 24);
    if (
      !["visible", "hidden"].includes(visibility) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 48
    )
      return fail(400, "invalid_collector_query");
    const query = collectorFiltersKey(filters);
    const source =
      owner === collectorFixtureOwner
        ? largeCollectorFixture(samples)
        : samples;
    const rows = source
      .filter((token) => {
        const trait = (name: string, values: string[]) =>
          !values.length ||
          token.attributes?.some(
            (attribute) =>
              attribute.trait_type === name &&
              values.includes(String(attribute.value))
          );
        const rarity = token.rarityPointsCapped ?? token.rarityPoints;
        const matchesRarity =
          (!filters.rarityMin && !filters.rarityMax) ||
          (rarity !== null &&
            (!filters.rarityMin ||
              compareDecimal(rarity, filters.rarityMin) >= 0) &&
            (!filters.rarityMax ||
              compareDecimal(rarity, filters.rarityMax) <= 0));
        return (
          token.owner === owner &&
          !token.burned &&
          Boolean(token.hidden) === (visibility === "hidden") &&
          chains.includes(token.chain) &&
          trait("Type", filters.types) &&
          trait("Color", filters.colors) &&
          matchesRarity &&
          (!filters.search ||
            (/^\d+$/.test(filters.search)
              ? token.tokenId === filters.search
              : token.name?.toLowerCase().startsWith(filters.search)))
        );
      })
      .sort((left, right) => {
        const a = left.rarityPointsCapped ?? left.rarityPoints;
        const b = right.rarityPointsCapped ?? right.rarityPoints;
        if (a === null && b !== null) return 1;
        if (b === null && a !== null) return -1;
        const rarity = Number(a) - Number(b);
        if (rarity) return filters.sort.endsWith("asc") ? rarity : -rarity;
        return (
          Number(BigInt(left.tokenId) - BigInt(right.tokenId)) ||
          left.chain.localeCompare(right.chain)
        );
      });
    let start = 0;
    const rawCursor = params.get("cursor");
    if (rawCursor) {
      try {
        const cursor = JSON.parse(
          Buffer.from(rawCursor, "base64url").toString()
        ) as {
          owner: string;
          visibility: string;
          query: string;
          start: number;
        };
        if (
          cursor.owner !== owner ||
          cursor.visibility !== visibility ||
          cursor.query !== query ||
          !Number.isInteger(cursor.start) ||
          cursor.start < 0
        )
          throw new Error();
        start = cursor.start;
      } catch {
        return fail(409, "invalid_collector_cursor");
      }
    }
    const encode = (offset: number) =>
      Buffer.from(
        JSON.stringify({ owner, visibility, query, start: offset })
      ).toString("base64url");
    return {
      status: 200,
      body: {
        version: 1,
        query,
        owner,
        ownerInput: owner,
        ownerName: null,
        resolvedAddresses: Object.fromEntries(
          chains.map((chain) => [chain, owner])
        ),
        chains,
        chain: chains.length === 1 ? chains[0] : null,
        visibility,
        items: rows.slice(start, start + limit),
        previousCursor: start > 0 ? encode(Math.max(0, start - limit)) : null,
        nextCursor: start + limit < rows.length ? encode(start + limit) : null
      }
    };
  } catch {
    return fail(400, "invalid_collector_query");
  }
}

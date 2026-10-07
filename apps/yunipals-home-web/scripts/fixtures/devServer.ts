import { createHash } from "node:crypto";
import type { Plugin } from "vite";

import {
  collectionFiltersKey,
  parseCollectionFilters
} from "../../../../packages/yunipals-market-core/src/collectionFilters";
import { validateCatalogFilters } from "../../../../packages/yunipals-market-core/src/catalogFilters";
import { marketplaceChains } from "../../../../packages/yunipals-market-core/src/registry";
import { indexedChains } from "../../../../packages/yunipals-market-core/src/collectionTypes";
import type { YunipalToken } from "@/lib/yunipalsIndexer";

import {
  collectorFixtureOwner,
  collectorFixturePage,
  largeCollectorFixture
} from "./collector";
import { solanaFixtureResponse } from "./solana";

const updatedAt = "2026-01-01T00:00:00.000Z";
export const fixtureOwners = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002"
] as const;
const types = ["Water", "Fire", "Earth"];
export const fixtureTokens: YunipalToken[] = indexedChains.flatMap((chain) =>
  Array.from({ length: 12 }, (_, index) => ({
    chain,
    chainId: marketplaceChains[chain].chainId,
    contractAddress: marketplaceChains[chain].contractAddress,
    tokenId: String(index + 1),
    owner: fixtureOwners[index % 2]!,
    burned: false,
    hidden: false,
    lifecycle: 1,
    mintBlock: "1",
    lastTransferBlock: "1",
    name: `Sample ${types[index % 3]} ${index + 1}`,
    image: index === 11 ? null : "/__fixtures/artwork.svg",
    attributes: [
      { trait_type: "Type", value: types[index % 3] },
      { trait_type: "Color", value: index % 2 ? "Red" : "Blue" }
    ],
    tokenUri: null,
    metadataAvailable: index !== 11,
    rarityPoints: String(100 + index * 10),
    rarityPointsCapped: String(100 + index * 5)
  }))
);
const metrics = {
  "collector-score": ["Collector score", "collectorScore"],
  "total-rarity": ["Total rarity", "totalRarity"],
  "monster-count": ["Monster count", "monsterCount"],
  "unique-types": ["Unique types", "uniqueTypes"],
  "special-count": ["Special count", "specialCount"],
  "glitter-count": ["Glitter count", "glitterCount"]
} as const;
type Metric = keyof typeof metrics;

function ranks(tokens: YunipalToken[], metric: Metric = "collector-score") {
  return [...new Set(tokens.map((token) => token.owner))]
    .map((owner) => {
      const owned = tokens.filter((token) => token.owner === owner);
      const totalRarity = owned.reduce(
        (sum, token) => sum + Number(token.rarityPoints),
        0
      );
      const values = {
        monsterCount: owned.length,
        totalRarity: String(totalRarity),
        uniqueTypes: new Set(owned.map((token) => token.attributes?.[0]?.value))
          .size,
        specialCount: 0,
        glitterCount: 0,
        collectorScore: String(totalRarity)
      };
      return {
        ...values,
        owner,
        ensName: null,
        updatedAt,
        score: String(values[metrics[metric][1]])
      };
    })
    .sort((a, b) => Number(b.score) - Number(a.score))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

type FixtureResponse = { status: number; body: unknown };

/** Local synthetic reads only; unknown routes never proxy to a live service. */
export function fixtureResponse(url: URL, method = "GET"): FixtureResponse {
  const ok = (body: unknown): FixtureResponse => ({ status: 200, body });
  const error = (status: number, message: string): FixtureResponse => ({
    status,
    body: { error: "fixture_unavailable", message }
  });
  if (method !== "GET") return error(405, "Fixtures are read-only.");
  const solana = solanaFixtureResponse(url);
  if (solana) return solana;
  if (url.pathname === "/__fixtures/indexer/v1/collector-capabilities")
    return ok({ version: 1, namePrefixSearch: true, rarityRange: true });
  if (/^\/__fixtures\/indexer\/v2\/owners\/[^/]+\/tokens$/.test(url.pathname))
    return collectorFixturePage(url, fixtureTokens);
  const params = url.searchParams;
  const selected = indexedChains.filter(
    (chain) => !params.has("chain") || params.getAll("chain").includes(chain)
  );
  const selection = {
    chains: selected,
    chain: selected.length === 1 ? selected[0] : null
  };
  const tokens = fixtureTokens.filter((token) =>
    selected.includes(token.chain)
  );
  const offset = Number(params.get("cursor") ?? 0);
  const limit = Math.min(100, Number(params.get("limit") ?? 24));
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    return error(400, "Invalid fixture pagination.");
  const page = <T>(rows: T[]) => ({
    items: rows.slice(offset, offset + limit),
    nextCursor: offset + limit < rows.length ? String(offset + limit) : null
  });
  const path = url.pathname;
  if (path === "/__fixtures/market/v1/market/capabilities")
    return ok({
      schemaVersion: 1,
      chains: Object.fromEntries(
        indexedChains.map((chain) => [
          chain,
          {
            read: false,
            buy: false,
            createListing: false,
            createOffer: false,
            cancel: false,
            acceptOffer: false
          }
        ])
      )
    });
  if (path === "/__fixtures/market/v2/market/tokens") {
    const filters = parseCollectionFilters(params);
    try {
      validateCatalogFilters(filters);
    } catch {
      return error(400, "Invalid catalog filters.");
    }
    const query = collectionFiltersKey(filters);
    const id = `fixture_${createHash("sha256").update(query).digest("hex").slice(0, 24)}`;
    if (offset && params.get("snapshot") !== id)
      return error(409, "Restart the fixture catalog after changing filters.");
    const rows = tokens
      .filter((token) => {
        const rarity = Number(
          filters.rarityMode === "raw"
            ? token.rarityPoints
            : token.rarityPointsCapped
        );
        return (
          filters.sale !== "listed" &&
          !filters.sort.startsWith("price") &&
          !filters.priceMin &&
          !filters.priceMax &&
          filters.currency === "all" &&
          (filters.metadata === "all" ||
            token.metadataAvailable === (filters.metadata === "available")) &&
          (!filters.rarityMin || rarity >= Number(filters.rarityMin)) &&
          (!filters.rarityMax || rarity <= Number(filters.rarityMax)) &&
          Object.entries(filters.traits).every(([name, values]) =>
            token.attributes?.some(
              (trait) =>
                trait.trait_type === name &&
                values.includes(String(trait.value))
            )
          )
        );
      })
      .sort((a, b) => {
        const field = filters.sort.startsWith("token-id")
          ? "tokenId"
          : filters.sort.startsWith("rarity-capped")
            ? "rarityPointsCapped"
            : "rarityPoints";
        const result = Number(a[field]) - Number(b[field]);
        return (
          (filters.sort.endsWith("desc") ? -result : result) ||
          a.chain.localeCompare(b.chain)
        );
      });
    const coverage = {
      status: "complete",
      completedAt: updatedAt,
      revision: "fixture-v1"
    };
    return ok({
      schemaVersion: 2,
      query,
      snapshot: { id, observedAt: updatedAt },
      sources: Object.fromEntries(
        selected.map((chain) => [chain, "available"])
      ),
      availability: Object.fromEntries(
        selected.map((chain) => [
          chain,
          {
            chain,
            evidence: "current",
            listings: coverage,
            offers: coverage
          }
        ])
      ),
      listingCompleteness: "complete",
      total: rows.length,
      listedTotal: 0,
      verifiedListedTotal: 0,
      ...page(
        rows.map((token) => ({
          token,
          market: { status: "unlisted", listings: [] }
        }))
      )
    });
  }
  if (path.startsWith("/__fixtures/market/"))
    return error(503, "Trading and market activity are not simulated.");
  if (path === "/__fixtures/indexer/v1/collections")
    return ok({
      items: indexedChains.map((chain) => ({
        slug: chain,
        chain,
        chainId: marketplaceChains[chain].chainId,
        ensCoinType: 60,
        address: marketplaceChains[chain].contractAddress,
        deploymentBlock: 1,
        knownTokens: 12,
        activeSupply: 12
      }))
    });
  if (path === "/__fixtures/indexer/v1/traits")
    return ok({
      ...selection,
      updatedAt,
      items: [
        {
          traitType: "Color",
          kind: "categorical",
          values: [
            { value: "Blue", count: 24 },
            { value: "Red", count: 24 }
          ]
        },
        {
          traitType: "Type",
          kind: "categorical",
          values: [
            ...types.map((value) => ({
              value,
              count: tokens.filter(
                (token) => token.attributes?.[0]?.value === value
              ).length
            })),
            ...Array.from({ length: 30 }, (_, index) => ({
              value: `Fixture type ${index + 1}`,
              count: 0
            }))
          ]
        }
      ],
      metadata: {
        available: tokens.filter((token) => token.metadataAvailable).length,
        missing: tokens.filter((token) => !token.metadataAvailable).length
      }
    });
  const detail = path.match(
    /^\/__fixtures\/indexer\/v1\/tokens\/([^/]+)\/(\d+)$/
  );
  if (detail) {
    const token = fixtureTokens.find(
      (token) => token.chain === detail[1] && token.tokenId === detail[2]
    );
    return token
      ? ok({
          token: {
            ...token,
            token_id: token.tokenId,
            mint_block: "1",
            last_transfer_block: "1"
          },
          transfers: [],
          lifecycles: []
        })
      : error(404, "Unknown sample token.");
  }
  const ownerMatch = path.match(
    /^\/__fixtures\/indexer\/v1\/owners\/([^/]+)\/(tokens|leaderboard)$/
  );
  if (ownerMatch) {
    const owner = decodeURIComponent(ownerMatch[1]!).toLowerCase();
    const resolution = {
      owner,
      ownerInput: owner,
      ownerName: null,
      resolvedAddresses: Object.fromEntries(
        selected.map((chain) => [chain, owner])
      )
    };
    if (ownerMatch[2] === "tokens") {
      const visibility = params.get("visibility") ?? "visible";
      const owned =
        visibility === "hidden"
          ? []
          : tokens.filter((token) => token.owner === owner);
      return ok({ ...selection, ...resolution, visibility, ...page(owned) });
    }
    const profileTokens =
      owner === collectorFixtureOwner
        ? largeCollectorFixture(fixtureTokens)
        : tokens;
    const row = ranks(profileTokens).find((row) => row.owner === owner);
    return row
      ? ok({
          ...row,
          ...resolution,
          scoreVersion: "fixture-v1",
          ...Object.fromEntries(
            Object.entries(metrics).map(([metric, [, field]]) => [
              `${field}Rank`,
              ranks(profileTokens, metric as Metric).find(
                (entry) => entry.owner === owner
              )!.rank
            ])
          )
        })
      : error(404, "Unknown sample collector.");
  }
  if (path === "/__fixtures/indexer/v1/leaderboards")
    return ok({
      ...selection,
      wallets: fixtureOwners.length,
      updatedAt,
      collectorScore: {
        version: "fixture-v1",
        formula: "Synthetic sample: sum of rarity points"
      },
      items: Object.entries(metrics).map(([slug, [label]]) => ({ slug, label }))
    });
  const metric = path.replace("/__fixtures/indexer/v1/leaderboards/", "");
  if (
    path.startsWith("/__fixtures/indexer/v1/leaderboards/") &&
    Object.hasOwn(metrics, metric)
  )
    return ok({
      metric,
      label: metrics[metric as Metric][0],
      ...selection,
      scoreVersion: "fixture-v1",
      updatedAt,
      ...page(ranks(tokens, metric as Metric))
    });
  return error(404, "Unknown fixture route.");
}

export function fixturePlugin(): Plugin {
  return {
    name: "yunipals-local-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1:5177");
        if (!url.pathname.startsWith("/__fixtures/")) return next();
        response.setHeader("Cache-Control", "no-store");
        if (
          url.pathname === "/__fixtures/artwork.svg" &&
          request.method === "GET"
        ) {
          response.setHeader("Content-Type", "image/svg+xml");
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#e0e7ff"/><circle cx="200" cy="175" r="95" fill="#818cf8"/><circle cx="170" cy="160" r="12" fill="#fff"/><circle cx="230" cy="160" r="12" fill="#fff"/><path d="M170 205 Q200 235 230 205" fill="none" stroke="#fff" stroke-width="8"/><text x="200" y="325" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#3730a3">SAMPLE</text></svg>'
          );
          return;
        }
        try {
          const result = fixtureResponse(url, request.method);
          response.statusCode = result.status;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(result.body));
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_fixture_request" }));
        }
      });
    }
  };
}

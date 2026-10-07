import assert from "node:assert/strict";
import { after, test } from "node:test";

import { environment } from "@/environment";
import type { CollectionToken } from "@/lib/collectionBrowser";
import type { ExomonToken } from "@/lib/solanaIndexer";
import type { YunipalToken } from "@/lib/yunipalsIndexer";

environment.exomonEnabled = true;
const {
  fetchCollectionPage,
  fetchCollectionFacets,
  compareCollectionTokens,
  collectionTokenKey
} = await import("@/lib/collectionBrowser");
const {
  parseCollectionFilters,
  serializeCollectionFilters,
  exomonCollectionRedirect,
  updateCollectionChains,
  includesSolana
} = await import("@/lib/collectionBrowserFilters");
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

function token(
  chain: "ethereum" | "solana",
  index: number,
  rarity: string | null
): CollectionToken {
  const common = {
    chain,
    tokenId:
      chain === "solana"
        ? `Mint${String(index).padStart(4, "0")}`
        : String(index),
    name: `Token ${index}`,
    image: null,
    tokenUri: null,
    burned: false,
    attributes: [{ trait_type: "Type", value: "Dragon" }],
    rarityPoints: rarity,
    rarityPointsCapped: rarity
  };
  return chain === "solana"
    ? ({
        ...common,
        chain,
        owner: null,
        legacyAlias: null,
        ownershipObservedAt: "2026-01-01T00:00:00Z"
      } satisfies ExomonToken)
    : ({
        ...common,
        chain,
        chainId: 1,
        contractAddress: "0x1",
        owner: "0x2",
        lifecycle: 0,
        mintBlock: "1",
        lastTransferBlock: "1"
      } satisfies YunipalToken);
}

test("All includes Solana; explicit four EVM chains do not become All", () => {
  const params = new URLSearchParams(
    "chain=ethereum&chain=base&chain=polygon&chain=bnb"
  );
  const filters = parseCollectionFilters(params);
  assert.equal(filters.chains.length, 4);
  assert.equal(includesSolana(filters), false);
  assert.deepEqual(
    parseCollectionFilters(serializeCollectionFilters(filters)),
    filters
  );
  assert.equal(
    includesSolana(parseCollectionFilters(new URLSearchParams())),
    true
  );
  assert.deepEqual(
    parseCollectionFilters(new URLSearchParams("chain=solana&chain=solana"))
      .chains,
    ["solana"]
  );
});

test("Old Exomon links preserve capped rarity and traits in the common collection", () => {
  const url = new URL(
    exomonCollectionRedirect(
      "?rarityMin=50&rarityMax=80&t.Type=Exodragon&sort=rarity-asc"
    ),
    "https://example.com"
  );
  const filters = parseCollectionFilters(url.searchParams);
  assert.deepEqual(filters.chains, ["solana"]);
  assert.equal(filters.rarityMode, "capped");
  assert.equal(filters.rarityMin, "50");
  assert.equal(filters.rarityMax, "80");
  assert.equal(filters.sort, "rarity-asc");
  assert.deepEqual(filters.traits.Type, ["Exodragon"]);
});

test("Adding Solana clears EVM market restrictions and payment amounts", () => {
  const current = parseCollectionFilters(
    new URLSearchParams(
      "chain=base&sale=listed&sort=price-asc&currency=native&priceMin=2"
    )
  );
  const next = updateCollectionChains(current, {
    ...current,
    chains: ["base", "solana"]
  });
  assert.equal(next.sale, "all");
  assert.equal(next.currency, "all");
  assert.equal(next.priceMin, "");
  assert.equal(next.sort, "rarity-capped-desc");
});

for (const sort of [
  "rarity-capped-desc",
  "rarity-capped-asc",
  "rarity-desc",
  "rarity-asc",
  "token-id-asc",
  "token-id-desc"
] as const) {
  test(`Merged ${sort} pages have no gaps, duplicates or unbounded requests`, async () => {
    const filters = parseCollectionFilters(new URLSearchParams(`sort=${sort}`));
    const rows = [
      ...Array.from({ length: 65 }, (_, i) =>
        token("ethereum", i + 1, i > 61 ? null : String(200 - i * 2))
      ),
      ...Array.from({ length: 45 }, (_, i) =>
        token("solana", i + 1, i > 42 ? null : String(199 - i * 3))
      )
    ];
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const chain =
        url.searchParams.get("chain") === "solana" ? "solana" : "ethereum";
      const source = rows
        .filter((t) => t.chain === chain)
        .sort((a, b) => compareCollectionTokens(a, b, sort));
      const offset = Number(url.searchParams.get("cursor") || 0);
      const limit = Number(url.searchParams.get("limit"));
      assert.equal(limit, 24);
      assert.equal(url.searchParams.get("burned"), "false");
      return Response.json({
        items: source.slice(offset, offset + limit),
        total: source.length,
        nextCursor:
          offset + limit < source.length ? String(offset + limit) : null
      });
    };
    const all: CollectionToken[] = [];
    let cursor: Awaited<ReturnType<typeof fetchCollectionPage>>["nextCursor"] =
      null;
    do {
      const saved: Awaited<
        ReturnType<typeof fetchCollectionPage>
      >["nextCursor"] = structuredClone(cursor);
      const page = await fetchCollectionPage(filters, cursor ?? undefined);
      assert.equal(page.total, 110);
      assert.deepEqual(
        cursor,
        saved,
        "Previous continuation must remain unchanged"
      );
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(all.length, 110);
    assert.equal(new Set(all.map(collectionTokenKey)).size, 110);
    assert.deepEqual(
      all.map(collectionTokenKey),
      rows
        .sort((a, b) => compareCollectionTokens(a, b, sort))
        .map(collectionTokenKey)
    );
    assert.equal(requests.length, 5, "Each source page is fetched only once");
  });
}

test("Rarity comparison preserves decimal precision and puts unknown rarity last", () => {
  const a = token("ethereum", 1, "9007199254740993.0000000001");
  const b = token("solana", 1, "9007199254740993.0000000002");
  assert.ok(compareCollectionTokens(a, b, "rarity-desc") > 0);
  assert.ok(compareCollectionTokens(a, b, "rarity-asc") < 0);
  assert.ok(
    compareCollectionTokens(token("solana", 2, null), a, "rarity-asc") > 0
  );
});

test("The default page interleaves actual scores and keeps EVM before Solana at equal rarity", async () => {
  globalThis.fetch = async (input) =>
    Response.json({
      items:
        new URL(String(input)).searchParams.get("chain") === "solana"
          ? [
              token("solana", 1, "30"),
              token("solana", 2, "20"),
              token("solana", 3, null)
            ]
          : [
              token("ethereum", 9, "40"),
              token("ethereum", 2, "20"),
              token("ethereum", 1, "10")
            ],
      total: 3,
      nextCursor: null
    });
  const result = await fetchCollectionPage(
    parseCollectionFilters(new URLSearchParams())
  );
  assert.deepEqual(result.items.map(collectionTokenKey), [
    "ethereum:9",
    "solana:Mint0001",
    "ethereum:2",
    "solana:Mint0002",
    "ethereum:1",
    "solana:Mint0003"
  ]);
  assert.equal(result.total, 6);
  assert.equal(result.nextCursor, null);
});

test("Solana-only requests retain trait groups, raw ranges, metadata and cancellation", async () => {
  const filters = parseCollectionFilters(
    new URLSearchParams(
      "chain=solana&t.Type=Dragon&t.Type=Fairy&rarityMin=10&rarityMax=20&metadata=available"
    )
  );
  const signal = new AbortController().signal;
  const requests: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(init?.signal, signal);
    return Response.json({ items: [], total: 0, nextCursor: null });
  };
  await fetchCollectionPage(filters, undefined, signal);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].searchParams.getAll("chain"), ["solana"]);
  assert.deepEqual(requests[0].searchParams.getAll("traitValue"), [
    "Dragon",
    "Fairy"
  ]);
  assert.equal(requests[0].searchParams.get("rarityMin"), "10");
  assert.equal(requests[0].searchParams.get("metadata"), "available");
});

test("Expired Solana snapshots reject a whole merged page and preserve the retry cursor", async () => {
  let fail = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (fail && url.searchParams.get("chain") === "solana")
      return Response.json({ error: "cursor_expired" }, { status: 409 });
    const isSolana = url.searchParams.get("chain") === "solana";
    return Response.json({
      items: Array.from({ length: 24 }, (_, i) =>
        token(isSolana ? "solana" : "ethereum", i + 1, isSolana ? "100" : "1")
      ),
      total: 48,
      nextCursor: "next"
    });
  };
  const filters = parseCollectionFilters(new URLSearchParams());
  const first = await fetchCollectionPage(filters);
  const saved = structuredClone(first.nextCursor);
  fail = true;
  await assert.rejects(
    fetchCollectionPage(filters, first.nextCursor!),
    (e) => e instanceof Error && "status" in e && e.status === 409
  );
  assert.deepEqual(first.nextCursor, saved);
  await assert.rejects(
    fetchCollectionPage({ ...filters, metadata: "missing" }, first.nextCursor!),
    /filters changed/
  );
});

test("Solana outages do not silently present an EVM-only total as the combined collection", async () => {
  globalThis.fetch = async (input) =>
    new URL(String(input)).searchParams.get("chain") === "solana"
      ? Response.json(
          { error: "solana_ownership_unavailable" },
          { status: 503 }
        )
      : Response.json({
          items: [token("ethereum", 1, "100")],
          total: 1,
          nextCursor: null
        });
  await assert.rejects(
    fetchCollectionPage(parseCollectionFilters(new URLSearchParams())),
    (e) => e instanceof Error && "status" in e && e.status === 503
  );
});

test("Feature disabled makes no Solana calls and market filters never reach the indexer", async () => {
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return Response.json({ items: [], total: 0, nextCursor: null });
  };
  environment.exomonEnabled = false;
  try {
    await fetchCollectionPage(parseCollectionFilters(new URLSearchParams()));
  } finally {
    environment.exomonEnabled = true;
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.has("chain"), false);
  await assert.rejects(
    fetchCollectionPage(
      parseCollectionFilters(new URLSearchParams("chain=solana&sale=listed"))
    ),
    /EVM chain/
  );
  assert.equal(requests.length, 1);
});

test("Facets merge shared trait counts and retain Solana-only types", async () => {
  globalThis.fetch = async (input) => {
    const solana =
      new URL(String(input)).searchParams.get("chain") === "solana";
    return Response.json({
      items: [
        {
          traitType: "Color",
          kind: "categorical",
          values: [{ value: "Blue", count: solana ? 3 : 5 }]
        },
        {
          traitType: "Type",
          kind: "categorical",
          values: [{ value: solana ? "Exodragon" : "Unidragon", count: 1 }]
        }
      ],
      metadata: { available: solana ? 3 : 5, missing: solana ? 0 : 2 },
      updatedAt: "2026-01-01T00:00:00Z"
    });
  };
  const facets = await fetchCollectionFacets([]);
  assert.deepEqual(facets.metadata, { available: 8, missing: 2 });
  assert.deepEqual(
    facets.items.find((f) => f.traitType === "Color"),
    {
      traitType: "Color",
      kind: "categorical",
      values: [{ value: "Blue", count: 8 }]
    }
  );
  const type = facets.items.find((f) => f.traitType === "Type");
  assert.ok(type?.kind === "categorical");
  assert.equal(type.values.length, 2);
});

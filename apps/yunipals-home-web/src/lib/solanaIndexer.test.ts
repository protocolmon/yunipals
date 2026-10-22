import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";

import {
  parseExomonFilters,
  serializeExomonFilters
} from "@/lib/exomonFilters";
import {
  fetchExomonOwnerTokens,
  fetchExomonTokens,
  isSolanaAddress,
  retrySolanaQuery,
  SolanaApiError,
  solanaCacheVersion,
  type ExomonFilters
} from "@/lib/solanaIndexer";
import { pruneSolanaPages } from "@/lib/solanaPageCache";
import {
  fixtureSolanaBurnedToken,
  fixtureSolanaOwners,
  fixtureSolanaTokens,
  fixtureSolanaUnknownMint,
  solanaFixtureResponse
} from "../../scripts/fixtures/solana";

const mint = "11dhaEa4XyBmp3eFYfnpBPePmNLaojnWVRSGpszf6Ma";
const owner = "Hg5WgUcns1auesf5ZtHkRrqEqb6s32KkoeWRdhKg9JRH";

test("Solana addresses retain their case and decode to exactly 32 bytes", () => {
  assert.equal(isSolanaAddress(mint), true);
  assert.equal(isSolanaAddress(owner), true);
  assert.equal(isSolanaAddress("0x1234"), false);
  assert.notEqual(owner.toLowerCase(), owner);
  assert.equal(isSolanaAddress("O".repeat(44)), false);
});

test("Exomon URL filters keep independent trait groups and valid rarity bounds", () => {
  const filters = parseExomonFilters(
    new URLSearchParams(
      "t.Type=Fire&t.Type=Water&t.Color=Blue&rarityMin=100&rarityMax=300&sort=rarity-capped-asc"
    )
  );
  assert.deepEqual(filters.traits, {
    Type: ["Fire", "Water"],
    Color: ["Blue"]
  });
  assert.equal(filters.sort, "rarity-capped-asc");
  assert.deepEqual(parseExomonFilters(serializeExomonFilters(filters)), {
    ...filters,
    traits: { Color: ["Blue"], Type: ["Fire", "Water"] }
  });
});

test("Solana API requests are scoped to chain and preserve base58 owner", async () => {
  const original = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return new Response(
      JSON.stringify({ items: [], total: 0, nextCursor: null }),
      { status: 200 }
    );
  };
  try {
    const filters: ExomonFilters = {
      sort: "rarity-capped-desc",
      rarityMin: "100",
      rarityMax: "",
      traits: { Type: ["Water", "Fire"], Color: ["Blue"] }
    };
    await fetchExomonTokens(filters, "cursor-value");
    await fetchExomonOwnerTokens(owner);
    const collection = requests[0]!;
    assert.equal(collection.pathname.endsWith("/v1/tokens"), true);
    assert.deepEqual(collection.searchParams.getAll("chain"), ["solana"]);
    assert.deepEqual(collection.searchParams.getAll("traitType"), [
      "Color",
      "Type",
      "Type"
    ]);
    assert.deepEqual(collection.searchParams.getAll("traitValue"), [
      "Blue",
      "Fire",
      "Water"
    ]);
    assert.equal(collection.searchParams.get("rarityCappedMin"), "100");
    assert.equal(collection.searchParams.get("cursor"), "cursor-value");
    assert.equal(
      requests[1]!.pathname.endsWith(`/v1/owners/${owner}/tokens`),
      true
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("expired cursors surface a typed 409 for pagination reset", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "cursor_expired" }), { status: 409 });
  try {
    await assert.rejects(
      fetchExomonOwnerTokens(owner, "old"),
      (error) =>
        error instanceof SolanaApiError &&
        error.status === 409 &&
        error.code === "cursor_expired"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("ownership-unavailable errors do not trigger repeated API reads", () => {
  assert.equal(
    retrySolanaQuery(
      0,
      new SolanaApiError(503, "solana_ownership_unavailable")
    ),
    false
  );
  assert.equal(
    retrySolanaQuery(0, new SolanaApiError(502, "upstream_error")),
    true
  );
  assert.equal(
    retrySolanaQuery(2, new SolanaApiError(502, "upstream_error")),
    false
  );
});

test("Solana page cache retains five responses without evicting the active page", () => {
  const client = new QueryClient();
  for (let index = 0; index < 20; index++)
    client.setQueryData([solanaCacheVersion, `collection:${index}`, ""], {
      index
    });
  client.setQueryData([solanaCacheVersion, "collection-summary"], {
    knownTokens: 38
  });
  client.setQueryData(["collection", "evm"], { unaffected: true });
  const active = [solanaCacheVersion, "collection:19", ""];
  pruneSolanaPages(client, active);
  assert.equal(
    client
      .getQueryCache()
      .findAll({ queryKey: [solanaCacheVersion] })
      .filter((query) => String(query.queryKey[1]).startsWith("collection:"))
      .length,
    5
  );
  assert.deepEqual(client.getQueryData(active), { index: 19 });
  assert.deepEqual(client.getQueryData(["collection", "evm"]), {
    unaffected: true
  });
  assert.deepEqual(
    client.getQueryData([solanaCacheVersion, "collection-summary"]),
    { knownTokens: 38 }
  );
  client.clear();
});

test("Solana fixtures cover collection, filtering, paging, details and owners", () => {
  const origin = "http://localhost/__fixtures/indexer";
  const response = (path: string) =>
    solanaFixtureResponse(new URL(`${origin}${path}`));
  assert.equal(
    (response("/v1/collection?chain=solana")?.body as { knownTokens: number })
      .knownTokens,
    38
  );
  const filtered = response(
    "/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&limit=5"
  )?.body as { items: unknown[]; total: number; nextCursor: string };
  assert.equal(filtered.items.length, 5);
  assert.equal(filtered.total, 18);
  assert.ok(filtered.nextCursor);
  const second = response(
    `/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&limit=5&cursor=${filtered.nextCursor}`
  )?.body as { items: unknown[] };
  assert.equal(second.items.length, 5);
  assert.equal(
    response(`/v1/tokens/solana/${fixtureSolanaTokens[0]!.tokenId}`)?.status,
    200
  );
  assert.equal(
    response(`/v1/tokens/solana/${fixtureSolanaBurnedToken.tokenId}`)?.status,
    200
  );
  assert.equal(
    response(`/v1/tokens/solana/${fixtureSolanaUnknownMint}`)?.status,
    503
  );
  assert.equal(
    (
      response(`/v1/owners/${fixtureSolanaOwners[0]}/tokens?chain=solana`)
        ?.body as { total: number }
    ).total,
    18
  );
  assert.equal(response("/v1/tokens?chain=solana&cursor=expired")?.status, 409);
});

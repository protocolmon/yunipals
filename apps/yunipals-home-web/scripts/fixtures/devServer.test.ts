import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCollectionFilters } from "@/lib/collectionFilters";
import {
  createCatalogClient,
  nextCatalogPage
} from "@/lib/marketplace/catalog";
import { fixtureOwners, fixtureResponse } from "./devServer";

const origin = "http://127.0.0.1:5177";
const read = (path: string, method = "GET") =>
  fixtureResponse(new URL(path, origin), method);
const client = createCatalogClient(
  `${origin}/__fixtures/market`,
  async (input, init) => {
    const result = fixtureResponse(new URL(String(input)), init?.method);
    return new Response(JSON.stringify(result.body), { status: result.status });
  }
);

test("sample catalog passes the real parser across pagination without duplicate assets", async () => {
  const filters = parseCollectionFilters(new URLSearchParams());
  const first = await client.catalog(filters);
  assert.equal(first.total, 48);
  assert.equal(first.items.length, 24);
  const continuation = nextCatalogPage(first, [first], filters);
  assert.ok(continuation);
  const second = await client.catalog(filters, continuation);
  assert.equal(second.items.length, 24);
  assert.equal(nextCatalogPage(second, [first, second], filters), undefined);
  assert.equal(
    new Set(
      [...first.items, ...second.items].map(
        ({ token }) => `${token.chain}:${token.tokenId}`
      )
    ).size,
    48
  );
});

test("chain, trait, rarity and metadata filters produce matching sample tokens", async () => {
  const filters = parseCollectionFilters(
    new URLSearchParams(
      "chain=base&t.Type=Water&rarityCappedMin=120&sort=token-id-asc"
    )
  );
  const result = await client.catalog(filters);
  assert.deepEqual(
    result.items.map(({ token }) => [token.chain, token.tokenId]),
    [
      ["base", "7"],
      ["base", "10"]
    ]
  );
  const missing = await client.catalog(
    parseCollectionFilters(new URLSearchParams("metadata=missing"))
  );
  assert.equal(missing.total, 4);
  assert.ok(
    missing.items.every(({ token }) => token.metadataAvailable === false)
  );
  const listed = await client.catalog(
    parseCollectionFilters(new URLSearchParams("sale=listed"))
  );
  assert.equal(listed.total, 0);
});

test("fixtures reject writes, unsupported routes and mismatched pagination snapshots", () => {
  assert.equal(read("/__fixtures/indexer/v1/collections", "POST").status, 405);
  assert.equal(
    read("/__fixtures/indexer/v1/tokens/base/1/visibility/signing-data").status,
    404
  );
  assert.equal(read("/__fixtures/market/v1/market/orders", "POST").status, 405);
  assert.equal(
    read("/__fixtures/market/v2/market/tokens?cursor=24&snapshot=wrong").status,
    409
  );
  assert.equal(
    read("/__fixtures/market/v2/market/tokens?cursor=-1").status,
    400
  );
  const capabilities = read("/__fixtures/market/v1/market/capabilities")
    .body as { chains: Record<string, Record<string, boolean>> };
  assert.ok(
    Object.values(capabilities.chains).every((chain) =>
      Object.values(chain).every((value) => value === false)
    )
  );
});

test("token details and owner samples agree with the catalog; unknown owners are empty", () => {
  const detail = read("/__fixtures/indexer/v1/tokens/base/1").body as {
    token: { owner: string; token_id: string };
  };
  assert.equal(detail.token.owner, fixtureOwners[0]);
  assert.equal(detail.token.token_id, "1");
  const holdings = read(
    `/__fixtures/indexer/v1/owners/${fixtureOwners[0]}/tokens?chain=base`
  ).body as { items: unknown[] };
  assert.equal(holdings.items.length, 6);
  const unknown = read(
    "/__fixtures/indexer/v1/owners/0x0000000000000000000000000000000000000003/tokens"
  ).body as { items: unknown[] };
  assert.equal(unknown.items.length, 0);
  assert.equal(read("/__fixtures/indexer/v1/tokens/base/999").status, 404);
});

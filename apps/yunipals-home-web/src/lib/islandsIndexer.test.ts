import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchIsland,
  fetchIslands,
  islandDetailHref,
  islandOwnerHref,
  islandsTokensPath,
  normalizeIslandTokenId,
  parseIslandsFilters
} from "@/lib/islandsIndexer";
import { IndexerError } from "@/lib/yunipalsIndexer";
import { environment } from "@/environment";

const owner = "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8";

test("island IDs stay separate from monster routes and preserve uint256 precision", () => {
  assert.equal(
    normalizeIslandTokenId(" #0009007199254740993 "),
    "9007199254740993"
  );
  assert.equal(islandDetailHref("1"), "/collection/ethereum-islands/1");
  assert.equal(islandOwnerHref(owner), `/?collection=islands&owner=${owner}`);
  assert.equal(
    normalizeIslandTokenId((2n ** 256n - 1n).toString()),
    (2n ** 256n - 1n).toString()
  );
  for (const input of [
    "-1",
    "1e3",
    "1.2",
    "#",
    "name.eth",
    (2n ** 256n).toString()
  ]) {
    assert.equal(normalizeIslandTokenId(input), null);
  }
});

test("edition, owner and sort filters round-trip with the cursor in the Islands API scope", () => {
  const filters = parseIslandsFilters(
    new URLSearchParams(
      `collection=islands&edition=Personal&owner=${owner.toUpperCase().replace("0X", "0x")}&sort=token-id-desc`
    )
  );
  const path = new URL(
    islandsTokensPath(filters, "opaque+/cursor="),
    "https://example.com"
  );
  assert.equal(path.pathname, "/v2/collections/ethereum-islands/tokens");
  assert.equal(path.searchParams.get("owner"), owner);
  assert.equal(path.searchParams.get("edition"), "Personal");
  assert.equal(path.searchParams.get("sort"), "token-id-desc");
  assert.equal(path.searchParams.get("limit"), "24");
  assert.equal(path.searchParams.get("cursor"), "opaque+/cursor=");
  for (const search of [
    "owner=bad",
    "owner=0x0000000000000000000000000000000000000000",
    "edition=Unknown",
    "sort=rarity-desc"
  ]) {
    assert.throws(() => parseIslandsFilters(new URLSearchParams(search)));
  }
});

test("island requests use the shared API errors and pass cancellation to fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        url.pathname,
        "/yunipals-indexer/v2/collections/ethereum-islands/tokens"
      );
      assert.equal(init?.signal, controller.signal);
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    };
    const result = await fetchIslands(
      { sort: "token-id-asc" },
      undefined,
      controller.signal
    );
    assert.deepEqual(result.items, []);

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "ownership_rebuilding" }), {
        status: 503
      });
    await assert.rejects(
      fetchIsland("1"),
      (error: unknown) =>
        error instanceof IndexerError &&
        error.status === 503 &&
        error.code === "ownership_rebuilding"
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "token_not_found" }), {
        status: 404
      });
    await assert.rejects(
      fetchIsland("100000"),
      (error: unknown) => error instanceof IndexerError && error.status === 404
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("staked browsing sends holding without a wallet and preserves combined filters", () => {
  const enabled = environment.islandStakingEnabled;
  try {
    environment.islandStakingEnabled = true;
    const filters = parseIslandsFilters(
      new URLSearchParams(
        "collection=islands&holding=staked&edition=Genesis&sort=token-id-desc"
      )
    );
    const path = new URL(
      islandsTokensPath(filters, "next-page"),
      "https://example.com"
    );
    assert.equal(path.searchParams.get("holding"), "staked");
    assert.equal(path.searchParams.has("owner"), false);
    assert.equal(path.searchParams.get("edition"), "Genesis");
    assert.equal(path.searchParams.get("sort"), "token-id-desc");
    assert.equal(path.searchParams.get("cursor"), "next-page");
    const walletPath = new URL(
      islandsTokensPath({ ...filters, owner }),
      "https://example.com"
    );
    assert.equal(walletPath.searchParams.get("holding"), "staked");
    assert.equal(walletPath.searchParams.get("owner"), owner);

    environment.islandStakingEnabled = false;
    const disabled = new URL(islandsTokensPath(filters), "https://example.com");
    assert.equal(disabled.searchParams.has("holding"), false);
  } finally {
    environment.islandStakingEnabled = enabled;
  }
});

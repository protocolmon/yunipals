import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryObserver, hashKey } from "@tanstack/react-query";

import {
  collectorFiltersKey,
  createCollectorClient,
  defaultCollectorFilters,
  parseCollectorFilters,
  parseCollectorPage,
  pruneCollectorPages
} from "@/lib/collector";
import {
  fixtureResponse,
  fixtureTokens
} from "../../scripts/fixtures/devServer";
import { collectorFixtureOwner } from "../../scripts/fixtures/collector";
import { IndexerError } from "@/lib/yunipalsIndexer";

const origin = "http://localhost/__fixtures/indexer";
const client = createCollectorClient(origin, async (input, init) => {
  const result = fixtureResponse(new URL(String(input)), init?.method);
  return new Response(JSON.stringify(result.body), { status: result.status });
});
const filters = (value: string) =>
  parseCollectorFilters(new URLSearchParams(value));

test("canonical filters preserve large IDs and share cache keys across equivalent selections", () => {
  assert.equal(filters("q=%230009007199254740993").search, "9007199254740993");
  assert.deepEqual(filters("rarityMin=001.5000&rarityMax=020.00"), {
    ...defaultCollectorFilters,
    rarityMin: "1.5",
    rarityMax: "20"
  });
  assert.equal(
    collectorFiltersKey(
      filters("chain=base&t.Type=Water&t.Type=Fire&t.Type=Water")
    ),
    collectorFiltersKey(filters("t.Type=Fire&t.Type=Water&chain=base"))
  );
  assert.deepEqual(
    filters("chain=ethereum&chain=base&chain=polygon&chain=bnb").chains,
    []
  );
  for (const value of [
    "q=x",
    "sort=price-asc",
    "chain=bad",
    "q=%23no",
    "q=a&q=b",
    "rarityMin=-1",
    "rarityMax=1e3",
    "rarityMin=20&rarityMax=10",
    "rarityMin=1&rarityMin=2"
  ])
    assert.throws(() => filters(value));
});

test("the real client reads full-wallet filters, both paging directions, exact IDs and prefix names", async () => {
  const profile = fixtureResponse(
    new URL(`${origin}/v1/owners/${collectorFixtureOwner}/leaderboard`)
  );
  assert.equal(profile.status, 200);
  assert.equal((profile.body as { monsterCount: number }).monsterCount, 128);
  assert.deepEqual(await client.capabilities(), {
    version: 1,
    namePrefixSearch: true,
    rarityRange: true
  });
  const first = await client.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "visible"
  );
  assert.equal(first.items.length, 24);
  assert.ok(first.nextCursor);
  const second = await client.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "visible",
    first.nextCursor
  );
  assert.ok(second.previousCursor);
  assert.equal(
    new Set(
      [...first.items, ...second.items].map(
        (token) => `${token.chain}:${token.tokenId}`
      )
    ).size,
    48
  );
  const previous = await client.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "visible",
    second.previousCursor
  );
  assert.deepEqual(previous.items, first.items);
  const combined = await client.page(
    collectorFixtureOwner,
    filters("chain=bnb&t.Type=Water&t.Color=Blue"),
    "visible"
  );
  assert.ok(combined.items.length);
  assert.ok(
    combined.items.every(
      (token) =>
        token.chain === "bnb" &&
        token.attributes?.some((attr) => attr.value === "Blue")
    )
  );
  const rarityRange = await client.page(
    collectorFixtureOwner,
    filters("rarityMin=110&rarityMax=120"),
    "visible"
  );
  assert.ok(rarityRange.items.length);
  assert.ok(
    rarityRange.items.every((token) => {
      const score = Number(token.rarityPointsCapped ?? token.rarityPoints);
      return score >= 110 && score <= 120;
    })
  );
  assert.equal(
    (await client.page(collectorFixtureOwner, filters("q=32"), "visible")).items
      .length,
    4
  );
  assert.equal(
    (
      await client.page(
        collectorFixtureOwner,
        filters("q=sample%20fire%2032"),
        "visible"
      )
    ).items.length,
    4
  );
  const hidden = await client.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "hidden"
  );
  assert.ok(hidden.items.length);
  assert.ok(hidden.items.every((token) => token.hidden));
  await assert.rejects(
    client.page(
      collectorFixtureOwner,
      filters("t.Color=Blue"),
      "visible",
      first.nextCursor
    ),
    (error: unknown) =>
      error instanceof IndexerError && error.code === "invalid_collector_cursor"
  );
  await assert.rejects(
    client.page(
      collectorFixtureOwner,
      filters("rarityMin=110"),
      "visible",
      first.nextCursor
    ),
    (error: unknown) =>
      error instanceof IndexerError && error.code === "invalid_collector_cursor"
  );
});

test("an older API cannot silently acknowledge filters, and failed requests remain errors", async () => {
  const oldClient = createCollectorClient(
    origin,
    async () => new Response("{}", { status: 404 })
  );
  assert.equal((await oldClient.capabilities()).version, 0);
  const failedClient = createCollectorClient(
    origin,
    async () => new Response("{}", { status: 503 })
  );
  await assert.rejects(failedClient.capabilities());
  const fakeClient = createCollectorClient(
    origin,
    async () =>
      new Response(JSON.stringify({ items: fixtureTokens.slice(0, 24) }))
  );
  await assert.rejects(
    fakeClient.page(collectorFixtureOwner, defaultCollectorFilters, "visible"),
    (error: unknown) =>
      error instanceof IndexerError &&
      error.code === "invalid_collector_response"
  );
});

test("response validation rejects wrong owners, visibility, duplicate tokens and looping cursors", async () => {
  const result = await client.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "visible"
  );
  for (const changed of [
    { ...result, query: "different" },
    { ...result, items: [result.items[0], result.items[0]] },
    { ...result, items: [{ ...result.items[0], hidden: true }] },
    {
      ...result,
      items: [
        {
          ...result.items[0],
          owner: "0x0000000000000000000000000000000000000002"
        }
      ]
    },
    { ...result, nextCursor: "current" }
  ])
    assert.throws(() =>
      parseCollectorPage(changed, defaultCollectorFilters, "visible", "current")
    );
});

test("obsolete requests pass an abort signal through to fetch", async () => {
  const controller = new AbortController();
  const waiting = createCollectorClient(
    origin,
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        assert.equal(init?.signal, controller.signal);
        init!.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      })
  );
  const pending = waiting.page(
    collectorFixtureOwner,
    defaultCollectorFilters,
    "visible",
    "",
    controller.signal
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("100 visited page/filter variants retain five payloads and protect the active page", () => {
  const cache = new QueryClient();
  const prefix = [
    "collector",
    "multi-chain-v1",
    collectorFixtureOwner,
    "tokens",
    "visible",
    "page-v1"
  ];
  const activeKey = [...prefix, "active"];
  cache.setQueryData(activeKey, { items: [1] });
  const observer = new QueryObserver(cache, {
    queryKey: activeKey,
    enabled: false
  });
  const unsubscribe = observer.subscribe(() => {});
  for (let index = 0; index < 100; index++) {
    cache.setQueryData([...prefix, index], {
      items: Array.from({ length: 24 }, () => ({ name: "Sample" }))
    });
    pruneCollectorPages(cache, hashKey(activeKey));
    assert.ok(cache.getQueryCache().getAll().length <= 5);
  }
  assert.deepEqual(cache.getQueryData(activeKey), { items: [1] });
  unsubscribe();
  cache.clear();
});

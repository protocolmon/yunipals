import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketClient,
  parseBnbFulfillmentQuote,
  parseBnbPreflight,
  parseMarketAsset,
  parseMarketCapabilities,
  parseMarketOrder
} from "./marketApi";
import { openSeaFixture } from "./opensea.testFixtures";
import {
  marketFixture,
  testSeller,
  testBuyer
} from "./marketplace.testFixtures";

test("BNB approval preflight binds the reviewed order and actor and rejects stale or invented prerequisites", () => {
  const { summary } = marketFixture("offer");
  const response = {
    schemaVersion: 1,
    source: "yunipals",
    asset: summary.asset,
    lifecycle: summary.lifecycle,
    actor: testSeller,
    protocolAddress: summary.protocolAddress,
    orderHash: summary.orderHash,
    expiresAt: "130",
    needsNftApproval: true
  };
  assert.deepEqual(parseBnbPreflight(response, summary, testSeller, 100n), {
    needsNftApproval: true
  });
  for (const changed of [
    { actor: testBuyer },
    { lifecycle: 9 },
    { expiresAt: "100" },
    { expiresAt: "161" },
    { needsNftApproval: "true" },
    { protocolAddress: testBuyer },
    { orderHash: `0x${"00".repeat(32)}` },
    { asset: { ...summary.asset, tokenId: "124" } }
  ])
    assert.throws(() =>
      parseBnbPreflight({ ...response, ...changed }, summary, testSeller, 100n)
    );
  assert.throws(() =>
    parseBnbPreflight(
      response,
      { ...summary, side: "listing" },
      testSeller,
      100n
    )
  );
});

test("validated BNB quotes accept Seaport's empty signature", () => {
  const { quote } = marketFixture();
  assert.equal(
    parseBnbFulfillmentQuote({
      ...quote,
      schemaVersion: 1,
      source: "yunipals",
      signature: "0x"
    }).signature,
    "0x"
  );
});

test("API parsing rejects misleading totals, unsupported collections and wrong asset joins", () => {
  const { summary } = marketFixture();
  assert.doesNotThrow(() => parseMarketOrder(summary));
  assert.throws(() =>
    parseMarketOrder({ ...summary, grossAmount: Number(summary.grossAmount) })
  );
  assert.throws(() =>
    parseMarketOrder({ ...summary, sellerProceeds: summary.grossAmount })
  );
  assert.throws(() =>
    parseMarketOrder({
      ...summary,
      asset: { ...summary.asset, chain: "ethereum" }
    })
  );
  assert.throws(() =>
    parseMarketCapabilities({ schemaVersion: 2, chains: {} })
  );
  assert.throws(() =>
    parseMarketCapabilities({
      schemaVersion: 1,
      chains: { bnb: { buy: "true" } }
    })
  );
  const data = {
    schemaVersion: 2,
    asset: summary.asset,
    lifecycle: 2,
    owner: testSeller,
    hidden: false,
    burned: false,
    sourceStatus: "available",
    availability: {
      chain: "bnb",
      evidence: "current",
      listings: { status: "complete", completedAt: null, revision: null },
      offers: { status: "complete", completedAt: null, revision: null }
    },
    listingState: "listed",
    offerAvailability: "complete",
    updatedAt: new Date().toISOString(),
    listings: [summary],
    offers: []
  };
  assert.doesNotThrow(() => parseMarketAsset(data, summary.asset));
  assert.throws(() =>
    parseMarketAsset(
      {
        ...data,
        listings: [{ ...summary, asset: { ...summary.asset, tokenId: "124" } }]
      },
      summary.asset
    )
  );
});

test("API requests are scoped, omit credentials, disable cache and reject oversized responses", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ schemaVersion: 1, chains: {} }));
  };
  const client = createMarketClient(
    "https://example.test/yunipals-indexer",
    fetcher
  );
  await client.capabilities();
  assert.equal(
    requests[0].url,
    "https://example.test/yunipals-indexer/v1/market/capabilities"
  );
  assert.equal(requests[0].init?.credentials, "omit");
  assert.equal(requests[0].init?.cache, "no-store");
  assert.equal(requests[0].init?.redirect, "error");
  assert.throws(() => createMarketClient("https://user:password@example.test"));
  assert.throws(() => createMarketClient("http://example.test"));
  const large = createMarketClient(
    "https://example.test",
    async () => new Response(" ".repeat(1_048_577))
  );
  await assert.rejects(large.capabilities(), /too large/);
});

test("BNB creation keeps the signed-order path while an older API lacks discovery", async () => {
  const client = createMarketClient(
    "https://example.test",
    async () => new Response(null, { status: 404 })
  );
  assert.deepEqual(await client.bnbDiscoveryStatus(), {
    mode: "preview",
    coverage: "partial"
  });
  const paths: string[] = [];
  const oldApi = createMarketClient(
    "https://example.test",
    async (url) => {
      paths.push(String(url));
      return String(url).endsWith("/v1/market/capabilities")
        ? Response.json({ schemaVersion: 1, chains: {} })
        : Response.json({ error: { code: "market_unavailable" } }, { status: 503 });
    }
  );
  assert.deepEqual(await oldApi.bnbDiscoveryStatus(), {
    mode: "preview",
    coverage: "partial"
  });
  assert.deepEqual(paths.map((path) => new URL(path).pathname), [
    "/v1/market/bnb/discovered-orders",
    "/v1/market/capabilities"
  ]);
  const unavailable = createMarketClient(
    "https://example.test",
    async (url) =>
      String(url).endsWith("/v1/market/capabilities")
        ? Response.json({ schemaVersion: 1, bnbDiscovery: true, chains: {} })
        : Response.json({ error: { code: "market_unavailable" } }, { status: 503 })
  );
  await assert.rejects(unavailable.bnbDiscoveryStatus(), /unavailable/);
});

test("preparation and publication preserve exact order JSON and require durable acknowledgement", async () => {
  const { summary, quote } = marketFixture();
  const request = {
    asset: summary.asset,
    lifecycle: summary.lifecycle,
    order: quote.order
  };
  const calls: Array<{ path: string; body: unknown }> = [];
  let persisted = true;
  const client = createMarketClient(
    "https://example.test",
    async (url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(init.credentials, "omit");
      const path = new URL(String(url)).pathname;
      calls.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json(
        path.endsWith("/prepare")
          ? {
              schemaVersion: 1,
              source: "yunipals",
              ...request,
              id: "prepared",
              orderHash: summary.orderHash,
              expiresAt: "160"
            }
          : { schemaVersion: 1, persisted, order: summary }
      );
    }
  );
  const prepared = await client.prepareOwnOrder(request);
  const signed = {
    ...request,
    preparationId: prepared.id,
    signature: quote.signature
  };
  assert.equal(
    (await client.publishOwnOrder(signed)).orderHash,
    summary.orderHash
  );
  assert.deepEqual(calls, [
    { path: "/v1/market/orders/prepare", body: request },
    { path: "/v1/market/orders", body: signed }
  ]);
  persisted = false;
  await assert.rejects(client.publishOwnOrder(signed), /durable/);
});

test("OpenSea preparation uses one request and strictly distinguishes simulated trades from prerequisites", async () => {
  const { reviewed, quote, actor } = openSeaFixture();
  let simulated: unknown = true;
  let purpose = "prepare";
  const requests: string[] = [];
  const client = createMarketClient(
    "https://example.test",
    async (url, init) => {
      requests.push(String(url));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        actor,
        lifecycle: reviewed.lifecycle
      });
      return Response.json({
        schemaVersion: 1,
        source: "opensea",
        purpose,
        simulated,
        ...quote
      });
    }
  );
  assert.equal((await client.openSeaPrepare(reviewed, actor)).simulated, true);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].endsWith("/prepare"));
  simulated = false;
  assert.equal((await client.openSeaPrepare(reviewed, actor)).simulated, false);
  for (const invalid of [undefined, "true", 1, null]) {
    simulated = invalid;
    await assert.rejects(
      client.openSeaPrepare(reviewed, actor),
      /Unexpected fulfillment/
    );
  }
  simulated = true;
  purpose = "preflight";
  await assert.rejects(
    client.openSeaPrepare(reviewed, actor),
    /Unexpected fulfillment/
  );
});

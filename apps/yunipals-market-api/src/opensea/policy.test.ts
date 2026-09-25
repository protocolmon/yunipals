import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { getAddress, zeroAddress } from "viem";
import {
  parseOpenSeaOrderPolicy,
  assertOpenSeaPolicyCurrent
} from "@protopals/yunipals-market-core/openseaOrderPolicy";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  openseaCurrencies,
  openseaSignedZone,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";

import { OpenSeaClient, OpenSeaError } from "@/opensea/client";
import { readOpenSeaProbeEnvironment } from "@/environment";
import { probeOpenSeaAccess } from "@/opensea/probe";
import {
  fixtureActor,
  fixtureFeeRecipient,
  fixtureMaker
} from "@/opensea/fixtures/orders";
import {
  fixtureProvider,
  fixtureJsonResponse
} from "@/opensea/fixtures/provider";
import {
  OpenSeaPolicyError,
  OpenSeaPolicyResolver,
  resolveOpenSeaContract,
  resolveOpenSeaCollectionPolicy
} from "@/opensea/policy";

const observedAt = 1788660000000;
function policyFixture(chain: OpenSeaChain = "ethereum") {
  const config = marketplaceChains[chain];
  return {
    contract: {
      address: config.contractAddress,
      chain,
      collection: `yunipals-${chain}`,
      contract_standard: "erc721",
      name: "Yunipals fixture"
    },
    collection: {
      collection: `yunipals-${chain}`,
      contracts: [{ address: config.contractAddress, chain }],
      is_disabled: false,
      pricing_currencies: {
        listing_currency: {
          chain,
          address: zeroAddress,
          symbol: config.nativeSymbol,
          decimals: 18
        },
        offer_currency: {
          chain,
          address: getAddress(openseaCurrencies[chain].address),
          symbol: "WETH",
          decimals: 18
        }
      },
      fees: [
        { recipient: fixtureFeeRecipient, fee: 2.505, required: true },
        { recipient: fixtureActor, fee: 3, required: false }
      ],
      required_zone: ""
    },
    options: {
      chain,
      collectionSlug: `yunipals-${chain}`,
      observedAt,
      maxDurationSeconds: 86400
    }
  };
}

test("provider contract and collection policies bind registered NFTs, required fees, currencies and zones on all three chains", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const fixture = policyFixture(chain);
    const collectionSlug = resolveOpenSeaContract(fixture.contract, chain);
    assert.equal(collectionSlug, fixture.options.collectionSlug);
    const result = resolveOpenSeaCollectionPolicy(
      fixture.collection,
      fixture.options
    );
    assert.deepEqual(result.wire.fees, [
      { recipient: fixtureFeeRecipient, basisPoints: 251 }
    ]);
    assert.equal(result.providerFees.length, 2);
    assert.deepEqual(result.wire.listingCurrencies, [zeroAddress]);
    assert.equal(
      result.policy.offerCurrency,
      getAddress(openseaCurrencies[chain].address)
    );
    assert.equal(result.policy.listingZone, zeroAddress);
    assert.equal(result.policy.offerZone, getAddress(openseaSignedZone));
    assert.equal(result.policy.expiresAt, BigInt(observedAt / 1000) + 60n);
    assert.deepEqual(
      result.policy,
      parseOpenSeaOrderPolicy(result.wire, chain)
    );
    assert.doesNotThrow(() =>
      assertOpenSeaPolicyCurrent(result.policy, BigInt(observedAt / 1000))
    );
    assert.throws(() =>
      assertOpenSeaPolicyCurrent(result.policy, BigInt(observedAt / 1000) + 60n)
    );
  }
});

test("policy version changes with executable economics and zones, while refreshing observation time preserves it", () => {
  const fixture = policyFixture();
  const first = resolveOpenSeaCollectionPolicy(
    fixture.collection,
    fixture.options
  );
  const refreshed = resolveOpenSeaCollectionPolicy(fixture.collection, {
    ...fixture.options,
    observedAt: observedAt + 10000
  });
  assert.equal(first.policy.version, refreshed.policy.version);
  assert.notEqual(first.policy.expiresAt, refreshed.policy.expiresAt);
  fixture.collection.fees[1]!.fee = 4;
  assert.equal(
    resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options).policy
      .version,
    first.policy.version
  );
  fixture.collection.fees[1]!.required = true;
  assert.notEqual(
    resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options).policy
      .version,
    first.policy.version
  );
  fixture.collection.required_zone = openseaSignedZone;
  assert.equal(
    resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options).policy
      .listingZone,
    getAddress(openseaSignedZone)
  );
});

test("fee conversion uses exact decimal rounding and refuses malformed, missing or confiscatory fees", () => {
  for (const [fee, expected] of [
    [2.5, 250],
    [2.505, 251],
    [0.29, 29],
    [0.0049, 0],
    [0.005, 1],
    [1e-7, 0],
    [0, 0]
  ]) {
    const fixture = policyFixture();
    fixture.collection.fees[0]!.fee = fee!;
    assert.equal(
      resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options).wire
        .fees[0]!.basisPoints,
      expected
    );
  }
  const mutations: ((
    data: ReturnType<typeof policyFixture>["collection"]
  ) => void)[] = [
    (data) => {
      Object.assign(data, { fees: undefined });
    },
    (data) => {
      data.fees[0]!.fee = NaN;
    },
    (data) => {
      data.fees[0]!.fee = -1;
    },
    (data) => {
      data.fees[0]!.fee = 100;
    },
    (data) => {
      data.fees[0]!.fee = 99.999;
    },
    (data) => {
      data.fees[0]!.recipient = zeroAddress;
    },
    (data) => {
      Object.assign(data.fees[1]!, { fee: "2.5" });
    },
    (data) => {
      data.fees[1]!.required = true;
      data.fees[1]!.recipient = data.fees[0]!.recipient;
    },
    (data) => {
      data.fees[0]!.fee = 99;
      data.fees[1]!.required = true;
    }
  ];
  for (const mutate of mutations) {
    const fixture = policyFixture();
    mutate(fixture.collection);
    assert.throws(
      () => resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options),
      OpenSeaPolicyError
    );
  }
});

test("wrong contracts, disabled collections and unsupported payment or zone fields cannot become policy", () => {
  const mutations: ((
    data: ReturnType<typeof policyFixture>["collection"]
  ) => void)[] = [
    (data) => {
      data.collection = "another-collection";
    },
    (data) => {
      Object.assign(data.contracts[0]!, { address: fixtureMaker });
    },
    (data) => {
      data.contracts[0]!.chain = "base";
    },
    (data) => {
      data.contracts.push(data.contracts[0]!);
    },
    (data) => {
      data.is_disabled = true;
    },
    (data) => {
      Object.assign(data, { is_disabled: undefined });
    },
    (data) => {
      data.required_zone = fixtureMaker;
    },
    (data) => {
      Object.assign(data, { pricing_currencies: undefined });
    },
    (data) => {
      data.pricing_currencies.offer_currency.address = zeroAddress;
    },
    (data) => {
      data.pricing_currencies.offer_currency.decimals = 6;
    },
    (data) => {
      Object.assign(data.pricing_currencies.listing_currency, {
        symbol: "USDC"
      });
    },
    (data) => {
      data.pricing_currencies.offer_currency.chain = "base";
    }
  ];
  for (const mutate of mutations) {
    const fixture = policyFixture();
    mutate(fixture.collection);
    assert.throws(
      () => resolveOpenSeaCollectionPolicy(fixture.collection, fixture.options),
      OpenSeaPolicyError
    );
  }
  const fixture = policyFixture();
  for (const patch of [
    { chain: "bnb" },
    { address: fixtureActor },
    { contract_standard: "erc1155" },
    { collection: "../foreign" }
  ]) {
    assert.throws(
      () =>
        resolveOpenSeaContract({ ...fixture.contract, ...patch }, "ethereum"),
      OpenSeaPolicyError
    );
  }
});

test("actual HTTP policy reads coalesce, return isolated copies and invalidate cache after failed fresh verification", async (t) => {
  const fixture = policyFixture();
  let calls = 0;
  let fail = false;
  const provider = await fixtureProvider((req, res) => {
    calls++;
    if (fail) {
      res.writeHead(403);
      res.end("private provider rejection");
      return;
    }
    assert.equal(req.method, "GET");
    if (req.url!.startsWith("/api/v2/chain/"))
      fixtureJsonResponse(res, fixture.contract);
    else {
      assert.equal(req.url, "/api/v2/collections/yunipals-ethereum");
      fixtureJsonResponse(res, fixture.collection);
    }
  });
  t.after(() => provider.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: provider.origin
  });
  const resolver = new OpenSeaPolicyResolver(client, {
    maxDurationSeconds: 86400
  });
  const policies = await Promise.all(
    Array.from({ length: 10 }, () => resolver.resolve("ethereum"))
  );
  assert.equal(calls, 2);
  policies[0]!.wire.fees[0]!.basisPoints = 9999;
  assert.equal(
    (await resolver.resolve("ethereum")).wire.fees[0]!.basisPoints,
    251
  );
  fail = true;
  await assert.rejects(
    resolver.resolve("ethereum", true),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_auth"
  );
  await assert.rejects(
    resolver.resolve("ethereum"),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_auth"
  );
  assert.equal(calls, 4);
  fail = false;
  assert.equal(
    (await resolver.resolve("ethereum")).wire.fees[0]!.basisPoints,
    251
  );
  assert.equal(calls, 6);
});

test("one deadline bounds sequential contract and collection reads, including a hanging response body", async (t) => {
  const fixture = policyFixture();
  let calls = 0;
  const provider = await fixtureProvider(async (req, res) => {
    calls++;
    if (req.url!.startsWith("/api/v2/chain/")) {
      await delay(60);
      fixtureJsonResponse(res, fixture.contract);
    } else {
      res.writeHead(200);
      res.write('{"pending":');
    }
  });
  t.after(() => provider.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: provider.origin,
    timeoutMs: 1000
  });
  const resolver = new OpenSeaPolicyResolver(client, {
    maxDurationSeconds: 86400,
    timeoutMs: 150
  });
  const start = Date.now();
  await assert.rejects(
    resolver.resolve("ethereum"),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_timeout"
  );
  assert.ok(Date.now() - start < 800);
  assert.equal(calls, 2);
});

test("read-only access reporting retains all chain results and never echoes credentials or claims trading permissions", async () => {
  for (const input of [
    {},
    { MARKET_OPENSEA_API_KEY: "bad\nkey" },
    {
      MARKET_OPENSEA_API_KEY: "valid-fixture",
      MARKET_OPENSEA_MAX_DURATION_SECONDS: "1"
    }
  ]) {
    assert.throws(() => readOpenSeaProbeEnvironment(input));
  }
  assert.equal(
    readOpenSeaProbeEnvironment({ MARKET_OPENSEA_API_KEY: "valid-fixture" })
      .maxDurationSeconds,
    30 * 86400
  );
  const report = await probeOpenSeaAccess({
    async resolve(chain) {
      if (chain === "polygon") throw new Error("private credential here");
      const fixture = policyFixture(chain);
      return resolveOpenSeaCollectionPolicy(
        fixture.collection,
        fixture.options
      );
    }
  });
  assert.equal(report.status, "unavailable");
  assert.equal(report.providerWritesEnabled, false);
  assert.equal(report.observations.length, 3);
  assert.deepEqual(
    report.observations.map((row) => row.status),
    ["available", "available", "unavailable"]
  );
  assert.equal(report.observations[2]!.reason, "provider_probe_failed");
  assert.equal(JSON.stringify(report).includes("private"), false);
});

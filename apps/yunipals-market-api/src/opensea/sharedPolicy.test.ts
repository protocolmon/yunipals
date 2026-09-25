import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { getAddress, zeroAddress } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  openseaCurrencies,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { OpenSeaClient, OpenSeaError } from "@/opensea/client";
import { fixtureFeeRecipient } from "@/opensea/fixtures/orders";
import {
  fixtureProvider,
  fixtureJsonResponse
} from "@/opensea/fixtures/provider";
import { OpenSeaPolicyError } from "@/opensea/policy";
import { PostgresOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";

const db = createBnbTestDatabase();
const scopes: string[] = [];
test.before(async () => {
  await db.initialize();
  await db.owner.query(
    readFileSync(
      new URL("../../scripts/grant-opensea-budget.sql", import.meta.url),
      "utf8"
    ).replaceAll(':"market_budget_role"', '"market_test_runtime"')
  );
});
test.after(async () => {
  try {
    for (const table of [
      "opensea_policy_observation",
      "opensea_request_metric_minute",
      "opensea_request_reservation",
      "opensea_request_endpoint_window",
      "opensea_request_window",
      "opensea_request_budget_state",
      "opensea_request_budget"
    ])
      await db.owner.query(
        `DELETE FROM yunipals_market.${table} WHERE scope=ANY($1::text[])`,
        [scopes]
      );
  } finally {
    await db.close();
  }
});

function collection(chain: OpenSeaChain, fee = 1) {
  const config = marketplaceChains[chain];
  return {
    collection: config.collectionSlug,
    contracts: [{ chain, address: config.contractAddress }],
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
    fees: [{ recipient: fixtureFeeRecipient, fee, required: true }],
    description: "irrelevant metadata must not be retained"
  };
}

async function scope() {
  const value = `policy-${randomUUID()}`;
  scopes.push(value);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_request_budget(scope,all_per_hour,fulfillment_per_minute,publication_per_hour,enabled) VALUES($1,1000,5,30,true)`,
    [value]
  );
  await db.owner.query(
    "INSERT INTO yunipals_market.opensea_request_budget_state(scope) VALUES($1)",
    [value]
  );
  return value;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function resolver(
  account: string,
  getCollection: (slug: string, signal?: AbortSignal) => Promise<unknown>,
  options = { maxDurationSeconds: 86400, timeoutMs: 10000 }
) {
  return new OpenSeaSharedPolicyResolver(
    db.runtime,
    account,
    { getCollection },
    options
  );
}

test("independent HTTP clients share one policy read per chain and preserve its original expiry", async (t) => {
  const account = await scope();
  let calls = 0;
  const server = await fixtureProvider(async (req, res) => {
    assert.equal(req.method, "GET");
    const chain = (["ethereum", "base", "polygon"] as const).find(
      (chain) =>
        req.url ===
        `/api/v2/collections/${marketplaceChains[chain].collectionSlug}`
    );
    assert.ok(chain);
    calls++;
    await delay(80);
    fixtureJsonResponse(res, collection(chain));
  });
  t.after(() => server.close());
  const make = (duration = 86400) =>
    new OpenSeaSharedPolicyResolver(
      db.runtime,
      account,
      new OpenSeaClient({
        apiKey: "yunipals-fixture-only",
        fixtureOrigin: server.origin,
        requestBudget: new PostgresOpenSeaRequestBudget(db.runtime, account)
      }),
      { maxDurationSeconds: duration }
    );
  const results = await Promise.all(
    Array.from({ length: 18 }, (_, index) =>
      make().resolve(
        (["ethereum", "base", "polygon"] as const)[index % 3]!,
        true
      )
    )
  );
  assert.equal(calls, 3);
  const original = results[0]!;
  original.wire.fees[0]!.basisPoints = 9999;
  const reused = await make().resolve("ethereum");
  assert.equal(reused.wire.fees[0]!.basisPoints, 100);
  assert.equal(reused.wire.expiresAt, original.wire.expiresAt);
  assert.equal(
    (await make(172800).resolve("ethereum")).wire.maxDurationSeconds,
    "172800"
  );
  assert.equal(calls, 3);
  const records = await db.owner.query(
    "SELECT response,extract(epoch FROM observed_at)::bigint AS observed FROM yunipals_market.opensea_policy_observation WHERE scope=$1 AND chain_id=1",
    [account]
  );
  assert.equal("description" in records.rows[0].response, false);
  const requests = await db.owner.query(
    "SELECT count(*)::integer AS count,bool_and(kind='read' AND completed) AS all_read FROM yunipals_market.opensea_request_reservation WHERE scope=$1",
    [account]
  );
  assert.deepEqual(requests.rows[0], { count: 3, all_read: true });
});

test("fresh refresh invalidates every process's older observation and changed fees propagate", async () => {
  const account = await scope();
  let fee = 1;
  let calls = 0;
  const fetch = async () => {
    calls++;
    return collection("ethereum", fee);
  };
  const first = resolver(account, fetch),
    second = resolver(account, fetch);
  const previous = await first.resolve("ethereum");
  fee = 2;
  await delay(2);
  const updated = await second.resolve("ethereum", true);
  assert.notEqual(updated.wire.policyVersion, previous.wire.policyVersion);
  assert.equal(
    (await first.resolve("ethereum")).wire.fees[0]!.basisPoints,
    200
  );
  assert.equal(calls, 2);
});

test("refresh failure retains the dated success while strict stale reads share retry timing", async () => {
  const account = await scope();
  let fail = false,
    calls = 0;
  const fetch = async () => {
    calls++;
    if (fail) throw new OpenSeaError("provider_rate_limited", 429, 120000);
    return collection("ethereum");
  };
  const first = resolver(account, fetch);
  await first.resolve("ethereum");
  fail = true;
  await delay(2);
  await assert.rejects(
    first.resolve("ethereum", true),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_rate_limited"
  );
  assert.equal(
    (await resolver(account, fetch).resolve("ethereum")).wire.fees[0]!
      .basisPoints,
    100
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET observed_at=clock_timestamp()-interval '61 seconds' WHERE scope=$1",
    [account]
  );
  await assert.rejects(
    resolver(account, fetch).resolve("ethereum"),
    (error: unknown) =>
      error instanceof OpenSeaError && error.retryAfterMs! > 119000
  );
  assert.equal(calls, 2);
  const row = (
    await db.owner.query(
      "SELECT response,observed_at FROM yunipals_market.opensea_policy_observation WHERE scope=$1",
      [account]
    )
  ).rows[0];
  assert.notEqual(row.response, null);
  assert.notEqual(row.observed_at, null);
  fail = false;
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET retry_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
    [account]
  );
  await resolver(account, fetch).resolve("ethereum");
  assert.equal(calls, 3);
});

test("stale policies refresh without extending the old observation's lifetime", async () => {
  const account = await scope();
  let calls = 0;
  const fetch = async () => {
    calls++;
    return collection("ethereum");
  };
  const service = resolver(account, fetch);
  await service.resolve("ethereum");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET observed_at=clock_timestamp()-interval '61 seconds' WHERE scope=$1",
    [account]
  );
  await service.resolve("ethereum");
  assert.equal(calls, 2);
});

test("browse policy refreshes every five minutes and retains a nonactionable stale observation", async () => {
  const account = await scope();
  let fail = false;
  let calls = 0;
  const service = resolver(account, async () => {
    calls++;
    if (fail) throw new OpenSeaError("provider_network");
    return collection("base");
  });
  const current = await service.resolveBrowse("base");
  assert.equal(current.freshness, "current");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET observed_at=clock_timestamp()-interval '6 minutes' WHERE scope=$1 AND chain_id=8453",
    [account]
  );
  fail = true;
  const stale = await service.resolveBrowse("base");
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.responseVersion, current.responseVersion);
  await assert.rejects(
    service.resolveCurrentBrowsePolicy("base"),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_busy"
  );
  assert.equal(calls, 2);
});

test("confirmed collection disablement invalidates browse and transaction policy immediately", async () => {
  const account = await scope();
  let disabled = false;
  const service = resolver(account, async () => ({
    ...collection("polygon"),
    is_disabled: disabled
  }));
  await service.resolveBrowse("polygon");
  disabled = true;
  await assert.rejects(
    service.resolve("polygon", true),
    (error: unknown) =>
      error instanceof OpenSeaPolicyError &&
      error.code === "provider_collection_disabled"
  );
  await assert.rejects(
    service.resolveBrowse("polygon"),
    (error: unknown) =>
      error instanceof OpenSeaPolicyError &&
      error.code === "provider_collection_disabled"
  );
});

test("a crashed refresher's lease expires, and a late old writer cannot overwrite its successor", async () => {
  const account = await scope();
  const started = deferred(),
    release = deferred();
  const stale = resolver(account, async () => {
    started.resolve();
    await release.promise;
    return collection("ethereum", 9);
  });
  const waiting = stale.resolve("ethereum");
  // Attach the rejection handler before releasing the old writer.
  const rejected = assert.rejects(
    waiting,
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_timeout"
  );
  await started.promise;
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET lease_until=clock_timestamp()-interval '1 second' WHERE scope=$1",
    [account]
  );
  const successor = resolver(account, async () => collection("ethereum", 2));
  await successor.resolve("ethereum");
  release.resolve();
  await rejected;
  assert.equal(
    (await successor.resolve("ethereum")).wire.fees[0]!.basisPoints,
    200
  );
});

test("followers honor deadlines and do not start parallel fetches behind a live lease", async () => {
  const account = await scope();
  const started = deferred(),
    release = deferred();
  let calls = 0;
  const fetch = async () => {
    calls++;
    started.resolve();
    await release.promise;
    return collection("ethereum");
  };
  const initial = resolver(account, fetch).resolve("ethereum");
  await started.promise;
  try {
    await assert.rejects(
      resolver(account, fetch, {
        maxDurationSeconds: 86400,
        timeoutMs: 100
      }).resolve("ethereum", true),
      (error: unknown) =>
        error instanceof OpenSeaError && error.code === "provider_timeout"
    );
    assert.equal(calls, 1);
  } finally {
    release.resolve();
    await initial;
  }
});

test("missing batch fields, wrong collection bindings and disabled collections never produce a policy", async () => {
  const invalid = [
    { ...collection("ethereum"), fees: undefined },
    { ...collection("ethereum"), pricing_currencies: undefined },
    { ...collection("ethereum"), collection: "different" },
    {
      ...collection("ethereum"),
      contracts: [
        { chain: "base", address: marketplaceChains.ethereum.contractAddress }
      ]
    },
    { ...collection("ethereum"), is_disabled: true }
  ];
  for (const raw of invalid) {
    const account = await scope();
    await assert.rejects(
      resolver(account, async () => raw).resolve("ethereum"),
      (error: unknown) => error instanceof OpenSeaPolicyError
    );
    await assert.rejects(
      resolver(account, async () => collection("ethereum")).resolve("ethereum"),
      (error: unknown) => error instanceof OpenSeaPolicyError
    );
  }
});

test("coordinator scope and chain isolate cached policies, and cached data is revalidated", async () => {
  const a = await scope(),
    b = await scope();
  const first = resolver(a, async () => collection("ethereum", 1));
  const second = resolver(b, async () => collection("ethereum", 2));
  assert.equal(
    (await first.resolve("ethereum")).wire.fees[0]!.basisPoints,
    100
  );
  assert.equal(
    (await second.resolve("ethereum")).wire.fees[0]!.basisPoints,
    200
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_policy_observation SET response=jsonb_set(response,'{collection}','\"wrong\"'::jsonb) WHERE scope=$1",
    [a]
  );
  await assert.rejects(
    first.resolve("ethereum"),
    (error: unknown) =>
      error instanceof OpenSeaPolicyError &&
      error.code === "provider_collection_mismatch"
  );
  assert.equal(
    (await second.resolve("ethereum")).wire.fees[0]!.basisPoints,
    200
  );
});

test("foreground policy diagnostics distinguish refresh from reuse without extending expiry", async () => {
  const account = await scope();
  const timings: import("./sharedPolicy").PolicyResolutionTiming[] = [];
  let calls = 0;
  const service = new OpenSeaSharedPolicyResolver(
    db.runtime,
    account,
    {
      getCollection: async () => {
        calls++;
        await delay(20);
        return collection("polygon");
      }
    },
    {
      maxDurationSeconds: 2592000,
      timeoutMs: 4000,
      observe: (value) => timings.push(value)
    }
  );
  const first = await service.resolve("polygon");
  const second = await service.resolve("polygon");
  assert.equal(calls, 1);
  assert.equal(first.wire.expiresAt, second.wire.expiresAt);
  assert.equal(timings.length, 2);
  assert.equal(timings[0]!.cacheHit, false);
  assert.ok(timings[0]!.providerMs >= 15);
  assert.equal(timings[1]!.cacheHit, true);
  assert.equal(timings[1]!.providerMs, 0);
  assert.ok(
    timings.every((t) => t.outcome === "success" && t.totalMs >= t.providerMs)
  );
});

test("short foreground deadline aborts a hanging upstream and reports failure without serving expired policy", async () => {
  const account = await scope();
  const timings: import("./sharedPolicy").PolicyResolutionTiming[] = [];
  let aborted = false;
  const service = new OpenSeaSharedPolicyResolver(
    db.runtime,
    account,
    {
      getCollection: async (_slug, signal) => {
        try {
          await delay(10000, undefined, { signal });
        } finally {
          aborted = signal?.aborted === true;
        }
        return collection("polygon");
      }
    },
    {
      maxDurationSeconds: 2592000,
      timeoutMs: 100,
      observe: (value) => timings.push(value)
    }
  );
  const started = Date.now();
  await assert.rejects(
    service.resolve("polygon"),
    (e: unknown) => e instanceof OpenSeaError && e.code === "provider_timeout"
  );
  assert.ok(Date.now() - started < 1500);
  assert.equal(aborted, true);
  assert.equal(timings[0]!.outcome, "error");
  assert.equal(timings[0]!.cacheHit, false);
  assert.ok(timings[0]!.providerMs > 0);
});

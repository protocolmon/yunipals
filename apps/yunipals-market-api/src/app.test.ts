import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";

import { createApp } from "@/app";
import { bnbValidationPolicy } from "@/bnb/validation";
import { readEnvironment } from "@/environment";
import { BnbOrderError } from "@/bnb/orders";
import { ownerTradeAuthorizationStatements } from "@/ownerTradeAuthorization";

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

function ownerAuthorizationEnvironment() {
  const seconds = Math.floor(Date.now() / 1000);
  const owner = "0x0000000000000000000000000000000000001234";
  const text = canonical({
    formatVersion: 1,
    kind: "yunipals-marketplace-owner-trade-schedule",
    status: "authorized",
    mode: "public",
    ownerWallet: owner,
    chains: ["bnb", "ethereum", "base", "polygon"],
    actions: ["createListing", "createOffer", "buy", "acceptOffer"],
    maximumFeesBasisPoints: 500,
    orders: [],
    validFrom: new Date((seconds - 60) * 1000)
      .toISOString()
      .replace(".000", ""),
    validUntil: new Date((seconds + 86400) * 1000)
      .toISOString()
      .replace(".000", ""),
    cancellationAndSettlementProcedure:
      "Disable admission, cancel outstanding orders and reconcile every chain transaction.",
    authorizedBy: owner,
    authorizedAt: new Date((seconds - 120) * 1000)
      .toISOString()
      .replace(".000", ""),
    authorizationStatement: ownerTradeAuthorizationStatements.public
  });
  const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  return {
    MARKET_OWNER_TRADE_SCHEDULE_BASE64: Buffer.from(text).toString("base64url"),
    MARKET_OWNER_TRADE_SCHEDULE_SHA256: digest,
    digest
  };
}

const environment = readEnvironment({
  MARKET_DATABASE_URL: "postgres://test:test@localhost/test",
  MARKET_DEPLOYMENT: "staging",
  MARKET_ALLOWED_ORIGINS: "http://127.0.0.1:5177"
});

test("v1 and v2 classify database failures, preserve expiry, and log programming failures safely", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (message: string) => {
    logs.push(message);
  });
  for (const failure of [
    {
      error: Object.assign(new Error("private database details"), {
        code: "57014"
      }),
      status: 503
    },
    {
      error: Object.assign(new Error("private lock details"), {
        code: "55P03"
      }),
      status: 503
    },
    {
      error: Object.assign(new Error("private connection details"), {
        code: "ECONNRESET"
      }),
      status: 503
    },
    { error: new BnbOrderError("snapshot_refresh_required", 409), status: 409 },
    { error: new TypeError("private programming details"), status: 500 }
  ]) {
    const fail = async () => {
      throw failure.error;
    };
    const app = createApp(environment, async () => {}, {
      catalog: { tokens: fail, tokensV2: fail }
    });
    for (const version of ["v1", "v2"]) {
      const response = await app.request(`/${version}/market/tokens`);
      assert.equal(response.status, failure.status);
      assert.match(response.headers.get("X-Request-Id")!, /^[0-9a-f-]{36}$/);
      assert.ok(!(await response.text()).includes("private"));
    }
  }
  assert.ok(logs.length >= 8);
  assert.ok(logs.every((message) => !message.includes("private")));
  assert.ok(
    logs.some((message) => JSON.parse(message).databaseCode === "57014")
  );
});

test("database failure affects readiness without exposing credentials or enabling actions", async () => {
  const app = createApp(environment, async () => {
    throw new Error("postgres://secret:credential@private/db");
  });
  assert.equal((await app.request("/health/live")).status, 200);
  const ready = await app.request("/health/ready");
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "unavailable" });
  const capabilities = await (
    await app.request("/v1/market/capabilities")
  ).json();
  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(capabilities.bnbDiscovery, true);
  assert.deepEqual(Object.keys(capabilities.chains).sort(), [
    "base",
    "bnb",
    "ethereum",
    "polygon"
  ]);
  for (const flags of Object.values(capabilities.chains))
    assert.deepEqual(flags, {
      read: false,
      buy: false,
      createListing: false,
      createOffer: false,
      acceptOffer: false,
      cancel: false
    });
  assert.equal(
    (await app.request("/v1/market/orders", { method: "POST", body: "{}" }))
      .status,
    503
  );
});

test("HTTP guards bound bodies and reject unapproved origins", async () => {
  const app = createApp(environment, async () => {});
  const denied = await app.request("/v1/market/capabilities", {
    headers: { Origin: "https://unknown.invalid" }
  });
  assert.equal(denied.status, 403);
  const allowed = await app.request("/health/ready", {
    headers: { Origin: environment.origins[0]! }
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get("Access-Control-Allow-Origin"),
    environment.origins[0]
  );
  assert.equal(allowed.headers.get("Cache-Control"), "no-store");
  const oversized = await app.request("/v1/market/orders", {
    method: "POST",
    body: "x".repeat(131073)
  });
  assert.equal(oversized.status, 413);
});

test("admission budget bounds concurrent database readiness work", async () => {
  let queries = 0;
  const app = createApp(environment, async () => {
    queries++;
  });
  const responses = await Promise.all(
    Array.from({ length: 500 }, () => app.request("/health/ready"))
  );
  assert.ok(responses.some((response) => response.status === 429));
  assert.ok(queries < 500);
});

test("deployment configuration refuses ambiguous environments and public listener binds", () => {
  assert.throws(() => readEnvironment({}), /MARKET_DEPLOYMENT/);
  assert.throws(
    () =>
      readEnvironment({
        MARKET_DEPLOYMENT: "production",
        MARKET_DATABASE_URL: "postgres://test:test@localhost/test",
        MARKET_ALLOWED_ORIGINS: "http://localhost"
      }),
    /origin/
  );
  assert.throws(
    () =>
      readEnvironment({
        MARKET_DEPLOYMENT: "staging",
        MARKET_DATABASE_URL: "postgres://test:test@localhost/test",
        MARKET_HOST: "0.0.0.0"
      }),
    /loopback/
  );
});

test("production capabilities default off and require complete independent live runtimes only for executable actions", () => {
  const authorization = ownerAuthorizationEnvironment();
  const production = {
    MARKET_DEPLOYMENT: "production",
    MARKET_DATABASE_URL: environment.databaseUrl,
    MARKET_ALLOWED_ORIGINS: "https://yunipals.com"
  };
  const inactive = readEnvironment(production);
  for (const chain of Object.values(inactive.capabilities))
    assert.ok(Object.values(chain).every((value) => value === false));
  assert.equal(inactive.productionTrading, undefined);

  const recoveryOnly = readEnvironment({
    ...production,
    MARKET_CAPABILITIES_BNB: "read,cancel"
  });
  assert.deepEqual(recoveryOnly.capabilities.bnb, {
    read: true,
    buy: false,
    createListing: false,
    createOffer: false,
    acceptOffer: false,
    cancel: true
  });
  for (const changes of [
    { MARKET_CAPABILITIES_BNB: "" },
    { MARKET_CAPABILITIES_BNB: "read,read" },
    { MARKET_CAPABILITIES_BNB: "read,unknown" },
    { MARKET_CAPABILITIES_SOLANA: "read" },
    { MARKET_TRADING_RPC_SOLANA: "https://primary.example/key" },
    { MARKET_CAPABILITIES_BNB: "buy" },
    {
      MARKET_TRADING_RPC_BNB: "https://primary.example/key",
      MARKET_TRADING_RPC_FAILOVER_BNB: "https://primary.example/backup"
    },
    {
      MARKET_TRADING_RPC_BNB: "https://primary.example/key",
      MARKET_TRADING_RPC_FAILOVER_BNB: "https://secondary.example/key"
    }
  ])
    assert.throws(() => readEnvironment({ ...production, ...changes }));

  const bnb = readEnvironment({
    ...production,
    MARKET_OWNER_TRADE_SCHEDULE_BASE64:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
    MARKET_OWNER_TRADE_SCHEDULE_SHA256:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
    MARKET_CAPABILITIES_BNB:
      "read,buy,createListing,createOffer,acceptOffer,cancel",
    MARKET_TRADING_RPC_BNB: "https://primary.example/key",
    MARKET_TRADING_RPC_FAILOVER_BNB: "https://secondary.example/key",
    MARKET_BNB_POLICY_VERSION: "bnb-owner-approved-v1",
    MARKET_BNB_MAX_DURATION_SECONDS: "86400",
    MARKET_BNB_TRADING_AUTHORIZATION: authorization.digest,
    MARKET_BNB_POLICY_FEES:
      '[{"recipient":"0x0000000000000000000000000000000000001234","basisPoints":500}]'
  });
  assert.equal(bnb.productionTrading?.bnb?.rpcUrls.length, 2);
  assert.deepEqual(bnb.productionTrading?.bnb?.policy.fees, [
    {
      recipient: "0x0000000000000000000000000000000000001234",
      basisPoints: 500
    }
  ]);

  const openSea = readEnvironment({
    ...production,
    MARKET_OWNER_TRADE_SCHEDULE_BASE64:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
    MARKET_OWNER_TRADE_SCHEDULE_SHA256:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
    MARKET_CAPABILITIES_BASE: "buy,createListing",
    MARKET_TRADING_RPC_BASE: "https://primary.example/key",
    MARKET_TRADING_RPC_FAILOVER_BASE: "https://secondary.example/key",
    MARKET_OPENSEA_API_KEY: "server-only-fixture-value",
    MARKET_OPENSEA_MAX_DURATION_SECONDS: "86400"
  });
  assert.deepEqual(
    Object.keys(openSea.productionTrading?.openSea?.rpcUrls ?? {}),
    ["base"]
  );
  assert.throws(() =>
    readEnvironment({
      ...production,
      MARKET_OWNER_TRADE_SCHEDULE_BASE64:
        authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
      MARKET_OWNER_TRADE_SCHEDULE_SHA256:
        authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
      MARKET_CAPABILITIES_BASE: "createListing",
      MARKET_TRADING_RPC_BASE: "https://primary.example/key",
      MARKET_TRADING_RPC_FAILOVER_BASE: "https://secondary.example/key",
      MARKET_OPENSEA_API_KEY: "server-only-fixture-value",
      MARKET_OPENSEA_MAX_DURATION_SECONDS: "86400",
      MARKET_OPENSEA_WORKER_CHAIN: "base",
      MARKET_OPENSEA_PUBLICATION_ENABLED: "1"
    })
  );
  const publication = readEnvironment({
    ...production,
    MARKET_OWNER_TRADE_SCHEDULE_BASE64:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
    MARKET_OWNER_TRADE_SCHEDULE_SHA256:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
    MARKET_CAPABILITIES_BASE: "createListing",
    MARKET_TRADING_RPC_BASE: "https://primary.example/key",
    MARKET_TRADING_RPC_FAILOVER_BASE: "https://secondary.example/key",
    MARKET_OPENSEA_API_KEY: "server-only-fixture-value",
    MARKET_OPENSEA_MAX_DURATION_SECONDS: "86400",
    MARKET_OPENSEA_WORKER_CHAIN: "base",
    MARKET_OPENSEA_PUBLICATION_ENABLED: "1",
    MARKET_OPENSEA_PUBLICATION_AUTHORIZATION: authorization.digest
  });
  assert.deepEqual(publication.productionTrading?.openSea?.publication, {
    chain: "base",
    authorization: authorization.digest
  });
});

test("validation configuration rejects production and remote RPC endpoints", () => {
  for (const [deployment, rpc] of [
    ["production", "http://127.0.0.1:18547"],
    ["staging", "https://bsc-dataseed.bnbchain.org"],
    ["staging", "http://user:pass@127.0.0.1"]
  ]) {
    assert.throws(
      () =>
        readEnvironment({
          MARKET_DEPLOYMENT: deployment,
          MARKET_DATABASE_URL: environment.databaseUrl,
          MARKET_BNB_VALIDATION_RPC: rpc
        }),
      /validation/
    );
  }
});

test("catalog source URLs are optional, PostgreSQL-only and rejected without leaking credentials", () => {
  const input = {
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: environment.databaseUrl
  };
  assert.equal(readEnvironment(input).indexerDatabaseUrl, undefined);
  const url = "postgresql://reader:fixture-password@127.0.0.1/indexer";
  assert.equal(
    readEnvironment({ ...input, MARKET_INDEXER_DATABASE_URL: url })
      .indexerDatabaseUrl,
    url
  );
  for (const invalid of [
    "",
    "https://reader:fixture-password@private/indexer",
    "postgresql://private/"
  ])
    assert.throws(
      () => readEnvironment({ ...input, MARKET_INDEXER_DATABASE_URL: invalid }),
      { message: "Invalid catalog indexer database URL." }
    );
});

test("HTTP admission rejects malformed JSON and sanitizes upstream failures", async () => {
  const app = createApp(
    { ...environment, bnbValidationRpc: "http://127.0.0.1:18547" },
    async () => {},
    {
      bnbValidation: {
        policy: bnbValidationPolicy,
        admission: {
          async prepare() {
            throw Object.assign(new Error("secret RPC credential"), {
              code: "ECONNRESET"
            });
          },
          async submit() {
            throw Object.assign(new Error("secret database credential"), {
              code: "08006"
            });
          }
        }
      }
    }
  );
  for (const path of ["/v1/market/orders/prepare", "/v1/market/orders"]) {
    assert.equal(
      (
        await app.request(path, {
          method: "POST",
          body: JSON.stringify({ asset: { chain: "bnb" } })
        })
      ).status,
      400
    );
    assert.equal(
      (
        await app.request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{"
        })
      ).status,
      400
    );
    const response = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset: { chain: "bnb" } })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: "market_unavailable" }
    });
  }
});

test("saturated admission cannot consume recovery work slots or bypass limits with forwarded headers", async () => {
  let started = 0;
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const app = createApp(
    { ...environment, bnbValidationRpc: "http://127.0.0.1:18547" },
    async () => {},
    {
      bnbValidation: {
        policy: bnbValidationPolicy,
        admission: {
          async prepare() {
            started++;
            await pending;
            throw new Error("fixture finished");
          },
          async submit() {
            throw new Error("unused");
          }
        }
      },
      recovery: {
        async accepted() {
          throw Object.assign(new Error("fixture database unavailable"), {
            code: "08006"
          });
        },
        async cancellation() {
          throw new Error("unused");
        }
      }
    }
  );
  const responses = Array.from({ length: 12 }, (_, index) =>
    app.request("/v1/market/orders/prepare", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `192.0.2.${index}`
      },
      body: JSON.stringify({ asset: { chain: "bnb" } })
    })
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(started, 4);
  const recovery = await app.request(
    `/v1/market/orders/bnb/${seaportDeployment.address}/0x${"ab".repeat(32)}`
  );
  assert.equal(
    recovery.status,
    503,
    "Recovery reaches its service despite occupied admission slots."
  );
  finish();
  const finished = await Promise.all(responses);
  assert.equal(
    finished.filter((response) => response.status === 429).length,
    8
  );
});

test("browser trading capabilities require explicit isolated validation and every dependent service", async () => {
  const base = {
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: environment.databaseUrl
  };
  for (const configuration of [
    { ...base, MARKET_BNB_VALIDATION_TRADING: "true" },
    { ...base, MARKET_BNB_VALIDATION_TRADING: "1" },
    {
      ...base,
      MARKET_DEPLOYMENT: "production",
      MARKET_BNB_VALIDATION_TRADING: "1",
      MARKET_BNB_VALIDATION_RPC: "http://127.0.0.1:18647"
    }
  ])
    assert.throws(() => readEnvironment(configuration), /validation/);
  const enabled = readEnvironment({
    ...base,
    MARKET_BNB_VALIDATION_TRADING: "1",
    MARKET_BNB_VALIDATION_RPC: "http://127.0.0.1:18647"
  });
  assert.throws(() => createApp(enabled, async () => {}), /complete trading/);
  const unused = async () => {
    throw new Error("This capability check invokes no trading operation.");
  };
  const app = createApp(enabled, async () => {}, {
    bnbValidation: {
      policy: bnbValidationPolicy,
      admission: { prepare: unused, submit: unused },
      fulfillment: { preflight: unused, quote: unused }
    },
    reads: { wallet: unused, asset: unused },
    recovery: { accepted: unused, cancellation: unused }
  });
  const response = await (await app.request("/v1/market/capabilities")).json();
  assert.ok(
    Object.values(response.chains.bnb).every((value) => value === true)
  );
  for (const chain of ["ethereum", "base", "polygon"])
    assert.ok(
      Object.values(response.chains[chain]).every((value) => value === false)
    );
});

test("BNB action pause preserves read and cancellation without reopening signed admission", async () => {
  const paused = readEnvironment({
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: environment.databaseUrl,
    MARKET_BNB_VALIDATION_RPC: "http://127.0.0.1:18647",
    MARKET_BNB_VALIDATION_TRADING: "1",
    MARKET_BNB_ACTIONS_PAUSED: "1"
  });
  const unused = async () => {
    throw new Error("Paused actions must not reach the service.");
  };
  const app = createApp(paused, async () => {}, {
    bnbValidation: {
      policy: bnbValidationPolicy,
      admission: { prepare: unused, submit: unused },
      fulfillment: { preflight: unused, quote: unused }
    },
    reads: { wallet: unused, asset: unused },
    recovery: { accepted: unused, cancellation: unused }
  });
  const capabilities = await (
    await app.request("/v1/market/capabilities")
  ).json();
  assert.deepEqual(capabilities.chains.bnb, {
    read: true,
    buy: false,
    createListing: false,
    createOffer: false,
    acceptOffer: false,
    cancel: true
  });
  const submit = await app.request("/v1/market/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset: { chain: "bnb" } })
  });
  assert.equal(submit.status, 503);
  const trade = await app.request(
    `/v1/market/orders/bnb/${seaportDeployment.address}/0x${"ab".repeat(32)}/preflight`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }
  );
  assert.equal(trade.status, 503);
});

test("production capabilities advertise only requested actions backed by the complete service graph", async () => {
  const authorization = ownerAuthorizationEnvironment();
  const configured = readEnvironment({
    MARKET_DEPLOYMENT: "production",
    MARKET_DATABASE_URL: environment.databaseUrl,
    MARKET_ALLOWED_ORIGINS: "https://yunipals.com",
    MARKET_OWNER_TRADE_SCHEDULE_BASE64:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
    MARKET_OWNER_TRADE_SCHEDULE_SHA256:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
    MARKET_CAPABILITIES_BASE: "read,buy,createListing,cancel",
    MARKET_TRADING_RPC_BASE: "https://primary.example/key",
    MARKET_TRADING_RPC_FAILOVER_BASE: "https://secondary.example/key",
    MARKET_OPENSEA_API_KEY: "server-only-fixture-value",
    MARKET_OPENSEA_MAX_DURATION_SECONDS: "86400"
  });
  const unused = async (): Promise<never> => {
    throw new Error("Capability inspection must not invoke a service.");
  };
  const services = {
    capabilityHealth: {
      async current() {
        return {
          bnbWorker: false,
          openSeaRead: { ethereum: false, base: true, polygon: false },
          openSeaPublication: {
            ethereum: false,
            base: true,
            polygon: false
          }
        };
      }
    },
    openseaValidation: {
      prepare: unused,
      submit: unused,
      policy: unused
    },
    openseaFulfillment: { preflight: unused, quote: unused },
    openseaRecovery: { accepted: unused, cancellation: unused },
    reads: { wallet: unused, asset: unused }
  };
  const complete = createApp(configured, async () => {}, services);
  assert.deepEqual(
    (await (await complete.request("/v1/market/capabilities")).json()).chains
      .base,
    {
      read: true,
      buy: true,
      createListing: true,
      createOffer: false,
      acceptOffer: false,
      cancel: true
    }
  );
  const withoutFulfillment = createApp(configured, async () => {}, {
    ...services,
    openseaFulfillment: undefined
  });
  assert.equal(
    (await (await withoutFulfillment.request("/v1/market/capabilities")).json())
      .chains.base.buy,
    false
  );
  const unhealthy = createApp(configured, async () => {}, {
    ...services,
    capabilityHealth: {
      async current() {
        return {
          bnbWorker: false,
          openSeaRead: { ethereum: false, base: false, polygon: false },
          openSeaPublication: {
            ethereum: false,
            base: false,
            polygon: false
          }
        };
      }
    }
  });
  const blocked = await unhealthy.request(
    `/v1/market/orders/base/${seaportDeployment.address}/0x${"ab".repeat(32)}/fulfillment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "fixture", lifecycle: 1 })
    }
  );
  assert.equal(blocked.status, 503);
});

test("production BNB rejects private signed publication and keeps wallet publication capabilities", async () => {
  const authorization = ownerAuthorizationEnvironment();
  const configured = readEnvironment({
    MARKET_DEPLOYMENT: "production",
    MARKET_DATABASE_URL: environment.databaseUrl,
    MARKET_ALLOWED_ORIGINS: "https://yunipals.com",
    MARKET_OWNER_TRADE_SCHEDULE_BASE64:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_BASE64,
    MARKET_OWNER_TRADE_SCHEDULE_SHA256:
      authorization.MARKET_OWNER_TRADE_SCHEDULE_SHA256,
    MARKET_BNB_TRADING_AUTHORIZATION: authorization.digest,
    MARKET_CAPABILITIES_BNB: "read,createListing,cancel",
    MARKET_TRADING_RPC_BNB: "http://127.0.0.1:19204",
    MARKET_BNB_POLICY_VERSION: "fixture-v1",
    MARKET_BNB_MAX_DURATION_SECONDS: "86400",
    MARKET_BNB_POLICY_FEES: "[]"
  });
  const app = createApp(configured, async () => {}, {
    capabilityHealth: {
      async current() {
        return {
          bnbWorker: true,
          openSeaRead: { ethereum: false, base: false, polygon: false },
          openSeaPublication: {
            ethereum: false,
            base: false,
            polygon: false
          }
        };
      }
    },
    bnbValidation: { policy: bnbValidationPolicy }
  });
  const capabilities = await app.request("/v1/market/capabilities");
  assert.equal(capabilities.status, 200);
  assert.equal((await capabilities.json()).chains.bnb.createListing, true);
  assert.equal((await app.request("/v1/market/policies/bnb")).status, 200);
  for (const path of ["/v1/market/orders/prepare", "/v1/market/orders"]) {
    const response = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset: { chain: "bnb" } })
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error.code,
      "signed_bnb_publication_disabled"
    );
  }
});

test("OpenSea fulfillment routes require explicit selected-chain validation without enabling public capabilities", async () => {
  let called = 0;
  const execute = async (
    chain: string,
    hash: string,
    body: unknown
  ): Promise<never> => {
    called++;
    assert.equal(chain, "base");
    assert.equal(hash, `0x${"ab".repeat(32)}`);
    assert.deepEqual(body, { actor: "fixture", lifecycle: 1 });
    throw new Error("fixture service reached");
  };
  const services = {
    openseaFulfillment: { preflight: execute, quote: execute, prepare: execute }
  };
  assert.throws(
    () => createApp(environment, async () => {}, services),
    /validation/
  );
  const app = createApp(
    {
      ...environment,
      openseaValidation: {
        chain: "base",
        rpcUrl: "http://127.0.0.1:18548",
        providerOrigin: "http://127.0.0.1:19548"
      }
    },
    async () => {},
    services
  );
  for (const action of ["preflight", "fulfillment", "prepare"]) {
    for (const chain of ["base", "ethereum", "polygon"]) {
      const before = called;
      await app.request(
        `/v1/market/orders/${chain}/${seaportDeployment.address}/0x${"ab".repeat(32)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor: "fixture", lifecycle: 1 })
        }
      );
      assert.equal(called - before, chain === "base" ? 1 : 0);
    }
    const malformed = await app.request(
      `/v1/market/orders/base/0x${"00".repeat(20)}/0x${"ab".repeat(32)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      }
    );
    assert.equal(malformed.status, 400);
  }
  const capabilities = await (
    await app.request("/v1/market/capabilities")
  ).json();
  for (const flags of Object.values(capabilities.chains))
    assert.ok(
      Object.values(flags as Record<string, boolean>).every(
        (value) => value === false
      )
    );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readSaleReplayEnvironment } from "@/environment";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";

const live = {
  MARKET_DEPLOYMENT: "staging",
  MARKET_SALE_CHAIN: "ethereum",
  MARKET_SALE_MODE: "live",
  MARKET_SALE_RPC: "https://rpc.example/",
  MARKET_SALE_POLICY: "ethereum-depth-20-v1"
};
test("sale worker configuration pins chain/policy and bounds execution without provider credentials", () => {
  assert.equal(readSaleReplayEnvironment(live).maxSeconds, 900);
  assert.equal(readSaleReplayEnvironment(live).finality, "confirmations");
  assert.deepEqual(readSaleReplayEnvironment(live).rpcUrls, [
    live.MARKET_SALE_RPC
  ]);
  const production = readSaleReplayEnvironment({
    ...live,
    MARKET_DEPLOYMENT: "production",
    MARKET_SALE_RPC_FAILOVER: "https://backup.example/"
  });
  assert.deepEqual(production.rpcUrls, [
    live.MARKET_SALE_RPC,
    "https://backup.example/"
  ]);
  assert.equal(production.finality, "finalized");
  const delegatedProduction = readSaleReplayEnvironment({
    ...live,
    MARKET_DEPLOYMENT: "production",
    MARKET_SALE_RPC: rpcBudgetProxyUrl("ethereum", "production")
  });
  assert.deepEqual(delegatedProduction.rpcUrls, [
    rpcBudgetProxyUrl("ethereum", "production")
  ]);
  assert.equal(delegatedProduction.finality, "finalized");
  assert.equal(
    readSaleReplayEnvironment({ ...live, MARKET_SALE_CONTINUOUS: "1" })
      .maxSeconds,
    undefined
  );
  assert.deepEqual(
    readSaleReplayEnvironment({
      ...live,
      MARKET_SALE_RPC: rpcBudgetProxyUrl("ethereum")
    }).rpcUrls,
    [rpcBudgetProxyUrl("ethereum")]
  );
  for (const change of [
    { MARKET_SALE_CHAIN: "bnb" },
    { MARKET_SALE_MODE: undefined },
    { MARKET_SALE_RPC: "http://rpc.example" },
    { MARKET_SALE_RPC: rpcBudgetProxyUrl("base") },
    { MARKET_SALE_RPC: rpcBudgetProxyUrl("ethereum", "production") },
    {
      MARKET_DEPLOYMENT: "production",
      MARKET_SALE_RPC: rpcBudgetProxyUrl("base", "production")
    },
    { MARKET_SALE_RPC: "https://user:password@rpc.example" },
    { MARKET_DEPLOYMENT: "production" },
    { MARKET_SALE_RPC_FAILOVER: "https://rpc.example/second" },
    { MARKET_SALE_POLICY: "" },
    { MARKET_SALE_MAX_SECONDS: "0" },
    { MARKET_SALE_MAX_SECONDS: "86401" },
    { MARKET_SALE_CONTINUOUS: "true" },
    { MARKET_SALE_CONTINUOUS: "1", MARKET_SALE_MAX_SECONDS: "900" },
    { MARKET_OPENSEA_VALIDATION_CHAIN: "ethereum" }
  ])
    assert.throws(() => readSaleReplayEnvironment({ ...live, ...change }));
});
test("fork sale replay requires staging and literal loopback HTTP", () => {
  const fork = {
    ...live,
    MARKET_SALE_MODE: "fork",
    MARKET_SALE_RPC: "http://127.0.0.1:18648"
  };
  assert.equal(readSaleReplayEnvironment(fork).mode, "fork");
  for (const change of [
    { MARKET_DEPLOYMENT: "production" },
    { MARKET_SALE_CONTINUOUS: "1" },
    { MARKET_SALE_RPC: "http://rpc.example" },
    { MARKET_SALE_RPC: "http://localhost:18648" },
    { MARKET_SALE_RPC: "http://127.0.0.1:18648?upstream=other" },
    { MARKET_SALE_RPC_FAILOVER: "http://127.0.0.1:18649" }
  ])
    assert.throws(() => readSaleReplayEnvironment({ ...fork, ...change }));
});

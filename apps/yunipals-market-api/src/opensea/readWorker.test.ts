import assert from "node:assert/strict";
import { test } from "node:test";
import { readOpenSeaReadEnvironment } from "@/environment";
import { classifyOpenSeaReadTransientFailure } from "@/opensea/readWorker";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";

const config = {
  MARKET_OPENSEA_READ_CHAIN: "base",
  MARKET_OPENSEA_READ_RPC: "https://rpc.example.test/private-token",
  MARKET_OPENSEA_READ_CONFIRMATIONS: "12"
};
test("live read configuration requires an explicit chain, HTTPS RPC and confirmation requirement", () => {
  const value = readOpenSeaReadEnvironment(config);
  assert.equal(value.confirmations, 12n);
  assert.equal(value.concurrency, 1);
  assert.equal(value.maxSeconds, undefined);
  assert.equal(value.finality, "confirmations");
  assert.deepEqual(value.rpcUrls, [config.MARKET_OPENSEA_READ_RPC]);
  const production = readOpenSeaReadEnvironment({
    ...config,
    MARKET_DEPLOYMENT: "production",
    MARKET_OPENSEA_READ_RPC_FAILOVER:
      "https://backup.example.test/private-token"
  });
  assert.deepEqual(production.rpcUrls, [
    config.MARKET_OPENSEA_READ_RPC,
    "https://backup.example.test/private-token"
  ]);
  assert.equal(production.finality, "finalized");
  const delegatedProduction = readOpenSeaReadEnvironment({
    ...config,
    MARKET_DEPLOYMENT: "production",
    MARKET_OPENSEA_READ_RPC: rpcBudgetProxyUrl("base", "production")
  });
  assert.deepEqual(delegatedProduction.rpcUrls, [
    rpcBudgetProxyUrl("base", "production")
  ]);
  assert.equal(delegatedProduction.finality, "finalized");
  assert.deepEqual(
    readOpenSeaReadEnvironment({
      ...config,
      MARKET_DEPLOYMENT: "staging",
      MARKET_OPENSEA_READ_RPC: rpcBudgetProxyUrl("base")
    }).rpcUrls,
    [rpcBudgetProxyUrl("base")]
  );
  for (const changes of [
    { MARKET_OPENSEA_READ_CHAIN: "bnb" },
    { MARKET_OPENSEA_READ_CONFIRMATIONS: undefined },
    { MARKET_OPENSEA_READ_CONFIRMATIONS: "0" },
    { MARKET_OPENSEA_READ_RPC: "http://127.0.0.1:8545" },
    { MARKET_OPENSEA_READ_RPC: rpcBudgetProxyUrl("ethereum") },
    { MARKET_OPENSEA_READ_RPC: rpcBudgetProxyUrl("base", "production") },
    {
      MARKET_DEPLOYMENT: "production",
      MARKET_OPENSEA_READ_RPC: rpcBudgetProxyUrl("ethereum", "production")
    },
    { MARKET_OPENSEA_READ_RPC: "https://secret:password@rpc.example.test/" },
    {
      MARKET_OPENSEA_READ_RPC_FAILOVER:
        "https://backup:password@backup.example.test/"
    },
    {
      MARKET_OPENSEA_READ_RPC_FAILOVER: "https://rpc.example.test/another-token"
    },
    { MARKET_DEPLOYMENT: "production" },
    { MARKET_OPENSEA_READ_CONCURRENCY: "9" },
    { MARKET_OPENSEA_READ_MAX_SECONDS: "0" },
    { MARKET_OPENSEA_VALIDATION_RPC: "http://127.0.0.1:8545" },
    { MARKET_BNB_VALIDATION_TRADING: "false" }
  ])
    assert.throws(
      () => readOpenSeaReadEnvironment({ ...config, ...changes }),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes("private-token") &&
        !error.message.includes("password")
    );
  assert.equal(
    readOpenSeaReadEnvironment({
      ...config,
      MARKET_OPENSEA_READ_MAX_SECONDS: "60"
    }).maxSeconds,
    60
  );
});

test("read workers retry only fixed infrastructure error classes", () => {
  for (const [code, expected] of [
    ["08006", "database_connection"],
    ["57014", "database_statement_timeout"],
    ["55P03", "database_lock_timeout"],
    ["57P01", "database_restart"],
    ["53300", "database_capacity"],
    ["40001", "database_serialization"],
    ["ECONNRESET", "database_network"]
  ] as const)
    assert.equal(
      classifyOpenSeaReadTransientFailure({ cause: { code } }),
      expected
    );
  assert.equal(
    classifyOpenSeaReadTransientFailure(new Error("private")),
    undefined
  );
  assert.equal(
    classifyOpenSeaReadTransientFailure({ code: "XX000" }),
    undefined
  );
});

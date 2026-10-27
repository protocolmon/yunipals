// Offline transport-policy evidence. All upstream responses are local stubs;
// this command never loads env files, opens a database or contacts a provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRpcBudgetProxy, isFreeRpcCall } from "../src/rpcBudgetProxy.ts";
import {
  alchemyComputeUnitModel,
  alchemyComputeUnits,
  RpcComputeBudgetError
} from "../src/opensea/rpcComputeBudget.ts";

assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outputIndex = process.argv.indexOf("--output");
const output = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
if (outputIndex !== -1 && !output) throw new Error("Missing output path.");
const hash = `0x${"ab".repeat(32)}`;
const address = `0x${"cd".repeat(20)}`;
const observations = [];

async function scenario(name, calls, expectedRoutes, options = {}) {
  const reservations = [];
  const routes = [];
  let freeAuthorizations = 0;
  const budget = {
    async authorizeFreeDispatch() {
      freeAuthorizations++;
    },
    async reserve(method) {
      if (options.denyPaid) throw new RpcComputeBudgetError(1000);
      reservations.push({ method, cu: alchemyComputeUnits(method) });
    },
    snapshot() {
      return {
        model: alchemyComputeUnitModel,
        workload: "source",
        priority: "background",
        grantedCu: 0,
        usedCu: reservations.reduce((sum, item) => sum + item.cu, 0),
        remainingCu: 0,
        denied: 0
      };
    }
  };
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.audit.invalid/"),
    ...(options.noFree
      ? {}
      : { freeUpstream: new URL("https://free.audit.invalid/") }),
    freeMinimumIntervalMs: 0,
    freeSourceMinimumIntervalMs: 0,
    paidFallbackOnFreeFailure: false,
    sourcePaidFallbackOnFreeFailure: false,
    budget,
    async fetch(url, request) {
      const route =
        new URL(url).hostname === "free.audit.invalid" ? "free" : "paid";
      routes.push(route);
      const body = JSON.parse(Buffer.from(request.body).toString("utf8"));
      const items = Array.isArray(body) ? body : [body];
      const responses = items.map((item) =>
        options.rejectFree && route === "free"
          ? {
              jsonrpc: "2.0",
              id: item.id,
              error: { code: -32000, message: "fixture unavailable" }
            }
          : {
              jsonrpc: "2.0",
              id: item.id,
              result: item.method === "eth_chainId" ? "0x2105" : []
            }
      );
      return new Response(
        JSON.stringify(Array.isArray(body) ? responses : responses[0]),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  try {
    const body = Array.isArray(calls)
      ? calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, ...call }))
      : { jsonrpc: "2.0", id: 1, ...calls };
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" }
    });
    await response.arrayBuffer();
    assert.deepEqual(routes, expectedRoutes, name);
    assert.equal(response.status, options.expectedStatus ?? 200, name);
    observations.push({
      name,
      status: response.status,
      routes,
      freeAuthorizations,
      reservations
    });
  } finally {
    await new Promise((resolveClose, rejectClose) =>
      proxy.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
}

// Request shapes read from installed Ponder and the unified evidence worker.
for (const [method, params] of [
  ["eth_chainId", []],
  ["eth_getBlockByNumber", ["latest", true]],
  ["eth_getBlockByHash", [hash, true]],
  ["eth_getLogs", [{ address, blockHash: hash }]],
  ["eth_getTransactionReceipt", [hash]]
]) {
  await scenario(`production_shape_${method}`, { method, params }, ["free"]);
}
await scenario(
  "historical_logs_paid_even_with_fallback_disabled",
  {
    method: "eth_getLogs",
    params: [{ address, fromBlock: "0x1", toBlock: "0x1f4" }]
  },
  ["paid"]
);
await scenario(
  "optional_block_receipts_paid_unknown_weight",
  {
    method: "eth_getBlockReceipts",
    params: [hash]
  },
  ["paid"]
);
await scenario(
  "unknown_read_paid_unknown_weight",
  {
    method: "eth_unreviewedRead",
    params: []
  },
  ["paid"]
);
await scenario(
  "no_free_pool_is_paid_even_with_fallback_disabled",
  {
    method: "eth_chainId",
    params: []
  },
  ["paid"],
  { noFree: true }
);
await scenario(
  "mixed_batch_moves_free_calls_to_paid",
  [
    { method: "eth_chainId", params: [] },
    { method: "eth_getBlockReceipts", params: [hash] }
  ],
  ["paid"]
);
await scenario(
  "address_count_is_not_manifest_scoped",
  {
    method: "eth_getLogs",
    params: [
      { address: Array.from({ length: 51 }, () => address), blockHash: hash }
    ]
  },
  ["free"]
);
await scenario(
  "free_failure_does_not_fall_back_by_default",
  {
    method: "eth_getLogs",
    params: [{ address, blockHash: hash }]
  },
  ["free"],
  { rejectFree: true }
);
await scenario(
  "paid_budget_denial_stops_dispatch",
  {
    method: "eth_getBlockReceipts",
    params: [hash]
  },
  [],
  { denyPaid: true, expectedStatus: 429 }
);
await scenario(
  "write_method_is_blocked",
  {
    method: "eth_sendRawTransaction",
    params: ["0x01"]
  },
  [],
  { expectedStatus: 502 }
);
await scenario(
  "more_than_1000_calls_are_blocked",
  Array.from({ length: 1001 }, () => ({
    method: "eth_chainId",
    params: []
  })),
  [],
  { expectedStatus: 502 }
);

const sourcePaths = [
  "apps/yunipals-market-api/src/rpcBudgetProxy.ts",
  "apps/yunipals-market-api/src/opensea/rpcComputeBudget.ts",
  "apps/yunipals-market-api/src/rpcBudgetProxyRegistry.ts",
  "apps/yunipals-indexer/ponder.config.ts",
  "apps/yunipals-indexer/lib/boosters/config.ts",
  "apps/yunipals-indexer/lib/unified/rpc.ts",
  "apps/yunipals-indexer/node_modules/ponder/src/build/config.ts",
  "apps/yunipals-indexer/node_modules/ponder/src/sync-realtime/index.ts",
  "apps/yunipals-indexer/node_modules/ponder/src/sync-historical/index.ts"
];
const files = await Promise.all(
  sourcePaths.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(resolve(repository, path)))
      .digest("hex")
  }))
);
const report = {
  format: "yunipals-unified-rpc-policy-audit-v1",
  status: "audit_complete_production_replay_not_approved",
  mode: "offline_stub_upstreams_loopback_transport_only",
  node: process.version,
  providerRequests: 0,
  databaseConnections: 0,
  sourceFiles: files,
  observations,
  classifiers: {
    blockReceiptsFree: isFreeRpcCall(
      { method: "eth_getBlockReceipts", params: [hash] },
      10000n
    ),
    blockReceiptsCu: alchemyComputeUnits("eth_getBlockReceipts"),
    historicalLogsFree: isFreeRpcCall(
      {
        method: "eth_getLogs",
        params: [{ address, fromBlock: "0x1", toBlock: "0x1f4" }]
      },
      10000n
    ),
    unboundedCurrentLogsFree: isFreeRpcCall(
      {
        method: "eth_getLogs",
        params: [{ fromBlock: "latest", toBlock: "latest" }]
      },
      10000n
    )
  },
  limitations: [
    "No external RPC/provider calls, current provider capability/cost confirmation or production policy inspection.",
    "Stub responses prove routing/accounting, not canonical EVM data validation or real provider throughput.",
    "Optional block-receipt requests came from the separate receipt-enabled RPC fixture; production Ponder contract configs omit includeTransactionReceipts.",
    "Existing source policy allows direct paid historical reads independently of the free-failure fallback switches."
  ]
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(resolve(output), json);
else process.stdout.write(json);

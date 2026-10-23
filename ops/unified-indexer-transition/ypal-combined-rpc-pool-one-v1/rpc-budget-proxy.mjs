// src/rpcBudgetProxy.ts
import { createHash as createHash2 } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  createServer
} from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ../../packages/yunipals-indexer-server/src/identity.ts
import { createHash } from "node:crypto";

// ../../packages/yunipals-indexer-client/src/sources.ts
function confirmationPolicyKey(policy) {
  switch (policy.kind) {
    case "latest":
    case "finalized":
      return policy.kind;
    case "depth":
      if (!Number.isSafeInteger(policy.subsequentBlocks) || policy.subsequentBlocks < 1) {
        throw new Error("Confirmation depth must be a positive safe integer.");
      }
      return `depth:${policy.subsequentBlocks}`;
    default:
      throw new Error("Unsupported confirmation policy.");
  }
}
var features = [
  "ownership",
  "islands",
  "boosters",
  "base-metadata",
  "marketplace",
  "arena"
];
var chains = /* @__PURE__ */ new Set([1, 56, 137, 8453]);
var decimal = /^(0|[1-9][0-9]*)$/;
function validateSourceManifest(manifest) {
  if (manifest.version !== 1 || manifest.ponderVersion !== "0.17.5" || manifest.ordering !== "multichain" || manifest.coverage !== "ponder-live-blocks-v1") {
    throw new Error("Unsupported source manifest runtime.");
  }
  const ids = /* @__PURE__ */ new Set();
  const subscriptions = /* @__PURE__ */ new Set();
  for (const source of manifest.sources) {
    if (!/^[a-z0-9][a-z0-9:_-]*$/.test(source.id) || ids.has(source.id)) {
      throw new Error("Invalid or duplicate source ID.");
    }
    ids.add(source.id);
    if (!features.includes(source.feature) || !chains.has(source.chainId) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(source.contractName) || typeof source.enabled !== "boolean" || !/^0x[0-9a-f]{64}$/.test(source.abiHash) || !["none", "full"].includes(source.receiptRequirement)) {
      throw new Error(`Invalid source configuration: ${source.id}.`);
    }
    if (source.address !== null && (!/^0x[0-9a-f]{40}$/.test(source.address) || /^0x0{40}$/.test(source.address))) {
      throw new Error(`Invalid source address: ${source.id}.`);
    }
    for (const value of [source.startBlock, source.endBlock]) {
      if (value !== null && (!decimal.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Invalid source block: ${source.id}.`);
      }
    }
    if (source.enabled && (source.address === null || source.startBlock === null) || source.endBlock !== null && (source.startBlock === null || BigInt(source.endBlock) < BigInt(source.startBlock))) {
      throw new Error(`Incomplete source bounds: ${source.id}.`);
    }
    if (source.receiptStartBlock !== void 0 && (!source.enabled || source.receiptRequirement !== "full" || typeof source.receiptStartBlock !== "string" || !decimal.test(source.receiptStartBlock) || BigInt(source.receiptStartBlock) > BigInt(Number.MAX_SAFE_INTEGER) || source.startBlock === null || BigInt(source.receiptStartBlock) < BigInt(source.startBlock) || source.endBlock !== null && BigInt(source.receiptStartBlock) > BigInt(source.endBlock))) {
      throw new Error(`Invalid source receipt history: ${source.id}.`);
    }
    if (source.events.length === 0 || new Set(source.events).size !== source.events.length || source.events.some((event) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)) || source.policies.length === 0) {
      throw new Error(`Invalid source filters: ${source.id}.`);
    }
    const policies = source.policies.map(confirmationPolicyKey);
    if (new Set(policies).size !== policies.length) {
      throw new Error(`Duplicate confirmation policy: ${source.id}.`);
    }
    if (source.enabled) {
      for (const event of source.events) {
        const subscription = JSON.stringify([
          source.chainId,
          source.address,
          event
        ]);
        if (subscriptions.has(subscription)) {
          throw new Error(`Duplicate source subscription: ${source.id}.`);
        }
        subscriptions.add(subscription);
      }
    }
  }
}

// ../../packages/yunipals-indexer-server/src/identity.ts
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object2 = value;
    return `{${Object.keys(object2).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object2[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === void 0)
    throw new Error("Manifest contains a non-JSON value.");
  return encoded;
}
function manifestDigest(value) {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
function sourceManifestHash(manifest) {
  validateSourceManifest(manifest);
  return manifestDigest({
    ...manifest,
    sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id))
  });
}

// ../../packages/yunipals-market-core/src/registry.ts
var seaportDeployment = {
  address: "0x0000000000000068F116a894984e2DB1123eB395",
  name: "Seaport",
  version: "1.6"
};

// ../../packages/yunipals-indexer-server/src/rpc-policy.ts
var unifiedRpcProfileHeader = "x-yunipals-unified-rpc-profile";
var unifiedRpcPath = "/unified";
var unifiedRpcPermitHeader = "x-yunipals-unified-rpc-permit";
var unifiedRpcWorkloads = [
  "unified_source",
  "unified_evidence"
];
var UnifiedRpcRangeError = class extends Error {
  constructor(maximum) {
    super(`eth_getLogs is limited to ${maximum} blocks`);
    this.maximum = maximum;
  }
};
var hash = /^0x[0-9a-f]{64}$/;
var address = /^0x[0-9a-f]{40}$/i;
var quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
var readMethods = /* @__PURE__ */ new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getCode"
]);
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid unified RPC policy.");
  return value;
}
function exact(value, keys) {
  if (Object.keys(value).sort().join() !== [...keys].sort().join())
    throw new Error("Invalid unified RPC policy fields.");
}
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum)
    throw new Error("Invalid unified RPC policy limit.");
}
function validateUnifiedRpcProfile(value) {
  const profile = object(value);
  exact(profile, [
    "version",
    "model",
    "scope",
    "coordinatorId",
    "manifest",
    "limits",
    ...profile.reviewId !== void 0 ? ["reviewId"] : []
  ]);
  if (profile.version !== 1 || profile.model !== "alchemy-2026-09-08" || typeof profile.scope !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.scope) || typeof profile.coordinatorId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    profile.coordinatorId
  ))
    throw new Error("Invalid unified RPC policy identity.");
  if (profile.reviewId !== void 0 && (typeof profile.reviewId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    profile.reviewId
  )))
    throw new Error("Invalid unified RPC review identity.");
  validateSourceManifest(profile.manifest);
  const limits = object(profile.limits);
  exact(limits, ["batchCalls", "logRange", "addresses", "topicValues"]);
  integer(limits.batchCalls, 100);
  integer(limits.logRange, 1e4);
  integer(limits.addresses, 50);
  integer(limits.topicValues, 128);
  return profile;
}
function unifiedRpcProfileId(profile) {
  validateUnifiedRpcProfile(profile);
  return manifestDigest(profile);
}
function unifiedRpcManifestId(profile) {
  return sourceManifestHash(profile.manifest);
}
function isUnifiedRpcWorkload(value) {
  return unifiedRpcWorkloads.includes(value);
}
function validateUnifiedRpcCalls(profile, chainId, calls) {
  const sources = profile.manifest.sources.filter(
    (source) => source.enabled && source.chainId === chainId
  );
  if (!sources.length || !calls.length || calls.length > profile.limits.batchCalls)
    throw new Error("Unified RPC source/batch policy refused.");
  const addresses = /* @__PURE__ */ new Map();
  for (const source of sources) {
    const address3 = source.address, start = BigInt(source.startBlock);
    if (!addresses.has(address3) || start < addresses.get(address3))
      addresses.set(address3, start);
  }
  const minimum = sources.reduce(
    (value, source) => BigInt(source.startBlock) < value ? BigInt(source.startBlock) : value,
    BigInt(sources[0].startBlock)
  );
  const codeAddresses = new Map(addresses);
  const fullReceipts = sources.filter(
    (source) => source.receiptRequirement === "full"
  );
  if (fullReceipts.length) {
    const earliest = fullReceipts.reduce(
      (start, source) => BigInt(source.startBlock) < start ? BigInt(source.startBlock) : start,
      BigInt(fullReceipts[0].startBlock)
    );
    const protocol = seaportDeployment.address.toLowerCase();
    const previous = codeAddresses.get(protocol);
    codeAddresses.set(
      protocol,
      previous !== void 0 && previous < earliest ? previous : earliest
    );
  }
  const number = (value) => {
    if (typeof value !== "string" || !quantity.test(value))
      throw new Error("Invalid RPC block quantity.");
    return BigInt(value);
  };
  for (const call of calls) {
    if (!readMethods.has(call.method) || call.params !== void 0 && !Array.isArray(call.params))
      throw new Error("Unified RPC method policy refused.");
    const params = call.params ?? [];
    if (call.method === "eth_chainId" || call.method === "eth_blockNumber") {
      if (params.length) throw new Error("Invalid RPC arguments.");
    } else if (call.method === "eth_getBlockByHash") {
      if (params.length !== 2 || typeof params[0] !== "string" || !hash.test(params[0]) || typeof params[1] !== "boolean")
        throw new Error("Invalid block-hash read.");
    } else if (call.method === "eth_getBlockByNumber") {
      if (params.length !== 2 || typeof params[1] !== "boolean")
        throw new Error("Invalid block read.");
      if (!["latest", "safe", "finalized"].includes(String(params[0])))
        number(params[0]);
    } else if (call.method === "eth_getTransactionByBlockNumberAndIndex") {
      if (params.length !== 2)
        throw new Error("Invalid block transaction read.");
      number(params[0]);
      if (number(params[1]) > 2147483647n)
        throw new Error("Invalid block transaction index.");
    } else if (call.method === "eth_getTransactionReceipt" || call.method === "eth_getTransactionByHash") {
      if (params.length !== 1 || typeof params[0] !== "string" || !hash.test(params[0]))
        throw new Error(
          call.method === "eth_getTransactionReceipt" ? "Invalid receipt read." : "Invalid transaction hash read."
        );
    } else if (call.method === "eth_getCode") {
      if (params.length !== 2 || typeof params[0] !== "string" || !codeAddresses.has(params[0].toLowerCase()))
        throw new Error("Code read outside reviewed sources.");
      if (number(params[1]) < codeAddresses.get(params[0].toLowerCase()))
        throw new Error("Code read before deployment.");
    } else {
      if (params.length !== 1) throw new Error("Invalid log read.");
      const filter = object(params[0]);
      if (Object.keys(filter).some(
        (key) => ![
          "address",
          "topics",
          "fromBlock",
          "toBlock",
          "blockHash"
        ].includes(key)
      ))
        throw new Error("Unknown log filter.");
      if (filter.blockHash !== void 0) {
        if (typeof filter.blockHash !== "string" || !hash.test(filter.blockHash) || filter.fromBlock !== void 0 || filter.toBlock !== void 0)
          throw new Error("Invalid block-hash logs.");
      } else {
        const from = number(filter.fromBlock), to = number(filter.toBlock);
        if (from < minimum || to < from)
          throw new Error("Unified RPC log range policy refused.");
        if (to - from + 1n > BigInt(profile.limits.logRange))
          throw new UnifiedRpcRangeError(profile.limits.logRange);
        if (filter.address === void 0)
          throw new Error("Historical logs require reviewed addresses.");
      }
      if (filter.address !== void 0) {
        const requested = Array.isArray(filter.address) ? filter.address : [filter.address];
        if (!requested.length || requested.length > profile.limits.addresses || requested.some(
          (value) => typeof value !== "string" || !address.test(value) || !addresses.has(value.toLowerCase())
        ))
          throw new Error("Logs outside reviewed sources.");
        if (filter.fromBlock !== void 0) {
          const earliest = requested.reduce(
            (start, value) => {
              const deployment = addresses.get(String(value).toLowerCase());
              return deployment < start ? deployment : start;
            },
            addresses.get(String(requested[0]).toLowerCase())
          );
          if (number(filter.fromBlock) < earliest)
            throw new Error(
              "Historical logs precede reviewed address deployment."
            );
        }
      }
      if (filter.topics !== void 0) {
        if (!Array.isArray(filter.topics) || filter.topics.length > 4)
          throw new Error("Invalid log topics.");
        let count = 0;
        for (const topic of filter.topics) {
          const values = Array.isArray(topic) ? topic : [topic];
          count += values.length;
          if (values.some(
            (value) => value !== null && (typeof value !== "string" || !hash.test(value))
          ))
            throw new Error("Invalid log topic.");
        }
        if (count > profile.limits.topicValues)
          throw new Error("Too many log topics.");
      }
    }
  }
}
function unifiedRpcPaidRange(call) {
  const params = call.params;
  let from, to;
  if (call.method === "eth_getLogs") {
    const filter = object(params[0]);
    from = filter.fromBlock;
    to = filter.toBlock;
  } else if (call.method === "eth_getCode") from = to = params[1];
  else if (call.method === "eth_getBlockByNumber") from = to = params[0];
  if (typeof from !== "string" || typeof to !== "string" || !quantity.test(from) || !quantity.test(to))
    throw new Error("Unified RPC paid read cannot be height bounded.");
  return { fromBlock: String(BigInt(from)), toBlock: String(BigInt(to)) };
}

// src/opensea/requestBudget.ts
import { randomUUID } from "node:crypto";
import pg3 from "pg";

// src/db/pool.ts
import pg from "pg";
async function transaction(pool, task) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

// src/environment.ts
import { getAddress as getAddress4, zeroAddress as zeroAddress3 } from "viem";

// src/ownerTradeAuthorization.ts
import { getAddress as getAddress3, maxUint256 as maxUint2562, zeroAddress as zeroAddress2 } from "viem";

// ../../packages/yunipals-market-core/src/marketOrder.ts
import { getAddress as getAddress2, zeroAddress } from "viem";

// ../../packages/yunipals-market-core/src/validation.ts
import { getAddress, maxUint256 } from "viem";

// src/rpcBudgetProxyRegistry.ts
var rpcBudgetWorkloadHeader = "x-yunipals-rpc-workload";
function isDelegatedRpcComputeWorkload(value) {
  return value === "order_projection" || value === "sale" || value === "foreground";
}

// src/indexer/ownership.ts
import pg2 from "pg";

// ../../packages/yunipals-market-core/src/collectionAbi.ts
import { parseAbi } from "viem";
var collectionAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function setBaseURI(string baseURI)",
  "function setTokenURI(uint256 tokenId, string tokenURI)"
]);

// src/environment.ts
function readOpenSeaBudgetEnvironment(input = process.env) {
  const databaseUrl = input.MARKET_OPENSEA_BUDGET_DATABASE_URL;
  const scope = input.MARKET_OPENSEA_BUDGET_SCOPE;
  const coordinatorId = input.MARKET_OPENSEA_BUDGET_COORDINATOR_ID;
  if (!databaseUrl || !scope)
    throw new Error(
      "Configure the shared OpenSea budget database and account scope."
    );
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid OpenSea budget database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2)
    throw new Error("Invalid OpenSea budget database URL.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope))
    throw new Error("Invalid OpenSea budget scope.");
  if (coordinatorId !== void 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    coordinatorId
  ))
    throw new Error("Invalid OpenSea budget coordinator identity.");
  if (input.MARKET_DEPLOYMENT === "production" && !coordinatorId)
    throw new Error(
      "Configure the production OpenSea budget coordinator identity."
    );
  return { databaseUrl, scope, coordinatorId: coordinatorId?.toLowerCase() };
}

// src/opensea/rpcComputeBudget.ts
var alchemyComputeUnitModel = "alchemy-2026-09-08";
var methodComputeUnits = {
  // Alchemy currently prices these methods at zero CU. A paid route reserves
  // one CU; a free route uses the non-consuming policy authorization below.
  eth_chainId: 1,
  eth_protocolVersion: 1,
  eth_syncing: 1,
  net_listening: 1,
  net_peerCount: 1,
  net_version: 1,
  eth_blockNumber: 10,
  eth_feeHistory: 10,
  eth_gasPrice: 20,
  eth_maxPriorityFeePerGas: 10,
  eth_getBalance: 20,
  eth_getBlockByHash: 20,
  eth_getBlockByNumber: 20,
  eth_getCode: 20,
  eth_getStorageAt: 20,
  eth_getTransactionByHash: 20,
  eth_getTransactionCount: 20,
  eth_getTransactionReceipt: 20,
  eth_call: 26,
  eth_estimateGas: 20,
  eth_getLogs: 60
};
function alchemyComputeUnits(method) {
  return methodComputeUnits[method] ?? 1e3;
}
var RpcComputeBudgetError = class extends Error {
  constructor(retryAfterMs) {
    super("rpc_budget_exhausted");
    this.retryAfterMs = retryAfterMs;
  }
};
function rpcComputeBudgetError(error) {
  const seen = /* @__PURE__ */ new Set();
  for (let cause = error; cause && typeof cause === "object" && seen.size < 8; cause = "cause" in cause ? cause.cause : void 0) {
    if (cause instanceof RpcComputeBudgetError) return cause;
    if (seen.has(cause)) break;
    seen.add(cause);
  }
  return void 0;
}
var PostgresRpcComputeBudget = class {
  constructor(pool, scope, workload, priority, grantSizeCu = 1e3) {
    this.pool = pool;
    this.scope = scope;
    this.workload = workload;
    this.priority = priority;
    this.grantSizeCu = grantSizeCu;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope) || !/^[a-z][a-z0-9_-]{0,63}$/.test(workload) || !["background", "foreground"].includes(priority) || !Number.isSafeInteger(grantSizeCu) || grantSizeCu < 20 || grantSizeCu > 1e5)
      throw new Error("Invalid RPC compute budget configuration.");
  }
  remainingCu = 0;
  grantedCu = 0;
  usedCu = 0;
  denied = 0;
  acquiring;
  authorizingFree;
  freeAuthorizedUntil = 0;
  async acquire(minimumCu) {
    const requestedCu = Math.max(minimumCu, this.grantSizeCu);
    const result = await transaction(this.pool, async (client) => {
      const policy = (await client.query(
        `SELECT b.enabled,b.daily_cu::text,b.foreground_reserve_cu::text,
          a.daily_cu::text AS allocation_cu,a.priority AS configured_priority,
          (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS window_start,
          floor(extract(epoch FROM ((date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'))*1000)::bigint::text AS reset_at
          FROM yunipals_market.rpc_compute_budget b
          JOIN yunipals_market.rpc_compute_allocation a USING(scope)
          WHERE b.scope=$1 AND a.workload=$2`,
        [this.scope, this.workload]
      )).rows[0];
      if (!policy)
        throw new Error("RPC compute budget is not provisioned for workload.");
      if (policy.configured_priority !== this.priority)
        throw new Error("RPC compute budget priority differs from policy.");
      const now = Date.now();
      const resetAt = Number(policy.reset_at);
      if (!policy.enabled)
        return { granted: 0, retryAfterMs: Math.max(1, resetAt - now) };
      await client.query(
        `INSERT INTO yunipals_market.rpc_compute_window(scope,window_start)
        VALUES($1,$2::date) ON CONFLICT DO NOTHING`,
        [this.scope, policy.window_start]
      );
      await client.query(
        `INSERT INTO yunipals_market.rpc_compute_workload_window(scope,workload,window_start)
        VALUES($1,$2,$3::date) ON CONFLICT DO NOTHING`,
        [this.scope, this.workload, policy.window_start]
      );
      const window = (await client.query(
        `SELECT w.granted_cu::text,w.background_granted_cu::text,
          a.granted_cu::text AS workload_granted_cu
          FROM yunipals_market.rpc_compute_window w
          JOIN yunipals_market.rpc_compute_workload_window a
            USING(scope,window_start)
          WHERE w.scope=$1 AND w.window_start=$3::date AND a.workload=$2
          FOR UPDATE OF w,a`,
        [this.scope, this.workload, policy.window_start]
      )).rows[0];
      const daily = Number(policy.daily_cu);
      const reserve = Number(policy.foreground_reserve_cu);
      const allocation = Number(policy.allocation_cu);
      const granted = Number(window.granted_cu);
      const background = Number(window.background_granted_cu);
      const workload = Number(window.workload_granted_cu);
      const globalRemaining = this.priority === "foreground" ? daily - granted : Math.min(daily - reserve - background, daily - granted);
      const available = Math.min(globalRemaining, allocation - workload);
      if (available < minimumCu)
        return { granted: 0, retryAfterMs: Math.max(1, resetAt - now) };
      const amount = Math.min(requestedCu, available);
      await client.query(
        `UPDATE yunipals_market.rpc_compute_window SET
          granted_cu=granted_cu+$3,
          background_granted_cu=background_granted_cu+CASE WHEN $4='background' THEN $3 ELSE 0 END
        WHERE scope=$1 AND window_start=$2::date`,
        [this.scope, policy.window_start, amount, this.priority]
      );
      await client.query(
        `UPDATE yunipals_market.rpc_compute_workload_window
        SET granted_cu=granted_cu+$4
        WHERE scope=$1 AND workload=$2 AND window_start=$3::date`,
        [this.scope, this.workload, policy.window_start, amount]
      );
      await client.query(
        `DELETE FROM yunipals_market.rpc_compute_workload_window
        WHERE window_start<$1::date-31`,
        [policy.window_start]
      );
      await client.query(
        `DELETE FROM yunipals_market.rpc_compute_window
        WHERE window_start<$1::date-31`,
        [policy.window_start]
      );
      return { granted: amount, retryAfterMs: 0 };
    });
    if (!result.granted) {
      this.denied++;
      throw new RpcComputeBudgetError(result.retryAfterMs);
    }
    this.grantedCu += result.granted;
    this.remainingCu += result.granted;
  }
  /**
   * Keep the operator kill switch fail-closed for public RPC traffic without
   * recording free-provider requests as paid Alchemy compute units.
   */
  async authorizeFreeDispatch() {
    if (Date.now() < this.freeAuthorizedUntil) return;
    if (!this.authorizingFree)
      this.authorizingFree = (async () => {
        const policy = (await this.pool.query(
          `SELECT b.enabled,a.priority AS configured_priority,
            floor(extract(epoch FROM ((date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'))*1000)::bigint::text AS reset_at
            FROM yunipals_market.rpc_compute_budget b
            JOIN yunipals_market.rpc_compute_allocation a USING(scope)
            WHERE b.scope=$1 AND a.workload=$2`,
          [this.scope, this.workload]
        )).rows[0];
        if (!policy)
          throw new Error(
            "RPC compute budget is not provisioned for workload."
          );
        if (policy.configured_priority !== this.priority)
          throw new Error("RPC compute budget priority differs from policy.");
        if (!policy.enabled) {
          this.denied++;
          throw new RpcComputeBudgetError(
            Math.max(1, Number(policy.reset_at) - Date.now())
          );
        }
        this.freeAuthorizedUntil = Math.min(
          Date.now() + 1e3,
          Number(policy.reset_at)
        );
      })().finally(() => {
        this.authorizingFree = void 0;
      });
    await this.authorizingFree;
  }
  async reserve(method) {
    const cost = alchemyComputeUnits(method);
    if (cost === 0) return;
    while (this.remainingCu < cost) {
      if (!this.acquiring)
        this.acquiring = this.acquire(cost).finally(() => {
          this.acquiring = void 0;
        });
      await this.acquiring;
    }
    this.remainingCu -= cost;
    this.usedCu += cost;
  }
  snapshot() {
    return {
      model: alchemyComputeUnitModel,
      workload: this.workload,
      priority: this.priority,
      grantedCu: this.grantedCu,
      usedCu: this.usedCu,
      remainingCu: this.remainingCu,
      denied: this.denied
    };
  }
};

// src/opensea/requestBudget.ts
var OpenSeaBudgetError = class extends Error {
  constructor(retryAfterMs) {
    super("provider_budget_exhausted");
    this.retryAfterMs = retryAfterMs;
  }
};
function headerInteger(raw) {
  if (!raw || !/^[0-9]{1,13}$/.test(raw)) return void 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : void 0;
}
var PostgresOpenSeaRequestBudget = class {
  constructor(pool, scope, headroom = {
    allPerHour: 0,
    fulfillmentPerMinute: 0
  }, context = {
    caller: "legacy",
    workload: "legacy",
    priority: "foreground"
  }, coordinatorId) {
    this.pool = pool;
    this.scope = scope;
    this.headroom = headroom;
    this.context = context;
    this.coordinatorId = coordinatorId;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope))
      throw new Error("Invalid OpenSea budget scope.");
    if (!Number.isSafeInteger(headroom.allPerHour) || headroom.allPerHour < 0 || headroom.allPerHour > 1e6 || !Number.isSafeInteger(headroom.fulfillmentPerMinute) || headroom.fulfillmentPerMinute < 0 || headroom.fulfillmentPerMinute > 1e5)
      throw new Error("Invalid OpenSea background request headroom.");
    if (![
      "api",
      "discovery",
      "read_worker",
      "signature",
      "publication",
      "probe",
      "incident",
      "retired_staging",
      "test",
      "legacy"
    ].includes(context.caller) || ![
      "foreground",
      "discovery",
      "order_projection",
      "signature",
      "publication",
      "incident",
      "legacy"
    ].includes(context.workload) || !["background", "foreground"].includes(context.priority))
      throw new Error("Invalid OpenSea request budget context.");
    this.headroom = { ...headroom };
    this.context = { ...context };
    if (coordinatorId !== void 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      coordinatorId
    ))
      throw new Error("Invalid OpenSea budget coordinator identity.");
  }
  async lock(client) {
    const result = await client.query(
      `
      SELECT b.*, greatest(s.clock_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)::text AS now,
        s.blocked_until::text
      FROM yunipals_market.opensea_request_budget b
      JOIN yunipals_market.opensea_request_budget_state s USING(scope)
      WHERE b.scope=$1 FOR UPDATE OF s`,
      [this.scope]
    );
    const state = result.rows[0];
    if (!state) throw new Error("OpenSea budget is not provisioned.");
    if (this.coordinatorId && state.coordinator_id.toLowerCase() !== this.coordinatorId)
      throw new Error("OpenSea budget coordinator identity mismatch.");
    await client.query(
      "UPDATE yunipals_market.opensea_request_budget_state SET clock_at=$2 WHERE scope=$1",
      [this.scope, state.now]
    );
    return state;
  }
  async reserve(kind, endpointClass = "unknown") {
    if (!["read", "fulfillment", "publication"].includes(kind))
      throw new Error("Invalid OpenSea request kind.");
    if (![
      "collection_policy",
      "contract",
      "listings",
      "offers",
      "order_lookup",
      "fulfillment",
      "publication",
      "unknown"
    ].includes(endpointClass))
      throw new Error("Invalid OpenSea endpoint class.");
    const result = await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      if (!state.enabled) {
        await this.rejectedMetric(client, kind, endpointClass, now, 6e4);
        return { delay: 6e4 };
      }
      let delay = Math.max(0, Number(state.blocked_until) - now);
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_endpoint_window WHERE scope=$1 AND reset_at<=$2",
        [this.scope, now]
      );
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_window WHERE scope=$1 AND reset_at<=$2",
        [this.scope, now]
      );
      const windows = await client.query(
        `SELECT max(reset_at)::text AS until FROM (
          SELECT reset_at FROM yunipals_market.opensea_request_endpoint_window
          WHERE scope=$1 AND endpoint_class IN ($2,'unknown') AND remaining<=$3
          UNION ALL
          SELECT reset_at FROM yunipals_market.opensea_request_window
          WHERE scope=$1 AND remaining<=$3
        ) AS active_windows`,
        // Aggregate hourly headroom is enforced by the local rolling counter.
        // Provider windows apply only to their request group; preserve explicit
        // fulfillment headroom without treating a minute bucket as hourly.
        [
          this.scope,
          endpointClass,
          kind === "fulfillment" ? this.headroom.fulfillmentPerMinute : 0
        ]
      );
      delay = Math.max(delay, Number(windows.rows[0].until) - now);
      await client.query(
        `INSERT INTO yunipals_market.opensea_request_metric_minute
        (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
        SELECT scope,to_timestamp(floor(reserved_at::double precision/60000)*60),caller,workload,priority,kind,
          endpoint_class,'lost',0,count(*),sum(greatest(0,$2-reserved_at)),0
        FROM yunipals_market.opensea_request_reservation
        WHERE scope=$1 AND reserved_at<=$2-3600000 AND NOT completed
        GROUP BY scope,to_timestamp(floor(reserved_at::double precision/60000)*60),caller,workload,priority,kind,endpoint_class
        ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
        DO UPDATE SET requests=opensea_request_metric_minute.requests+excluded.requests,
          latency_ms=opensea_request_metric_minute.latency_ms+excluded.latency_ms`,
        [this.scope, now]
      );
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_reservation WHERE scope=$1 AND reserved_at<=$2",
        [this.scope, now - 36e5]
      );
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_metric_minute WHERE scope=$1 AND bucket_at<to_timestamp($2::double precision/1000)-interval '90 days'",
        [this.scope, now]
      );
      const counts = await client.query(
        `
        SELECT count(*)::integer AS total,
          count(*) FILTER(WHERE kind='fulfillment' AND reserved_at>$2)::integer AS fulfillment,
          count(*) FILTER(WHERE kind='publication')::integer AS publication,
          min(reserved_at)::text AS first_all,
          min(reserved_at) FILTER(WHERE kind='fulfillment' AND reserved_at>$2)::text AS first_fulfillment,
          min(reserved_at) FILTER(WHERE kind='publication')::text AS first_publication
        FROM yunipals_market.opensea_request_reservation WHERE scope=$1`,
        [this.scope, now - 6e4]
      );
      const row = counts.rows[0];
      if (row.total >= state.all_per_hour - this.headroom.allPerHour)
        delay = Math.max(
          delay,
          row.first_all === null ? 6e4 : Number(row.first_all) + 36e5 - now
        );
      if (kind === "fulfillment" && row.fulfillment >= state.fulfillment_per_minute - this.headroom.fulfillmentPerMinute)
        delay = Math.max(
          delay,
          row.first_fulfillment === null ? 6e4 : Number(row.first_fulfillment) + 6e4 - now
        );
      if (kind === "publication" && row.publication >= state.publication_per_hour)
        delay = Math.max(delay, Number(row.first_publication) + 36e5 - now);
      if (delay > 0) {
        await this.rejectedMetric(client, kind, endpointClass, now, delay);
        return { delay };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO yunipals_market.opensea_request_reservation
        (id,scope,kind,reserved_at,caller,workload,priority,endpoint_class)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          this.scope,
          kind,
          now,
          this.context.caller,
          this.context.workload,
          this.context.priority,
          endpointClass
        ]
      );
      await client.query(
        `UPDATE yunipals_market.opensea_request_endpoint_window SET remaining=greatest(0,remaining-1)
        WHERE scope=$1 AND endpoint_class IN ($2,'unknown')`,
        [this.scope, endpointClass]
      );
      await client.query(
        `UPDATE yunipals_market.opensea_request_window SET remaining=greatest(0,remaining-1)
        WHERE scope=$1`,
        [this.scope]
      );
      return { id };
    });
    if (!result.id)
      throw new OpenSeaBudgetError(Math.max(1, result.delay ?? 6e4));
    return result.id;
  }
  async observe(reservation, response2) {
    await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      const recorded = await client.query(
        `UPDATE yunipals_market.opensea_request_reservation
        SET completed=true,response_status=$3,outcome=$4,completed_at=$5
        WHERE scope=$1 AND id=$2 AND NOT completed
        RETURNING reserved_at::text,kind,caller,workload,priority,endpoint_class`,
        [
          this.scope,
          reservation,
          response2.status,
          response2.status < 400 ? "completed" : "provider_error",
          now
        ]
      );
      if (!recorded.rowCount) return;
      let blocked = Number(state.blocked_until);
      const rawReset = headerInteger(response2.headers.get("x-ratelimit-reset"));
      const reportedReset = rawReset !== void 0 && Number.isSafeInteger(rawReset * 1e3) ? rawReset : void 0;
      const reportedRemaining = headerInteger(
        response2.headers.get("x-ratelimit-remaining")
      );
      const reportedLimit = headerInteger(
        response2.headers.get("x-ratelimit-limit")
      );
      const request = recorded.rows[0];
      if (reportedReset !== void 0 && reportedReset * 1e3 > now && reportedRemaining !== void 0 && reportedRemaining <= 2147483647) {
        const pending = await client.query(
          `SELECT count(*)::integer AS count FROM yunipals_market.opensea_request_reservation
          WHERE scope=$1 AND endpoint_class=$4 AND id<>$2 AND (NOT completed OR reserved_at>=$3)`,
          [this.scope, reservation, request.reserved_at, request.endpoint_class]
        );
        const allowance = Math.max(
          0,
          Math.min(reportedRemaining, reportedLimit ?? reportedRemaining) - pending.rows[0].count
        );
        await client.query(
          `INSERT INTO yunipals_market.opensea_request_endpoint_window(scope,endpoint_class,reset_at,remaining) VALUES($1,$2,$3,$4)
          ON CONFLICT(scope,endpoint_class,reset_at) DO UPDATE SET remaining=least(opensea_request_endpoint_window.remaining,excluded.remaining)`,
          [this.scope, request.endpoint_class, reportedReset * 1e3, allowance]
        );
      }
      if (response2.status === 429) {
        const raw = response2.headers.get("retry-after");
        const seconds = headerInteger(raw);
        const retryAt = seconds !== void 0 ? now + seconds * 1e3 : raw ? Date.parse(raw) : NaN;
        blocked = Math.max(
          blocked,
          now + 1e3,
          Number.isSafeInteger(retryAt) ? retryAt : now + 6e4,
          reportedReset !== void 0 ? reportedReset * 1e3 : 0
        );
      }
      await client.query(
        `UPDATE yunipals_market.opensea_request_budget_state
        SET blocked_until=$2 WHERE scope=$1`,
        [this.scope, blocked]
      );
      await this.metric(
        client,
        request,
        now,
        response2.status < 400 ? "completed" : "provider_error",
        response2.status,
        Math.max(0, blocked - now)
      );
    });
  }
  async metric(client, request, now, outcome, responseStatus, retryAfterMs) {
    await client.query(
      `INSERT INTO yunipals_market.opensea_request_metric_minute
      (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
      VALUES($1,to_timestamp(floor($2::double precision/60000)*60),$3,$4,$5,$6,$7,$8,$9,1,$10,$11)
      ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
      DO UPDATE SET requests=opensea_request_metric_minute.requests+1,
        latency_ms=opensea_request_metric_minute.latency_ms+excluded.latency_ms,
        retry_after_ms=greatest(opensea_request_metric_minute.retry_after_ms,excluded.retry_after_ms)`,
      [
        this.scope,
        now,
        request.caller,
        request.workload,
        request.priority,
        request.kind,
        request.endpoint_class,
        outcome,
        responseStatus,
        Math.max(0, now - Number(request.reserved_at)),
        retryAfterMs
      ]
    );
  }
  async rejectedMetric(client, kind, endpointClass, now, retryAfterMs) {
    await client.query(
      `INSERT INTO yunipals_market.opensea_request_metric_minute
      (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
      VALUES($1,to_timestamp(floor($2::double precision/60000)*60),$3,$4,$5,$6,$7,'local_quota',0,1,0,$8)
      ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
      DO UPDATE SET requests=opensea_request_metric_minute.requests+1,
        retry_after_ms=greatest(opensea_request_metric_minute.retry_after_ms,excluded.retry_after_ms)`,
      [
        this.scope,
        now,
        this.context.caller,
        this.context.workload,
        this.context.priority,
        kind,
        endpointClass,
        Math.min(864e5, Math.max(1, Math.ceil(retryAfterMs)))
      ]
    );
  }
  async fail(reservation, outcome, retryAfterMs = 0) {
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)
      throw new Error("Invalid OpenSea request retry delay.");
    await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      const recorded = await client.query(
        `UPDATE yunipals_market.opensea_request_reservation
        SET completed=true,outcome=$3,completed_at=$4,retry_after_ms=$5
        WHERE scope=$1 AND id=$2 AND NOT completed
        RETURNING reserved_at::text,kind,caller,workload,priority,endpoint_class`,
        [
          this.scope,
          reservation,
          outcome,
          now,
          Math.min(retryAfterMs, 864e5)
        ]
      );
      if (!recorded.rowCount) return;
      await this.metric(
        client,
        recorded.rows[0],
        now,
        outcome,
        0,
        retryAfterMs
      );
    });
  }
};
function createOpenSeaRequestBudget(input = process.env) {
  const { databaseUrl, scope, coordinatorId } = readOpenSeaBudgetEnvironment(input);
  const pool = new pg3.Pool({
    connectionString: databaseUrl,
    application_name: "yunipals_opensea_budget",
    max: 1,
    connectionTimeoutMillis: 1e3,
    statement_timeout: 1500,
    lock_timeout: 1e3,
    idle_in_transaction_session_timeout: 3e3
  });
  pool.on(
    "error",
    () => console.error("OpenSea budget database connection failed.")
  );
  try {
    return {
      pool,
      scope,
      budget: new PostgresOpenSeaRequestBudget(
        pool,
        scope,
        void 0,
        void 0,
        coordinatorId
      ),
      budgetFor: (context) => new PostgresOpenSeaRequestBudget(
        pool,
        scope,
        void 0,
        context,
        coordinatorId
      ),
      backgroundBudget: (headroom, context = {
        caller: "legacy",
        workload: "legacy",
        priority: "background"
      }) => new PostgresOpenSeaRequestBudget(
        pool,
        scope,
        headroom,
        context,
        coordinatorId
      ),
      rpcBudget: (workload, priority) => new PostgresRpcComputeBudget(pool, scope, workload, priority),
      close: () => pool.end()
    };
  } catch (error) {
    void pool.end();
    throw error;
  }
}

// src/unifiedRpcPolicy.ts
import { readFileSync } from "node:fs";
function readUnifiedRpcPolicyEnvironment(input = process.env) {
  const path = input.MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE;
  if (!path) {
    if (input.MARKET_RPC_PROXY_UNIFIED_PROFILE_ID || input.MARKET_RPC_PROXY_CHAIN_ID)
      throw new Error("Incomplete unified RPC profile configuration.");
    return void 0;
  }
  if (!path.startsWith("/"))
    throw new Error("Unified RPC profile path must be absolute.");
  const profile = validateUnifiedRpcProfile(
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (unifiedRpcProfileId(profile) !== input.MARKET_RPC_PROXY_UNIFIED_PROFILE_ID)
    throw new Error("Unified RPC profile differs from reviewed identity.");
  const chainId = Number(input.MARKET_RPC_PROXY_CHAIN_ID);
  if (!profile.manifest.sources.some(
    (source) => source.enabled && source.chainId === chainId
  ))
    throw new Error("Unified RPC chain is not reviewed.");
  return { profile, chainId };
}
function createUnifiedRpcPolicyGate(pool, scope, profile, chainId) {
  const id = unifiedRpcProfileId(profile);
  if (profile.scope !== scope)
    throw new Error("Unified RPC coordinator scope mismatch.");
  return {
    profile,
    chainId,
    async ready(workload) {
      const result = await pool.query(
        `SELECT 1 FROM yunipals_market.unified_rpc_profile p
        JOIN yunipals_market.opensea_request_budget c USING(scope)
        JOIN yunipals_market.rpc_compute_budget b USING(scope)
        JOIN yunipals_market.rpc_compute_allocation a USING(scope)
        WHERE p.profile_id=$1 AND p.scope=$2 AND p.manifest_hash=$3 AND p.policy=$4::jsonb
          AND p.enabled AND p.expires_at>clock_timestamp()
          AND c.coordinator_id=$5::uuid AND c.enabled AND b.enabled
          AND a.workload=$6 AND a.priority='background' AND a.daily_cu>0`,
        [
          id,
          scope,
          unifiedRpcManifestId(profile),
          JSON.stringify(profile),
          profile.coordinatorId,
          workload
        ]
      );
      if (result.rowCount !== 1)
        throw new Error("Unified RPC profile/budget is not approved.");
    },
    async reservePaid(permit, calls) {
      if (!permit || !/^0x[0-9a-f]{64}$/.test(permit))
        throw new Error("Explicit unified RPC replay permit required.");
      const ranges = calls.map(unifiedRpcPaidRange);
      const from = ranges.reduce(
        (value, range) => BigInt(range.fromBlock) < value ? BigInt(range.fromBlock) : value,
        BigInt(ranges[0].fromBlock)
      );
      const to = ranges.reduce(
        (value, range) => BigInt(range.toBlock) > value ? BigInt(range.toBlock) : value,
        BigInt(ranges[0].toBlock)
      );
      const cu = calls.reduce(
        (value, call) => value + alchemyComputeUnits(call.method),
        0
      );
      await pool.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,$3,$4,$5,$6)",
        [permit, id, chainId, String(from), String(to), cu]
      );
    },
    async inspect(workload, permit) {
      const budget = (await pool.query(
        `SELECT b.daily_cu::text,b.foreground_reserve_cu::text,a.daily_cu::text AS allocation_cu,
        coalesce(w.granted_cu,0)::text AS account_granted_cu,coalesce(w.background_granted_cu,0)::text AS background_granted_cu,
        coalesce(aw.granted_cu,0)::text AS allocation_granted_cu
        FROM yunipals_market.rpc_compute_budget b JOIN yunipals_market.rpc_compute_allocation a USING(scope)
        LEFT JOIN yunipals_market.rpc_compute_window w ON w.scope=b.scope AND w.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        LEFT JOIN yunipals_market.rpc_compute_workload_window aw ON aw.scope=a.scope AND aw.workload=a.workload AND aw.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        WHERE b.scope=$1 AND a.workload=$2`,
        [scope, workload]
      )).rows[0];
      if (!budget) throw new Error("Unified RPC allocation is unavailable.");
      let replay = { mode: "free_only" };
      if (permit !== void 0) {
        if (!/^0x[0-9a-f]{64}$/.test(permit))
          throw new Error("Invalid replay identity.");
        const row = (await pool.query(
          `SELECT from_block::text,through_block::text,maximum_cu::text,spent_cu::text,expires_at
          FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1 AND profile_id=$2 AND chain_id=$3
          AND enabled AND expires_at>clock_timestamp() AND spent_cu<maximum_cu`,
          [permit, id, chainId]
        )).rows[0];
        if (!row) throw new Error("Unified replay permit is unavailable.");
        replay = { mode: "bounded_replay", permitId: permit, ...row };
      }
      return { budget, replay };
    }
  };
}

// src/rpcBudgetProxy.ts
var maximumRequestBytes = 2 * 1024 * 1024;
var maximumResponseBytes = 32 * 1024 * 1024;
var defaultFreeRecentBlocks = 4096n;
var defaultFreeRequestTimeoutMs = 1e4;
var defaultFreeOrderRequestTimeoutMs = 3e3;
var defaultFreeFailureCooldownMs = 3e4;
var defaultFreeRateLimitCooldownMs = 2e3;
var defaultFreeSourceMinimumIntervalMs = 400;
var defaultFreeMinimumIntervalMs = 1e3;
var defaultMaximumConcurrentUpstreamRequests = 8;
var maximumQueuedSourceRequests = 64;
var maximumQueuedSourceBytes = 8 * 1024 * 1024;
var blockedMethods = /^(?:admin_|debug_|engine_|miner_|personal_|txpool_|wallet_)|(?:send|sign|submit)/i;
var freeAlwaysMethods = /* @__PURE__ */ new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_protocolVersion",
  "eth_syncing",
  "net_listening",
  "net_peerCount",
  "net_version"
]);
var freeHashMethods = /* @__PURE__ */ new Set([
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt"
]);
var freeNonNullResultMethods = /* @__PURE__ */ new Set([
  ...freeHashMethods,
  "eth_getTransactionByBlockNumberAndIndex"
]);
var freeCurrentStateBlockParameter = /* @__PURE__ */ new Map([
  ["eth_getBalance", 1],
  ["eth_getCode", 1],
  ["eth_getTransactionCount", 1],
  ["eth_getStorageAt", 2],
  ["eth_call", 1]
]);
var currentBlockTags = /* @__PURE__ */ new Set(["latest", "safe", "finalized", "pending"]);
function endpointList(value) {
  if (!value) return [];
  return value.split(",").map((item) => {
    if (!item || item.trim() !== item)
      throw new Error("Invalid RPC budget proxy configuration.");
    try {
      return new URL(item);
    } catch {
      throw new Error("Invalid RPC budget proxy configuration.");
    }
  });
}
function rpcPrimaryPoolSha256(urls) {
  return createHash2("sha256").update(JSON.stringify(urls.map((url) => url.href))).digest("hex");
}
function selectiveIndices(value) {
  if (value === void 0) return void 0;
  if (!/^(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*$/.test(value))
    throw new Error("Invalid BNB selective endpoint configuration.");
  return value.split(",").map(Number);
}
function readRpcBudgetProxyEnvironment(input = process.env) {
  const host = input.MARKET_RPC_PROXY_HOST ?? "127.0.0.1";
  const port = Number(input.MARKET_RPC_PROXY_PORT);
  let upstream;
  try {
    upstream = new URL(input.MARKET_RPC_PROXY_UPSTREAM ?? "");
  } catch {
    throw new Error("Configure the RPC budget proxy upstream.");
  }
  let freeUpstream;
  if (input.MARKET_RPC_PROXY_FREE_UPSTREAM) {
    try {
      freeUpstream = new URL(input.MARKET_RPC_PROXY_FREE_UPSTREAM);
    } catch {
      throw new Error("Invalid RPC budget proxy configuration.");
    }
  }
  let freeLogUpstream;
  if (input.MARKET_RPC_PROXY_FREE_LOG_UPSTREAM) {
    try {
      freeLogUpstream = new URL(input.MARKET_RPC_PROXY_FREE_LOG_UPSTREAM);
    } catch {
      throw new Error("Invalid RPC budget proxy configuration.");
    }
  }
  const freeUpstreams = [
    ...freeUpstream ? [freeUpstream] : [],
    ...endpointList(input.MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS)
  ];
  const freeLogUpstreams = [
    ...freeLogUpstream ? [freeLogUpstream] : freeUpstreams,
    ...endpointList(input.MARKET_RPC_PROXY_FREE_LOG_FAILOVER_UPSTREAMS)
  ];
  const freeOrderUpstreams = endpointList(
    input.MARKET_RPC_PROXY_FREE_ORDER_UPSTREAMS
  );
  const bnbSelectivePrimaryIndices = selectiveIndices(
    input.MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES
  );
  const bnbSelectivePoolSha256 = input.MARKET_RPC_PROXY_BNB_SELECTIVE_POOL_SHA256;
  const bnbSelectiveTransactionPrimaryIndices = selectiveIndices(
    input.MARKET_RPC_PROXY_BNB_SELECTIVE_TRANSACTION_PRIMARY_INDICES
  );
  const selectiveHeaderInterval = input.MARKET_RPC_PROXY_BNB_SELECTIVE_HEADER_MINIMUM_INTERVAL_MS;
  if (selectiveHeaderInterval !== void 0 && selectiveHeaderInterval !== "200" && selectiveHeaderInterval !== "400")
    throw new Error("Invalid BNB selective header pacing configuration.");
  const bnbSelectiveHeaderMinimumIntervalMs = selectiveHeaderInterval === void 0 ? void 0 : Number(selectiveHeaderInterval);
  const freeRecentBlocks = BigInt(
    input.MARKET_RPC_PROXY_FREE_RECENT_BLOCKS ?? defaultFreeRecentBlocks
  );
  const freeRequestTimeoutMs = Number(
    input.MARKET_RPC_PROXY_FREE_TIMEOUT_MS ?? defaultFreeRequestTimeoutMs
  );
  const freeOrderRequestTimeoutMs = Number(
    input.MARKET_RPC_PROXY_FREE_ORDER_TIMEOUT_MS ?? Math.min(freeRequestTimeoutMs, defaultFreeOrderRequestTimeoutMs)
  );
  const maximumConcurrentUpstreamRequests = Number(
    input.MARKET_RPC_PROXY_MAX_IN_FLIGHT ?? defaultMaximumConcurrentUpstreamRequests
  );
  const freeOrderMinimumIntervalMs = Number(
    input.MARKET_RPC_PROXY_FREE_ORDER_MINIMUM_INTERVAL_MS ?? defaultFreeMinimumIntervalMs
  );
  const paidFallbackValue = input.MARKET_RPC_PROXY_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const foregroundPaidFallbackValue = input.MARKET_RPC_PROXY_FOREGROUND_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const orderPaidFallbackValue = input.MARKET_RPC_PROXY_ORDER_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const sourcePaidFallbackValue = input.MARKET_RPC_PROXY_SOURCE_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const salePaidFallbackValue = input.MARKET_RPC_PROXY_SALE_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const unifiedSourcePaidPrimaryValue = input.MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY ?? "false";
  const unifiedSourcePaidLogsValue = input.MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS ?? "false";
  if (!(/* @__PURE__ */ new Set(["true", "false"])).has(paidFallbackValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(foregroundPaidFallbackValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(orderPaidFallbackValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(sourcePaidFallbackValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(salePaidFallbackValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(unifiedSourcePaidPrimaryValue) || !(/* @__PURE__ */ new Set(["true", "false"])).has(unifiedSourcePaidLogsValue) || unifiedSourcePaidPrimaryValue === "true" && unifiedSourcePaidLogsValue === "true")
    throw new Error("Invalid RPC budget proxy configuration.");
  const paidFallbackOnFreeFailure = paidFallbackValue === "true";
  const foregroundPaidFallbackOnFreeFailure = foregroundPaidFallbackValue === "true";
  const orderPaidFallbackOnFreeFailure = orderPaidFallbackValue === "true";
  const sourcePaidFallbackOnFreeFailure = sourcePaidFallbackValue === "true";
  const salePaidFallbackOnFreeFailure = salePaidFallbackValue === "true";
  const unifiedSourcePaidPrimary = unifiedSourcePaidPrimaryValue === "true";
  const unifiedSourcePaidLogs = unifiedSourcePaidLogsValue === "true";
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    upstream.hostname
  );
  if (!["127.0.0.1", "::1"].includes(host) || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.protocol !== "https:" && !(input.NODE_ENV === "test" && loopback && upstream.protocol === "http:"))
    throw new Error("Invalid RPC budget proxy configuration.");
  for (const candidate of [
    ...freeUpstreams,
    ...freeLogUpstreams,
    ...freeOrderUpstreams
  ])
    if (candidate && (candidate.protocol !== "https:" || !candidate.hostname || candidate.username || candidate.password || candidate.search || candidate.hash))
      throw new Error("Invalid RPC budget proxy configuration.");
  if (freeLogUpstream && !freeUpstream)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (freeRecentBlocks < 128n || freeRecentBlocks > 100000n)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (!Number.isSafeInteger(freeRequestTimeoutMs) || freeRequestTimeoutMs < 1e3 || freeRequestTimeoutMs > 3e4 || !Number.isSafeInteger(freeOrderRequestTimeoutMs) || freeOrderRequestTimeoutMs < 1e3 || freeOrderRequestTimeoutMs > freeRequestTimeoutMs)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (!Number.isSafeInteger(freeOrderMinimumIntervalMs) || freeOrderMinimumIntervalMs < 0 || freeOrderMinimumIntervalMs > 2e3 || !Number.isSafeInteger(maximumConcurrentUpstreamRequests) || maximumConcurrentUpstreamRequests < 1 || maximumConcurrentUpstreamRequests > 64)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (new Set(freeUpstreams.map((candidate) => candidate.href)).size !== freeUpstreams.length || new Set(freeLogUpstreams.map((candidate) => candidate.href)).size !== freeLogUpstreams.length || new Set(freeOrderUpstreams.map((candidate) => candidate.href)).size !== freeOrderUpstreams.length)
    throw new Error("Invalid RPC budget proxy configuration.");
  return {
    host,
    port,
    upstream,
    freeUpstream,
    freeLogUpstream,
    freeUpstreams,
    freeLogUpstreams,
    freeOrderUpstreams,
    freeRecentBlocks,
    freeRequestTimeoutMs,
    freeOrderRequestTimeoutMs,
    freeOrderMinimumIntervalMs,
    maximumConcurrentUpstreamRequests,
    paidFallbackOnFreeFailure,
    foregroundPaidFallbackOnFreeFailure,
    orderPaidFallbackOnFreeFailure,
    sourcePaidFallbackOnFreeFailure,
    salePaidFallbackOnFreeFailure,
    unifiedSourcePaidPrimary,
    unifiedSourcePaidLogs,
    ...bnbSelectivePrimaryIndices !== void 0 || bnbSelectivePoolSha256 !== void 0 ? { bnbSelectivePrimaryIndices, bnbSelectivePoolSha256 } : {},
    ...bnbSelectiveTransactionPrimaryIndices !== void 0 ? { bnbSelectiveTransactionPrimaryIndices } : {},
    ...bnbSelectiveHeaderMinimumIntervalMs !== void 0 ? { bnbSelectiveHeaderMinimumIntervalMs } : {}
  };
}
function response(output, status, body) {
  const encoded = JSON.stringify(body);
  output.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store"
  });
  output.end(encoded);
}
async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumRequestBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function parseRequests(body) {
  const parsed = JSON.parse(body.toString("utf8"));
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  if (requests.length < 1 || requests.length > 1e3 || requests.some(
    (item) => !item || typeof item !== "object" || Array.isArray(item) || typeof item.method !== "string" || !item.method || blockedMethods.test(item.method)
  ))
    throw new Error("invalid_request");
  return requests;
}
function blockNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return;
  return BigInt(value);
}
function isCanonicalBlockHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value;
  return Object.keys(reference).length === 2 && typeof reference.blockHash === "string" && /^0x[0-9a-f]{64}$/i.test(reference.blockHash) && reference.requireCanonical === true;
}
function isCurrentBlock(value, observedHead, recentBlocks) {
  if (typeof value === "string" && currentBlockTags.has(value)) return true;
  if (isCanonicalBlockHash(value)) return true;
  const number = blockNumber(value);
  return number !== void 0 && observedHead !== void 0 && number <= observedHead + 32n && number + recentBlocks >= observedHead;
}
function isFreeRpcCall(call, observedHead, recentBlocks = defaultFreeRecentBlocks) {
  if (freeAlwaysMethods.has(call.method)) return true;
  if (freeHashMethods.has(call.method)) return true;
  if (call.method === "eth_getTransactionByBlockNumberAndIndex")
    return Array.isArray(call.params) && call.params.length === 2 && call.params.every(
      (value) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)
    ) && BigInt(call.params[1]) <= 2147483647n;
  if (call.method === "eth_getBlockByNumber")
    return Array.isArray(call.params) && (isCurrentBlock(call.params[0], observedHead, recentBlocks) || call.params[0] === "earliest" || blockNumber(call.params[0]) !== void 0);
  const stateBlockParameter = freeCurrentStateBlockParameter.get(call.method);
  if (stateBlockParameter !== void 0) {
    if (!Array.isArray(call.params) || call.params.length < stateBlockParameter)
      return false;
    return isCurrentBlock(
      call.params[stateBlockParameter] ?? "latest",
      observedHead,
      recentBlocks
    );
  }
  if (call.method === "eth_getLogs") {
    if (!Array.isArray(call.params)) return false;
    const filter = call.params[0];
    if (!filter || typeof filter !== "object" || Array.isArray(filter))
      return false;
    const value = filter;
    if (value.blockHash !== void 0) return true;
    return isCurrentBlock(value.fromBlock ?? "latest", observedHead, recentBlocks) && isCurrentBlock(value.toBlock ?? "latest", observedHead, recentBlocks);
  }
  return false;
}
var RpcProxyBusyError = class extends Error {
};
var RpcResponseTooLargeError = class extends Error {
};
var RpcProxyCancelledError = class extends Error {
};
var RpcPaidPermitRefusedError = class extends Error {
};
async function dispatchRpc(dispatch, upstream, body, timeoutMs, signal) {
  const result = await dispatch(upstream, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Yunipals-RPC-Proxy/1"
    },
    body,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const length = Number(result.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumResponseBytes)
    throw new RpcResponseTooLargeError("response_too_large");
  const payload = Buffer.from(await result.arrayBuffer());
  if (payload.length > maximumResponseBytes)
    throw new RpcResponseTooLargeError("response_too_large");
  return {
    status: result.status,
    contentType: result.headers.get("content-type") ?? "application/json",
    payload
  };
}
function adaptiveLogSizeResponse(error, calls, workload, batch) {
  const call = calls[0];
  if (!(error instanceof RpcResponseTooLargeError) || workload !== "unified_source" || calls.length !== 1 || call?.method !== "eth_getLogs" || call.jsonrpc !== "2.0" || !(typeof call.id === "number" && Number.isSafeInteger(call.id) || typeof call.id === "string" && call.id.length <= 128) || !Array.isArray(call.params))
    return;
  const filter = call.params[0];
  const from = blockNumber(filter.fromBlock), to = blockNumber(filter.toBlock);
  if (from === void 0 || to === void 0 || to - from < 3n) return;
  const maximumBlockRange = Number((to - from + 2n) / 2n);
  const reply = {
    jsonrpc: "2.0",
    id: call.id,
    error: {
      code: -32005,
      message: `Max range: ${maximumBlockRange}`,
      data: {
        maximumResponseBytes,
        maximumBlockRange
      }
    }
  };
  return {
    status: 200,
    contentType: "application/json",
    payload: Buffer.from(JSON.stringify(batch ? [reply] : reply))
  };
}
function responseItems(result) {
  if (result.status < 200 || result.status >= 300) return;
  try {
    const parsed = JSON.parse(result.payload.toString("utf8"));
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length < 1 || values.some(
      (value) => !value || typeof value !== "object" || Array.isArray(value) || "error" in value
    ))
      return;
    return values;
  } catch {
    return;
  }
}
function usableFreeResponse(result, calls) {
  const items = responseItems(result);
  if (!items || items.length !== calls.length) return false;
  const callsById = new Map(
    calls.map((call) => [JSON.stringify(call.id), call])
  );
  return items.every((item) => {
    const call = callsById.get(JSON.stringify(item.id));
    if (!call) return false;
    return !(freeNonNullResultMethods.has(call.method) && (item.result === null || item.result === void 0));
  });
}
function isRangeOnlyUnifiedRejection(profile, chainId, calls) {
  const quantity2 = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
  const shortened = calls.map((call) => {
    if (call.method !== "eth_getLogs" || !Array.isArray(call.params))
      return call;
    const filter = call.params[0];
    if (!filter || typeof filter !== "object" || Array.isArray(filter))
      return call;
    const value = filter;
    if (typeof value.fromBlock !== "string" || !quantity2.test(value.fromBlock) || typeof value.toBlock !== "string" || !quantity2.test(value.toBlock))
      return call;
    const from = BigInt(value.fromBlock), to = BigInt(value.toBlock), maximum = BigInt(profile.limits.logRange);
    if (to - from + 1n <= maximum) return call;
    return {
      ...call,
      params: [
        { ...value, toBlock: `0x${(from + maximum - 1n).toString(16)}` },
        ...call.params.slice(1)
      ]
    };
  });
  try {
    validateUnifiedRpcCalls(profile, chainId, shortened);
    return true;
  } catch {
    return false;
  }
}
function adaptiveUnifiedLogResponse(result, calls, profile, batch) {
  if (result.status !== 200) return;
  try {
    const parsed = JSON.parse(result.payload.toString("utf8"));
    if (Array.isArray(parsed) !== batch) return;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length !== calls.length) return;
    const byId = /* @__PURE__ */ new Map();
    for (const call of calls) {
      if (call.jsonrpc !== "2.0" || !(typeof call.id === "number" && Number.isSafeInteger(call.id) || typeof call.id === "string" && call.id.length <= 128))
        return;
      const key = JSON.stringify(call.id);
      if (byId.has(key)) return;
      byId.set(key, call);
    }
    const seen = /* @__PURE__ */ new Set();
    let changed = false;
    const normalized = [];
    for (const value of items) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const item = value;
      if (item.jsonrpc !== "2.0") return;
      if (!(typeof item.id === "number" && Number.isSafeInteger(item.id) || typeof item.id === "string" && item.id.length <= 128))
        return;
      const key = JSON.stringify(item.id);
      const call = byId.get(key);
      if (!call || seen.has(key)) return;
      seen.add(key);
      if (!("error" in item)) {
        if (!("result" in item) || call.method === "eth_getLogs" && !Array.isArray(item.result) || freeNonNullResultMethods.has(call.method) && item.result == null)
          return;
        normalized.push(item);
        continue;
      }
      if ("result" in item || call.method !== "eth_getLogs" || !item.error || typeof item.error !== "object" || Array.isArray(item.error))
        return;
      const error = item.error;
      if (error.code !== -32602 || error.message !== "invalid params" || typeof error.data !== "string" || error.data.length > 512)
        return;
      const match = error.data.match(
        /^Block range too large for public access: maximum ([1-9][0-9]{0,4}) blocks\. Try with this block range \[0x[0-9a-f]+, 0x[0-9a-f]+\], or use an access key for larger ranges\.$/
      );
      if (!match) return;
      const maximum = Number(match[1]);
      if (maximum < 2 || maximum > profile.limits.logRange || !Array.isArray(call.params))
        return;
      const filter = call.params[0];
      const from = blockNumber(filter.fromBlock), to = blockNumber(filter.toBlock);
      if (from === void 0 || to === void 0 || to - from + 1n <= BigInt(maximum))
        return;
      normalized.push({
        ...item,
        error: { ...error, code: -32005, message: `Max range: ${maximum}` }
      });
      changed = true;
    }
    if (!changed || seen.size !== calls.length) return;
    const payload = Buffer.from(
      JSON.stringify(batch ? normalized : normalized[0])
    );
    if (payload.length > maximumResponseBytes) return;
    return { ...result, payload };
  } catch {
    return;
  }
}
function freeFailureDisposition(result) {
  if (result.status === 413) return "adaptive";
  if (result.status === 429) return "rate_limit";
  if ([401, 403].includes(result.status)) return "cooldown";
  if (result.status >= 400 && result.status < 500) return "request";
  if (result.status >= 500) return "transient";
  try {
    const parsed = JSON.parse(result.payload.toString("utf8"));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const messages = items.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const error = item.error;
      if (!error || typeof error !== "object" || Array.isArray(error))
        return [];
      const message = error.message;
      return typeof message === "string" ? [message.slice(0, 512)] : [];
    });
    return messages.some(
      (message) => /rate.?limit|too many requests|request limit/i.test(message)
    ) ? "rate_limit" : "request";
  } catch {
    return "request";
  }
}
function updateObservedHead(items, calls, current) {
  const callsById = new Map(
    calls.map((call) => [JSON.stringify(call.id), call])
  );
  let head = current;
  for (const item of items) {
    const call = callsById.get(JSON.stringify(item.id));
    if (!call) continue;
    let candidate;
    if (call.method === "eth_blockNumber") candidate = blockNumber(item.result);
    if (call.method === "eth_getBlockByNumber" && Array.isArray(call.params) && typeof call.params[0] === "string" && currentBlockTags.has(call.params[0]) && item.result && typeof item.result === "object" && !Array.isArray(item.result))
      candidate = blockNumber(item.result.number);
    if (candidate !== void 0 && (head === void 0 || candidate > head))
      head = candidate;
  }
  return head;
}
function methodBucket(method) {
  return Object.hasOwn(
    {
      eth_blockNumber: true,
      eth_chainId: true,
      eth_getBlockByHash: true,
      eth_getBlockByNumber: true,
      eth_getBalance: true,
      eth_call: true,
      eth_getCode: true,
      eth_getLogs: true,
      eth_getStorageAt: true,
      eth_getTransactionByHash: true,
      eth_getTransactionByBlockNumberAndIndex: true,
      eth_getTransactionCount: true,
      eth_getTransactionReceipt: true,
      eth_syncing: true,
      net_version: true
    },
    method
  ) ? method : "other";
}
function increment(target, calls) {
  for (const call of calls) {
    const key = methodBucket(String(call.method));
    target[key] = (target[key] ?? 0) + 1;
  }
}
function createRpcBudgetProxy(options) {
  const dispatch = options.fetch ?? globalThis.fetch;
  const recentBlocks = options.freeRecentBlocks ?? defaultFreeRecentBlocks;
  const freeTimeoutMs = options.freeRequestTimeoutMs ?? defaultFreeRequestTimeoutMs;
  const freeOrderTimeoutMs = options.freeOrderRequestTimeoutMs ?? Math.min(freeTimeoutMs, defaultFreeOrderRequestTimeoutMs);
  const paidFallbackOnFreeFailure = options.paidFallbackOnFreeFailure ?? false;
  const foregroundPaidFallbackOnFreeFailure = options.foregroundPaidFallbackOnFreeFailure ?? false;
  const orderPaidFallbackOnFreeFailure = options.orderPaidFallbackOnFreeFailure ?? false;
  const sourcePaidFallbackOnFreeFailure = options.sourcePaidFallbackOnFreeFailure ?? false;
  const salePaidFallbackOnFreeFailure = options.salePaidFallbackOnFreeFailure ?? false;
  const unifiedSourcePaidPrimary = options.unifiedSourcePaidPrimary ?? false;
  const unifiedSourcePaidLogs = options.unifiedSourcePaidLogs ?? false;
  if (typeof unifiedSourcePaidPrimary !== "boolean" || typeof unifiedSourcePaidLogs !== "boolean" || unifiedSourcePaidPrimary && unifiedSourcePaidLogs || (unifiedSourcePaidPrimary || unifiedSourcePaidLogs) && !options.unifiedPolicy)
    throw new Error("Unified paid primary requires an explicit RPC policy.");
  const freeFailureCooldownMs = options.freeFailureCooldownMs ?? defaultFreeFailureCooldownMs;
  const freeRateLimitCooldownMs = options.freeRateLimitCooldownMs ?? defaultFreeRateLimitCooldownMs;
  const freeMinimumIntervalMs = options.freeMinimumIntervalMs ?? defaultFreeMinimumIntervalMs;
  const freeSourceMinimumIntervalMs = options.freeSourceMinimumIntervalMs ?? (options.freeMinimumIntervalMs === void 0 ? defaultFreeSourceMinimumIntervalMs : freeMinimumIntervalMs);
  const freeOrderMinimumIntervalMs = options.freeOrderMinimumIntervalMs ?? freeMinimumIntervalMs;
  const maximumConcurrentUpstreamRequests = options.maximumConcurrentUpstreamRequests ?? defaultMaximumConcurrentUpstreamRequests;
  if (!Number.isSafeInteger(freeFailureCooldownMs) || freeFailureCooldownMs < 1 || freeFailureCooldownMs > 3e5 || !Number.isSafeInteger(freeOrderTimeoutMs) || freeOrderTimeoutMs < 1e3 || freeOrderTimeoutMs > freeTimeoutMs || !Number.isSafeInteger(freeRateLimitCooldownMs) || freeRateLimitCooldownMs < 1 || freeRateLimitCooldownMs > 5e3 || !Number.isSafeInteger(freeMinimumIntervalMs) || freeMinimumIntervalMs < 0 || freeMinimumIntervalMs > 2e3 || !Number.isSafeInteger(freeSourceMinimumIntervalMs) || freeSourceMinimumIntervalMs < 0 || freeSourceMinimumIntervalMs > 2e3 || !Number.isSafeInteger(freeOrderMinimumIntervalMs) || freeOrderMinimumIntervalMs < 0 || freeOrderMinimumIntervalMs > 2e3 || !Number.isSafeInteger(maximumConcurrentUpstreamRequests) || maximumConcurrentUpstreamRequests < 1 || maximumConcurrentUpstreamRequests > 64)
    throw new Error("Invalid RPC budget proxy configuration.");
  const endpointStates = (urls) => urls.map((url) => ({
    url,
    retryAt: 0,
    nextDispatchAt: 0,
    failures: 0,
    consecutiveFailures: 0,
    successes: 0
  }));
  const primaryUrls = options.freeUpstreams ?? (options.freeUpstream ? [options.freeUpstream] : []);
  const primaryPool = endpointStates(primaryUrls);
  const selectiveConfigured = options.bnbSelectivePrimaryIndices !== void 0 || options.bnbSelectivePoolSha256 !== void 0;
  const selectiveIndices2 = options.bnbSelectivePrimaryIndices;
  if (selectiveConfigured && (options.unifiedPolicy?.chainId !== 56 || !Array.isArray(selectiveIndices2) || selectiveIndices2.length === 0 || new Set(selectiveIndices2).size !== selectiveIndices2.length || selectiveIndices2.some(
    (index) => !Number.isSafeInteger(index) || index < 0 || index >= primaryUrls.length
  ) || options.bnbSelectivePoolSha256 !== rpcPrimaryPoolSha256(primaryUrls)))
    throw new Error("Invalid BNB selective endpoint configuration.");
  const selectiveTransactionIndices = options.bnbSelectiveTransactionPrimaryIndices;
  const selectiveHeaderMinimumIntervalMs = options.bnbSelectiveHeaderMinimumIntervalMs;
  if (selectiveHeaderMinimumIntervalMs !== void 0 && (!selectiveConfigured || ![200, 400].includes(selectiveHeaderMinimumIntervalMs)))
    throw new Error("Invalid BNB selective header pacing configuration.");
  const selectiveTransactionsConfigured = selectiveTransactionIndices !== void 0;
  if (selectiveTransactionsConfigured && (!selectiveConfigured || !Array.isArray(selectiveTransactionIndices) || selectiveTransactionIndices.length === 0 || new Set(selectiveTransactionIndices).size !== selectiveTransactionIndices.length || selectiveTransactionIndices.some(
    (index) => !Number.isSafeInteger(index) || index < 0 || index >= primaryUrls.length
  )))
    throw new Error("Invalid BNB selective transaction endpoint configuration.");
  const configuredLogPool = options.freeLogUpstreams ?? (options.freeLogUpstream ? [options.freeLogUpstream] : []);
  const logUrls = configuredLogPool.length ? configuredLogPool : primaryUrls;
  const logPool = configuredLogPool.length ? endpointStates(configuredLogPool) : primaryPool;
  const configuredOrderPool = options.freeOrderUpstreams ?? [];
  const orderPool = endpointStates(
    configuredOrderPool.length ? configuredOrderPool : primaryUrls
  );
  const salePool = endpointStates(
    configuredLogPool.length ? configuredLogPool : primaryUrls
  );
  const unifiedPools = {
    unified_source: endpointStates(primaryUrls),
    unified_evidence: endpointStates(primaryUrls)
  };
  const selectivePool = (selectiveIndices2 ?? []).map(
    (index) => unifiedPools.unified_source[index]
  );
  const selectiveTransactionPool = (selectiveTransactionIndices ?? []).map(
    (index) => unifiedPools.unified_source[index]
  );
  const sourceLogPool = endpointStates([
    ...new Map(
      [...logUrls, ...primaryUrls].map((url) => [url.href, url])
    ).values()
  ]);
  const dedicatedSourceLogUrls = new Set(logUrls.map((url) => url.href));
  const unifiedTraffic = {
    unified_source: { freeCalls: 0, paidCalls: 0, refused: 0 },
    unified_evidence: { freeCalls: 0, paidCalls: 0, refused: 0 }
  };
  const adaptiveRangeRejected = {
    unified_source: 0,
    unified_evidence: 0
  };
  let preferredSourcePrimary = 0;
  let preferredSelective = 0;
  let preferredSelectiveTransactions = 0;
  let preferredSourceLogs = 0;
  let preferredLogs = 0;
  let preferredOrder = 0;
  let preferredSale = 0;
  let activeUpstreamRequests = 0;
  let maximumObservedUpstreamRequests = 0;
  let maximumQueuedPriorityRequests = 0;
  let maximumObservedQueuedSourceRequests = 0;
  let queuedSourceBytes = 0;
  let observedHead;
  const priorityQueue = {
    order_projection: [],
    sale: [],
    foreground: []
  };
  const sourceQueue = [];
  const priorityQueueLimit = maximumConcurrentUpstreamRequests * 32;
  const priorityQueueWaitMs = Math.min(2e3, freeTimeoutMs / 3);
  const sourcePacingQueueWaitMs = Math.min(
    8e3,
    Math.max(2e3, freeTimeoutMs - 2e3)
  );
  const sourceQueueWaitMs = sourcePacingQueueWaitMs;
  const orderRouteQueueWaitMs = Math.min(4500, freeTimeoutMs / 2);
  const maximumConcurrentOrderFreeRoutes = Math.min(
    4,
    maximumConcurrentUpstreamRequests
  );
  let activeOrderFreeRoutes = 0;
  const orderFreeRouteQueue = [];
  const traffic = {
    freeBatches: 0,
    freeCalls: 0,
    paidBatches: 0,
    paidCalls: 0,
    fallbackBatches: 0,
    freeFailures: 0,
    freeOnlyFailures: 0,
    freeCircuitOpenBatches: 0,
    overloadedBatches: 0,
    queuedPriorityBatches: 0,
    priorityQueueTimeouts: 0,
    queuedOrderRouteBatches: 0,
    orderRouteTimeouts: 0,
    freeRateLimitRetries: 0,
    freeRateLimitWaitMs: 0,
    freePacingWaitMs: 0,
    sourcePacingTimeouts: 0,
    queuedSourceBatches: 0,
    sourceQueueTimeouts: 0,
    sourceQueueCancellations: 0,
    methods: {
      free: {},
      paid: {}
    },
    workloads: {
      source: { freeCalls: 0, paidCalls: 0 },
      order_projection: { freeCalls: 0, paidCalls: 0 },
      sale: { freeCalls: 0, paidCalls: 0 },
      foreground: { freeCalls: 0, paidCalls: 0 }
    }
  };
  const availableFreeEndpoints = (pool, preferred) => {
    const now = Date.now();
    const available = [];
    for (let offset = 0; offset < pool.length; offset++) {
      const index = (preferred + offset) % pool.length;
      if (pool[index].retryAt <= now)
        available.push({ state: pool[index], index });
    }
    return available;
  };
  const boundedDispatch = async (upstream, body, timeoutMs, workload, sourceRequest) => {
    if (sourceRequest?.signal.aborted) throw new RpcProxyCancelledError();
    const start = () => {
      activeUpstreamRequests++;
      maximumObservedUpstreamRequests = Math.max(
        maximumObservedUpstreamRequests,
        activeUpstreamRequests
      );
    };
    if (activeUpstreamRequests < maximumConcurrentUpstreamRequests) start();
    else if (workload === "source" && sourceRequest) {
      if (sourceQueue.length >= maximumQueuedSourceRequests || queuedSourceBytes + body.length > maximumQueuedSourceBytes) {
        traffic.overloadedBatches++;
        throw new RpcProxyBusyError();
      }
      traffic.queuedSourceBatches++;
      await new Promise((resolve2, reject) => {
        const remove = (error) => {
          const index = sourceQueue.indexOf(waiter);
          if (index < 0) return;
          sourceQueue.splice(index, 1);
          queuedSourceBytes -= waiter.bytes;
          clearTimeout(waiter.timer);
          waiter.detach();
          reject(error);
        };
        const cancelled = () => {
          traffic.sourceQueueCancellations++;
          remove(new RpcProxyCancelledError());
        };
        const waiter = {
          resolve: resolve2,
          reject,
          bytes: body.length,
          detach: () => sourceRequest.signal.removeEventListener("abort", cancelled),
          timer: setTimeout(() => {
            traffic.sourceQueueTimeouts++;
            traffic.overloadedBatches++;
            remove(new RpcProxyBusyError());
          }, sourceQueueWaitMs)
        };
        sourceQueue.push(waiter);
        queuedSourceBytes += body.length;
        maximumObservedQueuedSourceRequests = Math.max(
          maximumObservedQueuedSourceRequests,
          sourceQueue.length
        );
        sourceRequest.signal.addEventListener("abort", cancelled, { once: true });
        if (sourceRequest.signal.aborted) cancelled();
      });
    } else {
      if (workload === "source" || priorityQueue.order_projection.length + priorityQueue.sale.length + priorityQueue.foreground.length >= priorityQueueLimit) {
        traffic.overloadedBatches++;
        throw new RpcProxyBusyError();
      }
      traffic.queuedPriorityBatches++;
      await new Promise((resolve2, reject) => {
        const queue = priorityQueue[workload];
        const waiter = {
          resolve: resolve2,
          reject,
          timer: setTimeout(() => {
            const index = queue.indexOf(waiter);
            if (index >= 0) queue.splice(index, 1);
            traffic.priorityQueueTimeouts++;
            traffic.overloadedBatches++;
            reject(new RpcProxyBusyError());
          }, priorityQueueWaitMs)
        };
        queue.push(waiter);
        maximumQueuedPriorityRequests = Math.max(
          maximumQueuedPriorityRequests,
          priorityQueue.order_projection.length + priorityQueue.sale.length + priorityQueue.foreground.length
        );
      });
    }
    try {
      if (sourceRequest?.signal.aborted) throw new RpcProxyCancelledError();
      await sourceRequest?.beforeDispatch?.();
      if (sourceRequest?.signal.aborted) throw new RpcProxyCancelledError();
      try {
        return await dispatchRpc(
          dispatch,
          upstream,
          body,
          timeoutMs,
          sourceRequest?.signal
        );
      } catch (error) {
        if (sourceRequest?.signal.aborted) throw new RpcProxyCancelledError();
        throw error;
      }
    } finally {
      const waiter = priorityQueue.foreground.shift() ?? priorityQueue.sale.shift() ?? priorityQueue.order_projection.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      } else {
        const sourceWaiter = sourceQueue.shift();
        if (sourceWaiter) {
          clearTimeout(sourceWaiter.timer);
          queuedSourceBytes -= sourceWaiter.bytes;
          sourceWaiter.detach();
          sourceWaiter.resolve();
        } else activeUpstreamRequests--;
      }
    }
  };
  const acquireOrderFreeRoute = async () => {
    const release = () => {
      const waiter = orderFreeRouteQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      } else activeOrderFreeRoutes--;
    };
    if (activeOrderFreeRoutes < maximumConcurrentOrderFreeRoutes) {
      activeOrderFreeRoutes++;
      return release;
    }
    if (orderFreeRouteQueue.length >= priorityQueueLimit) {
      traffic.overloadedBatches++;
      throw new RpcProxyBusyError();
    }
    traffic.queuedOrderRouteBatches++;
    await new Promise((resolve2, reject) => {
      const waiter = {
        resolve: resolve2,
        reject,
        timer: setTimeout(() => {
          const index = orderFreeRouteQueue.indexOf(waiter);
          if (index >= 0) orderFreeRouteQueue.splice(index, 1);
          traffic.orderRouteTimeouts++;
          traffic.overloadedBatches++;
          reject(new RpcProxyBusyError());
        }, orderRouteQueueWaitMs)
      };
      orderFreeRouteQueue.push(waiter);
    });
    return release;
  };
  const waitForRateLimitRecovery = async (pool) => {
    const now = Date.now();
    const delay = Math.max(
      0,
      Math.min(...pool.map((item) => item.retryAt)) - now
    );
    if (delay > freeRateLimitCooldownMs + 50) return false;
    if (delay) {
      traffic.freeRateLimitWaitMs += delay;
      await new Promise((resolve2) => setTimeout(resolve2, delay));
    }
    return true;
  };
  const paceFreeDispatch = async (endpoint, workload, selectiveHeader = false) => {
    const minimumIntervalMs = workload === "source" ? selectiveHeader ? selectiveHeaderMinimumIntervalMs ?? freeSourceMinimumIntervalMs : freeSourceMinimumIntervalMs : workload === "order_projection" || workload === "foreground" ? freeOrderMinimumIntervalMs : freeMinimumIntervalMs;
    if (!minimumIntervalMs) return;
    const now = Date.now();
    const scheduledAt = Math.max(now, endpoint.nextDispatchAt);
    const delay = scheduledAt - now;
    if (workload === "foreground" && (foregroundPaidFallbackOnFreeFailure || paidFallbackOnFreeFailure) && delay > 250)
      throw new RpcProxyBusyError();
    if (workload === "source" && delay > sourcePacingQueueWaitMs) {
      traffic.sourcePacingTimeouts++;
      traffic.overloadedBatches++;
      throw new RpcProxyBusyError();
    }
    endpoint.nextDispatchAt = scheduledAt + minimumIntervalMs;
    if (delay) {
      traffic.freePacingWaitMs += delay;
      await new Promise((resolve2) => setTimeout(resolve2, delay));
    }
  };
  return createServer(async (request, output) => {
    let requestWorkload = "source";
    let unifiedWorkload;
    let cancelSourceRequest;
    try {
      if (request.method === "GET" && request.url === "/health") {
        response(output, 200, { status: "ready" });
        return;
      }
      if (request.method === "GET" && request.url === "/unified/preflight") {
        const gate = options.unifiedPolicy;
        const workload2 = request.headers[rpcBudgetWorkloadHeader];
        if (!gate || request.headers[unifiedRpcProfileHeader] !== unifiedRpcProfileId(gate.profile) || !isUnifiedRpcWorkload(workload2) || !options.workloadBudgets?.[workload2] || !primaryPool.length) {
          response(output, 403, { error: "unified_rpc_profile_unavailable" });
          return;
        }
        await gate.ready(workload2);
        await options.workloadBudgets[workload2].authorizeFreeDispatch();
        const permit = request.headers[unifiedRpcPermitHeader];
        const status = await gate.inspect(
          workload2,
          typeof permit === "string" ? permit : void 0
        );
        response(output, 200, {
          profileId: unifiedRpcProfileId(gate.profile),
          manifestHash: unifiedRpcManifestId(gate.profile),
          chainId: gate.chainId,
          coordinatorId: gate.profile.coordinatorId,
          scope: gate.profile.scope,
          workload: workload2,
          limits: gate.profile.limits,
          paid: "explicit_bounded_permit_only",
          ...status
        });
        return;
      }
      if (request.method === "GET" && request.url === "/metrics") {
        response(output, 200, {
          status: "ready",
          freeRouting: primaryPool.length > 0,
          freeLogRouting: logPool.length > 0,
          dedicatedFreeOrderRouting: configuredOrderPool.length > 0,
          paidFallbackOnFreeFailure,
          foregroundPaidFallbackOnFreeFailure,
          orderPaidFallbackOnFreeFailure,
          sourcePaidFallbackOnFreeFailure,
          salePaidFallbackOnFreeFailure,
          freeRequestTimeoutMs: freeTimeoutMs,
          freeOrderRequestTimeoutMs: freeOrderTimeoutMs,
          freeFailureCooldownMs,
          freeRateLimitCooldownMs,
          freeSourceMinimumIntervalMs,
          ...selectiveHeaderMinimumIntervalMs !== void 0 ? {
            bnbSelectiveHeaderMinimumIntervalMs: selectiveHeaderMinimumIntervalMs
          } : {},
          freeOrderMinimumIntervalMs,
          freeMinimumIntervalMs,
          sourcePacingQueueWaitMs,
          sourceQueueLimit: maximumQueuedSourceRequests,
          sourceQueueByteLimit: maximumQueuedSourceBytes,
          sourceQueueWaitMs,
          maximumConcurrentUpstreamRequests,
          maximumConcurrentOrderFreeRoutes,
          activeUpstreamRequests,
          activeOrderFreeRoutes,
          maximumObservedUpstreamRequests,
          queuedPriorityRequests: priorityQueue.order_projection.length + priorityQueue.sale.length + priorityQueue.foreground.length,
          queuedOrderRouteRequests: orderFreeRouteQueue.length,
          maximumQueuedPriorityRequests,
          queuedSourceRequests: sourceQueue.length,
          queuedSourceBytes,
          maximumQueuedSourceRequests: maximumObservedQueuedSourceRequests,
          preferredFreeEndpoints: {
            source: preferredSourcePrimary,
            logs: preferredLogs,
            orderProjection: preferredOrder,
            saleReplay: preferredSale
          },
          freeEndpoints: {
            primary: primaryPool.map((state, index) => ({
              index,
              coolingDown: state.retryAt > Date.now(),
              failures: state.failures,
              consecutiveFailures: state.consecutiveFailures,
              successes: state.successes
            })),
            logs: logPool.map((state, index) => ({
              index,
              coolingDown: state.retryAt > Date.now(),
              failures: state.failures,
              consecutiveFailures: state.consecutiveFailures,
              successes: state.successes
            })),
            orderProjection: orderPool.map((state, index) => ({
              index,
              coolingDown: state.retryAt > Date.now(),
              failures: state.failures,
              consecutiveFailures: state.consecutiveFailures,
              successes: state.successes
            })),
            saleReplay: salePool.map((state, index) => ({
              index,
              coolingDown: state.retryAt > Date.now(),
              failures: state.failures,
              consecutiveFailures: state.consecutiveFailures,
              successes: state.successes
            }))
          },
          observedHead: observedHead?.toString() ?? null,
          traffic,
          unified: options.unifiedPolicy ? {
            profileId: unifiedRpcProfileId(options.unifiedPolicy.profile),
            chainId: options.unifiedPolicy.chainId,
            sourceRouting: unifiedSourcePaidPrimary ? "paid_primary" : unifiedSourcePaidLogs ? "paid_logs_free_blocks" : "free_first",
            traffic: unifiedTraffic,
            adaptiveRangeRejected,
            ...selectiveConfigured ? {
              selective: {
                primaryIndices: selectiveIndices2,
                poolSha256: options.bnbSelectivePoolSha256,
                preferred: preferredSelective,
                endpoints: selectivePool.map((state, index) => ({
                  primaryIndex: selectiveIndices2[index],
                  coolingDown: state.retryAt > Date.now(),
                  failures: state.failures,
                  successes: state.successes
                }))
              }
            } : {},
            ...selectiveTransactionsConfigured ? {
              selectiveTransactions: {
                primaryIndices: selectiveTransactionIndices,
                poolSha256: options.bnbSelectivePoolSha256,
                preferred: preferredSelectiveTransactions,
                endpoints: selectiveTransactionPool.map(
                  (state, index) => ({
                    primaryIndex: selectiveTransactionIndices[index],
                    coolingDown: state.retryAt > Date.now(),
                    failures: state.failures,
                    successes: state.successes
                  })
                )
              }
            } : {}
          } : null,
          budget: options.budget.snapshot(),
          workloadBudgets: {
            source: options.budget.snapshot(),
            ...Object.fromEntries(
              Object.entries(options.workloadBudgets ?? {}).map(
                ([workload2, budget2]) => [workload2, budget2.snapshot()]
              )
            )
          }
        });
        return;
      }
      if (request.method !== "POST" || !["/", unifiedRpcPath].includes(request.url ?? "") || !/^application\/json(?:\s*;|$)/i.test(
        String(request.headers["content-type"] ?? "")
      )) {
        response(output, 404, { error: "not_found" });
        return;
      }
      const rawWorkload = request.headers[rpcBudgetWorkloadHeader];
      let workload = "source";
      let budget = options.budget;
      const profileHeader = request.headers[unifiedRpcProfileHeader];
      if (request.url === unifiedRpcPath && (profileHeader === void 0 || !isUnifiedRpcWorkload(rawWorkload)) || request.url !== unifiedRpcPath && (profileHeader !== void 0 || isUnifiedRpcWorkload(rawWorkload))) {
        response(output, 403, { error: "unified_rpc_path_or_headers_refused" });
        return;
      }
      if (isUnifiedRpcWorkload(rawWorkload) || profileHeader !== void 0) {
        const gate = options.unifiedPolicy;
        if (!gate || profileHeader !== unifiedRpcProfileId(gate.profile) || !isUnifiedRpcWorkload(rawWorkload) || !options.workloadBudgets?.[rawWorkload]) {
          response(output, 403, { error: "unified_rpc_profile_unavailable" });
          return;
        }
        unifiedWorkload = rawWorkload;
        await gate.ready(unifiedWorkload);
        budget = options.workloadBudgets[unifiedWorkload];
        workload = unifiedWorkload === "unified_evidence" ? "order_projection" : "source";
      } else if (rawWorkload !== void 0) {
        if (!isDelegatedRpcComputeWorkload(rawWorkload) || !options.workloadBudgets?.[rawWorkload]) {
          response(output, 400, { error: "invalid_rpc_workload" });
          return;
        }
        workload = rawWorkload;
        budget = options.workloadBudgets[rawWorkload];
      }
      requestWorkload = workload;
      const configuredPaidFallbackAllowed = paidFallbackOnFreeFailure || workload === "foreground" && foregroundPaidFallbackOnFreeFailure || workload === "order_projection" && orderPaidFallbackOnFreeFailure || workload === "source" && sourcePaidFallbackOnFreeFailure || workload === "sale" && salePaidFallbackOnFreeFailure;
      const body = await bodyOf(request);
      const calls = parseRequests(body);
      if (unifiedWorkload) {
        try {
          validateUnifiedRpcCalls(
            options.unifiedPolicy.profile,
            options.unifiedPolicy.chainId,
            calls
          );
        } catch (error) {
          const rangeOnly = error instanceof UnifiedRpcRangeError && isRangeOnlyUnifiedRejection(
            options.unifiedPolicy.profile,
            options.unifiedPolicy.chainId,
            calls
          );
          if (rangeOnly && error.maximum >= 2 && unifiedWorkload === "unified_source")
            adaptiveRangeRejected.unified_source++;
          else unifiedTraffic[unifiedWorkload].refused++;
          if (error instanceof UnifiedRpcRangeError && rangeOnly) {
            const errors = calls.map((call) => ({
              jsonrpc: "2.0",
              id: call.id,
              error: {
                code: -32005,
                message: error.maximum >= 2 ? `Max range: ${error.maximum}` : error.message
              }
            }));
            response(
              output,
              200,
              Array.isArray(JSON.parse(body.toString())) ? errors : errors[0]
            );
          } else
            response(output, 400, {
              error: {
                code: -32602,
                message: "Unified RPC source/method policy refused."
              }
            });
          return;
        }
      }
      let result;
      let rejectedFreeResponse;
      const logsOnly = calls.every((call) => call.method === "eth_getLogs");
      const unifiedSourceSelective = selectiveConfigured && unifiedWorkload === "unified_source" && calls.some(
        (call) => call.method === "eth_getTransactionByHash" || call.method === "eth_getTransactionByBlockNumberAndIndex" || call.method === "eth_getBlockByNumber" && Array.isArray(call.params) && call.params[1] === false
      );
      const unifiedSourceSelectiveTransactions = unifiedSourceSelective && selectiveTransactionsConfigured && calls.every(
        (call) => call.method === "eth_getTransactionByBlockNumberAndIndex"
      );
      const unifiedSourceSelectiveHeaders = unifiedSourceSelective && calls.every(
        (call) => call.method === "eth_getBlockByNumber" && Array.isArray(call.params) && call.params[1] === false && blockNumber(call.params[0]) !== void 0
      );
      const unifiedSourceLogs = !unifiedSourceSelective && unifiedWorkload === "unified_source" && calls.some((call) => call.method === "eth_getLogs");
      const orderRoute = workload === "order_projection" || workload === "foreground";
      const saleRoute = workload === "sale";
      const freePool = unifiedSourceSelective ? unifiedSourceSelectiveTransactions ? selectiveTransactionPool : selectivePool : unifiedSourceLogs ? sourceLogPool : unifiedWorkload ? unifiedPools[unifiedWorkload] : orderRoute ? orderPool : saleRoute ? salePool : logsOnly ? logPool : primaryPool;
      const boundedUnifiedSource = unifiedWorkload === "unified_source" && calls.every((call) => {
        try {
          unifiedRpcPaidRange(call);
          return true;
        } catch {
          return false;
        }
      });
      const useUnifiedPaidPrimary = !unifiedSourceSelective && boundedUnifiedSource && (unifiedSourcePaidPrimary || unifiedSourcePaidLogs && calls.some((call) => call.method === "eth_getLogs"));
      const useUnifiedFreeBlocks = unifiedSourcePaidLogs && boundedUnifiedSource && calls.every((call) => call.method === "eth_getBlockByNumber");
      const paidFallbackAllowed = !unifiedSourceSelective && (configuredPaidFallbackAllowed || useUnifiedFreeBlocks);
      if (unifiedSourceSelective && !calls.every(
        (call) => isFreeRpcCall(call, observedHead, recentBlocks) || call.method === "eth_getLogs"
      )) {
        unifiedTraffic.unified_source.refused++;
        response(output, 400, { error: "selective_free_batch_unavailable" });
        return;
      }
      const sourceRequest = unifiedSourcePaidLogs && unifiedWorkload === "unified_source" ? new AbortController() : void 0;
      if (sourceRequest) {
        cancelSourceRequest = () => {
          if (!output.writableEnded) sourceRequest.abort();
        };
        output.once("close", cancelSourceRequest);
        if (output.destroyed) sourceRequest.abort();
      }
      if (!useUnifiedPaidPrimary && freePool.length && calls.every(
        (call) => isFreeRpcCall(call, observedHead, recentBlocks) || // Unified calls have already passed the reviewed source/address,
        // deployment and range limits above. Permit those bounded source
        // scans on the existing paced pool without changing legacy reads
        // or the separate paid-fallback/permit admission below.
        unifiedWorkload === "unified_source" && call.method === "eth_getLogs" || // Complete historical receipts require bytecode at that exact
        // block. The policy above already restricts code reads to reviewed
        // addresses and deployment bounds. Keep this exception within the
        // evidence workload; legacy historical state reads are unchanged.
        unifiedWorkload === "unified_evidence" && call.method === "eth_getCode"
      )) {
        let releaseOrderRoute;
        try {
          releaseOrderRoute = orderRoute ? await acquireOrderFreeRoute() : void 0;
          await budget.authorizeFreeDispatch();
          const maximumSweeps = orderRoute ? 2 : 1;
          for (let sweep = 0; sweep < maximumSweeps && !result; sweep++) {
            const preferred = unifiedSourceSelective ? unifiedSourceSelectiveTransactions ? preferredSelectiveTransactions : preferredSelective : unifiedSourceLogs ? preferredSourceLogs : orderRoute ? preferredOrder : saleRoute ? preferredSale : logsOnly ? preferredLogs : preferredSourcePrimary;
            let available = availableFreeEndpoints(freePool, preferred);
            if (workload === "foreground")
              available.sort(
                (left, right) => left.state.nextDispatchAt - right.state.nextDispatchAt
              );
            else if (unifiedSourceLogs)
              available.sort((left, right) => {
                const leftDedicated = dedicatedSourceLogUrls.has(
                  left.state.url.href
                );
                const rightDedicated = dedicatedSourceLogUrls.has(
                  right.state.url.href
                );
                if (leftDedicated !== rightDedicated)
                  return leftDedicated ? -1 : 1;
                return leftDedicated ? left.state.nextDispatchAt - right.state.nextDispatchAt : 0;
              });
            if (!available.length) {
              if (sweep + 1 < maximumSweeps && await waitForRateLimitRecovery(freePool)) {
                traffic.freeRateLimitRetries++;
                continue;
              }
              traffic.freeCircuitOpenBatches++;
              break;
            }
            if (unifiedSourceSelectiveTransactions)
              preferredSelectiveTransactions = (available[0].index + 1) % freePool.length;
            else if (unifiedSourceSelective)
              preferredSelective = (available[0].index + 1) % freePool.length;
            else if (!unifiedSourceLogs && !logsOnly && workload === "source")
              preferredSourcePrimary = (available[0].index + 1) % freePool.length;
            let rateLimited = false;
            for (const selected of available) {
              try {
                await paceFreeDispatch(
                  selected.state,
                  workload,
                  unifiedSourceSelectiveHeaders
                );
                if (selected.state.retryAt > Date.now()) continue;
                const free = await boundedDispatch(
                  selected.state.url,
                  body,
                  orderRoute ? freeOrderTimeoutMs : freeTimeoutMs,
                  workload,
                  sourceRequest ? { signal: sourceRequest.signal } : void 0
                );
                if (usableFreeResponse(free, calls)) {
                  result = free;
                  selected.state.retryAt = 0;
                  selected.state.consecutiveFailures = 0;
                  selected.state.successes++;
                  if (unifiedSourceLogs)
                    preferredSourceLogs = (selected.index + 1) % freePool.length;
                  else if (orderRoute) preferredOrder = selected.index;
                  else if (saleRoute)
                    preferredSale = (selected.index + 1) % freePool.length;
                  else if (logsOnly)
                    preferredLogs = (selected.index + 1) % freePool.length;
                  traffic.freeBatches++;
                  traffic.freeCalls += calls.length;
                  if (unifiedWorkload)
                    unifiedTraffic[unifiedWorkload].freeCalls += calls.length;
                  traffic.workloads[workload].freeCalls += calls.length;
                  increment(traffic.methods.free, calls);
                  break;
                }
                traffic.freeFailures++;
                const adaptive = unifiedSourceLogs ? adaptiveUnifiedLogResponse(
                  free,
                  calls,
                  options.unifiedPolicy.profile,
                  Array.isArray(JSON.parse(body.toString("utf8")))
                ) : void 0;
                if (adaptive) {
                  result = adaptive;
                  selected.state.failures++;
                  selected.state.consecutiveFailures = 0;
                  break;
                }
                rejectedFreeResponse ??= free;
                selected.state.failures++;
                const disposition = freeFailureDisposition(free);
                if (disposition === "transient")
                  selected.state.consecutiveFailures++;
                else selected.state.consecutiveFailures = 0;
                if (disposition === "adaptive") break;
                if (disposition === "rate_limit") {
                  rateLimited = true;
                  selected.state.retryAt = Date.now() + freeRateLimitCooldownMs;
                } else if (disposition === "cooldown" || selected.state.consecutiveFailures >= 3)
                  selected.state.retryAt = Date.now() + freeFailureCooldownMs;
              } catch (error) {
                if (error instanceof RpcProxyBusyError || error instanceof RpcProxyCancelledError)
                  throw error;
                traffic.freeFailures++;
                selected.state.failures++;
                const adaptive = adaptiveLogSizeResponse(
                  error,
                  calls,
                  unifiedWorkload,
                  Array.isArray(JSON.parse(body.toString("utf8")))
                );
                if (adaptive) {
                  result = adaptive;
                  selected.state.consecutiveFailures = 0;
                  break;
                }
                selected.state.consecutiveFailures++;
                if (selected.state.consecutiveFailures >= 3)
                  selected.state.retryAt = Date.now() + freeFailureCooldownMs;
              }
              if (unifiedSourceLogs)
                preferredSourceLogs = (selected.index + 1) % freePool.length;
              else if (orderRoute)
                preferredOrder = (selected.index + 1) % freePool.length;
              else if (saleRoute)
                preferredSale = (selected.index + 1) % freePool.length;
              else if (logsOnly)
                preferredLogs = (selected.index + 1) % freePool.length;
            }
            if (!result && rateLimited && sweep + 1 < maximumSweeps && await waitForRateLimitRecovery(freePool)) {
              traffic.freeRateLimitRetries++;
              continue;
            }
            break;
          }
        } catch (error) {
          if (!(error instanceof RpcProxyBusyError) || workload !== "foreground" || !paidFallbackAllowed)
            throw error;
        } finally {
          releaseOrderRoute?.();
        }
        if (!result && paidFallbackAllowed) traffic.fallbackBatches++;
        if (!result && !paidFallbackAllowed) {
          traffic.freeOnlyFailures++;
          if (rejectedFreeResponse) result = rejectedFreeResponse;
          else {
            response(output, 502, { error: "free_rpc_unavailable" });
            return;
          }
        }
      }
      if (!result) {
        const reservePaidDispatch = async () => {
          if (unifiedWorkload) {
            const permit = request.headers[unifiedRpcPermitHeader];
            try {
              await options.unifiedPolicy.reservePaid(
                typeof permit === "string" ? permit : void 0,
                calls
              );
            } catch {
              unifiedTraffic[unifiedWorkload].refused++;
              throw new RpcPaidPermitRefusedError();
            }
          }
          for (const call of calls) await budget.reserve(call.method);
        };
        if (!sourceRequest) await reservePaidDispatch();
        try {
          result = await boundedDispatch(
            options.upstream,
            body,
            3e4,
            workload,
            sourceRequest ? {
              signal: sourceRequest.signal,
              beforeDispatch: reservePaidDispatch
            } : void 0
          );
        } catch (error) {
          result = adaptiveLogSizeResponse(
            error,
            calls,
            unifiedWorkload,
            Array.isArray(JSON.parse(body.toString("utf8")))
          );
          if (!result) throw error;
        }
        traffic.paidBatches++;
        traffic.paidCalls += calls.length;
        if (unifiedWorkload)
          unifiedTraffic[unifiedWorkload].paidCalls += calls.length;
        traffic.workloads[workload].paidCalls += calls.length;
        increment(traffic.methods.paid, calls);
      }
      const items = responseItems(result);
      if (items) observedHead = updateObservedHead(items, calls, observedHead);
      output.writeHead(result.status, {
        "content-type": result.contentType,
        "content-length": result.payload.length,
        "cache-control": "no-store"
      });
      output.end(result.payload);
    } catch (error) {
      const budget = rpcComputeBudgetError(error);
      if (error instanceof RpcProxyCancelledError) return;
      if (error instanceof RpcPaidPermitRefusedError)
        response(output, 403, { error: "unified_rpc_paid_permit_refused" });
      else if (error instanceof RpcProxyBusyError) {
        if (requestWorkload === "source") {
          output.setHeader("retry-after", "1");
          response(output, 429, { error: "rpc_proxy_rate_limited" });
        } else response(output, 503, { error: "rpc_proxy_busy" });
      } else if (budget) {
        output.setHeader(
          "retry-after",
          String(Math.max(1, Math.ceil(budget.retryAfterMs / 1e3)))
        );
        response(output, 429, { error: "rpc_budget_exhausted" });
      } else response(output, 502, { error: "rpc_proxy_failed" });
    } finally {
      if (cancelSourceRequest) output.off("close", cancelSourceRequest);
    }
  });
}
async function main() {
  const environment = readRpcBudgetProxyEnvironment();
  const coordinator = createOpenSeaRequestBudget();
  const unified = readUnifiedRpcPolicyEnvironment();
  const proxy = createRpcBudgetProxy({
    upstream: environment.upstream,
    freeUpstream: environment.freeUpstream,
    freeLogUpstream: environment.freeLogUpstream,
    freeUpstreams: environment.freeUpstreams,
    freeLogUpstreams: environment.freeLogUpstreams,
    freeOrderUpstreams: environment.freeOrderUpstreams,
    freeRecentBlocks: environment.freeRecentBlocks,
    freeRequestTimeoutMs: environment.freeRequestTimeoutMs,
    freeOrderRequestTimeoutMs: environment.freeOrderRequestTimeoutMs,
    freeOrderMinimumIntervalMs: environment.freeOrderMinimumIntervalMs,
    maximumConcurrentUpstreamRequests: environment.maximumConcurrentUpstreamRequests,
    paidFallbackOnFreeFailure: environment.paidFallbackOnFreeFailure,
    foregroundPaidFallbackOnFreeFailure: environment.foregroundPaidFallbackOnFreeFailure,
    orderPaidFallbackOnFreeFailure: environment.orderPaidFallbackOnFreeFailure,
    sourcePaidFallbackOnFreeFailure: environment.sourcePaidFallbackOnFreeFailure,
    salePaidFallbackOnFreeFailure: environment.salePaidFallbackOnFreeFailure,
    unifiedSourcePaidPrimary: environment.unifiedSourcePaidPrimary,
    unifiedSourcePaidLogs: environment.unifiedSourcePaidLogs,
    bnbSelectivePrimaryIndices: environment.bnbSelectivePrimaryIndices,
    bnbSelectivePoolSha256: environment.bnbSelectivePoolSha256,
    bnbSelectiveTransactionPrimaryIndices: environment.bnbSelectiveTransactionPrimaryIndices,
    bnbSelectiveHeaderMinimumIntervalMs: environment.bnbSelectiveHeaderMinimumIntervalMs,
    budget: coordinator.rpcBudget("source", "background"),
    unifiedPolicy: unified ? createUnifiedRpcPolicyGate(
      coordinator.pool,
      coordinator.scope,
      unified.profile,
      unified.chainId
    ) : void 0,
    workloadBudgets: {
      order_projection: coordinator.rpcBudget("order_projection", "background"),
      sale: coordinator.rpcBudget("sale", "background"),
      foreground: coordinator.rpcBudget("foreground", "foreground"),
      unified_source: coordinator.rpcBudget("unified_source", "background"),
      unified_evidence: coordinator.rpcBudget("unified_evidence", "background")
    }
  });
  proxy.requestTimeout = 35e3;
  proxy.headersTimeout = 1e4;
  proxy.maxRequestsPerSocket = 1e3;
  const stop = () => proxy.close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await new Promise((resolve2, reject) => {
      proxy.once("error", reject);
      proxy.listen(environment.port, environment.host, resolve2);
    });
    console.log(
      JSON.stringify({
        service: "yunipals-rpc-budget-proxy",
        status: "started"
      })
    );
    await new Promise((resolve2) => proxy.once("close", resolve2));
  } finally {
    await coordinator.close();
  }
}
function isRpcBudgetProxyMain(argv = process.argv[1], modulePath = fileURLToPath(import.meta.url)) {
  return Boolean(
    argv && realpathSync(resolve(argv)) === realpathSync(resolve(modulePath))
  );
}
if (isRpcBudgetProxyMain())
  main().catch(() => {
    console.error(
      "RPC budget proxy stopped after a configuration or runtime failure."
    );
    process.exitCode = 1;
  });
export {
  createRpcBudgetProxy,
  isFreeRpcCall,
  isRpcBudgetProxyMain,
  readRpcBudgetProxyEnvironment,
  rpcPrimaryPoolSha256
};
//# sourceMappingURL=rpc-budget-proxy.mjs.map

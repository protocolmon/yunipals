import { realpathSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import {
  rpcComputeBudgetError,
  type RpcComputeBudget
} from "@/opensea/rpcComputeBudget";
import {
  isDelegatedRpcComputeWorkload,
  rpcBudgetWorkloadHeader,
  type DelegatedRpcComputeWorkload
} from "@/rpcBudgetProxyRegistry";

const maximumRequestBytes = 2 * 1024 * 1024;
const maximumResponseBytes = 32 * 1024 * 1024;
const defaultFreeRecentBlocks = 4096n;
const defaultFreeRequestTimeoutMs = 10000;
const defaultFreeOrderRequestTimeoutMs = 3000;
const defaultFreeFailureCooldownMs = 30000;
const defaultFreeRateLimitCooldownMs = 2000;
const defaultFreeSourceMinimumIntervalMs = 400;
const defaultFreeMinimumIntervalMs = 1000;
const defaultMaximumConcurrentUpstreamRequests = 8;
const blockedMethods =
  /^(?:admin_|debug_|engine_|miner_|personal_|txpool_|wallet_)|(?:send|sign|submit)/i;
const freeAlwaysMethods = new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_protocolVersion",
  "eth_syncing",
  "net_listening",
  "net_peerCount",
  "net_version"
]);
const freeHashMethods = new Set([
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt"
]);
const freeCurrentStateBlockParameter = new Map<string, number>([
  ["eth_getBalance", 1],
  ["eth_getCode", 1],
  ["eth_getTransactionCount", 1],
  ["eth_getStorageAt", 2],
  ["eth_call", 1]
]);
const currentBlockTags = new Set(["latest", "safe", "finalized", "pending"]);

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export type RpcBudgetProxyOptions = {
  upstream: URL;
  freeUpstream?: URL;
  freeLogUpstream?: URL;
  freeUpstreams?: URL[];
  freeLogUpstreams?: URL[];
  freeOrderUpstreams?: URL[];
  freeRecentBlocks?: bigint;
  freeRequestTimeoutMs?: number;
  freeOrderRequestTimeoutMs?: number;
  freeFailureCooldownMs?: number;
  freeRateLimitCooldownMs?: number;
  freeSourceMinimumIntervalMs?: number;
  freeOrderMinimumIntervalMs?: number;
  freeMinimumIntervalMs?: number;
  maximumConcurrentUpstreamRequests?: number;
  paidFallbackOnFreeFailure?: boolean;
  foregroundPaidFallbackOnFreeFailure?: boolean;
  orderPaidFallbackOnFreeFailure?: boolean;
  sourcePaidFallbackOnFreeFailure?: boolean;
  salePaidFallbackOnFreeFailure?: boolean;
  budget: RpcComputeBudget;
  workloadBudgets?: Partial<
    Record<DelegatedRpcComputeWorkload, RpcComputeBudget>
  >;
  fetch?: typeof globalThis.fetch;
};

function endpointList(value: string | undefined) {
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

export function readRpcBudgetProxyEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const host = input.MARKET_RPC_PROXY_HOST ?? "127.0.0.1";
  const port = Number(input.MARKET_RPC_PROXY_PORT);
  let upstream: URL;
  try {
    upstream = new URL(input.MARKET_RPC_PROXY_UPSTREAM ?? "");
  } catch {
    throw new Error("Configure the RPC budget proxy upstream.");
  }
  let freeUpstream: URL | undefined;
  if (input.MARKET_RPC_PROXY_FREE_UPSTREAM) {
    try {
      freeUpstream = new URL(input.MARKET_RPC_PROXY_FREE_UPSTREAM);
    } catch {
      throw new Error("Invalid RPC budget proxy configuration.");
    }
  }
  let freeLogUpstream: URL | undefined;
  if (input.MARKET_RPC_PROXY_FREE_LOG_UPSTREAM) {
    try {
      freeLogUpstream = new URL(input.MARKET_RPC_PROXY_FREE_LOG_UPSTREAM);
    } catch {
      throw new Error("Invalid RPC budget proxy configuration.");
    }
  }
  const freeUpstreams = [
    ...(freeUpstream ? [freeUpstream] : []),
    ...endpointList(input.MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS)
  ];
  const freeLogUpstreams = [
    ...(freeLogUpstream ? [freeLogUpstream] : freeUpstreams),
    ...endpointList(input.MARKET_RPC_PROXY_FREE_LOG_FAILOVER_UPSTREAMS)
  ];
  const freeOrderUpstreams = endpointList(
    input.MARKET_RPC_PROXY_FREE_ORDER_UPSTREAMS
  );
  const freeRecentBlocks = BigInt(
    input.MARKET_RPC_PROXY_FREE_RECENT_BLOCKS ?? defaultFreeRecentBlocks
  );
  const freeRequestTimeoutMs = Number(
    input.MARKET_RPC_PROXY_FREE_TIMEOUT_MS ?? defaultFreeRequestTimeoutMs
  );
  const freeOrderRequestTimeoutMs = Number(
    input.MARKET_RPC_PROXY_FREE_ORDER_TIMEOUT_MS ??
      Math.min(freeRequestTimeoutMs, defaultFreeOrderRequestTimeoutMs)
  );
  const maximumConcurrentUpstreamRequests = Number(
    input.MARKET_RPC_PROXY_MAX_IN_FLIGHT ??
      defaultMaximumConcurrentUpstreamRequests
  );
  const freeOrderMinimumIntervalMs = Number(
    input.MARKET_RPC_PROXY_FREE_ORDER_MINIMUM_INTERVAL_MS ??
      defaultFreeMinimumIntervalMs
  );
  const paidFallbackValue =
    input.MARKET_RPC_PROXY_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const foregroundPaidFallbackValue =
    input.MARKET_RPC_PROXY_FOREGROUND_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const orderPaidFallbackValue =
    input.MARKET_RPC_PROXY_ORDER_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const sourcePaidFallbackValue =
    input.MARKET_RPC_PROXY_SOURCE_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  const salePaidFallbackValue =
    input.MARKET_RPC_PROXY_SALE_PAID_FALLBACK_ON_FREE_FAILURE ?? "false";
  if (
    !new Set(["true", "false"]).has(paidFallbackValue) ||
    !new Set(["true", "false"]).has(foregroundPaidFallbackValue) ||
    !new Set(["true", "false"]).has(orderPaidFallbackValue) ||
    !new Set(["true", "false"]).has(sourcePaidFallbackValue) ||
    !new Set(["true", "false"]).has(salePaidFallbackValue)
  )
    throw new Error("Invalid RPC budget proxy configuration.");
  const paidFallbackOnFreeFailure = paidFallbackValue === "true";
  const foregroundPaidFallbackOnFreeFailure =
    foregroundPaidFallbackValue === "true";
  const orderPaidFallbackOnFreeFailure = orderPaidFallbackValue === "true";
  const sourcePaidFallbackOnFreeFailure = sourcePaidFallbackValue === "true";
  const salePaidFallbackOnFreeFailure = salePaidFallbackValue === "true";
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    upstream.hostname
  );
  if (
    !["127.0.0.1", "::1"].includes(host) ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    (upstream.protocol !== "https:" &&
      !(input.NODE_ENV === "test" && loopback && upstream.protocol === "http:"))
  )
    throw new Error("Invalid RPC budget proxy configuration.");
  for (const candidate of [
    ...freeUpstreams,
    ...freeLogUpstreams,
    ...freeOrderUpstreams
  ])
    if (
      candidate &&
      (candidate.protocol !== "https:" ||
        !candidate.hostname ||
        candidate.username ||
        candidate.password ||
        candidate.search ||
        candidate.hash)
    )
      throw new Error("Invalid RPC budget proxy configuration.");
  if (freeLogUpstream && !freeUpstream)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (freeRecentBlocks < 128n || freeRecentBlocks > 100_000n)
    throw new Error("Invalid RPC budget proxy configuration.");
  if (
    !Number.isSafeInteger(freeRequestTimeoutMs) ||
    freeRequestTimeoutMs < 1000 ||
    freeRequestTimeoutMs > 30000 ||
    !Number.isSafeInteger(freeOrderRequestTimeoutMs) ||
    freeOrderRequestTimeoutMs < 1000 ||
    freeOrderRequestTimeoutMs > freeRequestTimeoutMs
  )
    throw new Error("Invalid RPC budget proxy configuration.");
  if (
    !Number.isSafeInteger(freeOrderMinimumIntervalMs) ||
    freeOrderMinimumIntervalMs < 0 ||
    freeOrderMinimumIntervalMs > 2000 ||
    !Number.isSafeInteger(maximumConcurrentUpstreamRequests) ||
    maximumConcurrentUpstreamRequests < 1 ||
    maximumConcurrentUpstreamRequests > 64
  )
    throw new Error("Invalid RPC budget proxy configuration.");
  if (
    new Set(freeUpstreams.map((candidate) => candidate.href)).size !==
      freeUpstreams.length ||
    new Set(freeLogUpstreams.map((candidate) => candidate.href)).size !==
      freeLogUpstreams.length ||
    new Set(freeOrderUpstreams.map((candidate) => candidate.href)).size !==
      freeOrderUpstreams.length
  )
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
    salePaidFallbackOnFreeFailure
  };
}

function response(
  output: ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  const encoded = JSON.stringify(body);
  output.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store"
  });
  output.end(encoded);
}

async function bodyOf(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumRequestBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseRequests(body: Buffer) {
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  if (
    requests.length < 1 ||
    requests.length > 1000 ||
    requests.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as JsonRpcRequest).method !== "string" ||
        !(item as JsonRpcRequest).method ||
        blockedMethods.test((item as JsonRpcRequest).method as string)
    )
  )
    throw new Error("invalid_request");
  return requests as Array<JsonRpcRequest & { method: string }>;
}

function blockNumber(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return;
  return BigInt(value);
}

function isCanonicalBlockHash(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  return (
    Object.keys(reference).length === 2 &&
    typeof reference.blockHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(reference.blockHash) &&
    reference.requireCanonical === true
  );
}

function isCurrentBlock(
  value: unknown,
  observedHead: bigint | undefined,
  recentBlocks: bigint
) {
  if (typeof value === "string" && currentBlockTags.has(value)) return true;
  // Reconciliation pins current-state reads to the freshly observed canonical
  // block hash with EIP-1898. Public routing is safe for this exact read-only
  // reference; unsupported archival hashes still fail closed for market work.
  if (isCanonicalBlockHash(value)) return true;
  const number = blockNumber(value);
  return (
    number !== undefined &&
    observedHead !== undefined &&
    number <= observedHead + 32n &&
    number + recentBlocks >= observedHead
  );
}

export function isFreeRpcCall(
  call: JsonRpcRequest & { method: string },
  observedHead: bigint | undefined,
  recentBlocks = defaultFreeRecentBlocks
) {
  if (freeAlwaysMethods.has(call.method)) return true;
  if (freeHashMethods.has(call.method)) return true;
  if (call.method === "eth_getBlockByNumber")
    return (
      Array.isArray(call.params) &&
      (isCurrentBlock(call.params[0], observedHead, recentBlocks) ||
        call.params[0] === "earliest" ||
        blockNumber(call.params[0]) !== undefined)
    );
  const stateBlockParameter = freeCurrentStateBlockParameter.get(call.method);
  if (stateBlockParameter !== undefined) {
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
    const value = filter as Record<string, unknown>;
    if (value.blockHash !== undefined) return true;
    return (
      isCurrentBlock(value.fromBlock ?? "latest", observedHead, recentBlocks) &&
      isCurrentBlock(value.toBlock ?? "latest", observedHead, recentBlocks)
    );
  }
  return false;
}

type DispatchedResponse = {
  status: number;
  contentType: string;
  payload: Buffer;
};

class RpcProxyBusyError extends Error {}

type FreeEndpointState = {
  url: URL;
  retryAt: number;
  nextDispatchAt: number;
  failures: number;
  consecutiveFailures: number;
  successes: number;
};

async function dispatchRpc(
  dispatch: typeof globalThis.fetch,
  upstream: URL,
  body: Buffer,
  timeoutMs: number
): Promise<DispatchedResponse> {
  const result = await dispatch(upstream, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Yunipals-RPC-Proxy/1"
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const length = Number(result.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumResponseBytes)
    throw new Error("response_too_large");
  const payload = Buffer.from(await result.arrayBuffer());
  if (payload.length > maximumResponseBytes)
    throw new Error("response_too_large");
  return {
    status: result.status,
    contentType: result.headers.get("content-type") ?? "application/json",
    payload
  };
}

function responseItems(result: DispatchedResponse) {
  if (result.status < 200 || result.status >= 300) return;
  try {
    const parsed = JSON.parse(result.payload.toString("utf8")) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (
      values.length < 1 ||
      values.some(
        (value) =>
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          "error" in value
      )
    )
      return;
    return values as Array<Record<string, unknown>>;
  } catch {
    return;
  }
}

function usableFreeResponse(
  result: DispatchedResponse,
  calls: Array<JsonRpcRequest & { method: string }>
) {
  const items = responseItems(result);
  if (!items || items.length !== calls.length) return false;
  const callsById = new Map(
    calls.map((call) => [JSON.stringify(call.id), call])
  );
  return items.every((item) => {
    const call = callsById.get(JSON.stringify(item.id));
    if (!call) return false;
    return !(
      freeHashMethods.has(call.method) &&
      (item.result === null || item.result === undefined)
    );
  });
}

type FreeFailureDisposition =
  | "adaptive"
  | "cooldown"
  | "rate_limit"
  | "request"
  | "transient";

function freeFailureDisposition(
  result: DispatchedResponse
): FreeFailureDisposition {
  if (result.status === 413) return "adaptive";
  if (result.status === 429) return "rate_limit";
  if ([401, 403].includes(result.status)) return "cooldown";
  if (result.status >= 400 && result.status < 500) return "request";
  if (result.status >= 500) return "transient";
  try {
    const parsed = JSON.parse(result.payload.toString("utf8")) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const messages = items.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const error = (item as Record<string, unknown>).error;
      if (!error || typeof error !== "object" || Array.isArray(error))
        return [];
      const message = (error as Record<string, unknown>).message;
      return typeof message === "string" ? [message.slice(0, 512)] : [];
    });
    return messages.some((message) =>
      /rate.?limit|too many requests|request limit/i.test(message)
    )
      ? "rate_limit"
      : "request";
  } catch {
    return "request";
  }
}

function updateObservedHead(
  items: Array<Record<string, unknown>>,
  calls: Array<JsonRpcRequest & { method: string }>,
  current: bigint | undefined
) {
  const callsById = new Map(
    calls.map((call) => [JSON.stringify(call.id), call])
  );
  let head = current;
  for (const item of items) {
    const call = callsById.get(JSON.stringify(item.id));
    if (!call) continue;
    let candidate: bigint | undefined;
    if (call.method === "eth_blockNumber") candidate = blockNumber(item.result);
    if (
      call.method === "eth_getBlockByNumber" &&
      Array.isArray(call.params) &&
      typeof call.params[0] === "string" &&
      currentBlockTags.has(call.params[0]) &&
      item.result &&
      typeof item.result === "object" &&
      !Array.isArray(item.result)
    )
      candidate = blockNumber((item.result as Record<string, unknown>).number);
    if (candidate !== undefined && (head === undefined || candidate > head))
      head = candidate;
  }
  return head;
}

function methodBucket(method: string) {
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
      eth_getTransactionCount: true,
      eth_getTransactionReceipt: true,
      eth_syncing: true,
      net_version: true
    },
    method
  )
    ? method
    : "other";
}

function increment(target: Record<string, number>, calls: JsonRpcRequest[]) {
  for (const call of calls) {
    const key = methodBucket(String(call.method));
    target[key] = (target[key] ?? 0) + 1;
  }
}

export function createRpcBudgetProxy(options: RpcBudgetProxyOptions) {
  const dispatch = options.fetch ?? globalThis.fetch;
  const recentBlocks = options.freeRecentBlocks ?? defaultFreeRecentBlocks;
  const freeTimeoutMs =
    options.freeRequestTimeoutMs ?? defaultFreeRequestTimeoutMs;
  const freeOrderTimeoutMs =
    options.freeOrderRequestTimeoutMs ??
    Math.min(freeTimeoutMs, defaultFreeOrderRequestTimeoutMs);
  const paidFallbackOnFreeFailure = options.paidFallbackOnFreeFailure ?? false;
  const foregroundPaidFallbackOnFreeFailure =
    options.foregroundPaidFallbackOnFreeFailure ?? false;
  const orderPaidFallbackOnFreeFailure =
    options.orderPaidFallbackOnFreeFailure ?? false;
  const sourcePaidFallbackOnFreeFailure =
    options.sourcePaidFallbackOnFreeFailure ?? false;
  const salePaidFallbackOnFreeFailure =
    options.salePaidFallbackOnFreeFailure ?? false;
  const freeFailureCooldownMs =
    options.freeFailureCooldownMs ?? defaultFreeFailureCooldownMs;
  const freeRateLimitCooldownMs =
    options.freeRateLimitCooldownMs ?? defaultFreeRateLimitCooldownMs;
  const freeMinimumIntervalMs =
    options.freeMinimumIntervalMs ?? defaultFreeMinimumIntervalMs;
  const freeSourceMinimumIntervalMs =
    options.freeSourceMinimumIntervalMs ??
    (options.freeMinimumIntervalMs === undefined
      ? defaultFreeSourceMinimumIntervalMs
      : freeMinimumIntervalMs);
  const freeOrderMinimumIntervalMs =
    options.freeOrderMinimumIntervalMs ?? freeMinimumIntervalMs;
  const maximumConcurrentUpstreamRequests =
    options.maximumConcurrentUpstreamRequests ??
    defaultMaximumConcurrentUpstreamRequests;
  if (
    !Number.isSafeInteger(freeFailureCooldownMs) ||
    freeFailureCooldownMs < 1 ||
    freeFailureCooldownMs > 300000 ||
    !Number.isSafeInteger(freeOrderTimeoutMs) ||
    freeOrderTimeoutMs < 1000 ||
    freeOrderTimeoutMs > freeTimeoutMs ||
    !Number.isSafeInteger(freeRateLimitCooldownMs) ||
    freeRateLimitCooldownMs < 1 ||
    freeRateLimitCooldownMs > 5000 ||
    !Number.isSafeInteger(freeMinimumIntervalMs) ||
    freeMinimumIntervalMs < 0 ||
    freeMinimumIntervalMs > 2000 ||
    !Number.isSafeInteger(freeSourceMinimumIntervalMs) ||
    freeSourceMinimumIntervalMs < 0 ||
    freeSourceMinimumIntervalMs > 2000 ||
    !Number.isSafeInteger(freeOrderMinimumIntervalMs) ||
    freeOrderMinimumIntervalMs < 0 ||
    freeOrderMinimumIntervalMs > 2000 ||
    !Number.isSafeInteger(maximumConcurrentUpstreamRequests) ||
    maximumConcurrentUpstreamRequests < 1 ||
    maximumConcurrentUpstreamRequests > 64
  )
    throw new Error("Invalid RPC budget proxy configuration.");
  const endpointStates = (urls: URL[]) =>
    urls.map((url) => ({
      url,
      retryAt: 0,
      nextDispatchAt: 0,
      failures: 0,
      consecutiveFailures: 0,
      successes: 0
    }));
  const primaryUrls =
    options.freeUpstreams ??
    (options.freeUpstream ? [options.freeUpstream] : []);
  const primaryPool = endpointStates(primaryUrls);
  const configuredLogPool =
    options.freeLogUpstreams ??
    (options.freeLogUpstream ? [options.freeLogUpstream] : []);
  const logPool = configuredLogPool.length
    ? endpointStates(configuredLogPool)
    : primaryPool;
  const configuredOrderPool = options.freeOrderUpstreams ?? [];
  // Keep pacing and circuit state independent across workloads, even when the
  // configured URLs are the same. A busy replay or projection must not push
  // source-indexer reads behind its own pacing queue.
  const orderPool = endpointStates(
    configuredOrderPool.length ? configuredOrderPool : primaryUrls
  );
  const salePool = endpointStates(
    configuredLogPool.length ? configuredLogPool : primaryUrls
  );
  let preferredSourcePrimary = 0;
  let preferredLogs = 0;
  let preferredOrder = 0;
  let preferredSale = 0;
  let activeUpstreamRequests = 0;
  let maximumObservedUpstreamRequests = 0;
  let maximumQueuedPriorityRequests = 0;
  let observedHead: bigint | undefined;
  type PriorityWaiter = {
    resolve: () => void;
    reject: (error: RpcProxyBusyError) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const priorityQueue: Record<DelegatedRpcComputeWorkload, PriorityWaiter[]> = {
    order_projection: [],
    sale: [],
    foreground: []
  };
  const priorityQueueLimit = maximumConcurrentUpstreamRequests * 32;
  const priorityQueueWaitMs = Math.min(2000, freeTimeoutMs / 3);
  const sourcePacingQueueWaitMs = Math.min(
    8000,
    Math.max(2000, freeTimeoutMs - 2000)
  );
  const orderRouteQueueWaitMs = Math.min(4500, freeTimeoutMs / 2);
  const maximumConcurrentOrderFreeRoutes = Math.min(
    4,
    maximumConcurrentUpstreamRequests
  );
  let activeOrderFreeRoutes = 0;
  const orderFreeRouteQueue: PriorityWaiter[] = [];
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
    methods: {
      free: {} as Record<string, number>,
      paid: {} as Record<string, number>
    },
    workloads: {
      source: { freeCalls: 0, paidCalls: 0 },
      order_projection: { freeCalls: 0, paidCalls: 0 },
      sale: { freeCalls: 0, paidCalls: 0 },
      foreground: { freeCalls: 0, paidCalls: 0 }
    }
  };
  const availableFreeEndpoints = (
    pool: FreeEndpointState[],
    preferred: number
  ) => {
    const now = Date.now();
    const available: Array<{ state: FreeEndpointState; index: number }> = [];
    for (let offset = 0; offset < pool.length; offset++) {
      const index = (preferred + offset) % pool.length;
      if (pool[index]!.retryAt <= now)
        available.push({ state: pool[index]!, index });
    }
    return available;
  };
  const boundedDispatch = async (
    upstream: URL,
    body: Buffer,
    timeoutMs: number,
    workload: "source" | DelegatedRpcComputeWorkload
  ) => {
    const start = () => {
      activeUpstreamRequests++;
      maximumObservedUpstreamRequests = Math.max(
        maximumObservedUpstreamRequests,
        activeUpstreamRequests
      );
    };
    if (activeUpstreamRequests < maximumConcurrentUpstreamRequests) start();
    else {
      if (
        workload === "source" ||
        priorityQueue.order_projection.length +
          priorityQueue.sale.length +
          priorityQueue.foreground.length >=
          priorityQueueLimit
      ) {
        traffic.overloadedBatches++;
        throw new RpcProxyBusyError();
      }
      traffic.queuedPriorityBatches++;
      await new Promise<void>((resolve, reject) => {
        const queue = priorityQueue[workload];
        const waiter: PriorityWaiter = {
          resolve,
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
          priorityQueue.order_projection.length +
            priorityQueue.sale.length +
            priorityQueue.foreground.length
        );
      });
      start();
    }
    try {
      return await dispatchRpc(dispatch, upstream, body, timeoutMs);
    } finally {
      activeUpstreamRequests--;
      const waiter =
        priorityQueue.foreground.shift() ??
        priorityQueue.sale.shift() ??
        priorityQueue.order_projection.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve();
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
    await new Promise<void>((resolve, reject) => {
      const waiter: PriorityWaiter = {
        resolve,
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
  const waitForRateLimitRecovery = async (pool: FreeEndpointState[]) => {
    const now = Date.now();
    const delay = Math.max(
      0,
      Math.min(...pool.map((item) => item.retryAt)) - now
    );
    if (delay > freeRateLimitCooldownMs + 50) return false;
    if (delay) {
      traffic.freeRateLimitWaitMs += delay;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return true;
  };
  const paceFreeDispatch = async (
    endpoint: FreeEndpointState,
    workload: "source" | DelegatedRpcComputeWorkload
  ) => {
    const minimumIntervalMs =
      workload === "source"
        ? freeSourceMinimumIntervalMs
        : workload === "order_projection" || workload === "foreground"
          ? freeOrderMinimumIntervalMs
          : freeMinimumIntervalMs;
    if (!minimumIntervalMs) return;
    const now = Date.now();
    const scheduledAt = Math.max(now, endpoint.nextDispatchAt);
    const delay = scheduledAt - now;
    // A fresh trade cannot accumulate seconds of background pacing at every
    // validation step. Prefer a ready free endpoint, then the configured,
    // budget-enforced foreground fallback instead of aging its observation.
    if (
      workload === "foreground" &&
      (foregroundPaidFallbackOnFreeFailure || paidFallbackOnFreeFailure) &&
      delay > 250
    )
      throw new RpcProxyBusyError();
    if (workload === "source" && delay > sourcePacingQueueWaitMs) {
      traffic.sourcePacingTimeouts++;
      traffic.overloadedBatches++;
      throw new RpcProxyBusyError();
    }
    endpoint.nextDispatchAt = scheduledAt + minimumIntervalMs;
    if (delay) {
      traffic.freePacingWaitMs += delay;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };
  return createServer(async (request, output) => {
    let requestWorkload: "source" | DelegatedRpcComputeWorkload = "source";
    try {
      if (request.method === "GET" && request.url === "/health") {
        response(output, 200, { status: "ready" });
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
          freeOrderMinimumIntervalMs,
          freeMinimumIntervalMs,
          sourcePacingQueueWaitMs,
          maximumConcurrentUpstreamRequests,
          maximumConcurrentOrderFreeRoutes,
          activeUpstreamRequests,
          activeOrderFreeRoutes,
          maximumObservedUpstreamRequests,
          queuedPriorityRequests:
            priorityQueue.order_projection.length +
            priorityQueue.sale.length +
            priorityQueue.foreground.length,
          queuedOrderRouteRequests: orderFreeRouteQueue.length,
          maximumQueuedPriorityRequests,
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
          budget: options.budget.snapshot(),
          workloadBudgets: {
            source: options.budget.snapshot(),
            ...Object.fromEntries(
              Object.entries(options.workloadBudgets ?? {}).map(
                ([workload, budget]) => [workload, budget.snapshot()]
              )
            )
          }
        });
        return;
      }
      if (
        request.method !== "POST" ||
        request.url !== "/" ||
        !/^application\/json(?:\s*;|$)/i.test(
          String(request.headers["content-type"] ?? "")
        )
      ) {
        response(output, 404, { error: "not_found" });
        return;
      }
      const rawWorkload = request.headers[rpcBudgetWorkloadHeader];
      let workload: "source" | DelegatedRpcComputeWorkload = "source";
      let budget = options.budget;
      if (rawWorkload !== undefined) {
        if (
          !isDelegatedRpcComputeWorkload(rawWorkload) ||
          !options.workloadBudgets?.[rawWorkload]
        ) {
          response(output, 400, { error: "invalid_rpc_workload" });
          return;
        }
        workload = rawWorkload;
        budget = options.workloadBudgets[rawWorkload];
      }
      requestWorkload = workload;
      const paidFallbackAllowed =
        paidFallbackOnFreeFailure ||
        (workload === "foreground" && foregroundPaidFallbackOnFreeFailure) ||
        (workload === "order_projection" && orderPaidFallbackOnFreeFailure) ||
        (workload === "source" && sourcePaidFallbackOnFreeFailure) ||
        (workload === "sale" && salePaidFallbackOnFreeFailure);
      const body = await bodyOf(request);
      const calls = parseRequests(body);
      let result: DispatchedResponse | undefined;
      let rejectedFreeResponse: DispatchedResponse | undefined;
      const logsOnly = calls.every((call) => call.method === "eth_getLogs");
      const orderRoute =
        workload === "order_projection" || workload === "foreground";
      const saleRoute = workload === "sale";
      const freePool = orderRoute
        ? orderPool
        : saleRoute
          ? salePool
          : logsOnly
            ? logPool
            : primaryPool;
      if (
        freePool.length &&
        calls.every((call) => isFreeRpcCall(call, observedHead, recentBlocks))
      ) {
        let releaseOrderRoute: (() => void) | undefined;
        try {
          releaseOrderRoute = orderRoute
            ? await acquireOrderFreeRoute()
            : undefined;
          // The policy gate runs before public-provider work and never consumes
          // the monetary Alchemy allowance.
          await budget.authorizeFreeDispatch();
          const maximumSweeps = orderRoute ? 2 : 1;
          for (let sweep = 0; sweep < maximumSweeps && !result; sweep++) {
            const preferred = orderRoute
              ? preferredOrder
              : saleRoute
                ? preferredSale
                : logsOnly
                  ? preferredLogs
                  : preferredSourcePrimary;
            let available = availableFreeEndpoints(freePool, preferred);
            if (workload === "foreground")
              available.sort(
                (left, right) =>
                  left.state.nextDispatchAt - right.state.nextDispatchAt
              );
            if (!available.length) {
              if (
                sweep + 1 < maximumSweeps &&
                (await waitForRateLimitRecovery(freePool))
              ) {
                traffic.freeRateLimitRetries++;
                continue;
              }
              traffic.freeCircuitOpenBatches++;
              break;
            }
            if (!logsOnly && workload === "source")
              preferredSourcePrimary =
                (available[0]!.index + 1) % freePool.length;
            let rateLimited = false;
            // The operator kill switch remains fail-closed, but public-provider
            // requests do not consume the monetary Alchemy CU allowance.
            for (const selected of available) {
              try {
                await paceFreeDispatch(selected.state, workload);
                if (selected.state.retryAt > Date.now()) continue;
                const free = await boundedDispatch(
                  selected.state.url,
                  body,
                  orderRoute ? freeOrderTimeoutMs : freeTimeoutMs,
                  workload
                );
                if (usableFreeResponse(free, calls)) {
                  result = free;
                  selected.state.retryAt = 0;
                  selected.state.consecutiveFailures = 0;
                  selected.state.successes++;
                  if (orderRoute) preferredOrder = selected.index;
                  else if (saleRoute)
                    preferredSale = (selected.index + 1) % freePool.length;
                  else if (logsOnly)
                    preferredLogs = (selected.index + 1) % freePool.length;
                  traffic.freeBatches++;
                  traffic.freeCalls += calls.length;
                  traffic.workloads[workload].freeCalls += calls.length;
                  increment(traffic.methods.free, calls);
                  break;
                }
                traffic.freeFailures++;
                rejectedFreeResponse ??= free;
                selected.state.failures++;
                const disposition = freeFailureDisposition(free);
                if (disposition === "transient")
                  selected.state.consecutiveFailures++;
                else selected.state.consecutiveFailures = 0;
                // A bounded caller can adapt to an oversized log range. Other
                // request-specific errors must not open the endpoint circuit.
                if (disposition === "adaptive") break;
                if (disposition === "rate_limit") {
                  rateLimited = true;
                  selected.state.retryAt = Date.now() + freeRateLimitCooldownMs;
                } else if (
                  disposition === "cooldown" ||
                  selected.state.consecutiveFailures >= 3
                )
                  selected.state.retryAt = Date.now() + freeFailureCooldownMs;
              } catch (error) {
                if (error instanceof RpcProxyBusyError) throw error;
                traffic.freeFailures++;
                selected.state.failures++;
                selected.state.consecutiveFailures++;
                if (selected.state.consecutiveFailures >= 3)
                  selected.state.retryAt = Date.now() + freeFailureCooldownMs;
              }
              if (orderRoute)
                preferredOrder = (selected.index + 1) % freePool.length;
              else if (saleRoute)
                preferredSale = (selected.index + 1) % freePool.length;
              else if (logsOnly)
                preferredLogs = (selected.index + 1) % freePool.length;
            }
            if (
              !result &&
              rateLimited &&
              sweep + 1 < maximumSweeps &&
              (await waitForRateLimitRecovery(freePool))
            ) {
              traffic.freeRateLimitRetries++;
              continue;
            }
            break;
          }
        } catch (error) {
          // A saturated free-route queue is an infrastructure failure too.
          // Interactive trades may use their already configured paid fallback;
          // background jobs keep their existing backpressure and cannot spend
          // the foreground allowance. reserve() below still enforces every CU.
          if (
            !(error instanceof RpcProxyBusyError) ||
            workload !== "foreground" ||
            !paidFallbackAllowed
          )
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
        for (const call of calls) await budget.reserve(call.method);
        result = await boundedDispatch(options.upstream, body, 30000, workload);
        traffic.paidBatches++;
        traffic.paidCalls += calls.length;
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
      if (error instanceof RpcProxyBusyError) {
        if (requestWorkload === "source") {
          output.setHeader("retry-after", "1");
          response(output, 429, { error: "rpc_proxy_rate_limited" });
        } else response(output, 503, { error: "rpc_proxy_busy" });
      } else if (budget) {
        output.setHeader(
          "retry-after",
          String(Math.max(1, Math.ceil(budget.retryAfterMs / 1000)))
        );
        response(output, 429, { error: "rpc_budget_exhausted" });
      } else response(output, 502, { error: "rpc_proxy_failed" });
    }
  });
}

async function main() {
  const environment = readRpcBudgetProxyEnvironment();
  const coordinator = createOpenSeaRequestBudget();
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
    maximumConcurrentUpstreamRequests:
      environment.maximumConcurrentUpstreamRequests,
    paidFallbackOnFreeFailure: environment.paidFallbackOnFreeFailure,
    foregroundPaidFallbackOnFreeFailure:
      environment.foregroundPaidFallbackOnFreeFailure,
    orderPaidFallbackOnFreeFailure: environment.orderPaidFallbackOnFreeFailure,
    sourcePaidFallbackOnFreeFailure:
      environment.sourcePaidFallbackOnFreeFailure,
    salePaidFallbackOnFreeFailure: environment.salePaidFallbackOnFreeFailure,
    budget: coordinator.rpcBudget("source", "background"),
    workloadBudgets: {
      order_projection: coordinator.rpcBudget("order_projection", "background"),
      sale: coordinator.rpcBudget("sale", "background"),
      foreground: coordinator.rpcBudget("foreground", "foreground")
    }
  });
  proxy.requestTimeout = 35000;
  proxy.headersTimeout = 10000;
  proxy.maxRequestsPerSocket = 1000;
  const stop = () => proxy.close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(environment.port, environment.host, resolve);
    });
    console.log(
      JSON.stringify({
        service: "yunipals-rpc-budget-proxy",
        status: "started"
      })
    );
    await new Promise<void>((resolve) => proxy.once("close", resolve));
  } finally {
    await coordinator.close();
  }
}

export function isRpcBudgetProxyMain(
  argv = process.argv[1],
  modulePath = fileURLToPath(import.meta.url)
) {
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

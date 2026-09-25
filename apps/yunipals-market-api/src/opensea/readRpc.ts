import {
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  http,
  type Transport
} from "viem";
import {
  alchemyComputeUnits,
  type RpcComputeBudget
} from "@/opensea/rpcComputeBudget";
import {
  isDelegatedRpcComputeWorkload,
  isRpcBudgetProxyUrl,
  rpcBudgetWorkloadHeader
} from "@/rpcBudgetProxyRegistry";

const methods = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getLogs",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_getStorageAt"
]);

type MethodStats = {
  requests: number;
  computeUnits: number;
  failed: number;
  totalMs: number;
  maxMs: number;
  failures: Partial<Record<FailureKind, number>>;
};

type FailureKind =
  | "response_limit"
  | "timeout"
  | "http_rate_limit"
  | "http_auth"
  | "http_client"
  | "http_server"
  | "http_other"
  | "network"
  | "rpc_noncanonical_block"
  | "rpc_missing_block"
  | "rpc_missing_state"
  | "rpc_execution_reverted"
  | "rpc_rate_limit"
  | "rpc_invalid_request"
  | "rpc_method_unavailable"
  | "rpc_invalid_params"
  | "rpc_server"
  | "rpc_other"
  | "unknown";

type EndpointStats = {
  requests: number;
  failed: number;
};

export class RpcResponseLimitError extends Error {
  constructor() {
    super("RPC response exceeds the bounded read capacity.");
  }
}

export function isRpcResponseLimitError(error: unknown) {
  const seen = new Set<object>();
  for (
    let cause = error;
    cause && typeof cause === "object" && seen.size < 8;

  ) {
    if (cause instanceof RpcResponseLimitError) return true;
    if (cause instanceof HttpRequestError && cause.status === 413) return true;
    if (
      cause instanceof RpcRequestError &&
      /query returned more than|too many (?:results|logs)|response (?:size|limit)|limit exceeded|block range|range too large/i.test(
        (cause.details ?? "").slice(0, 4096)
      )
    )
      return true;
    if (seen.has(cause)) break;
    seen.add(cause);
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return false;
}

// Read the body inside viem's fetch deadline. Its default fetch timeout ends at
// response headers, before response.json(), and does not bound body size.
async function boundedFetch(input: string | URL | Request, init?: RequestInit) {
  const response = await fetch(input, { ...init, redirect: "error" });
  if (!response.body) return response;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new RpcResponseLimitError();
    chunks.push(chunk);
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// Fixed diagnostic buckets only. Provider text is used transiently to recognize
// common ambiguous RPC failures; it never becomes a metric label or log field.
// Classification permits one provider failover for infrastructure failures;
// deterministic request and execution failures never reach another endpoint.
function failureKind(error: unknown): FailureKind {
  if (isRpcResponseLimitError(error)) return "response_limit";
  const causes: object[] = [];
  for (
    let cause = error;
    cause && typeof cause === "object" && causes.length < 8;
    cause = "cause" in cause ? cause.cause : undefined
  ) {
    if (causes.includes(cause)) break;
    causes.push(cause);
  }
  if (causes.some((cause) => cause instanceof TimeoutError)) return "timeout";
  const response = causes.find((cause) => cause instanceof HttpRequestError);
  if (response) {
    const status = response.status;
    if (status === undefined) return "network";
    if (status === 429) return "http_rate_limit";
    if (status === 401 || status === 403) return "http_auth";
    if (status >= 400 && status < 500) return "http_client";
    if (status >= 500 && status < 600) return "http_server";
    return "http_other";
  }
  const rpc = causes.find((cause) => cause instanceof RpcRequestError);
  if (!rpc) return "unknown";
  const hint = (rpc.details ?? "").slice(0, 4096).toLowerCase();
  if (/non.?canonical|not (?:currently |in (?:the )?)?canonical/.test(hint))
    return "rpc_noncanonical_block";
  if (/(?:header|block(?: hash)?) not found|unknown block/.test(hint))
    return "rpc_missing_block";
  if (
    /missing trie node|historical state.*unavailable|state.*pruned/.test(hint)
  )
    return "rpc_missing_state";
  if (/execution reverted|vm execution error/.test(hint))
    return "rpc_execution_reverted";
  if (rpc.code === -32005 || /rate limit|too many requests/.test(hint))
    return "rpc_rate_limit";
  if (rpc.code === -32700 || rpc.code === -32600) return "rpc_invalid_request";
  if ([-32601, -32004, -32042].includes(rpc.code))
    return "rpc_method_unavailable";
  if (rpc.code === -32602) return "rpc_invalid_params";
  if (rpc.code === -32603 || (rpc.code <= -32000 && rpc.code >= -32099))
    return "rpc_server";
  return "rpc_other";
}

function canFailOver(kind: FailureKind) {
  return ![
    "rpc_execution_reverted",
    "rpc_invalid_request",
    "rpc_invalid_params",
    "rpc_other",
    "http_client"
  ].includes(kind);
}

// Count actual transport invocations, including failures. Do not retain URLs,
// parameters, response/error bodies, wallet addresses or transaction calldata.
export function createMeasuredOpenSeaReadRpc(
  input: string | readonly [string, ...string[]],
  timeout = 6000,
  primaryProbeCooldownMs = 30000,
  budget?: RpcComputeBudget
) {
  const urls = typeof input === "string" ? [input] : [...input];
  const budgetDelegated = urls.length === 1 && isRpcBudgetProxyUrl(urls[0]!);
  const delegatedWorkload = budgetDelegated
    ? budget?.snapshot().workload
    : undefined;
  if (
    urls.length < 1 ||
    urls.length > 2 ||
    !Number.isSafeInteger(primaryProbeCooldownMs) ||
    primaryProbeCooldownMs < 1000 ||
    primaryProbeCooldownMs > 300000
  )
    throw new Error("Invalid RPC failover configuration.");
  if (
    budgetDelegated &&
    delegatedWorkload !== "source" &&
    !isDelegatedRpcComputeWorkload(delegatedWorkload)
  )
    throw new Error("Invalid delegated RPC compute workload.");
  const inners = urls.map((url) =>
    http(url, {
      timeout,
      retryCount: 0,
      batch: budgetDelegated ? { batchSize: 2, wait: 10 } : false,
      // The proxy's unlabelled route owns the existing source budget and
      // log-capable provider pool. Only explicit worker lanes send a header.
      fetchOptions: delegatedWorkload && delegatedWorkload !== "source"
        ? { headers: { [rpcBudgetWorkloadHeader]: delegatedWorkload } }
        : undefined,
      fetchFn: boundedFetch
    })
  );
  const started = performance.now();
  const stats: Record<string, MethodStats> = {};
  const endpoints: EndpointStats[] = inners.map(() => ({
    requests: 0,
    failed: 0
  }));
  let inFlight = 0;
  let maxInFlight = 0;
  let preferred = 0;
  let primaryProbeAfter = 0;
  let failoverAttempts = 0;
  let failoverSuccesses = 0;
  const transport: Transport = (config) => {
    const underlying = inners.map((inner) => inner(config));
    const primary = underlying[0]!;
    const request = (async (
      args: Parameters<typeof primary.request>[0],
      options: Parameters<typeof primary.request>[1]
    ) => {
      const key = methods.has(args.method) ? args.method : "other";
      const method = (stats[key] ??= {
        requests: 0,
        computeUnits: 0,
        failed: 0,
        totalMs: 0,
        maxMs: 0,
        failures: {}
      });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const order =
          urls.length === 1
            ? [0]
            : preferred === 1 && Date.now() < primaryProbeAfter
              ? [1, 0]
              : [0, 1];
        let previous: unknown;
        for (const [position, endpoint] of order.entries()) {
          if (!budgetDelegated) await budget?.reserve(args.method);
          method.requests++;
          if (!budgetDelegated)
            method.computeUnits += alchemyComputeUnits(args.method);
          endpoints[endpoint]!.requests++;
          const attemptStarted = performance.now();
          try {
            const value = await underlying[endpoint]!.request(args, options);
            if (position > 0) failoverSuccesses++;
            if (endpoint === 0) {
              preferred = 0;
              primaryProbeAfter = 0;
            } else if (position > 0) {
              preferred = 1;
            }
            return value;
          } catch (error) {
            previous = error;
            method.failed++;
            endpoints[endpoint]!.failed++;
            const kind = failureKind(error);
            method.failures[kind] = (method.failures[kind] ?? 0) + 1;
            if (position === order.length - 1 || !canFailOver(kind))
              throw error;
            failoverAttempts++;
            if (endpoint === 0) {
              preferred = 1;
              primaryProbeAfter = Date.now() + primaryProbeCooldownMs;
            }
          } finally {
            const elapsed = performance.now() - attemptStarted;
            method.totalMs += elapsed;
            method.maxMs = Math.max(method.maxMs, elapsed);
          }
        }
        throw previous;
      } finally {
        inFlight--;
      }
    }) as typeof primary.request;
    return {
      ...primary,
      request
    };
  };
  return {
    transport,
    snapshot() {
      return {
        elapsedMs: Math.round(performance.now() - started),
        requests: Object.values(stats).reduce(
          (sum, method) => sum + method.requests,
          0
        ),
        failed: Object.values(stats).reduce(
          (sum, method) => sum + method.failed,
          0
        ),
        computeUnits: Object.values(stats).reduce(
          (sum, method) => sum + method.computeUnits,
          0
        ),
        inFlight,
        maxInFlight,
        budgetDelegated,
        failover: {
          configured: endpoints.length === 2,
          preferredEndpoint: preferred,
          attempts: failoverAttempts,
          successes: failoverSuccesses,
          endpoints: endpoints.map((value, index) => ({
            index,
            ...value
          }))
        },
        budget: budgetDelegated ? undefined : budget?.snapshot(),
        methods: Object.fromEntries(
          Object.entries(stats).map(([name, value]) => [
            name,
            {
              ...value,
              failures: { ...value.failures },
              totalMs: Math.round(value.totalMs),
              maxMs: Math.round(value.maxMs)
            }
          ])
        )
      };
    }
  };
}

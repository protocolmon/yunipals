import { readFileSync } from "node:fs";
import {
  http,
  ResponseBodyTooLargeError,
  RpcError,
  type HttpTransport,
  type HttpTransportConfig
} from "viem";
import {
  unifiedRpcProfileHeader,
  unifiedRpcPermitHeader,
  unifiedRpcProfileId,
  unifiedRpcManifestId,
  validateUnifiedRpcProfile,
  type UnifiedRpcWorkload
} from "../../../../packages/yunipals-indexer-server/src/rpc-policy.js";
import type { SourceManifest } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import { sourceManifestHash } from "./sources.js";

// Combined replay shares one Base source slot across every client factory.
// Other chains and evidence keep their existing transport behavior.
let baseSourceActive = false;
const baseSourceWaiting: { grant: () => void }[] = [];

function acquireBaseSourceSlot(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      const index = baseSourceWaiting.indexOf(request);
      if (index >= 0) baseSourceWaiting.splice(index, 1);
      reject(signal?.reason);
    };
    const request = { grant: () => {
      signal?.removeEventListener("abort", abort);
      baseSourceActive = true;
      resolve();
    } };
    if (baseSourceActive) {
      baseSourceWaiting.push(request);
      signal?.addEventListener("abort", abort, { once: true });
    } else request.grant();
  });
}

function releaseBaseSourceSlot() {
  baseSourceActive = false;
  if (baseSourceWaiting.length > 0) baseSourceWaiting.shift()!.grant();
}

const productionEndpoints: Record<number, string> = {
  1: "http://127.0.0.1:19201/unified",
  8453: "http://127.0.0.1:19202/unified",
  137: "http://127.0.0.1:19203/unified",
  56: "http://127.0.0.1:19204/unified"
};
export function unifiedRpcConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const required = env.UNIFIED_RPC_POLICY_REQUIRED;
  if (required !== undefined && !["true", "false"].includes(required))
    throw new Error("Invalid unified RPC policy requirement.");
  const path = env.UNIFIED_RPC_PROFILE_FILE;
  if (!path && required !== "true") return null;
  if (!path?.startsWith("/"))
    throw new Error(
      "A reviewed absolute unified RPC profile file is required."
    );
  const profile = validateUnifiedRpcProfile(
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (unifiedRpcProfileId(profile) !== env.UNIFIED_RPC_PROFILE_ID)
    throw new Error("Unified RPC profile hash differs from review.");
  const permit = env.UNIFIED_RPC_REPLAY_PERMIT_ID;
  if (permit && !/^0x[0-9a-f]{64}$/.test(permit))
    throw new Error("Invalid unified RPC permit identity.");
  return {
    profile,
    headers(workload: UnifiedRpcWorkload, chainId?: number) {
      const selectedPermit =
        (chainId
          ? env[`UNIFIED_RPC_REPLAY_PERMIT_ID_${chainId}`]
          : undefined) ?? permit;
      if (selectedPermit && !/^0x[0-9a-f]{64}$/.test(selectedPermit))
        throw new Error("Invalid unified RPC permit identity.");
      return {
        "x-yunipals-rpc-workload": workload,
        [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile),
        ...(selectedPermit ? { [unifiedRpcPermitHeader]: selectedPermit } : {})
      };
    }
  };
}

export async function preflightUnifiedRpc(
  manifest: SourceManifest,
  env: NodeJS.ProcessEnv = process.env,
  // Test dependency injection does not create a production environment bypass.
  options: {
    endpoints?: Readonly<Record<number, string>>;
    fetch?: typeof fetch;
  } = {}
) {
  const config = unifiedRpcConfiguration(env);
  if (!config) return null;
  if (unifiedRpcManifestId(config.profile) !== sourceManifestHash(manifest))
    throw new Error("Unified RPC source manifest differs from review.");
  const endpoints = options.endpoints ?? productionEndpoints;
  const request = options.fetch ?? fetch;
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const [chain, endpoint] of Object.entries(endpoints)) {
    const chainId = Number(chain);
    const url = env[`PONDER_RPC_URL_${chainId}`];
    if (!url || new URL(url).href !== new URL(endpoint).href)
      throw new Error(
        "Explicit reviewed production budget proxy URLs are required for every chain."
      );
    for (const workload of ["unified_source", "unified_evidence"] as const) {
      let reply: Record<string, unknown>;
      try {
        const result = await request(new URL("/unified/preflight", url), {
          headers: config.headers(workload, chainId),
          signal: AbortSignal.timeout(5000)
        });
        if (!result.ok) throw new Error("Unavailable RPC policy.");
        reply = (await result.json()) as Record<string, unknown>;
      } catch {
        throw new Error("Unified RPC profile/budget preflight unavailable.");
      }
      if (
        reply.profileId !== unifiedRpcProfileId(config.profile) ||
        reply.manifestHash !== sourceManifestHash(manifest) ||
        reply.chainId !== chainId ||
        reply.coordinatorId !== config.profile.coordinatorId ||
        reply.scope !== config.profile.scope ||
        reply.workload !== workload ||
        reply.paid !== "explicit_bounded_permit_only"
      )
        throw new Error("Unified RPC proxy identity differs from review.");
      if (
        !reply.budget ||
        typeof reply.budget !== "object" ||
        !reply.replay ||
        typeof reply.replay !== "object"
      )
        throw new Error("Unified RPC budget/permit evidence is missing.");
      diagnostics.push({
        chainId,
        workload,
        budget: reply.budget,
        replay: reply.replay
      });
    }
    try {
      const response = await request(url, {
        method: "POST",
        headers: {
          ...config.headers("unified_evidence", chainId),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: []
        }),
        signal: AbortSignal.timeout(5000)
      });
      const body = (await response.json()) as {
        result?: string;
        error?: unknown;
      };
      if (
        !response.ok ||
        body.error ||
        body.result !== `0x${chainId.toString(16)}`
      )
        throw new Error("Wrong chain.");
    } catch {
      throw new Error("Unified RPC upstream chain check failed.");
    }
  }
  return { ...config, diagnostics };
}

export function unifiedRpcTransport(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env
) {
  const config = unifiedRpcConfiguration(env);
  const url = env[`PONDER_RPC_URL_${chainId}`];
  if (!config) return url;
  if (!url) throw new Error("Explicit unified RPC URL required.");
  return unifiedRpcHttpTransport(url, chainId, "unified_source", env);
}

export function unifiedRpcHttpTransport(
  url: string,
  chainId: number,
  workload: UnifiedRpcWorkload,
  env: NodeJS.ProcessEnv = process.env,
  options: Pick<HttpTransportConfig, "timeout" | "retryCount" | "fetchFn"> = {}
): HttpTransport {
  const config = unifiedRpcConfiguration(env);
  if (!config) return http(url, options);
  const transport = http(url, {
    ...options,
    batch: {
      batchSize: Math.min(10, config.profile.limits.batchCalls),
      wait: 10
    },
    fetchOptions: { headers: config.headers(workload, chainId) }
  });
  // Public log providers can limit batches independently from ordinary block
  // methods. Keep source log requests as individual RPC objects; evidence and
  // source block methods retain the existing bounded batch scheduler.
  const logTransport =
    workload === "unified_source"
      ? http(url, {
          ...options,
          batch: false,
          fetchOptions: { headers: config.headers(workload, chainId) }
        })
      : undefined;
  const blockTransports =
    workload === "unified_source"
      ? [5, 2].map((batchSize) =>
          http(url, {
            ...options,
            batch: {
              batchSize: Math.min(batchSize, config.profile.limits.batchCalls),
              wait: 10
            },
            fetchOptions: { headers: config.headers(workload, chainId) }
          })
        )
      : [];
  // Viem shares its batch scheduler by URL and request signal. Separate every
  // workload and full-block tier so concurrent fallbacks cannot recombine.
  const isolatedSignals = Array.from(
    { length: 4 },
    () => new AbortController().signal
  );
  const requestSignals = new WeakMap<AbortSignal, AbortSignal[]>();
  return (parameters) => {
    const initialized = transport(parameters);
    const initializedLogs = logTransport?.(parameters);
    const initializedBlocks = [
      initialized,
      ...blockTransports.map((selected) => selected(parameters)),
      initializedLogs
    ];
    let blockTier = 0;
    const request = async (
      args: Parameters<typeof initialized.request>[0],
      requestOptions?: Parameters<typeof initialized.request>[1]
    ): Promise<unknown> => {
      let signals = isolatedSignals;
      if (requestOptions?.signal) {
        const input = requestOptions.signal;
        const retained = requestSignals.get(input);
        signals =
          retained ??
          isolatedSignals.map((signal) => AbortSignal.any([signal, input]));
        if (!retained) requestSignals.set(input, signals);
      }
      const fullBlock =
        workload === "unified_source" &&
        args.method === "eth_getBlockByNumber" &&
        Array.isArray(args.params) &&
        args.params.length === 2 &&
        typeof args.params[0] === "string" &&
        /^0x[0-9a-fA-F]+$/.test(args.params[0]) &&
        args.params[1] === true;
      if (fullBlock && initializedLogs) {
        let tier = blockTier;
        for (;;) {
          try {
            return await initializedBlocks[tier]!.request(args, {
              ...requestOptions,
              signal: signals[tier]
            });
          } catch (error) {
            if (!(error instanceof ResponseBodyTooLargeError) || tier === 3)
              throw error;
            // Advance from the failed tier, not the number of concurrent
            // failures. At most three fallbacks; an oversized singleton fails.
            blockTier = Math.max(blockTier, tier + 1);
            tier = blockTier;
          }
        }
      }
      const signal = signals[0];
      try {
        const selected =
          args.method === "eth_getLogs" && initializedLogs
            ? initializedLogs
            : initialized;
        return await selected.request(args, { ...requestOptions, signal });
      } catch (error) {
        if (
          error instanceof ResponseBodyTooLargeError &&
          workload === "unified_source" &&
          args.method === "eth_getLogs"
        ) {
          const filter: unknown = Array.isArray(args.params)
            ? args.params[0]
            : undefined;
          if (
            Array.isArray(args.params) &&
            args.params.length === 1 &&
            filter &&
            typeof filter === "object" &&
            "fromBlock" in filter &&
            "toBlock" in filter &&
            typeof filter.fromBlock === "string" &&
            typeof filter.toBlock === "string" &&
            /^0x[0-9a-fA-F]+$/.test(filter.fromBlock) &&
            /^0x[0-9a-fA-F]+$/.test(filter.toBlock)
          ) {
            const blocks =
              BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n;
            if (blocks === 2n) {
              // Ponder 0.17 derives a zero chunk size from a one-block hint.
              // Resolve this last split here, retaining both complete replies.
              const first = await request(
                {
                  ...args,
                  params: [{ ...filter, toBlock: filter.fromBlock }]
                },
                requestOptions
              );
              const second = await request(
                {
                  ...args,
                  params: [{ ...filter, fromBlock: filter.toBlock }]
                },
                requestOptions
              );
              if (!Array.isArray(first) || !Array.isArray(second))
                throw new Error("Invalid split eth_getLogs response.");
              return [...first, ...second];
            }
            if (blocks > 2n) {
              // This typed failure describes response density, not a provider
              // block-span limit. Ponder halves the interval and can regrow its
              // estimate after successful sparse ranges. Keep the byte cap.
              throw new RpcError(error, {
                code: -32005,
                name: "UnifiedRpcLogResponseTooLargeError",
                shortMessage: "backend response too large: source log response exceeded the client byte limit"
              });
            }
          }
        }
        throw error;
      }
    };
    const boundedRequest = async (
      args: Parameters<typeof initialized.request>[0],
      requestOptions?: Parameters<typeof initialized.request>[1]
    ): Promise<unknown> => {
      if (chainId !== 8453 || workload !== "unified_source") {
        return request(args, requestOptions);
      }
      await acquireBaseSourceSlot(requestOptions?.signal);
      try {
        requestOptions?.signal?.throwIfAborted();
        return await request(args, requestOptions);
      } finally {
        releaseBaseSourceSlot();
      }
    };
    // The wire-level wrapper preserves the generic RPC method/result mapping.
    return { ...initialized, request: boundedRequest as typeof initialized.request };
  };
}

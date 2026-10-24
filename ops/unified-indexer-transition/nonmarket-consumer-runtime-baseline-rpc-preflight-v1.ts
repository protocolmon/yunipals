import { readFileSync } from "node:fs";
import { http, type HttpTransport, type HttpTransportConfig } from "viem";
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
  // Viem shares its batch scheduler by URL and request signal. Distinct
  // transports can have different workload/permit headers at the same URL.
  const isolatedSignal = new AbortController().signal;
  const requestSignals = new WeakMap<AbortSignal, AbortSignal>();
  return (parameters) => {
    const initialized = transport(parameters);
    return {
      ...initialized,
      request: (args, requestOptions) => {
        let signal = isolatedSignal;
        if (requestOptions?.signal) {
          const input = requestOptions.signal;
          const retained = requestSignals.get(input);
          signal = retained ?? AbortSignal.any([isolatedSignal, input]);
          if (!retained) requestSignals.set(input, signal);
        }
        return initialized.request(args, { ...requestOptions, signal });
      }
    };
  };
}

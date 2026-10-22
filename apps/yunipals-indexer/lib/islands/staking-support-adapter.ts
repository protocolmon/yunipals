import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { islandCollection } from "../constants.js";
import { islandStakingAddress } from "./staking-read.js";
import type { NativeStakingChainReader } from "./staking-verifier.js";

// Exact view ABI from the accepted public production-reference staking.ts,
// SHA256 46af1ac7cf401d42a276f2590bf18abfb2191b56cf52d9798df33c16724ef8bb.
// The transaction function from that reference is deliberately not included.
export const stakingSupportAbi = parseAbi([
  "function islandContract() view returns (address)",
  "function paused() view returns (bool)",
  "function stakedIslandsOf(address wallet) view returns (uint256[])"
]);
const custodyAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)"
]);
const rootEndpoint = "http://127.0.0.1:19201/";
const hashPattern = /^0x[0-9a-f]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
type ObjectValue = Record<string, unknown>;
type Anchor = { number: bigint; hash: string; timestamp: bigint };
export type StakingSupportLimits = {
  maxRpcCalls: number;
  maxSeconds: number;
  maxResponseBytes: number;
  maxTokens: number;
};
export type StakingSupportAdapter = {
  chain: NativeStakingChainReader;
  assertFreeProof(): Promise<void>;
  statistics(): { rpcCalls: number; metricReads: number; elapsedMs: number; freeOnly: true };
};

const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("staking_proxy_shape_invalid");
  return value as ObjectValue;
};
const counter = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("staking_proxy_counter_invalid");
  return value as number;
};

export function createStakingSupportAdapter(
  limits: StakingSupportLimits,
  options: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}
): StakingSupportAdapter {
  for (const [name, min, max] of [["maxRpcCalls", 6, 2048], ["maxSeconds", 1, 180], ["maxResponseBytes", 1024, 1048576], ["maxTokens", 1, 500]] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < min || limits[name] > max) throw new Error("staking_adapter_limit_invalid");
  }
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  let rpcCalls = 0, metricReads = 0, stopped = false;
  let baseline: { configuration: string; sourcePaid: number } | undefined;
  let anchor: Anchor | undefined;
  const check = () => {
    if (stopped || options.signal?.aborted || now() - started >= limits.maxSeconds * 1000) throw new Error("staking_adapter_stopped");
  };
  const fail = (code: string): never => { stopped = true; throw new Error(code); };
  const json = async (url: string, body?: unknown): Promise<unknown> => {
    check();
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(10000, limits.maxSeconds * 1000 - (now() - started))));
    try {
      const response = await request(url, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        // Root with no workload/profile/permit header retains the existing
        // source/background budget and its disabled paid fallback.
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok || response.redirected || !response.body) return fail("staking_proxy_unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > limits.maxResponseBytes) return fail("staking_proxy_response_limit");
          chunks.push(part.value);
          check();
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return fail("staking_proxy_request_failed");
    }
  };
  const assertFreeProof = async () => {
    metricReads++;
    const metrics = object(await json(rootEndpoint + "metrics"));
    const budget = object(metrics.budget);
    if (metrics.status !== "ready" || metrics.freeRouting !== true || metrics.paidFallbackOnFreeFailure !== false ||
        metrics.sourcePaidFallbackOnFreeFailure !== false || budget.workload !== "source" || budget.priority !== "background" ||
        budget.model !== "alchemy-2026-09-08") return fail("staking_free_source_policy_unavailable");
    for (const key of ["freeRequestTimeoutMs", "freeMinimumIntervalMs", "freeSourceMinimumIntervalMs", "maximumConcurrentUpstreamRequests"]) {
      if (!Number.isSafeInteger(metrics[key]) || Number(metrics[key]) < 0) return fail("staking_free_configuration_incomplete");
    }
    const traffic = object(object(metrics.traffic).workloads);
    const sourcePaid = counter(object(traffic.source).paidCalls);
    const configuration = JSON.stringify([metrics.freeRouting, metrics.paidFallbackOnFreeFailure, metrics.sourcePaidFallbackOnFreeFailure,
      metrics.freeRequestTimeoutMs, metrics.freeMinimumIntervalMs, metrics.freeSourceMinimumIntervalMs, metrics.maximumConcurrentUpstreamRequests,
      budget.model, budget.workload, budget.priority]);
    if (!baseline) baseline = { configuration, sourcePaid };
    else if (baseline.configuration !== configuration || baseline.sourcePaid !== sourcePaid) return fail("staking_free_source_proof_changed");
  };
  const rpc = async (method: "eth_chainId" | "eth_getBlockByNumber" | "eth_call", params: unknown[]) => {
    await assertFreeProof();
    check();
    if (rpcCalls >= limits.maxRpcCalls) return fail("staking_rpc_call_limit");
    const id = ++rpcCalls;
    const result = object(await json(rootEndpoint, { jsonrpc: "2.0", id, method, params }));
    if (result.id !== id || result.error || !("result" in result)) return fail("staking_rpc_result_invalid");
    return result.result;
  };
  const header = async (tag: "latest" | "finalized" | Hex): Promise<Anchor> => {
    const row = object(await rpc("eth_getBlockByNumber", [tag, false]));
    if (typeof row.number !== "string" || !quantityPattern.test(row.number) || typeof row.timestamp !== "string" ||
        !quantityPattern.test(row.timestamp) || typeof row.hash !== "string" || !hashPattern.test(row.hash) || /^0x0{64}$/.test(row.hash)) return fail("staking_header_invalid");
    return { number: BigInt(row.number), hash: row.hash, timestamp: BigInt(row.timestamp) };
  };
  const pinned = (block: bigint) => {
    if (!anchor || block !== anchor.number) return fail("staking_unpinned_call");
    return { blockHash: anchor.hash, requireCanonical: true };
  };
  const call = async (address: string, data: Hex, block: bigint) => {
    const reference = pinned(block);
    const result = await rpc("eth_call", [{ to: address, data }, reference]);
    if (typeof result !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(result)) return fail("staking_call_result_invalid");
    return result as Hex;
  };
  return {
    chain: {
      contractAddress: islandStakingAddress,
      finalizedBlock: async () => {
        if (anchor) return fail("staking_anchor_already_selected");
        if (await rpc("eth_chainId", []) !== "0x1") return fail("staking_rpc_chain_mismatch");
        const finalized = await header("finalized");
        const head = await header("latest");
        const current = BigInt(now());
        if (head.number < finalized.number || head.number - finalized.number > 256n ||
            head.timestamp < finalized.timestamp || current - head.timestamp * 1000n > 180000n ||
            head.timestamp * 1000n > current + 30000n || current - finalized.timestamp * 1000n > 1800000n ||
            finalized.number < BigInt(islandCollection.deploymentBlock) ||
            (head.number === finalized.number && head.hash !== finalized.hash)) return fail("staking_finality_stale_or_inconsistent");
        anchor = finalized;
        return { number: anchor.number, hash: anchor.hash };
      },
      blockHash: async (block) => {
        pinned(block);
        const value = await header(`0x${block.toString(16)}`);
        if (value.number !== block || value.hash !== anchor!.hash) return fail("staking_canonical_anchor_changed");
        await assertFreeProof();
        return value.hash;
      },
      islandContract: async (block) => decodeFunctionResult({ abi: stakingSupportAbi, functionName: "islandContract",
        data: await call(islandStakingAddress, encodeFunctionData({ abi: stakingSupportAbi, functionName: "islandContract" }), block) }),
      custodyBalance: async (block) => decodeFunctionResult({ abi: custodyAbi, functionName: "balanceOf",
        data: await call(islandCollection.address, encodeFunctionData({ abi: custodyAbi, functionName: "balanceOf", args: [islandStakingAddress] }), block) }),
      owners: async (ids, block) => {
        if (ids.length < 1 || ids.length > 40 || ids.some((id) => id < 0n)) return fail("staking_owner_batch_invalid");
        const owners: string[] = [];
        // Bound actual RPCs per token rather than counting one multicall as one.
        for (const id of ids) owners.push(decodeFunctionResult({ abi: custodyAbi, functionName: "ownerOf",
          data: await call(islandCollection.address, encodeFunctionData({ abi: custodyAbi, functionName: "ownerOf", args: [id] }), block) }));
        return owners;
      },
      stakedIslands: async (wallet, block) => {
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) return fail("staking_wallet_invalid");
        const ids = decodeFunctionResult({ abi: stakingSupportAbi, functionName: "stakedIslandsOf",
          data: await call(islandStakingAddress, encodeFunctionData({ abi: stakingSupportAbi, functionName: "stakedIslandsOf", args: [wallet] }), block) });
        if (ids.length > limits.maxTokens) return fail("staking_membership_limit");
        return ids;
      }
    },
    assertFreeProof,
    statistics: () => ({ rpcCalls, metricReads, elapsedMs: now() - started, freeOnly: true })
  };
}

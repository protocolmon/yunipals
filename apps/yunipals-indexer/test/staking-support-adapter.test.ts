import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { createStakingSupportAdapter, stakingSupportAbi } from "../lib/islands/staking-support-adapter.js";
import { islandCollection } from "../lib/constants.js";
import { islandStakingAddress } from "../lib/islands/staking-read.js";

const hash = `0x${"11".repeat(32)}`;
const wallet = `0x${"22".repeat(20)}` as const;
const now = 1800000000000;
const block = 20000000n;
const custodyAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function balanceOf(address) view returns(uint256)"]);
const limits = { maxTokens: 50, maxRpcCalls: 128, maxSeconds: 120, maxResponseBytes: 1048576 };
const aggregateResult = (results: readonly { success: boolean; returnData: Hex }[]) =>
  encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
const metrics = () => ({ status: "ready", freeRouting: true, paidFallbackOnFreeFailure: false, sourcePaidFallbackOnFreeFailure: false,
  foregroundPaidFallbackOnFreeFailure: true, orderPaidFallbackOnFreeFailure: true,
  freeRequestTimeoutMs: 3000, freeMinimumIntervalMs: 1000, freeSourceMinimumIntervalMs: 400, maximumConcurrentUpstreamRequests: 8,
  budget: { workload: "source", priority: "background", model: "alchemy-2026-09-08" },
  traffic: { workloads: { source: { paidCalls: 0 } } } });

function fixture(options: { metrics?: () => unknown; result?: (body: Record<string, unknown>, sequence: number) => unknown; clock?: () => number;
  rejectCall?: boolean; limits?: Partial<typeof limits> } = {}) {
  const sent: Array<{ url: string; body: { method: string; params: unknown[] }; headers: Headers }> = [];
  const mock = (async (input, init) => {
    if (String(input).endsWith("/metrics")) return Response.json(options.metrics?.() ?? metrics());
    const body = JSON.parse(String(init?.body));
    sent.push({ url: String(input), body, headers: new Headers(init?.headers) });
    if (options.rejectCall && body.method === "eth_call") return Response.json({ id: body.id, error: { code: -32602 } });
    const result = options.result?.(body, sent.length) ?? (body.method === "eth_chainId" ? "0x1" : {
      number: `0x${(body.params[0] === "latest" ? block + 64n : block).toString(16)}`,
      hash, timestamp: `0x${(BigInt(now / 1000) - (body.params[0] === "latest" ? 0n : 768n)).toString(16)}`
    });
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  }) as typeof fetch;
  return { sent, adapter: createStakingSupportAdapter({ ...limits, ...options.limits }, { fetch: mock, now: options.clock ?? (() => now) }) };
}

describe("bounded native staking root adapter", () => {
  it("pins finalized canonical hash and exact known addresses/view selectors without paid/workload headers", async () => {
    const { adapter, sent } = fixture({ result: (body) => body.method === "eth_call" ?
      encodeFunctionResult({ abi: stakingSupportAbi, functionName: "islandContract", result: islandCollection.address }) : undefined });
    expect(await adapter.chain.finalizedBlock()).toEqual({ number: block, hash });
    expect((await adapter.chain.islandContract(block)).toLowerCase()).toBe(islandCollection.address);
    const call = sent.at(-1)!;
    expect(call.url).toBe("http://127.0.0.1:19201/");
    expect(call.body.params).toEqual([{ to: islandStakingAddress, data: expect.stringMatching(/^0x[0-9a-f]{8}$/) }, { blockHash: hash, requireCanonical: true }]);
    expect([...call.headers.keys()]).toEqual(["content-type"]);
    expect(sent.map((row) => row.body.method)).toEqual(["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_call"]);
  });

  it("batches 40 owner and wallet reads through the installed mainnet Multicall3 at one canonical anchor", async () => {
    let operation = "balance";
    const ids = Array.from({ length: 40 }, (_, index) => BigInt(index + 1));
    const wallets = ids.map((id) => `0x${id.toString(16).padStart(40, "0")}` as const);
    const { adapter, sent } = fixture({ result: (body) => {
      if (body.method !== "eth_call") return undefined;
      if (operation === "balance") return encodeFunctionResult({ abi: custodyAbi, functionName: "balanceOf", result: 1n });
      if (operation === "owner" || operation === "many") return aggregateResult(ids.map((id) => ({ success: true,
        returnData: operation === "owner" ? encodeFunctionResult({ abi: custodyAbi, functionName: "ownerOf", result: islandStakingAddress }) :
          encodeFunctionResult({ abi: stakingSupportAbi, functionName: "stakedIslandsOf", result: [id] }) })));
      return encodeFunctionResult({ abi: stakingSupportAbi, functionName: "stakedIslandsOf", result: [1n] });
    } });
    await adapter.chain.finalizedBlock();
    expect(await adapter.chain.custodyBalance(block)).toBe(1n);
    operation = "owner";
    expect((await adapter.chain.owners(ids, block)).map((owner) => owner.toLowerCase())).toEqual(ids.map(() => islandStakingAddress));
    operation = "membership";
    expect(await adapter.chain.stakedIslands(wallet, block)).toEqual([1n]);
    operation = "many";
    expect(await adapter.chain.stakedIslandsMany!(wallets, block)).toEqual(ids.map((id) => [id]));
    expect(sent.filter((row) => row.body.method === "eth_call")).toHaveLength(4);
    expect(adapter.statistics().rpcCalls).toBe(7);
    expect(sent.slice(-4).map((row) => (row.body.params[0] as { to: string }).to)).toEqual([
      islandCollection.address, mainnet.contracts.multicall3.address, islandStakingAddress, mainnet.contracts.multicall3.address
    ]);
    for (const [offset, abi, functionName, args, target] of [
      [-3, custodyAbi, "ownerOf", ids, islandCollection.address],
      [-1, stakingSupportAbi, "stakedIslandsOf", wallets, islandStakingAddress]
    ] as const) {
      const request = sent.at(offset)!.body;
      expect(request.params[1]).toEqual({ blockHash: hash, requireCanonical: true });
      const aggregate = decodeFunctionData({ abi: multicall3Abi, data: (request.params[0] as { data: Hex }).data });
      expect(aggregate.functionName).toBe("aggregate3");
      if (aggregate.functionName !== "aggregate3") throw new Error("aggregate3 required");
      expect(aggregate.args[0]).toHaveLength(40);
      for (const [index, entry] of aggregate.args[0].entries()) {
        expect(entry.target.toLowerCase()).toBe(target);
        expect(entry.allowFailure).toBe(false);
        const decoded = decodeFunctionData({ abi, data: entry.callData });
        expect(decoded.functionName).toBe(functionName);
        expect(decoded.args?.map((arg) => typeof arg === "string" ? arg.toLowerCase() : arg)).toEqual([args[index]]);
      }
    }
  });

  it("rejects partial, mismatched and malformed multicall results without returning partial owners or retrying", async () => {
    const good = { success: true, returnData: encodeFunctionResult({ abi: custodyAbi, functionName: "ownerOf", result: islandStakingAddress }) };
    for (const response of [
      aggregateResult([good, { success: false, returnData: "0x" }]),
      aggregateResult([good]), aggregateResult([good, good, good]),
      aggregateResult([good, { success: true, returnData: "0x" }]), "0x"
    ]) {
      const { adapter, sent } = fixture({ result: (body) => body.method === "eth_call" ? response : undefined });
      await adapter.chain.finalizedBlock();
      await expect(adapter.chain.owners([1n, 2n], block)).rejects.toThrow(/result_invalid/);
      await expect(adapter.chain.owners([1n], block)).rejects.toThrow("stopped");
      expect(sent.filter((row) => row.body.method === "eth_call")).toHaveLength(1);
    }
  });

  it("rejects invalid wallet batch results and per-wallet membership overflow", async () => {
    const good = { success: true, returnData: encodeFunctionResult({ abi: stakingSupportAbi, functionName: "stakedIslandsOf", result: [1n] }) };
    for (const response of [aggregateResult([good]), aggregateResult([good, { success: false, returnData: "0x" }]),
      aggregateResult([good, { success: true, returnData: "0x" }]),
      aggregateResult([good, { success: true, returnData: encodeFunctionResult({ abi: stakingSupportAbi,
        functionName: "stakedIslandsOf", result: Array.from({ length: 51 }, () => 1n) }) }])]) {
      const { adapter } = fixture({ result: (body) => body.method === "eth_call" ? response : undefined });
      await adapter.chain.finalizedBlock();
      await expect(adapter.chain.stakedIslandsMany!([wallet, wallet], block)).rejects.toThrow(/staking_(multicall|membership)_/);
      await expect(adapter.chain.stakedIslandsMany!([wallet], block)).rejects.toThrow("stopped");
    }
  });

  it("refuses RPC before selecting an anchor and refuses another block", async () => {
    const one = fixture();
    await expect(one.adapter.chain.custodyBalance(block)).rejects.toThrow("unpinned");
    expect(one.sent).toHaveLength(0);
    const two = fixture();
    await two.adapter.chain.finalizedBlock();
    await expect(two.adapter.chain.custodyBalance(block + 1n)).rejects.toThrow("unpinned");
    expect(two.sent).toHaveLength(3);
  });

  it("requires free source/background metrics and rejects fallback or missing config before any RPC", async () => {
    for (const change of [ { sourcePaidFallbackOnFreeFailure: true }, { paidFallbackOnFreeFailure: true }, { freeRouting: false },
      { budget: { workload: "foreground", priority: "foreground", model: "alchemy-2026-09-08" } }, { freeRequestTimeoutMs: undefined } ]) {
      const { adapter, sent } = fixture({ metrics: () => ({ ...metrics(), ...change }) });
      await expect(adapter.chain.finalizedBlock()).rejects.toThrow();
      expect(sent).toHaveLength(0);
    }
  });

  it("refuses source paid counter changes/resets and configuration drift without a retry", async () => {
    let value = metrics();
    const { adapter, sent } = fixture({ metrics: () => value });
    await adapter.assertFreeProof();
    value = { ...value, traffic: { workloads: { source: { paidCalls: 1 } } } };
    await expect(adapter.chain.finalizedBlock()).rejects.toThrow("proof_changed");
    expect(sent).toHaveLength(0);
    let interval = 400;
    const other = fixture({ metrics: () => ({ ...metrics(), freeSourceMinimumIntervalMs: interval }) });
    await other.adapter.assertFreeProof();
    interval++;
    await expect(other.adapter.chain.finalizedBlock()).rejects.toThrow("proof_changed");
    expect(other.sent).toHaveLength(0);
  });

  it("rejects wrong chain, stale head/finality and canonical hash replacement", async () => {
    const wrong = fixture({ result: (body) => body.method === "eth_chainId" ? "0x89" : undefined });
    await expect(wrong.adapter.chain.finalizedBlock()).rejects.toThrow("chain_mismatch");
    const stale = fixture({ clock: () => now + 180001 });
    await expect(stale.adapter.chain.finalizedBlock()).rejects.toThrow("stale_or_inconsistent");
    const changed = fixture({ result: (body) => body.method === "eth_getBlockByNumber" && body.params instanceof Array && String(body.params[0]).startsWith("0x") ?
      { number: `0x${block.toString(16)}`, hash: `0x${"33".repeat(32)}`, timestamp: `0x${BigInt(now / 1000).toString(16)}` } : undefined });
    await changed.adapter.chain.finalizedBlock();
    await expect(changed.adapter.chain.blockHash(block)).rejects.toThrow("anchor_changed");
  });

  it("does not retry unsupported canonical-hash eth_call on a numeric block or another route", async () => {
    const { adapter, sent } = fixture({ rejectCall: true });
    await adapter.chain.finalizedBlock();
    await expect(adapter.chain.islandContract(block)).rejects.toThrow("result_invalid");
    await expect(adapter.chain.islandContract(block)).rejects.toThrow("stopped");
    expect(sent.filter((row) => row.body.method === "eth_call")).toHaveLength(1);
    expect(sent.at(-1)!.body.params[1]).toEqual({ blockHash: hash, requireCanonical: true });
  });

  it("counts each aggregate as one actual RPC and refuses oversized responses before parsing", async () => {
    const limited = fixture({ limits: { maxRpcCalls: 6 }, result: (body) => body.method === "eth_call" ?
      aggregateResult([{ success: true, returnData: encodeFunctionResult({ abi: custodyAbi, functionName: "ownerOf", result: islandStakingAddress }) }]) : undefined });
    await limited.adapter.chain.finalizedBlock();
    for (let i = 0; i < 3; i++) expect(await limited.adapter.chain.owners([1n], block)).toHaveLength(1);
    await expect(limited.adapter.chain.owners([1n], block)).rejects.toThrow("rpc_call_limit");
    expect(limited.sent).toHaveLength(6);
    const oversized = createStakingSupportAdapter({ ...limits, maxResponseBytes: 1024 }, {
      now: () => now, fetch: (async () => new Response("x".repeat(1025))) as typeof fetch
    });
    await expect(oversized.assertFreeProof()).rejects.toThrow("request_failed");
  });

  it("rejects unanchored, wrong-block, empty, oversized and invalid batches before an RPC", async () => {
    for (const [ids, wallets] of [
      [[], []], [Array.from({ length: 41 }, () => 1n), Array.from({ length: 41 }, () => wallet)],
      [[-1n], ["0x1234"]], [[2n ** 256n], ["0xZZ00000000000000000000000000000000000000"]]
    ] as const) {
      const owners = fixture();
      await owners.adapter.chain.finalizedBlock();
      await expect(owners.adapter.chain.owners([...ids], block)).rejects.toThrow("batch_invalid");
      expect(owners.sent).toHaveLength(3);
      const members = fixture();
      await members.adapter.chain.finalizedBlock();
      await expect(members.adapter.chain.stakedIslandsMany!(wallets as readonly `0x${string}`[], block)).rejects.toThrow("batch_invalid");
      expect(members.sent).toHaveLength(3);
    }
    const unanchored = fixture();
    await expect(unanchored.adapter.chain.owners([1n], block)).rejects.toThrow("unpinned");
    expect(unanchored.sent).toHaveLength(0);
    const wrong = fixture();
    await wrong.adapter.chain.finalizedBlock();
    await expect(wrong.adapter.chain.stakedIslandsMany!([wallet], block + 1n)).rejects.toThrow("unpinned");
    expect(wrong.sent).toHaveLength(3);
  });

  it("enforces per-response/request-time/row limits with no network authority beyond the fixed root", async () => {
    expect(() => createStakingSupportAdapter({ ...limits, maxRpcCalls: 2049 })).toThrow();
    expect(() => createStakingSupportAdapter({ ...limits, maxTokens: 501 })).toThrow();
    const { adapter } = fixture();
    await adapter.chain.finalizedBlock();
    await expect(adapter.chain.owners(Array.from({ length: 41 }, () => 1n), block)).rejects.toThrow("batch_invalid");
    let clock = now;
    const expiring = fixture({ clock: () => clock });
    clock += 120000;
    await expect(expiring.adapter.chain.finalizedBlock()).rejects.toThrow("stopped");
  });
});

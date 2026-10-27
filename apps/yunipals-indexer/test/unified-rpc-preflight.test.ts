import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildSourceManifest } from "../lib/unified/sources.js";
import {
  preflightUnifiedRpc,
  unifiedRpcConfiguration,
  unifiedRpcHttpTransport,
  unifiedRpcTransport
} from "../lib/unified/rpc-preflight.js";
import { evidenceRpc } from "../lib/unified/rpc.js";
import {
  unifiedRpcProfileId,
  unifiedRpcManifestId,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";

const directory = await mkdtemp("/tmp/yunipals-rpc-preflight-");
afterAll(() => rm(directory, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "test-coordinator",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({}),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const path = join(directory, "profile.json");
await writeFile(path, JSON.stringify(profile));
const endpoints: Record<number, string> = {
  1: "http://127.0.0.1:19201/unified",
  8453: "http://127.0.0.1:19202/unified",
  137: "http://127.0.0.1:19203/unified",
  56: "http://127.0.0.1:19204/unified"
};
const env = {
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_PROFILE_FILE: path,
  UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile),
  ...Object.fromEntries(
    Object.entries(endpoints).map(([chain, url]) => [
      `PONDER_RPC_URL_${chain}`,
      url
    ])
  )
};
describe("reviewed unified RPC startup", () => {
  it("leaves legacy configuration unchanged until explicit opt-in", () => {
    expect(unifiedRpcConfiguration({})).toBeNull();
    expect(() =>
      unifiedRpcConfiguration({ UNIFIED_RPC_POLICY_REQUIRED: "true" })
    ).toThrow("reviewed");
    expect(() =>
      unifiedRpcConfiguration({
        ...env,
        UNIFIED_RPC_PROFILE_ID: `0x${"ab".repeat(32)}`
      })
    ).toThrow("hash");
  });
  it("refuses implicit/direct provider URLs without any history request", async () => {
    let requests = 0;
    await expect(
      preflightUnifiedRpc(
        profile.manifest,
        {
          ...env,
          PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/invalid"
        },
        {
          fetch: async () => {
            requests++;
            throw new Error("must not dispatch");
          }
        }
      )
    ).rejects.toThrow("Explicit");
    expect(requests).toBe(0);
  });
  it("checks both background allocations, exact identity and actual chain on all four proxies", async () => {
    const calls: string[] = [];
    await preflightUnifiedRpc(profile.manifest, env, {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const chainId = Number(
          Object.entries(endpoints).find(
            ([, value]) => new URL(value).port === url.port
          )![0]
        );
        const headers = new Headers(init?.headers),
          workload = headers.get("x-yunipals-rpc-workload");
        expect(headers.get("x-yunipals-unified-rpc-profile")).toBe(
          unifiedRpcProfileId(profile)
        );
        calls.push(`${chainId}:${workload}:${url.pathname}`);
        return new Response(
          JSON.stringify(
            url.pathname === "/unified/preflight"
              ? {
                  profileId: unifiedRpcProfileId(profile),
                  manifestHash: unifiedRpcManifestId(profile),
                  chainId,
                  coordinatorId: profile.coordinatorId,
                  scope: profile.scope,
                  workload,
                  paid: "explicit_bounded_permit_only",
                  budget: { daily_cu: "10000", allocation_cu: "1000" },
                  replay: { mode: "free_only" }
                }
              : { jsonrpc: "2.0", id: 1, result: `0x${chainId.toString(16)}` }
          )
        );
      }
    });
    expect(calls).toHaveLength(12);
  });
  it("refuses unavailable policy and a changed proxy coordinator", async () => {
    await expect(
      preflightUnifiedRpc(profile.manifest, env, {
        fetch: async () => new Response("{}", { status: 403 })
      })
    ).rejects.toThrow("unavailable");
    await expect(
      preflightUnifiedRpc(profile.manifest, env, {
        fetch: async () =>
          new Response(
            JSON.stringify({
              profileId: unifiedRpcProfileId(profile),
              coordinatorId: "changed"
            })
          )
      })
    ).rejects.toThrow("identity");
  });
  it("rejects a changed source manifest before proxy access", async () => {
    await expect(
      preflightUnifiedRpc(
        { ...profile.manifest, sources: profile.manifest.sources.slice(1) },
        env,
        {
          fetch: async () => {
            throw new Error("must not dispatch");
          }
        }
      )
    ).rejects.toThrow("manifest");
  });
});

type RpcCall = {
  id: number;
  method: string;
  params: string[];
};
type Dispatch = { calls: RpcCall[]; headers: Headers; batched: boolean };
function recordFetch(
  dispatches: Dispatch[],
  response: (call: RpcCall, headers: Headers) => object = (call) => ({
    result: call.params[0]
  })
): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    const batched = Array.isArray(body);
    const calls = (batched ? body : [body]) as RpcCall[];
    dispatches.push({ calls, headers: request.headers, batched });
    const results = calls
      .map((call) => ({
        jsonrpc: "2.0",
        id: call.id,
        ...response(call, request.headers)
      }))
      .reverse();
    return new Response(JSON.stringify(batched ? results : results[0]), {
      headers: { "content-type": "application/json" }
    });
  };
}

describe("bounded unified HTTP batching", () => {
  it("batches concurrent source reads and matches reversed response IDs", async () => {
    const dispatches: Dispatch[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(recordFetch(dispatches));
    const configured = unifiedRpcTransport(56, env);
    expect(typeof configured).toBe("function");
    if (typeof configured !== "function") throw new Error("Missing transport");
    const client = configured({ retryCount: 0 });
    const results = await Promise.all(
      ["0x10", "0x11", "0x12"].map((height) =>
        client.request({
          method: "eth_getBlockByNumber",
          params: [height, true]
        })
      )
    );
    expect(results).toEqual(["0x10", "0x11", "0x12"]);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.batched).toBe(true);
    expect(new Set(dispatches[0]!.calls.map((call) => call.id)).size).toBe(3);
    expect(dispatches[0]!.headers.get("x-yunipals-rpc-workload")).toBe(
      "unified_source"
    );
  });

  it("splits at the reviewed maximum and keeps an item error isolated", async () => {
    const limited = {
      ...profile,
      limits: { ...profile.limits, batchCalls: 3 }
    };
    const limitedPath = join(directory, "limited.json");
    await writeFile(limitedPath, JSON.stringify(limited));
    const selected = {
      ...env,
      UNIFIED_RPC_PROFILE_FILE: limitedPath,
      UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(limited)
    };
    const dispatches: Dispatch[] = [];
    const client = unifiedRpcHttpTransport(
      endpoints[56]!,
      56,
      "unified_source",
      selected,
      {
        retryCount: 0,
        fetchFn: recordFetch(dispatches, (call) =>
          call.params[0] === "0x3"
            ? { error: { code: -32000, message: "fixture item failure" } }
            : { result: call.params[0] }
        )
      }
    )({});
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        client.request({
          method: "eth_getBlockByNumber",
          params: [`0x${index}`, true]
        })
      )
    );
    expect(dispatches.map((item) => item.calls.length)).toEqual([3, 3, 2]);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(results[3]!.status).toBe("rejected");
    expect(
      results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
    ).toEqual(["0x0", "0x1", "0x2", "0x4", "0x5", "0x6", "0x7"]);
  });

  it("keeps source and evidence headers separate at the same URL and caller signal", async () => {
    const dispatches: Dispatch[] = [];
    const permit = `0x${"ac".repeat(32)}`;
    const selected = { ...env, UNIFIED_RPC_REPLAY_PERMIT_ID_56: permit };
    const options = {
      retryCount: 0,
      fetchFn: recordFetch(dispatches, (call, headers) => ({
        result: `${headers.get("x-yunipals-rpc-workload")}:${call.params[0]}`
      }))
    };
    const source = unifiedRpcHttpTransport(
      endpoints[56]!,
      56,
      "unified_source",
      selected,
      options
    )({});
    const evidence = unifiedRpcHttpTransport(
      endpoints[56]!,
      56,
      "unified_evidence",
      selected,
      options
    )({});
    const controller = new AbortController();
    const request = {
      method: "eth_getCode",
      params: ["0x01", "0x10"]
    } as const;
    const results = await Promise.all([
      source.request(request, { signal: controller.signal }),
      evidence.request(request, { signal: controller.signal }),
      source.request(request, { signal: controller.signal }),
      evidence.request(request, { signal: controller.signal })
    ]);
    expect(results).toEqual([
      "unified_source:0x01",
      "unified_evidence:0x01",
      "unified_source:0x01",
      "unified_evidence:0x01"
    ]);
    expect(dispatches.map((item) => item.calls.length)).toEqual([2, 2]);
    for (const item of dispatches) {
      expect(item.headers.get("x-yunipals-unified-rpc-profile")).toBe(
        unifiedRpcProfileId(profile)
      );
      expect(item.headers.get("x-yunipals-unified-rpc-permit")).toBe(permit);
    }
    controller.abort();
    const count = dispatches.length;
    await expect(
      source.request(request, { signal: controller.signal })
    ).rejects.toThrow();
    expect(dispatches).toHaveLength(count);
  });

  it("keeps the transport ceiling at ten even with a larger valid profile", async () => {
    const large = {
      ...profile,
      limits: { ...profile.limits, batchCalls: 100 }
    };
    const largePath = join(directory, "large.json");
    await writeFile(largePath, JSON.stringify(large));
    const dispatches: Dispatch[] = [];
    const transport = unifiedRpcHttpTransport(
      endpoints[56]!,
      56,
      "unified_source",
      {
        ...env,
        UNIFIED_RPC_PROFILE_FILE: largePath,
        UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(large)
      },
      { retryCount: 0, fetchFn: recordFetch(dispatches) }
    )({});
    await Promise.all(
      Array.from({ length: 23 }, (_, index) =>
        transport.request({
          method: "eth_getBlockByNumber",
          params: [`0x${index.toString(16)}`, true]
        })
      )
    );
    expect(dispatches.map((item) => item.calls.length)).toEqual([10, 10, 3]);
  });

  it("batches actual evidence receipt reads but leaves legacy HTTP unbatched", async () => {
    const dispatches: Dispatch[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(recordFetch(dispatches));
    const rpc = evidenceRpc(56, env);
    const hashes = [`0x${"a1".repeat(32)}`, `0x${"b2".repeat(32)}`];
    expect(await Promise.all(hashes.map((hash) => rpc.receipt(hash)))).toEqual(
      hashes
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.calls).toHaveLength(2);
    expect(dispatches[0]!.headers.get("x-yunipals-rpc-workload")).toBe(
      "unified_evidence"
    );
    const legacy = unifiedRpcHttpTransport(
      endpoints[56]!,
      56,
      "unified_evidence",
      {},
      {
        retryCount: 0
      }
    )({});
    await Promise.all(
      hashes.map((hash) =>
        legacy.request({
          method: "eth_getTransactionReceipt",
          params: [hash]
        })
      )
    );
    expect(dispatches).toHaveLength(3);
    expect(dispatches.slice(1).every((item) => !item.batched)).toBe(true);
    expect(unifiedRpcTransport(56, { PONDER_RPC_URL_56: endpoints[56] })).toBe(
      endpoints[56]
    );
  });
});

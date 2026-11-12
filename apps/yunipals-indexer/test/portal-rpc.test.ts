import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, type Hex } from "viem";
import {
  portalRpcTransport,
  portalLogBlockRange,
  portalRpcUrls,
  preflightPortalRpc,
  verifyPortalRpcChains
} from "../lib/portals/rpc.js";

const hash = `0x${"a".repeat(64)}` as Hex;
const absent = `0x${"b".repeat(64)}` as Hex;
const grading = "0x1111111111111111111111111111111111111111";
afterEach(() => vi.unstubAllGlobals());
function rpc(
  response: (host: string, method: string, params: unknown[]) => unknown
) {
  const methods: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as {
        id: number;
        method: string;
        params: unknown[];
      };
      methods.push(body.method);
      const value = response(
        new URL(request.url).hostname,
        body.method,
        body.params
      );
      if (value instanceof Error)
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32602, message: value.message }
          }),
          { status: 403 }
        );
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }),
        { headers: { "content-type": "application/json" } }
      );
    }
  );
  return methods;
}
describe("portal RPC compatibility", () => {
  it("bounds configured historical log ranges without changing the default", () => {
    expect(portalLogBlockRange({})).toBe(2000n);
    expect(portalLogBlockRange({ PORTALS_LOG_BLOCK_RANGE: "1000" })).toBe(
      1000n
    );
    for (const value of [
      "",
      "0",
      "-1",
      "2001",
      "1.5",
      "1e3",
      "99999999999999999"
    ])
      expect(() =>
        portalLogBlockRange({ PORTALS_LOG_BLOCK_RANGE: value })
      ).toThrow("between 1 and 2000");
  });
  it("validates endpoints without leaking credentials and restricts insecure local overrides", () => {
    expect(
      portalRpcUrls({
        PORTALS_RPC_URL: "https://one.test/key",
        PORTALS_RPC_FALLBACK_URLS: "https://two.test,https://one.test/key"
      })
    ).toHaveLength(2);
    expect(() =>
      portalRpcUrls({ PORTALS_RPC_URL: "http://remote.test/private-key" })
    ).toThrow("HTTPS");
    expect(() =>
      portalRpcUrls({ PORTALS_RPC_URL: "https://user:secret@one.test" })
    ).toThrow("user information");
    expect(
      portalRpcUrls({
        PORTALS_RPC_URL: "http://127.0.0.1:8545",
        PORTALS_CHAIN_ID: "31337",
        PORTALS_ALLOW_LOCAL_CHAIN: "true"
      })
    ).toHaveLength(1);
  });
  it("uses a fallback for gateway access errors without converting errors to null", async () => {
    rpc((host) =>
      host === "one.test" ? new Error("archive access denied") : null
    );
    const client = createPublicClient({
      transport: portalRpcTransport(["https://one.test", "https://two.test"])
    });
    expect(
      await client.request({
        method: "eth_getTransactionReceipt",
        params: [absent]
      })
    ).toBeNull();
  });
  it("requires each endpoint to match the configured chain", async () => {
    rpc((host) => (host === "one.test" ? "0x2105" : "0x1"));
    await expect(
      verifyPortalRpcChains(
        ["https://one.test", "https://two.test/secret-key"],
        8453
      )
    ).rejects.toThrow("RPC 2");
  });
  it("performs only read operations and flags incompatible missing-receipt behavior", async () => {
    const methods = rpc((_host, method, params) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_getCode") return "0x6000";
      if (method === "eth_getTransactionByHash") return null;
      if (method === "eth_blockNumber") return "0x800";
      if (method === "eth_getLogs") {
        const range = params[0] as { fromBlock: Hex; toBlock: Hex };
        if (BigInt(range.toBlock) - BigInt(range.fromBlock) >= 1000n)
          return new Error("provider permits at most 1000 blocks");
        return [];
      }
      if (method === "eth_getBlockByNumber")
        return { number: params[0], hash, timestamp: "0x10", transactions: [] };
      if (method === "eth_getTransactionReceipt") {
        if (params[0] === absent) return new Error("personal token required");
        return {
          transactionHash: hash,
          blockNumber: "0x14",
          blockHash: hash,
          status: "0x1",
          transactionIndex: "0x0",
          gasUsed: "0x5208",
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          logs: [],
          type: "0x2"
        };
      }
      throw new Error("Unexpected test RPC");
    });
    const report = await preflightPortalRpc(["https://one.test"], {
      chainId: 8453,
      grading,
      startBlock: 20n,
      knownTransaction: hash,
      absentTransaction: absent,
      logBlockRange: 1000n
    });
    expect(report.ready).toBe(false);
    expect(report.reports[0].checks).toEqual({
      chain: true,
      historicalCode: true,
      knownReceipt: true,
      missingTransaction: true,
      missingReceipt: false,
      historicalLogs: true
    });
    expect(report.reports[0].blockNumber).toBe("1019");
    expect(methods.every((method) => !/send|sign/.test(method))).toBe(true);
  });
});

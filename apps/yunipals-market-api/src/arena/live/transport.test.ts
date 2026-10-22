import assert from "node:assert/strict";
import { test } from "node:test";
import { custom } from "viem";
import { arenaTransport } from "./transport";

test("reads retain the CU gate and signed broadcasts never use or fall back to it", async () => {
  const reads: string[] = [];
  const broadcasts: string[] = [];
  const transport = arenaTransport(
    custom(
      {
        request: async ({ method }: { method: string }) => {
          reads.push(method);
          if (method === "eth_call") throw new Error("CU allocation exhausted");
          return "0x2105";
        }
      },
      { retryCount: 0 }
    ),
    custom(
      {
        request: async ({ method }: { method: string }) => {
          broadcasts.push(method);
          throw new Error("ambiguous broadcast timeout");
        }
      },
      { retryCount: 0 }
    )
  )({});
  assert.equal(await transport.request({ method: "eth_chainId" }), "0x2105");
  await assert.rejects(
    transport.request({ method: "eth_call", params: [] }),
    /CU allocation/
  );
  await assert.rejects(
    transport.request({ method: "eth_sendRawTransaction", params: ["0x1234"] }),
    /ambiguous broadcast/
  );
  assert.deepEqual(reads, ["eth_chainId", "eth_call"]);
  assert.deepEqual(broadcasts, ["eth_sendRawTransaction"]);
});

test("an unconfigured broadcast route cannot send a transaction", async () => {
  let calls = 0;
  const transport = arenaTransport(
    custom({
      request: async () => {
        calls++;
        return "0x";
      }
    })
  )({});
  await assert.rejects(
    transport.request({ method: "eth_sendRawTransaction", params: ["0x1234"] }),
    /disabled/
  );
  assert.equal(calls, 0);
});

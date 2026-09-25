import assert from "node:assert/strict";
import test from "node:test";

import { createMarketRequest } from "@/lib/marketplace/http";

test("preparation waits for the server deadline while reads stay bounded and cancellation works", async (t) => {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  let observedSignal: AbortSignal | null | undefined;
  const request = createMarketRequest(
    "https://market.example",
    async (_url, init) => {
      observedSignal = init?.signal;
      return Response.json({ ok: true });
    }
  );
  await request("/v2/market/tokens");
  await request("/v1/market/orders/ethereum/protocol/hash/preflight", {
    method: "POST"
  });
  const controller = new AbortController();
  await request("/v1/market/orders/ethereum/protocol/hash/fulfillment", {
    method: "POST",
    signal: controller.signal
  });
  assert.equal(observedSignal?.aborted, false);
  controller.abort();
  assert.equal(observedSignal?.aborted, true);
  await request("/v1/market/orders/ethereum/protocol/hash/prepare", {
    method: "POST"
  });
  assert.deepEqual(deadlines, [15_000, 50_000, 50_000, 15_000]);
});

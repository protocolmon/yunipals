import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, type PublicClient } from "viem";
import {
  boosterEthAddress,
  boosterEthAbi,
  capEthPackQuote,
  checkBoosterEthPayment,
  ethPackPurchaseData,
  quoteEthPackRoutes,
  baseEthRoutes
} from "./boosterEth";

test("exact output maximum rounds up to the configured slippage", () => {
  for (const amount of [1n, 9999n, 10n ** 18n]) {
    const quote = capEthPackQuote(1, amount);
    assert.ok(quote.maximum * 10000n >= amount * 10050n);
    assert.ok((quote.maximum - 1n) * 10000n < amount * 10050n);
  }
  assert.throws(() => capEthPackQuote(0, 0n));
  assert.equal(
    boosterEthAddress("0x0000000000000000000000000000000000000000"),
    null
  );
  assert.equal(boosterEthAddress("not-an-address"), null);
});
test("ETH calldata binds count, route and independent budgets", () => {
  const data = ethPackPurchaseData(
    7n,
    3,
    capEthPackQuote(1, 1000n),
    200n,
    300n
  );
  assert.deepEqual(decodeFunctionData({ abi: boosterEthAbi, data }).args, [
    7n,
    3,
    1,
    1005n,
    200n,
    300n
  ]);
  for (const quantity of [0, 11, 1.5, NaN])
    assert.throws(() =>
      ethPackPurchaseData(7n, quantity, capEthPackQuote(0, 1n), 2n, 3n)
    );
});
test("a failed quote leaves the other pool usable; total failure is actionable", async () => {
  const client = {
    simulateContract: async () => {
      throw new Error("no V3 liquidity");
    },
    readContract: async () => [101n, 1n]
  } as unknown as Pick<PublicClient, "simulateContract" | "readContract">;
  assert.deepEqual(await quoteEthPackRoutes(client, 1n), [
    capEthPackQuote(1, 101n)
  ]);
  await assert.rejects(
    () =>
      quoteEthPackRoutes(
        {
          ...client,
          readContract: async () => {
            throw new Error("RPC failed");
          }
        },
        1n
      ),
    /unavailable/
  );
});
test("activation requires matching dependencies and the engine grant", async () => {
  const engine = "0x1111111111111111111111111111111111111111";
  const ypal = "0x2222222222222222222222222222222222222222";
  const adapter = "0x3333333333333333333333333333333333333333";
  let grant = true;
  let wrongRouter = false;
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "VERSION") return 1n;
      if (functionName === "PAYMENT_ADAPTER_ROLE")
        return `0x${"11".repeat(32)}`;
      if (functionName === "hasRole") return grant;
      if (functionName === "engine") return engine;
      if (functionName === "ypal") return ypal;
      if (wrongRouter && functionName === "v3Router") return adapter;
      return baseEthRoutes[functionName as keyof typeof baseEthRoutes];
    }
  } as unknown as Pick<PublicClient, "readContract">;
  await checkBoosterEthPayment(client, adapter, engine, ypal);
  grant = false;
  await assert.rejects(
    () => checkBoosterEthPayment(client, adapter, engine, ypal),
    /not activated/
  );
  grant = true;
  wrongRouter = true;
  await assert.rejects(
    () => checkBoosterEthPayment(client, adapter, engine, ypal),
    /not activated/
  );
});

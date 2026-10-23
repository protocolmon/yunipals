import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex
} from "viem";
import { base } from "viem/chains";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import {
  boosterPurchaseAbi,
  boosterPurchaseData,
  readBoosterPurchaseLimit,
  validateBoosterPurchaseQuantity
} from "./boosterPurchase";

const engine = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609";
const oldImplementation =
  "0x00000000000000000000000092e2351a83b6c445c94d0b887259d2b940c82a5a";
function fixture(implementation: Hex, limit = 10, fail = false) {
  const methods: string[] = [];
  const client = createPublicClient({
    chain: base,
    transport: custom(
      {
        request: async ({ method, params }) => {
          methods.push(method);
          if (fail) throw new Error("RPC unavailable");
          if (method === "eth_getStorageAt") {
            assert.equal(params[0].toLowerCase(), engine);
            assert.equal(
              params[1],
              "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
            );
            return implementation;
          }
          assert.equal(method, "eth_call");
          const decoded = decodeFunctionData({
            abi: boosterPurchaseAbi,
            data: params[0].data
          });
          assert.equal(decoded.functionName, "MAX_OPEN_PACKS");
          return encodeFunctionResult({
            abi: boosterPurchaseAbi,
            functionName: "MAX_OPEN_PACKS",
            result: limit
          });
        }
      },
      { retryCount: 0 }
    )
  });
  return { client, methods };
}

test("existing engine keeps the working single-pack path without calling an absent getter", async () => {
  const { client, methods } = fixture(oldImplementation);
  assert.equal(await readBoosterPurchaseLimit(client, engine), 1);
  assert.deepEqual(methods, ["eth_getStorageAt"]);
  const data = boosterPurchaseData(2n, 1, 1000n, 5000n);
  assert.deepEqual(decodeFunctionData({ abi: boosterPacksAbi, data }), {
    functionName: "openPack",
    args: [2n, 1000n, 5000n]
  });
});

test("upgraded engine advertises a bounded purchase count", async () => {
  const { client } = fixture(`0x${"ab".repeat(32)}`);
  assert.equal(await readBoosterPurchaseLimit(client, engine), 10);
  const oversized = fixture(`0x${"ab".repeat(32)}`, 32);
  assert.equal(await readBoosterPurchaseLimit(oversized.client, engine), 10);
});

test("network and invalid capability results never masquerade as a successful legacy-engine read", async () => {
  const unavailable = fixture(oldImplementation, 10, true);
  await assert.rejects(readBoosterPurchaseLimit(unavailable.client, engine));
  const invalid = fixture(`0x${"ab".repeat(32)}`, 0);
  await assert.rejects(readBoosterPurchaseLimit(invalid.client, engine));
});

test("multiple purchases encode one atomic call with count and a TOTAL ETH ceiling", () => {
  for (const count of [2, 3, 5, 10]) {
    const data = boosterPurchaseData(2n, count, 123456n, 999999n);
    assert.deepEqual(decodeFunctionData({ abi: boosterPurchaseAbi, data }), {
      functionName: "openPacks",
      args: [2n, count, 123456n, 999999n]
    });
  }
});

test("invalid, fractional, unsafe and out-of-cap quantities cannot generate a purchase", () => {
  for (const count of [0, -1, 1.5, 11, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => boosterPurchaseData(2n, count, 1000n, 9999n));
  }
  assert.throws(() => validateBoosterPurchaseQuantity(2, 1));
  assert.equal(validateBoosterPurchaseQuantity(undefined), 1);
});

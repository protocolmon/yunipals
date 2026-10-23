import assert from "node:assert/strict";
import { test } from "node:test";
import { TransactionReceiptNotFoundError } from "viem";
import {
  boosterAssetUrl,
  fetchMonsterArtwork,
  readBoosterTransactions,
  readBoosterTransactionReceipt,
  saveBoosterTransaction,
  visibleBoosterTypes
} from "./boosters";
import { boosterSetupOwner } from "./boosterSetup";

test("the capped smoke type is shown only to the approved owner; ordinary packs stay public", () => {
  const smoke = {
    manifestUri:
      "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-smoke-v1/manifest.json"
  };
  const standard = {
    manifestUri:
      "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-standard-v1/manifest.json"
  };
  assert.deepEqual(visibleBoosterTypes([smoke, standard]), [standard]);
  assert.deepEqual(
    visibleBoosterTypes(
      [smoke, standard],
      "0x1111111111111111111111111111111111111111"
    ),
    [standard]
  );
  assert.deepEqual(
    visibleBoosterTypes([smoke, standard], boosterSetupOwner.toLowerCase()),
    [smoke, standard]
  );
});

test("only a missing receipt is pending; RPC failures stay unavailable", async () => {
  const receipt = { status: "success" as const, blockNumber: 123n };
  assert.equal(
    await readBoosterTransactionReceipt(async () => receipt),
    receipt
  );
  assert.equal(
    await readBoosterTransactionReceipt(async () => {
      throw new TransactionReceiptNotFoundError({
        hash: `0x${"ab".repeat(32)}`
      });
    }),
    null
  );
  for (const failure of [
    new Error("RPC connection unavailable"),
    new Error("RPC request timed out"),
    new TypeError("Invalid RPC receipt response")
  ]) {
    let calls = 0;
    await assert.rejects(
      readBoosterTransactionReceipt(async () => {
        calls++;
        throw failure;
      }),
      (error: unknown) => error === failure
    );
    assert.equal(calls, 1);
  }
});

test("pending transactions survive reloads and stay scoped to wallet and engine", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
  const account = "0x1111111111111111111111111111111111111111";
  const engine = "0x2222222222222222222222222222222222222222";
  const transaction = {
    hash: `0x${"ab".repeat(32)}` as const,
    kind: "open" as const
  };
  saveBoosterTransaction(account, engine, transaction, storage);
  saveBoosterTransaction(account, engine, transaction, storage);
  assert.deepEqual(readBoosterTransactions(account, engine, storage), [
    transaction
  ]);
  assert.deepEqual(readBoosterTransactions(engine, engine, storage), []);
  assert.deepEqual(readBoosterTransactions(account, account, storage), []);
  const replacement = {
    ...transaction,
    hash: `0x${"cd".repeat(32)}` as const,
    cancelled: true
  };
  saveBoosterTransaction(
    account,
    engine,
    replacement,
    storage,
    transaction.hash
  );
  assert.deepEqual(readBoosterTransactions(account, engine, storage), [
    replacement
  ]);
  values.set([...values.keys()][0], "bad json");
  assert.deepEqual(readBoosterTransactions(account, engine, storage), []);
});

test("multi-pack expectations survive reloads and replacements without dropping legacy hashes", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
  const wallet = "0x1111111111111111111111111111111111111111";
  const engine = "0x2222222222222222222222222222222222222222";
  const first = {
    hash: `0x${"12".repeat(32)}` as const,
    kind: "open" as const,
    expectedRequestCount: 3,
    packTypeId: "2",
    quantity: 1
  };
  saveBoosterTransaction(wallet, engine, first, storage);
  assert.deepEqual(readBoosterTransactions(wallet, engine, storage), [first]);
  const replacement = { ...first, hash: `0x${"34".repeat(32)}` as const };
  saveBoosterTransaction(wallet, engine, replacement, storage, first.hash);
  assert.deepEqual(readBoosterTransactions(wallet, engine, storage), [
    replacement
  ]);
  const claim = {
    hash: `0x${"56".repeat(32)}` as const,
    kind: "claim" as const,
    expectedRequestCount: 1,
    packTypeId: "2",
    quantity: 7,
    originalId: "900"
  };
  saveBoosterTransaction(wallet, engine, claim, storage);
  assert.deepEqual(readBoosterTransactions(wallet, engine, storage), [
    replacement,
    claim
  ]);
  assert.deepEqual(readBoosterTransactions(engine, engine, storage), []);
  const key = [...values.keys()][0];
  values.set(
    key,
    JSON.stringify([
      {
        ...first,
        expectedRequestCount: 11,
        packTypeId: "01",
        quantity: 33,
        originalId: "-1",
        arbitrary: "not trusted"
      }
    ])
  );
  assert.deepEqual(readBoosterTransactions(wallet, engine, storage), [
    { hash: first.hash, kind: first.kind }
  ]);
  values.set(key, JSON.stringify([{ ...first, expectedRequestCount: 1.5 }]));
  assert.equal(
    readBoosterTransactions(wallet, engine, storage)[0].expectedRequestCount,
    undefined
  );
});

test("artwork accepts durable URLs and rejects executable or credential-bearing locations", () => {
  assert.equal(
    boosterAssetUrl("ipfs://cid/image.png"),
    "https://ipfs.io/ipfs/cid/image.png"
  );
  assert.equal(
    boosterAssetUrl("https://example.test/image.png"),
    "https://example.test/image.png"
  );
  assert.equal(boosterAssetUrl("javascript:alert(1)"), null);
  assert.equal(
    boosterAssetUrl("https://name:password@example.test/image.png"),
    null
  );
  assert.equal(boosterAssetUrl("http://example.test/image.png"), null);
});

test("pending metadata polls without a broken image and holo masks reject unsafe URLs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ name: "Yuniaqua", yunipals: { status: "queued" } }),
        { status: 202 }
      );
    const pending = await fetchMonsterArtwork("https://example.test/12.json");
    assert.equal(pending.status, "queued");
    assert.equal(pending.image, null);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          image: "https://example.test/card.png",
          yunipals: {
            status: "ready",
            holo: {
              foreground: "https://example.test/fg.svg",
              background: "javascript:alert(1)",
              stars: "https://example.test/stars.svg"
            }
          }
        })
      );
    const ready = await fetchMonsterArtwork("https://example.test/12.json");
    assert.equal(ready.status, "ready");
    assert.equal(ready.holo, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

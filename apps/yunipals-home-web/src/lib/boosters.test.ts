import assert from "node:assert/strict";
import { test } from "node:test";
import { TransactionReceiptNotFoundError } from "viem";
import {
  boosterAssetUrl,
  fetchBoosterClaimPolicy,
  fetchMonsterArtwork,
  readBoosterTransactions,
  readBoosterTransactionReceipt,
  saveBoosterTransaction,
  visibleBoosterTypes
} from "./boosters";
import { boosterSetupOwner } from "./boosterSetup";
import { boosterArtworkPreviewUrl } from "./boosterArtworkPreview";

test("purchase policy comes from the matching indexed pack and missing data never implies saved claims", async (t) => {
  const expected = {
    registry: "0x1111111111111111111111111111111111111111",
    engine: "0x2222222222222222222222222222222222222222",
    monsters: "0x3333333333333333333333333333333333333333",
    packTypeId: "2",
    ruleHash: `0x${"ab".repeat(32)}`
  } as const;
  const pack = { ...expected, dailyClaimsExpire: true };
  const snapshot = {
    enabled: true,
    chainId: 8453,
    engine: expected.engine,
    collection: expected.monsters,
    indexedBlock: "123",
    items: [pack]
  };
  let body: unknown = snapshot;
  let status = 200;
  const fetch = t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.ok(url.endsWith("/v1/boosters/types"));
    return new Response(JSON.stringify(body), { status });
  });
  assert.equal(await fetchBoosterClaimPolicy(expected), true);
  pack.dailyClaimsExpire = false;
  assert.equal(await fetchBoosterClaimPolicy(expected), false);
  for (const changed of [
    { dailyClaimsExpire: undefined },
    { dailyClaimsExpire: "false" },
    { packTypeId: "3" },
    { registry: expected.engine },
    { engine: expected.registry },
    { ruleHash: `0x${"cd".repeat(32)}` }
  ]) {
    body = { ...snapshot, items: [{ ...pack, ...changed }] };
    await assert.rejects(
      fetchBoosterClaimPolicy(expected),
      /claim policy is not available/
    );
  }
  for (const changed of [
    { enabled: false },
    { chainId: 1 },
    { engine: expected.registry },
    { collection: expected.registry },
    { indexedBlock: null },
    { items: [] }
  ]) {
    body = { ...snapshot, ...changed };
    await assert.rejects(
      fetchBoosterClaimPolicy(expected),
      /claim policy is not available/
    );
  }
  status = 503;
  const before = fetch.mock.callCount();
  await assert.rejects(
    fetchBoosterClaimPolicy(expected),
    /index is catching up/
  );
  assert.equal(fetch.mock.callCount(), before + 1);
});

test("preview URLs preserve the API origin and prefix and only match canonical PNG assets", () => {
  const sha = "a".repeat(64);
  for (const base of [
    "https://api.yunipals.com/yunipals-indexer",
    "http://127.0.0.1:59985"
  ]) {
    assert.equal(
      boosterArtworkPreviewUrl(`${base}/v1/boosters/art-assets/${sha}.png`),
      `${base}/v1/boosters/art-previews/v1/${sha}.webp`
    );
  }
  for (const url of [
    null,
    "https://example.test/card.png",
    `https://example.test/v1/boosters/art-assets/${sha}.svg`,
    `https://example.test/v1/boosters/art-assets/${sha}.png?token=private`,
    `https://example.test/v1/boosters/art-assets/${sha}.png#fragment`,
    `https://user:password@example.test/v1/boosters/art-assets/${sha}.png`,
    `http://example.test/v1/boosters/art-assets/${sha}.png`
  ]) {
    assert.equal(boosterArtworkPreviewUrl(url), null);
  }
});

test("the capped test offer stays hidden for every wallet, including the owner; ordinary packs stay public", () => {
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
    [standard]
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

test("evolved artwork retains all foil layers without changing its base glitter trait or grading eligibility", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const layers = Object.fromEntries(
      ["foreground", "background", "stars", "cutout"].map((name) => [
        name,
        `https://example.test/${name}.png`
      ])
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          image: "https://example.test/evolved.png",
          attributes: [{ trait_type: "Finish", value: "Black" }],
          yunipals: { version: "1", historyCount: "0", holo: layers }
        })
      );
    const artwork = await fetchMonsterArtwork(
      "https://example.test/evolved.json"
    );
    assert.deepEqual(artwork.holo, layers);
    assert.equal(artwork.completedGrade, false);
    assert.equal(artwork.attributes.finish, "Black");
    assert.equal(artwork.attributes.glitter, undefined);
    layers.cutout = "javascript:alert(1)";
    assert.equal(
      (await fetchMonsterArtwork("https://example.test/evolved.json")).holo
        ?.cutout,
      undefined
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

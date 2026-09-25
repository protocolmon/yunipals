import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { testPolicy, testSeller, testBuyer } from "./marketplace.testFixtures";
import { createBnbPublicationIntent } from "./orderPublication";
import {
  encodeRecoverableOrders,
  importRecoverableOrders,
  maxOrderRecoveryFileBytes,
  readRecoverableOrders,
  type OrderRecoveryStorage,
  type RecoverableOrder
} from "./orderRecovery";
import { marketplaceChains } from "./registry";

function record(salt = 1n, maker: Address = testSeller): RecoverableOrder {
  const intent = createBnbPublicationIntent(
    {
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: marketplaceChains.bnb.contractAddress,
        tokenId: "123"
      },
      lifecycle: 1,
      maker,
      side: "listing",
      grossAmount: 10n ** 18n,
      endTime: 3700n
    },
    testPolicy,
    { timestamp: 100n, counter: 0n },
    salt
  );
  return {
    asset: intent.asset,
    lifecycle: intent.lifecycle,
    order: intent.order,
    orderHash: intent.orderHash,
    state: "accepted",
    updatedAt: 1000
  };
}

function memory(initial = "[]") {
  let value = initial;
  let writes = 0;
  const storage: OrderRecoveryStorage = {
    getItem: () => value,
    setItem: (_key, json) => {
      writes++;
      value = json;
    }
  };
  return { storage, json: () => value, writes: () => writes };
}

test("import restores cancellation parameters without trusting publication claims or retaining signatures", () => {
  const original = record();
  const data = JSON.parse(encodeRecoverableOrders([original]));
  data[0].signature = "0xdeadbeef";
  const target = memory();
  assert.deepEqual(
    importRecoverableOrders(JSON.stringify(data), testSeller, target.storage),
    { added: 1, existing: 0 }
  );
  const [imported] = readRecoverableOrders(target.storage);
  assert.deepEqual(imported.order, original.order);
  assert.equal(imported.orderHash, original.orderHash);
  assert.equal(imported.state, "imported");
  assert.ok(imported.updatedAt > original.updatedAt);
  assert.ok(!target.json().includes("deadbeef"));
  assert.ok(!target.json().includes('"signature"'));
});

test("merging and repeated imports preserve all existing wallets and local publication observations", () => {
  const local = { ...record(), state: "publication-unknown" as const };
  const unrelated = record(2n, testBuyer);
  const target = memory(encodeRecoverableOrders([local, unrelated]));
  const incoming = encodeRecoverableOrders([
    { ...local, state: "accepted", updatedAt: Number.MAX_SAFE_INTEGER },
    record(3n)
  ]);
  assert.deepEqual(
    importRecoverableOrders(incoming, testSeller, target.storage),
    {
      added: 1,
      existing: 1
    }
  );
  const saved = readRecoverableOrders(target.storage);
  assert.deepEqual(saved[0], local);
  assert.deepEqual(saved[1], unrelated);
  assert.equal(saved[2].state, "imported");
  const after = target.json();
  assert.deepEqual(
    importRecoverableOrders(incoming, testSeller, target.storage),
    {
      added: 0,
      existing: 2
    }
  );
  assert.equal(target.json(), after);
  assert.equal(target.writes(), 1);
});

test("an invalid record rejects the entire import before existing evidence is changed", () => {
  const valid = record(2n);
  const original = encodeRecoverableOrders([record()]);
  const data = JSON.parse(encodeRecoverableOrders([valid, record(3n)]));
  for (const mutation of ["hash", "asset", "duplicate", "state"] as const) {
    const input = structuredClone(data);
    if (mutation === "hash") input[1].order.salt = "4";
    if (mutation === "asset") input[1].asset.tokenId = "124";
    if (mutation === "duplicate") input[1] = input[0];
    if (mutation === "state") input[1].state = "cancelled";
    const target = memory(original);
    assert.throws(() =>
      importRecoverableOrders(JSON.stringify(input), testSeller, target.storage)
    );
    assert.equal(target.json(), original, mutation);
    assert.equal(target.writes(), 0, mutation);
  }
});

test("wrong-wallet, empty and oversized files cannot add cancellation records", () => {
  for (const input of [
    encodeRecoverableOrders([record(), record(2n, testBuyer)]),
    "[]",
    " ".repeat(maxOrderRecoveryFileBytes + 1)
  ]) {
    const target = memory();
    assert.throws(() =>
      importRecoverableOrders(input, testSeller, target.storage)
    );
    assert.equal(target.json(), "[]");
    assert.equal(target.writes(), 0);
  }
});

test("capacity overflow never prunes evidence or commits only part of a batch", () => {
  const full = Array.from({ length: 100 }, (_item, i) => record(BigInt(i)));
  const original = encodeRecoverableOrders(full);
  const target = memory(original);
  assert.throws(
    () =>
      importRecoverableOrders(
        encodeRecoverableOrders([record(100n), record(101n)]),
        testSeller,
        target.storage
      ),
    /Too many saved orders/
  );
  assert.equal(target.json(), original);
  assert.equal(target.writes(), 0);
  assert.deepEqual(
    importRecoverableOrders(
      encodeRecoverableOrders([full[0]]),
      testSeller,
      target.storage
    ),
    {
      added: 0,
      existing: 1
    }
  );
  assert.equal(target.writes(), 0);
});

test("damaged or unwritable storage is not replaced or reported as a successful import", () => {
  const input = encodeRecoverableOrders([record()]);
  const damaged = memory("{unreadable");
  assert.throws(() =>
    importRecoverableOrders(input, testSeller, damaged.storage)
  );
  assert.equal(damaged.json(), "{unreadable");
  assert.equal(damaged.writes(), 0);
  for (const rejectsWrite of [true, false]) {
    const storage: OrderRecoveryStorage = {
      getItem: () => "[]",
      setItem: () => {
        if (rejectsWrite) throw new Error("Storage quota exceeded");
      }
    };
    assert.throws(
      () => importRecoverableOrders(input, testSeller, storage),
      rejectsWrite ? /quota exceeded/ : /could not be saved/
    );
  }
});

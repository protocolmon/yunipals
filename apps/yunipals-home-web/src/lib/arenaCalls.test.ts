import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type GetCallsStatusReturnType
} from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import {
  arenaCallsEntryHash,
  arenaCallsRejected,
  clearArenaCalls,
  readArenaCalls,
  saveArenaCalls,
  type PendingArenaCalls
} from "./arenaCalls";
import { newArenaTransaction, transactionPending } from "./arenaTransactions";

const batch: PendingArenaCalls = {
  id: `0x${"ab".repeat(32)}`,
  wallet: `0x${"1".repeat(40)}`,
  contract: `0x${"3".repeat(40)}`,
  mediaKind: "anime",
  fighter: {
    tournamentId: "2",
    nftChainId: 8453,
    collection: `0x${"5".repeat(40)}`,
    tokenId: "42"
  }
};
const hash = `0x${"cd".repeat(32)}` as const;

test("batch recovery is isolated by wallet, contract and mode, and requires durable storage", () => {
  const values = new Map<string, string>();
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
  try {
    saveArenaCalls(batch);
    assert.deepEqual(
      readArenaCalls(batch.wallet, batch.contract, "anime"),
      batch
    );
    assert.equal(readArenaCalls(batch.wallet, batch.contract, "video"), null);
    assert.equal(
      readArenaCalls(`0x${"2".repeat(40)}`, batch.contract, "anime"),
      null
    );
    clearArenaCalls(batch);
    assert.equal(readArenaCalls(batch.wallet, batch.contract, "anime"), null);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("Storage unavailable");
        }
      }
    });
    assert.throws(() => saveArenaCalls(batch), /Storage unavailable/);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original
    });
  }
});

test("batch handoff requires Base, atomic success and the exact fighter's Entered event", () => {
  const log = {
    address: batch.contract,
    topics: encodeEventTopics({
      abi: arenaV2Abi,
      eventName: "Entered",
      args: { id: 2n, seat: 0, player: batch.wallet }
    }).filter((topic): topic is Hex => typeof topic === "string"),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [8453n, batch.fighter.collection, 42n]
    )
  };
  const result: GetCallsStatusReturnType = {
    id: batch.id,
    version: "2.0.0",
    chainId: 8453,
    atomic: true,
    status: "success",
    statusCode: 200,
    receipts: [
      {
        status: "success",
        transactionHash: hash,
        blockHash: hash,
        blockNumber: 100n,
        gasUsed: 100000n,
        logs: [log]
      }
    ]
  };
  assert.equal(arenaCallsEntryHash(batch, result), hash);
  assert.equal(arenaCallsEntryHash(batch, { ...result, chainId: 1 }), null);
  assert.equal(arenaCallsEntryHash(batch, { ...result, atomic: false }), null);
  assert.equal(
    arenaCallsEntryHash(batch, {
      ...result,
      status: "failure",
      statusCode: 600
    }),
    null
  );
  assert.equal(
    arenaCallsEntryHash(
      { ...batch, fighter: { ...batch.fighter, tokenId: "43" } },
      result
    ),
    null
  );
  assert.equal(
    arenaCallsEntryHash({ ...batch, wallet: `0x${"2".repeat(40)}` }, result),
    null
  );
});

test("only explicit pre-submission rejections release a batch for retry", () => {
  assert.equal(arenaCallsRejected({ cause: { code: 4001 } }), true);
  assert.equal(arenaCallsRejected({ code: 5760 }), true);
  assert.equal(arenaCallsRejected({ code: -32000 }), false);
  assert.equal(arenaCallsRejected(new Error("Request timed out")), false);
});

test("a checked allowance releases only approval waits; entry still needs canonical indexing", () => {
  const approval = newArenaTransaction(
    batch.wallet,
    batch.contract,
    hash,
    { kind: "approval", tournamentId: "2" },
    "anime"
  );
  assert.equal(transactionPending({ ...approval, state: "indexing" }), true);
  assert.equal(
    transactionPending({
      ...approval,
      state: "indexing",
      approvalConfirmed: true
    }),
    false
  );
  const entry = newArenaTransaction(
    batch.wallet,
    batch.contract,
    hash,
    { kind: "entry", ...batch.fighter },
    "anime"
  );
  assert.equal(
    transactionPending({
      ...entry,
      state: "indexing",
      approvalConfirmed: true
    }),
    true
  );
});

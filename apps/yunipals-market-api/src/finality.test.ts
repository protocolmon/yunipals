import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex, PublicClient } from "viem";

import { assertBnbObservationCurrent, readBnbHead } from "@/bnb/protocol";
import {
  assertOpenSeaObservationCurrent,
  readOpenSeaHead
} from "@/opensea/chain";

const latestHash = `0x${"11".repeat(32)}` as Hex;
const finalizedHash = `0x${"22".repeat(32)}` as Hex;

function client(chainId: number, now: number) {
  let finalizedNumber = 90n;
  const blocks = {
    latest: {
      number: 100n,
      hash: latestHash,
      timestamp: BigInt(Math.floor(now / 1000) - 5)
    },
    finalized: {
      number: finalizedNumber,
      hash: finalizedHash,
      timestamp: BigInt(Math.floor(now / 1000) - 60)
    }
  };
  const value = {
    async getChainId() {
      return chainId;
    },
    async getBlock(input: {
      blockTag?: "latest" | "finalized";
      blockNumber?: bigint;
    }) {
      if (input.blockTag === "latest") return blocks.latest;
      if (input.blockTag === "finalized")
        return { ...blocks.finalized, number: finalizedNumber };
      if (input.blockNumber === blocks.latest.number) return blocks.latest;
      if (input.blockNumber === blocks.finalized.number)
        return blocks.finalized;
      throw new Error("Unexpected block request.");
    }
  } as unknown as PublicClient;
  return {
    value,
    regressFinality() {
      finalizedNumber = 89n;
    }
  };
}

test("production head observations require an explicit finalized block and fence finality regression", async () => {
  const now = 1_800_000_000_000;
  const ethereum = client(1, now);
  const openSea = await readOpenSeaHead(
    ethereum.value,
    "ethereum",
    () => now,
    "finalized"
  );
  assert.equal(openSea.number, 100n);
  assert.equal(openSea.finalizedNumber, 90n);
  assert.equal(openSea.finalizedHash, finalizedHash);
  await assertOpenSeaObservationCurrent(ethereum.value, openSea, () => now);
  ethereum.regressFinality();
  await assert.rejects(
    assertOpenSeaObservationCurrent(ethereum.value, openSea, () => now),
    { message: "observation_expired" }
  );

  const bnbClient = client(56, now);
  const bnb = await readBnbHead(bnbClient.value, () => now, "finalized");
  assert.equal(bnb.number, 100n);
  assert.equal(bnb.finalizedNumber, 90n);
  await assertBnbObservationCurrent(bnbClient.value, bnb, () => now);
});

test("finalized mode fails closed when the provider omits the finalized tag", async () => {
  const now = 1_800_000_000_000;
  const unavailable = {
    async getChainId() {
      return 8453;
    },
    async getBlock(input: { blockTag?: string }) {
      if (input.blockTag === "finalized") throw new Error("unsupported tag");
      return {
        number: 100n,
        hash: latestHash,
        timestamp: BigInt(Math.floor(now / 1000) - 5)
      };
    }
  } as unknown as PublicClient;
  await assert.rejects(
    readOpenSeaHead(unavailable, "base", () => now, "finalized")
  );
});

test("Base accepts a healthy finalized head delayed beyond thirty minutes", async () => {
  const now = 1_800_000_000_000;
  const delayedFinality = {
    async getChainId() {
      return 8453;
    },
    async getBlock(input: { blockTag?: string }) {
      return {
        number: input.blockTag === "finalized" ? 90n : 100n,
        hash: input.blockTag === "finalized" ? finalizedHash : latestHash,
        timestamp: BigInt(
          Math.floor(now / 1000) -
            (input.blockTag === "finalized" ? 45 * 60 : 5)
        )
      };
    }
  } as unknown as PublicClient;

  const observed = await readOpenSeaHead(
    delayedFinality,
    "base",
    () => now,
    "finalized"
  );
  assert.equal(observed.finalizedNumber, 90n);

  await assert.rejects(
    readOpenSeaHead(
      {
        ...delayedFinality,
        async getChainId() {
          return 1;
        }
      } as PublicClient,
      "ethereum",
      () => now,
      "finalized"
    ),
    { message: "chain_finality_unavailable" }
  );
});

test("BNB reads finalized before latest to avoid a fast-block head race", async () => {
  const now = 1_800_000_000_000;
  let finalizedRead = false;
  const calls: string[] = [];
  const racing = {
    async getChainId() {
      return 56;
    },
    async getBlock(input: { blockTag?: "latest" | "finalized" }) {
      if (input.blockTag === "finalized") {
        calls.push("finalized");
        finalizedRead = true;
        return {
          number: 101n,
          hash: finalizedHash,
          timestamp: BigInt(Math.floor(now / 1000) - 1)
        };
      }
      calls.push("latest");
      return {
        number: finalizedRead ? 102n : 100n,
        hash: latestHash,
        timestamp: BigInt(Math.floor(now / 1000))
      };
    }
  } as unknown as PublicClient;

  const observed = await readBnbHead(racing, () => now, "finalized");
  assert.deepEqual(calls, ["finalized", "latest"]);
  assert.equal(observed.number, 102n);
  assert.equal(observed.finalizedNumber, 101n);
});

test("BNB observations allow the cost-capped production read set to finish", async () => {
  const now = 1_800_000_000_000;
  const bnbClient = client(56, now);
  const observed = await readBnbHead(bnbClient.value, () => now, "finalized");

  await assertBnbObservationCurrent(
    bnbClient.value,
    observed,
    () => now + 29_999
  );
  await assert.rejects(
    assertBnbObservationCurrent(bnbClient.value, observed, () => now + 30_001),
    { message: "observation_expired" }
  );
});

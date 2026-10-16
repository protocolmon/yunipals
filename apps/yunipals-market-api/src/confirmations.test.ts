import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readConfirmedBlock, chainConfirmations } from "./confirmations";

const hash = `0x${"a".repeat(64)}` as const;
test("confirmation snapshots use latest and a numeric local depth, never safe/finalized tags", async () => {
  for (const [chain, depth] of Object.entries(chainConfirmations)) {
    const calls: unknown[] = [];
    const client = {
      getBlock: async (p: { blockTag: "latest" } | { blockNumber: bigint }) => {
        calls.push(p);
        return {
          number: "blockNumber" in p ? p.blockNumber : 1000n,
          hash,
          timestamp: BigInt(Math.floor(Date.now() / 1000))
        };
      }
    };
    const block = await readConfirmedBlock(client, Number(chain));
    assert.equal(block.number, 1000n - depth);
    assert.deepEqual(calls, [
      { blockTag: "latest" },
      { blockNumber: 1000n - depth }
    ]);
  }
});
test("stale or inconsistent snapshots never authorize indexing", async () => {
  const client = {
    getBlock: async (p: { blockTag: "latest" } | { blockNumber: bigint }) => ({
      number: "blockNumber" in p ? p.blockNumber + 1n : 1000n,
      hash,
      timestamp: BigInt(Math.floor(Date.now() / 1000))
    })
  };
  await assert.rejects(
    readConfirmedBlock(client, 8453),
    /block is unavailable/
  );
  await assert.rejects(
    readConfirmedBlock(
      { getBlock: async () => ({ number: 1000n, hash, timestamp: 1n }) },
      8453
    ),
    /head is unavailable/
  );
  await assert.rejects(readConfirmedBlock(client, 99999), /confirmation depth/);
});
test("live Arena and indexer paths cannot reintroduce full-finality RPC tags", () => {
  const paths = [
    "src/arena/live/projector.ts",
    "src/arena/live/clientTransactions.ts",
    "src/arena/live/admission.ts",
    "src/arena/live/control.ts",
    "src/arena/live/settlement.ts",
    "../yunipals-indexer/lib/islands/base-worker.ts",
    "../yunipals-indexer/lib/islands/worker.ts",
    "../yunipals-indexer/lib/islands/staking-worker.ts",
    "../yunipals-indexer/lib/metadata/base-replay.ts",
    "../yunipals-indexer/scripts/verify-islands.ts",
    "../yunipals-indexer/scripts/qualify-base-islands.ts"
  ];
  for (const path of paths)
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /blockTag:\s*["'](?:finalized|safe)["']/,
      path
    );
  for (const path of [
    "src/environment.ts",
    "src/productionRuntime.ts",
    "src/openseaWorker.ts",
    "src/liveRpc.ts",
    "src/worker.ts"
  ])
    assert.doesNotMatch(readFileSync(path, "utf8"), /["']finalized["']/, path);
});

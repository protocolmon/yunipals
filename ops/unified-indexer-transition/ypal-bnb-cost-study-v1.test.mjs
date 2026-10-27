import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { historical, realtime, renderPolling10 } from "./ypal-bnb-cost-study-v1.mjs";

const groups = [];
const check = async (name, fn) => { await fn(); groups.push(name); };

await check("installed historical engine fetches100quietheaders for interval1", async () => {
  const value = await historical(1, [], 100);
  assert.equal(value.fullHeaderRequests, 100); assert.equal(value.callbackCount, 100);
  assert.equal(value.cacheRows.blocks, 100); assert.equal(value.baselineApplicationDbOperations, 300);
});
await check("installed historical engine fetches10quietheaders for interval10", async () => {
  const value = await historical(10, [], 100);
  assert.equal(value.fullHeaderRequests, 10); assert.equal(value.callbackCount, 10);
  assert.equal(value.cacheRows.blocks, 10); assert.equal(value.baselineApplicationDbOperations, 30);
});
await check("nonsampled synthetic events retain all6logs and5transactions", async () => {
  const value = await historical(10, [1, 37, 37, 87, 90, 99], 100);
  assert.equal(value.fullHeaderRequests, 14); assert.equal(value.syntheticEventBlocks, 5);
  assert.equal(value.cacheRows.logs, 6); assert.equal(value.cacheRows.transactions, 5);
});
await check("invalid or unbounded fixture inputs refuse beforeRPC", async () => {
  await assert.rejects(historical(0)); await assert.rejects(historical(10, [], 31001));
  await assert.rejects(historical(10, [-1], 100)); await assert.rejects(historical(10, [100], 100));
  await assert.rejects(realtime(60000));
});
let original;
await check("actual realtime gap engine keeps266headers at both polling rates", async () => {
  original = await realtime(2000); const slow = await realtime(10000);
  assert.equal(original.indexedBlocks, 266); assert.equal(slow.indexedBlocks, 266);
  assert.equal(original.latestHeaderRequests, 60); assert.equal(slow.latestHeaderRequests, 12);
  assert.equal(original.missingHeaderRequests, 206); assert.equal(slow.missingHeaderRequests, 254);
  assert.equal(original.totalFullHeaderRequests, slow.totalFullHeaderRequests);
});
await check("sparse callbacks do not remove stock realtime header continuity", async () => {
  const value = await realtime(10000, 10);
  assert.equal(value.totalFullHeaderRequests, original.totalFullHeaderRequests);
  assert.equal(value.indexedBlocks, 266); assert.equal(value.blockCallbacks, 26);
});
await check("poll renderer changes only exactBNB2s field; foreign source refuses", async () => {
  const before = await readFile(new URL("./ypal-combined-source-v1/payload/ponder.config.ts", import.meta.url), "utf8");
  const after = renderPolling10(before);
  assert.equal(after.replace("pollingInterval: 10_000", "pollingInterval: 2_000"), before);
  assert.match(after, /base: \{[\s\S]*?pollingInterval: 2_000/);
  assert.throws(() => renderPolling10(before + "\n"), /exact71e/);
});
await check("real three-variant build proof reproduces71e and requires new sparse build", async () => {
  const value = JSON.parse(await readFile("/tmp/yunipals-bnb-cost-study-20261024.json", "utf8"));
  const { baseline, poll10, sparse10 } = value.offlineBuild.variants;
  assert.equal(baseline.buildId, "71e2a7f3b7"); assert.equal(poll10.buildId, baseline.buildId);
  assert.equal(sparse10.buildId, "67d8a35489");
  assert.equal(baseline.bnbActualHandlerTotalOps, 93000); assert.equal(poll10.bnbActualHandlerTotalOps, 93000);
  assert.equal(sparse10.bnbActualHandlerTotalOps, 9300);
  for (const variant of [poll10, sparse10]) {
    assert.equal(variant.schemaHash, baseline.schemaHash); assert.equal(variant.indexingHash, baseline.indexingHash);
    assert.deepEqual(variant.contracts, baseline.contracts); assert.equal(variant.poolMax, 5);
    assert.equal(variant.pollingIntervals.base, 2000);
  }
  assert.equal(value.runtimeFilesManifestSha256, createHash("sha256").update(await readFile(new URL("./ypal-bnb-cost-study-v1.ponder-files.json", import.meta.url))).digest("hex"));
  assert.equal(value.providerCalls + value.databaseConnections + value.serviceActions + value.sockets, 0);
  assert.equal(value.productionEventTailMeasured, false);
  assert.equal(value.recommendation.keepBnbPollingMs, 2000);
  assert.equal(value.recommendation.nativeRebuildJustForRemainingTailRecommended, false);
});

console.log(JSON.stringify({ format: "yunipals-bnb-cost-study-v1-controls", passed: groups.length, groups,
  isolatedSyntheticRpcOnly: true, productionChanges: 0, providerCalls: 0, databaseConnections: 0 }));

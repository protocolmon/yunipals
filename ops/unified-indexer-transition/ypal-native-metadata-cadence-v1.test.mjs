// Local timing diagnosis only. Executes the actual serial worker loop with
// virtual time and fixture boundaries; performs no DB, network or service IO.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker = readFileSync(new URL("../../apps/yunipals-indexer/lib/metadata/archive-worker.ts", import.meta.url), "utf8");
const native = readFileSync(new URL("../../apps/yunipals-indexer/lib/metadata/native-base.ts", import.meta.url), "utf8");
const begin = worker.indexOf("try {\n  while (!stopping) {");
assert.ok(begin > 0);
const loop = worker.slice(begin);
assert.equal(loop.split("while (!stopping)").length, 2);
assert.ok(native.includes("interval '60 seconds'"));
const run = new (async function () {}).constructor("fixture", `
  const {pool,refreshNativeBaseMetadata,enqueueNativeBasePublications,
    enqueuePublications,auditArchiveUris,claimPublications,publishJob,
    Date,setTimeout,console}=fixture;
  const role="full",nativeBase={},unifiedBase=undefined,readSchemaName="fixture",
    scanBatchSize=5000,enqueueIntervalMs=5000,concurrency=8,resolveUri=undefined;
  const safeErrorMessage=()=>"fixture",process={env:{}};
  let stopping=false,nextBase=0,nextUri=0,nextEnqueue=0;
  ${loop.replace("while (!stopping)", "while (!stopping && fixture.continue())")}
`);

async function scenario({ age = 0, stages = {}, refreshMs = 0, rounds = 1 } = {}) {
  let now = age, approvalAt = 0, maximumAge = age, left = rounds;
  const calls = [];
  const advance = (milliseconds) => {
    now += milliseconds;
    maximumAge = Math.max(maximumAge, now - approvalAt);
  };
  await run({
    continue: () => left-- > 0,
    Date: { now: () => now },
    setTimeout: (resolve, ms) => { advance(ms); resolve(); },
    console: { error: () => assert.fail("unexpected fixture error path") },
    pool: { query: async () => ({}), end: async () => calls.push("closed") },
    refreshNativeBaseMetadata: async () => {
      calls.push("refresh");
      // Fixture approval age emulates the unchanged refresh skip condition.
      // Actual approval/canonical/private/RPC correctness is not inferred.
      if (now - approvalAt >= 60_000) { advance(refreshMs); approvalAt = now; }
    },
    enqueueNativeBasePublications: async () => { calls.push("native-enqueue"); advance(stages.nativeEnqueue ?? 0); },
    enqueuePublications: async () => { calls.push("enqueue"); advance(stages.enqueue ?? 0); },
    auditArchiveUris: async () => { calls.push("audit"); advance(stages.audit ?? 0); },
    claimPublications: async () => stages.jobs ? [{}] : [],
    publishJob: async () => { calls.push("job"); advance(stages.jobs ?? 0); }
  });
  return { maximumAge, calls };
}

test("actual quiet loop has no artificial 90-second cadence delay", async () => {
  const row = await scenario({ rounds: 3 });
  assert.equal(row.maximumAge, 6_000);
  assert.equal(row.calls.filter((value) => value === "refresh").length, 3);
});

test("serial URI audit can cross unchanged approval TTL after a quiet skip", async () => {
  const row = await scenario({ age: 59_000, stages: { audit: 35_400 } });
  assert.ok(row.maximumAge >= 94_400);
  assert.ok(row.calls.indexOf("refresh") < row.calls.indexOf("audit"));
  assert.equal(row.calls.filter((value) => value === "refresh").length, 1);
});

test("serial enqueue or publication work is an independent possible delay", async () => {
  for (const stages of [{ enqueue: 35_400 }, { jobs: 35_400 }]) {
    const row = await scenario({ age: 59_000, stages });
    assert.ok(row.maximumAge >= 94_400);
    assert.equal(row.calls.filter((value) => value === "refresh").length, 1);
  }
});

test("point check latency alone can exhaust the remaining 30-second margin", async () => {
  const row = await scenario({ age: 60_000, refreshMs: 35_400 });
  assert.equal(row.maximumAge, 95_400);
});

test("diagnostic preserves actual loop source and never claims a live cause", () => {
  assert.match(createHash("sha256").update(worker).digest("hex"), /^[a-f0-9]{64}$/);
  assert.ok(loop.includes("await refreshNativeBaseMetadata(pool, nativeBase)"));
  assert.ok(loop.includes("nextBase = Date.now() + (nativeBase ? 2000 : 15000)"));
  assert.ok(loop.includes("await auditArchiveUris(pool, readSchemaName, resolveUri)"));
});

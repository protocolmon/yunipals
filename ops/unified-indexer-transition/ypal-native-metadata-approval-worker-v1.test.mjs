// Candidate scheduling controls. All clock, RPC, database and signal boundaries
// are fixtures. The original native refresh/schema programs remain unchanged.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startNativeApproval, INTERVAL_MS } from "./ypal-native-metadata-approval-scheduler-v1.mjs";
import { workerSource, SCHEDULER_FILE } from "./ypal-native-metadata-approval-worker-v1.mjs";

const require = createRequire(new URL("../../apps/yunipals-indexer/package.json", import.meta.url));
const ts = require("typescript");
const original = readFileSync(new URL("../../apps/yunipals-indexer/lib/metadata/archive-worker.ts", import.meta.url));
const rewritten = workerSource(original, "./" + SCHEDULER_FILE);
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

class Clock {
  now = 0;
  next = 0;
  timers = new Map();
  set = (callback, delay) => { const id = ++this.next; this.timers.set(id, { at: this.now + delay, callback }); return id; };
  clear = (id) => this.timers.delete(id);
  sleep = (ms) => new Promise((resolve) => this.set(resolve, ms));
  async advance(ms) {
    const target = this.now + ms;
    for (;;) {
      await drain();
      const ready = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!ready.length || ready[0][1].at > target) break;
      const [id, value] = ready[0]; this.timers.delete(id); this.now = value.at; value.callback();
    }
    this.now = target; await drain();
  }
}

function virtualWorker() {
  const source = ts.createSourceFile("candidate.ts", rewritten, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let text = rewritten;
  for (const item of [...source.statements].reverse()) if (ts.isImportDeclaration(item)) text = text.slice(0, item.pos) + text.slice(item.end);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return new (async function () {}).constructor("fixture", `const {${[
    "startNativeApproval", "createPublicClient", "http", "mainnet", "base", "polygon", "bsc", "pool", "readSchemaName",
    "collections", "collectionAbi", "baseRpcUrlOf", "polygonRpcUrlOf", "bnbRpcUrlOf", "safeErrorMessage",
    "enqueuePublications", "enqueueNativeBasePublications", "claimPublications", "publishJob", "replayBaseMetadata",
    "auditArchiveUris", "consumeBaseMetadataPage", "baseMetadataIngestionMode", "baseMetadataPointRpc", "unifiedBaseRuntime",
    "refreshNativeBaseMetadata", "process", "Date", "setTimeout", "console"
  ].join(",")}}=fixture;\n${js}`);
}

async function workerFixture({ blocked = "audit", delay = 94_400, role = "full", mode = "native", refreshDelay = 100, failFirst = false, reportFails = false } = {}) {
  const clock = new Clock(), signals = new Map(), trace = [];
  let approvalAt = 0, refreshes = 0, active = 0, maximumActive = 0, closed = 0;
  const stage = (name) => async () => { trace.push([name, clock.now]); if (blocked === name) await clock.sleep(delay); };
  const pool = { query: async (sql) => { trace.push([sql.includes("base_error=") ? "base-report" : "worker-report", clock.now]); return {}; },
    end: async () => { assert.equal(active, 0, "pool cannot close during approval"); trace.push(["pool-close", clock.now]); closed++; } };
  const fixture = {
    startNativeApproval: (task, options) => startNativeApproval(task, { ...options, setTimer: clock.set, clearTimer: clock.clear }),
    pool, process: { env: { METADATA_WORKER_ROLE: role }, on: (name, callback) => signals.set(name, callback) },
    Date: { now: () => clock.now }, setTimeout: clock.set,
    console: { error: (...args) => { if (reportFails) throw Error("fixture-report-failed"); trace.push(["error", clock.now, args[0]]); } },
    createPublicClient: () => ({ readContract: async () => "fixture-uri" }), http: () => ({}), mainnet: {}, base: {}, polygon: {}, bsc: {},
    readSchemaName: "fixture", collections: {}, collectionAbi: [], baseRpcUrlOf: () => "fixture", polygonRpcUrlOf: () => "fixture", bnbRpcUrlOf: () => "fixture",
    safeErrorMessage: () => "fixture-error", baseMetadataIngestionMode: () => mode, baseMetadataPointRpc: () => ({}),
    unifiedBaseRuntime: () => ({ reader: async () => ({}), rpc: {}, close: async () => trace.push(["unified-close", clock.now]) }),
    consumeBaseMetadataPage: stage("unified"), replayBaseMetadata: stage("legacy"),
    enqueueNativeBasePublications: stage("native-enqueue"), enqueuePublications: stage("enqueue"), auditArchiveUris: stage("audit"),
    claimPublications: async () => blocked === "job" ? [{}] : [], publishJob: stage("job"),
    refreshNativeBaseMetadata: async (actualPool) => {
      assert.equal(actualPool, pool); active++; maximumActive = Math.max(maximumActive, active); refreshes++;
      trace.push(["refresh", clock.now]);
      try {
        if (failFirst && refreshes === 1) throw Error("fixture-native-check-failed");
        if (clock.now - approvalAt >= 60_000 || refreshDelay > 1_000) {
          await clock.sleep(refreshDelay); approvalAt = clock.now;
        }
      } finally { active--; }
    }
  };
  let rejection;
  const completed = virtualWorker()(fixture).catch((error) => { rejection = error; });
  await drain();
  return { clock, signals, trace, completed, get approvalAt() { return approvalAt; }, get active() { return active; },
    get refreshes() { return refreshes; }, get maximumActive() { return maximumActive; }, get closed() { return closed; }, get rejection() { return rejection; } };
}

test("source transform retains original approval/canonical code and rejects any other template", () => {
  assert.equal(INTERVAL_MS, 2_000);
  assert.ok(rewritten.includes('if (role === "full" && !nativeBase && Date.now() >= nextBase)'));
  assert.equal(rewritten.split("await refreshNativeBaseMetadata(pool, nativeBase)").length, 3); // retained task in each mutually exclusive branch
  assert.throws(() => workerSource(Buffer.concat([original, Buffer.from("\n")]), "./" + SCHEDULER_FILE), /exact_frozen/);
  assert.throws(() => workerSource(original, "foreign"), /literal_native_approval/);
});

test("single task remains nonoverlapping even when it exceeds the two-second interval", async () => {
  const clock = new Clock(); let active = 0, maximum = 0, calls = 0;
  const owner = startNativeApproval(async () => { calls++; active++; maximum = Math.max(maximum, active); await clock.sleep(12_000); active--; },
    { setTimer: clock.set, clearTimer: clock.clear });
  await clock.advance(10_000); assert.equal(calls, 1); assert.equal(active, 1);
  owner.requestStop(); await clock.advance(2_000); await owner.stop();
  assert.equal(calls, 1); assert.equal(maximum, 1); assert.equal(clock.timers.size, 0);
});

test("native approval continues during slow awaited enqueue, audit and publication work", async () => {
  for (const blocked of ["native-enqueue", "enqueue", "audit", "job"]) {
    const row = await workerFixture({ blocked }); let maximumAge = 0;
    for (let seconds = 0; seconds < 92; seconds++) { await row.clock.advance(1_000); maximumAge = Math.max(maximumAge, row.clock.now - row.approvalAt); }
    assert.ok(maximumAge < 90_000, blocked); assert.ok(row.refreshes >= 30); assert.equal(row.maximumActive, 1);
    row.signals.get("SIGTERM")(); const count = row.refreshes;
    await row.clock.advance(100_000); await row.completed;
    assert.equal(row.refreshes, count); assert.equal(row.closed, 1); assert.equal(row.rejection, undefined);
  }
});

test("native failures retain existing error reporting and retry without overlap", async () => {
  const row = await workerFixture({ failFirst: true }); await row.clock.advance(4_000);
  assert.ok(row.refreshes >= 2); assert.ok(row.trace.some(([label]) => label === "error")); assert.equal(row.maximumActive, 1);
  row.signals.get("SIGINT")(); await row.clock.advance(100_000); await row.completed; assert.equal(row.closed, 1);
});

test("shutdown joins the actual inflight task before pool close and is idempotent", async () => {
  const row = await workerFixture({ blocked: "none", refreshDelay: 12_000 });
  await row.clock.advance(500); row.signals.get("SIGTERM")(); await row.clock.advance(2_000);
  assert.equal(row.closed, 0); assert.equal(row.active, 1);
  await row.clock.advance(10_000); await row.completed;
  assert.equal(row.active, 0); assert.equal(row.closed, 1); assert.equal(row.refreshes, 1);
  const clock = new Clock(), owner = startNativeApproval(async () => {}, { setTimer: clock.set, clearTimer: clock.clear });
  await drain(); owner.requestStop(); await owner.stop(); await owner.stop(); assert.equal(clock.timers.size, 0);
});

test("publish-only and unified modes do not start native approval", async () => {
  for (const settings of [{ role: "publish-only" }, { mode: "unified" }, { mode: "rpc" }]) {
    const row = await workerFixture({ ...settings, blocked: "none" }); await row.clock.advance(2_000);
    row.signals.get("SIGTERM")(); await row.clock.advance(4_000); await row.completed;
    assert.equal(row.refreshes, 0); assert.equal(row.closed, 1); assert.equal(row.rejection, undefined);
  }
});

test("a fatal background reporter failure is preserved and cannot skip pool shutdown", async () => {
  const row = await workerFixture({ blocked: "none", failFirst: true, reportFails: true });
  row.signals.get("SIGTERM")(); await row.clock.advance(4_000); await row.completed;
  assert.equal(row.closed, 1); assert.equal(row.refreshes, 1); assert.match(row.rejection?.message, /fixture-report-failed/);
});

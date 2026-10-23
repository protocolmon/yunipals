import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { candidate, execute, official, INPUT, RELEASE_ID, CATALOG_SQL } from "./ypal-combined-release-register-v1.mjs";

const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const api = await official(root);
const profile = readFileSync(root + "/ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json");
const release = candidate(api, profile);
function fixture() {
  const state = { releases: [{ id: "old", schema: "original", buildId: "old", manifestHash: "old", manifest: {} }], active: [], calls: [], sources: structuredClone(release.manifest.sources), onInsert: () => {} };
  let saved;
  const db = { release() {}, async query(sql, params = []) {
    state.calls.push(sql);
    if (sql.startsWith("BEGIN")) { saved = structuredClone({ releases: state.releases, active: state.active }); return { rows: [] }; }
    if (sql === "ROLLBACK") { if (saved) Object.assign(state, saved); saved = undefined; return { rows: [] }; }
    if (sql === "COMMIT") { saved = undefined; return { rows: [] }; }
    if (sql.startsWith("SET LOCAL") || sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
    if (sql === CATALOG_SQL) return { rows: [{ value: { database: "yunipals_backfill", user: "postgres", client: null, schemaOid: "75963410", releases: structuredClone(state.releases), active: structuredClone(state.active) } }] };
    if (sql.includes("SELECT value AS app")) return { rows: [{ app: { version: "6", build_id: INPUT.buildId, heartbeat_at: Date.now(), is_ready: 0, is_locked: 1, is_dev: 0 }, checkpoints: [], witnesses: [] }] };
    if (sql.includes("SELECT id,chain_id,manifest_hash,definition FROM")) return { rows: state.sources.map((source) => ({ id: source.id, chain_id: source.chainId, manifest_hash: release.manifestHash, definition: JSON.stringify(source) })) };
    if (sql.startsWith("INSERT INTO yunipals_indexer_control.release")) {
      const [id, schema, buildId, manifestHash, manifest] = params;
      state.releases.push({ id, schema, buildId, manifestHash, manifest: JSON.parse(manifest) }); state.onInsert(); return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id,manifest FROM yunipals_indexer_control.release")) return { rows: state.releases.filter((row) => row.schema === params[0]).map(({ id, manifest }) => ({ id, manifest })) };
    throw Error("Unexpected SQL in actual official-function fixture: " + sql);
  } };
  return { state, pool: { connect: async () => db } };
}
test("exact admitted manifest derives the real combined candidate identity", () => {
  assert.equal(release.id, RELEASE_ID); assert.equal(release.manifest.sources.length, 12);
  assert.throws(() => candidate(api, Buffer.concat([profile, Buffer.from(" ")])));
  const booster = release.manifest.sources.filter((row) => row.feature === "boosters");
  assert.deepEqual(booster.map((row) => row.startBlock).sort(), ["52995007", "52995029", "52995174"]);
});
test("official review accepts running unready bootstrap and performs no write", async () => {
  const f = fixture(); const value = await execute(f.pool, api, release, "review");
  assert.equal(value.targetRegistered, false); assert.equal(value.activated, false);
  assert.equal(f.state.calls.some((sql) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)), false);
});
test("rollback rehearsal executes actual official insertion but retains all original state", async () => {
  const f = fixture(); const old = structuredClone(f.state.releases);
  const before = await execute(f.pool, api, release, "review");
  const result = await execute(f.pool, api, release, "rehearse", before.reviewHash);
  assert.equal(result.databaseCommitted, false); assert.equal(result.registered, false);
  assert.deepEqual(f.state.releases, old); assert.equal(f.state.calls.filter((s) => s.startsWith("INSERT")).length, 1);
});
test("official commit adds only exact candidate; read-only reconcile authenticates unknown ACK", async () => {
  const f = fixture(); const before = await execute(f.pool, api, release, "review");
  const result = await execute(f.pool, api, release, "commit", before.reviewHash);
  assert.equal(result.registered, true); assert.equal(f.state.releases.length, 2); assert.deepEqual(f.state.active, []);
  const inserted = f.state.calls.filter((s) => s.startsWith("INSERT")).length;
  assert.equal((await execute(f.pool, api, release, "reconcile", before.reviewHash)).registered, true);
  assert.equal(f.state.calls.filter((s) => s.startsWith("INSERT")).length, inserted);
  await assert.rejects(() => execute(f.pool, api, release, "commit", before.reviewHash));
});
test("changed selector or unrelated release refuses stale review before insertion", async () => {
  for (const change of [(s) => s.active.push({ name: "main", release_id: "changed" }), (s) => s.releases[0].manifest = { changed: true }]) {
    const f = fixture(); const before = await execute(f.pool, api, release, "review"); change(f.state);
    await assert.rejects(() => execute(f.pool, api, release, "commit", before.reviewHash));
    assert.equal(f.state.calls.some((sql) => sql.startsWith("INSERT")), false);
  }
});
test("changed source definition refuses official readBoundRuntime", async () => {
  const f = fixture(); f.state.sources[0].startBlock = "1";
  await assert.rejects(() => execute(f.pool, api, release, "review"), /source definition/);
});
test("post-insertion invariant change rolls the official transaction back", async () => {
  const f = fixture(); const before = await execute(f.pool, api, release, "review");
  f.state.onInsert = () => f.state.active.push({ name: "main", release_id: RELEASE_ID });
  await assert.rejects(() => execute(f.pool, api, release, "commit", before.reviewHash));
  assert.equal(f.state.releases.length, 1); assert.deepEqual(f.state.active, []);
});
test("missing commit cannot be reconciled or silently retried", async () => {
  const f = fixture(); const before = await execute(f.pool, api, release, "review");
  await assert.rejects(() => execute(f.pool, api, release, "reconcile", before.reviewHash));
  assert.equal(f.state.calls.some((sql) => sql.startsWith("INSERT")), false);
});

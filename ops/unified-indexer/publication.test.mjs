import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as owner from "./publication.mjs";
import { hash } from "./configure-readers.mjs";
import * as reader from "../unified-indexer-transition/ypal-ordinary-reader-sql-v6.mjs";
const clone = structuredClone;
function fixture() {
  const release = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3", identity = "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab";
  const snapshot = { releaseId: release, readIdentity: identity, anchors: [{ chain_id: 1, block_number: "26236452" }, { chain_id: 56, block_number: "128816538" }, { chain_id: 137, block_number: "95883932" }, { chain_id: 8453, block_number: "52870977" }] };
  const stamp = name => ({ name, metadataRelease: "archive-20261026", sourceRelease: release, readIdentity: identity });
  const observation = { pointer: { current: "103", previous: "102" }, candidate: { id: "106", state: "ready", sourceMode: "archive", metadataRelease: "archive-20261026", sourceRelease: release, readIdentity: identity, published: false, validationSha256: "a".repeat(64) }, archive: "archive-20261026", walletStats: { rows: "1", sha256: "a".repeat(64) }, stamps: [{ ...stamp("leaderboard"), metadataRelease: "old" }, { ...stamp("traits"), metadataRelease: "old" }] };
  const old = clone(observation); old.candidate.id = "105";
  const rows = [{ id: "103", value: { exactOldGeneration: 103 } }, { id: "105", value: { exactOldGeneration: 105 } }];
  const log = [], calls = []; let current = true;
  const db = { async query(sql, args) {
    log.push(sql);
    if (sql.startsWith("SELECT current_user")) return { rows: [{ current_user: "yunipals", session_user: "yunipals", role_oid: "16388", database_oid: "17584", port: "5432", address: "127.0.0.1" }] };
    if (sql.startsWith("SELECT id::text,to_jsonb")) return { rows: clone(rows) };
    if (sql.includes("'walletStats'")) return { rows: [{ value: clone(args[0] === "105" ? old : observation) }] };
    if (sql.includes("validation->'sourceSnapshot'")) return { rows: [{ value: clone(snapshot) }] };
    if (sql.includes(" AS accepted")) { assert.deepEqual(JSON.parse(args[0]), snapshot); return { rows: [{ accepted: current }] }; }
    if (sql.startsWith("SELECT pg_current_xact_id")) return { rows: [{ xid: "123" }] };
    if (sql.includes("FROM pg_stat_activity")) return { rows: [{ value: { pid: 222, backendStart: "456", roleOid: "16388", databaseOid: "17584" } }] };
    return { rows: [] };
  } };
  const official = {
    async retainProjectionAnchors(actual, value) { calls.push("retain"); assert.equal(actual, db); assert.deepEqual(value, snapshot); },
    async refreshProjectionGeneration(options) { calls.push("refresh"); assert.deepEqual(options, { publish: false }); return { prepared: true, predecessor: "103", generationId: "106" }; },
    async prepareNativeLeaderboardCandidate(actual, id) { calls.push("wallet"); assert.equal(actual, db); assert.equal(id, "106"); return { generationId: id, predecessor: "103", metadataReleaseId: observation.archive, sourceSnapshot: clone(snapshot), walletRows: "2", walletRowsSha256: "b".repeat(64) }; },
    async stagePreparedNativeLeaderboard(actual, handle) { calls.push("stage"); assert.equal(actual, db); observation.walletStats = { rows: handle.walletRows, sha256: handle.walletRowsSha256 }; observation.stamps[0] = stamp("leaderboard"); },
    async publishGenerationInTransaction(actual, id, archive, predecessor, proof) { calls.push("CAS"); assert.equal(actual, db); assert.equal(id, "106"); assert.equal(predecessor, "103"); assert.equal(archive, observation.archive); assert.deepEqual(proof, snapshot); observation.pointer = { current: "106", previous: "103" }; observation.candidate.published = true; observation.stamps[1] = stamp("traits"); }
  };
  const modules = { reader, official, cache: { approval: async () => calls.push("native120") } };
  return { db, modules, calls, log, rows, invalid: () => current = false };
}
test("source predicate equals the complete genuine TypeScript builder", () => {
  const raw = readFileSync(new URL("../../apps/yunipals-indexer/lib/metadata/projection-snapshot.ts", import.meta.url), "utf8");
  assert.equal(hash(raw), "94e724f9b3b198fe18b7115d600936dc0c110f9ee2416167ca06129ed6890203");
  const start = raw.indexOf("export function projectionPublicationSourcePredicate"), end = raw.indexOf("/** Retain rollback predecessors", start);
  const source = raw.slice(start, end).trim().replace("export function", "function").replace("parameter: string", "parameter");
  const original = new Function("ponderSchema", "physicalPonderSchema", source + ";return projectionPublicationSourcePredicate;")('"yunipals_ownership_4e77f52b_v5"', '"unified_ypal_20261023_v1"');
  for (const parameter of ["$1", "$22"]) assert.equal(owner.publicationSourcePredicate(parameter), original(parameter));
  for (const parameter of ["$0", "literal", "$1;DROP"]) { assert.throws(() => owner.publicationSourcePredicate(parameter)); assert.throws(() => original(parameter)); }
});
test("official unpublished prepare preserves103/105 and returns actual fresh plan", async () => {
  const prior = process.env.PROJECTION_PRESERVE_GENERATION_IDS; process.env.PROJECTION_PRESERVE_GENERATION_IDS = "103,105";
  try { const f = fixture(), value = await owner.prepare(f.db, f.modules); assert.equal(value.generationId, "106"); assert.equal(value.published, false); assert.equal(value.plan.generationId, "106"); assert.deepEqual(f.calls, ["native120", "refresh", "native120"]); assert(!f.calls.includes("CAS")); }
  finally { if (prior === undefined) delete process.env.PROJECTION_PRESERVE_GENERATION_IDS; else process.env.PROJECTION_PRESERVE_GENERATION_IDS = prior; }
});
test("complete retained publication body performs private build,stage,CAS and two ACKs", async () => {
  const f = fixture(), plan = await owner.actualPlan(f.db, reader, "106"), phases = [];
  const value = await owner.publish(f.db, f.modules, plan, async phase => { phases.push(phase); return true; });
  assert.equal(value.completed, true); assert.equal(value.publication.after.pointer.current, "106");
  assert.deepEqual(phases, ["wallet-private-prepared", "publication-prepared"]);
  assert.deepEqual(f.calls, ["retain", "native120", "wallet", "retain", "retain", "stage", "CAS"]); assert.equal(f.log.filter(sql => sql === "COMMIT").length, 2);
  assert(!f.log.some(sql => /GRANT |ALTER ROLE/.test(sql)));
});
test("aged canonical snapshot fails before wallet computation or publication", async () => {
  const f = fixture(), plan = await owner.actualPlan(f.db, reader, "106"); f.invalid();
  await assert.rejects(owner.publish(f.db, f.modules, plan, async () => true), /anchors_must_be_current/);
  assert(!f.calls.includes("wallet")); assert(!f.log.some(sql => sql.startsWith("BEGIN")));
});
test("old105 and changed immutable105 rows are refused", async () => {
  const f = fixture(); await assert.rejects(owner.actualPlan(f.db, reader, "105"));
  const prior = process.env.PROJECTION_PRESERVE_GENERATION_IDS; process.env.PROJECTION_PRESERVE_GENERATION_IDS = "103,105";
  f.modules.official.refreshProjectionGeneration = async () => { f.rows[1].value.exactOldGeneration = "changed"; return { prepared: true, predecessor: "103", generationId: "106" }; };
  try { await assert.rejects(owner.prepare(f.db, f.modules), /103_and_105/); }
  finally { if (prior === undefined) delete process.env.PROJECTION_PRESERVE_GENERATION_IDS; else process.env.PROJECTION_PRESERVE_GENERATION_IDS = prior; }
});

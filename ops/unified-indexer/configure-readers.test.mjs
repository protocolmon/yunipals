import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as cold from "./configure-readers.mjs";
import * as cacheOriginal from "../unified-indexer-transition/ypal-ordinary-cache-two-phase-v1.mjs";
import * as reader from "../unified-indexer-transition/ypal-ordinary-reader-sql-v6.mjs";

const clone = structuredClone;
function fixture() {
  const names = ["read_epoch", "read_guard", "read_set", "read_member"].map(name => "metadata_projection." + name);
  const grants = names.map(name => ({ name, grantor: "16388", grantee: "73187672", role: "yunipals_unified_collector", privilege: "SELECT", grantable: false }));
  const state = { guards: [{ explicitGuardIO: true }], epochs: ["base", "bnb", "ethereum", "polygon"].map(collection => ({ collection, revision: "4" })), tables: names.map((name, index) => ({ name, oid: String(index + 100) })), acl: [], columnAcl: [], functions: [{ explicitDefinitionIO: true }], triggers: [{ explicitTriggerIO: true }] };
  const full = { roles: Object.entries(reader.LOGIN_ROLES).map(([name, oid]) => ({ name, oid, login: false })), directRoleEdges: [], relations: names.map(name => ({ schema: "metadata_projection", name: name.split(".")[1], acl: null })), effective: [{ role: "yunipals_unified_collector", relations: Object.fromEntries(names.map(name => [name, { select: false, writes: [] }])) }], schemas: [{ exactUnrelated: true }], functions: [{ exactNative120Definition: true }] };
  const target = cacheOriginal.catalog({ ...clone(state), acl: clone(grants) });
  const log = [], acked = [], columns = [{ explicitGlobalColumnIO: true }];
  let valid = true, stale = false, wrongDB = false;
  const db = { async query(sql, args) {
    log.push(sql);
    if (sql.startsWith("SELECT current_user")) return { rows: [{ current_user: "postgres", session_user: "postgres", role_oid: "10", database_oid: wrongDB ? "15438" : "17584", port: "5432", address: null }] };
    if (sql === "CATALOG") return { rows: [{ value: clone(full) }] };
    if (sql === "COLUMNS") return { rows: [{ value: clone(columns) }] };
    if (sql.includes("FROM unnest(ARRAY['ethereum'")) return { rows: [{ value: ["base", "bnb", "ethereum", "polygon"].map(collection => ({ collection, ready: valid })) }] };
    if (sql.startsWith("WITH wanted")) return { rows: [{ value: { valid } }] };
    if (sql.startsWith("WITH stamp")) { const at = BigInt(Date.now()) * 1000n; return { rows: [{ value: { atUs: String(at), checkedUs: String(at - (stale ? 121_000_000n : 1_000_000n)), release: cacheOriginal.RELEASE, identity: cacheOriginal.IDENTITY, state: "ready", implementation: cacheOriginal.IMPLEMENTATION, errorCode: null, frontier: "same", frameFrontier: "same", checkedBlock: "7", frameBlock: "8", checkedHash: "0x" + "a".repeat(64), frameHash: "0x" + "b".repeat(64), probe: true, nativeMode: true, canonical: true } }] }; }
    if (sql.startsWith("SELECT release_id")) return { rows: [{ release_id: args[0] }] };
    if (sql.startsWith("SELECT pg_current_xact_id")) return { rows: [{ xid: "123" }] };
    if (sql.includes("FROM pg_stat_activity")) return { rows: [{ value: { pid: 111, backendStart: "123", roleOid: "10", databaseOid: "17584" } }] };
    if (sql.startsWith("GRANT SELECT")) {
      const grant = grants.find(row => sql.includes('"' + row.name.split(".")[1] + '"')); assert(grant); state.acl.push(clone(grant));
      full.directRoleEdges.push({ kind: "relation", object: state.tables.find(row => row.name === grant.name).oid, object_name: grant.name, grantee: grant.grantee, grantor: grant.grantor, privilege: "SELECT", grantable: false, column_number: null });
      full.relations.find(row => row.schema + "." + row.name === grant.name).acl = "explicit new table ACL";
      full.effective[0].relations[grant.name].select = true;
    }
    if (sql.startsWith("ALTER ROLE")) full.roles.find(row => sql.includes('"' + row.name + '"')).login = true;
    return { rows: [] };
  } };
  const snapshot = { releaseId: cacheOriginal.RELEASE, readIdentity: cacheOriginal.IDENTITY, anchors: [{ chain_id: 1, block_number: "26236452" }, { chain_id: 56, block_number: "128816538" }, { chain_id: 137, block_number: "95883932" }, { chain_id: 8453, block_number: "52870977" }] };
  const stamp = name => ({ name, metadataRelease: "archive-20261026", sourceRelease: cacheOriginal.RELEASE, readIdentity: cacheOriginal.IDENTITY });
  const observation = { pointer: { current: "103", previous: "102" }, candidate: { id: "105", state: "ready", sourceMode: "archive", metadataRelease: "archive-20261026", sourceRelease: cacheOriginal.RELEASE, readIdentity: cacheOriginal.IDENTITY, published: false, validationSha256: "a".repeat(64) }, archive: "archive-20261026", walletStats: { rows: "1", sha256: "a".repeat(64) }, stamps: [{ ...stamp("leaderboard"), metadataRelease: "old" }, { ...stamp("traits"), metadataRelease: "old" }] };
  const publication = { generationId: "105", predecessorGenerationId: "103", metadataReleaseId: observation.archive, sourceRelease: cacheOriginal.RELEASE, readIdentity: cacheOriginal.IDENTITY, validationSqlSha256: "a".repeat(64), originalObservationSha256: cold.hash(JSON.stringify(observation)), candidateSourceSnapshot: snapshot, boundaryPoints: [{ chainId: 1, number: "26236452" }, { chainId: 56, number: "128816538" }, { chainId: 137, number: "95883932" }, { chainId: 8453, number: "52870956" }, { chainId: 8453, number: "52870977" }] };
  const businessLog = [];
  const business = { async query(sql) {
    businessLog.push(sql);
    if (sql.startsWith("SELECT current_user")) return { rows: [{ current_user: "yunipals", session_user: "yunipals", role_oid: "16388", database_oid: "17584", port: "5432", address: "127.0.0.1" }] };
    if (sql.includes("'walletStats'")) return { rows: [{ value: clone(observation) }] };
    if (sql.includes("validation->'sourceSnapshot'")) return { rows: [{ value: clone(snapshot) }] };
    if (sql.startsWith("SELECT pg_current_xact_id")) return { rows: [{ xid: "456" }] };
    if (sql.includes("FROM pg_stat_activity")) return { rows: [{ value: { pid: 222, backendStart: "456", roleOid: "16388", databaseOid: "17584" } }] };
    return { rows: [] };
  } };
  const official = {
    async prepareNativeLeaderboardCandidate(actual, generation) { assert.equal(actual, business); assert.equal(generation, "105"); return { generationId: "105", predecessor: "103", metadataReleaseId: observation.archive, sourceSnapshot: clone(snapshot), walletRows: "2", walletRowsSha256: "b".repeat(64) }; },
    async stagePreparedNativeLeaderboard(actual, handle) { assert.equal(actual, business); observation.walletStats = { rows: handle.walletRows, sha256: handle.walletRowsSha256 }; observation.stamps[0] = stamp("leaderboard"); },
    async publishGenerationInTransaction(actual, generation, release, predecessor, source) { assert.equal(actual, business); assert.equal(generation, "105"); assert.equal(predecessor, "103"); assert.equal(release, observation.archive); assert.deepEqual(source, snapshot); observation.pointer = { current: "105", previous: "103" }; observation.candidate.published = true; observation.stamps[1] = stamp("traits"); }
  };
  const input = { format: cold.FORMAT, grants, targetCatalog: target, readCatalogBefore: clone(full), publication };
  const modules = { cache: { ...cacheOriginal, capture: async () => clone(state) }, reader, official, catalogSql: "CATALOG", columnSql: "COLUMNS" };
  return { input, modules, db, business, log, businessLog, full, state, acked, ack: async (phase, value) => { acked.push([phase, clone(value)]); return true; }, invalid: () => valid = false, stale: () => stale = true, wrongDB: () => wrongDB = true };
}

test("inert default and exact input allowlist", async () => {
  let output; const original = console.log; console.log = value => { output = value; };
  try { await cold.main([]); } finally { console.log = original; }
  assert.equal(JSON.parse(output).staticOnly, true); assert.equal(typeof cold.APPLY_REVIEWED, "boolean");
  const f = fixture(); cold.validateInput(f.input);
  for (const mutate of [value => value.grants[0].role = "postgres", value => value.publication.generationId = "106", value => value.extra = true]) { const bad = clone(f.input); mutate(bad); assert.throws(() => cold.validateInput(bad)); }
});
test("real retained LOGIN and publication bodies execute complete cold sequence", async () => {
  const f = fixture(); const result = await cold.configure(f.db, f.business, f.input, f.modules, f.ack);
  assert.equal(result.completed, true); assert.equal(result.oldWarmACKClaimed, false); assert.equal(result.publication.after.pointer.current, "105");
  assert.deepEqual(f.acked.map(row => row[0]), ["cache-selects-prepared", "reader-logins-prepared", "wallet-private-prepared", "generation-publication-prepared"]);
  assert.equal(f.log.filter(sql => sql.startsWith("GRANT SELECT")).length, 4); assert.equal(f.log.filter(sql => sql.startsWith("ALTER ROLE")).length, 2);
  assert.equal(f.businessLog.filter(sql => sql === "COMMIT").length, 2);
});
test("wrong database, stale120 approval and invalid native guard block SELECT activation", async () => {
  for (const mutate of [f => f.wrongDB(), f => f.stale(), f => f.invalid()]) { const f = fixture(); mutate(f); await assert.rejects(cold.activateCache(f.db, f.input, f.modules, f.ack)); assert.equal(f.log.filter(sql => sql.startsWith("GRANT SELECT")).length, 0); }
});
test("full READ baseline and global column drift refuse before COMMIT", async () => {
  const f = fixture(); f.full.schemas.push({ foreign: true }); await assert.rejects(cold.activateCache(f.db, f.input, f.modules, f.ack)); assert(!f.log.includes("COMMIT"));
  const g = fixture(); const before = clone(g.input.readCatalogBefore), after = clone(before); after.roles[0].login = true;
  assert.throws(() => cold.readDelta(before, after, g.input.grants, g.state.tables));
});
test("literal Root ACK refusal rolls back without sending COMMIT", async () => {
  const f = fixture(); await assert.rejects(cold.activateCache(f.db, f.input, f.modules, async () => false)); assert(f.log.includes("ROLLBACK")); assert(!f.log.includes("COMMIT"));
});
test("official publication rejects wrong snapshot and never republished by wrapper", async () => {
  const f = fixture(); f.input.publication.originalObservationSha256 = "f".repeat(64);
  await assert.rejects(cold.configure(f.db, f.business, f.input, f.modules, f.ack));
  assert.equal(f.businessLog.filter(sql => sql === "COMMIT").length, 0); assert(f.businessLog.includes("ROLLBACK"));
});
test("readonly planner produces literal exact observation identity without effects", async () => {
  const f = fixture(); const seed = { format: cold.FORMAT, grants: f.input.grants, targetCatalog: f.input.targetCatalog, readCatalogBefore: f.input.readCatalogBefore };
  const value = await cold.plan(f.db, f.business, seed, f.modules);
  assert.equal(value.publication.originalObservationSha256, f.input.publication.originalObservationSha256);
  assert.equal(f.log.filter(sql => /^(GRANT|ALTER)/.test(sql)).length, 0); assert.equal(f.acked.length, 0);
});
test("in-memory public column SQL requires the exact pinned bytes", () => {
  const raw = readFileSync(new URL("../unified-indexer-transition/ypal-restored-read-admission-v1.columns.sql", import.meta.url));
  assert.deepEqual(cold.publicColumnBytes(raw.toString()), raw);
  for (const value of [raw.toString() + " ", false, "x".repeat(100001)]) assert.throws(() => cold.publicColumnBytes(value));
});

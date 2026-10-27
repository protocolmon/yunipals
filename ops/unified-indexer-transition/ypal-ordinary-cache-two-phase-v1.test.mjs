// Original Node transport and new phase contracts with explicit PG/installer I/O fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as original from "./ypal-ordinary-cache-transition-v5.mjs";
import * as phase from "./ypal-ordinary-cache-two-phase-v1.mjs";
import { execute } from "./ypal-ordinary-cache-two-phase-driver-v1.mjs";
const root = fileURLToPath(new URL("./", import.meta.url));
const copy = value => structuredClone(value);
const collections = ["base", "bnb", "ethereum", "polygon"];
const reader = { name: "explicit_reader_fixture", oid: "12345" };
const grants = ["read_epoch", "read_guard", "read_set", "read_member"].map(name => ({ name: "metadata_projection." + name, grantor: "10", grantee: reader.oid, role: reader.name, privilege: "SELECT", grantable: false }));
function fixture() {
  const before = { guards: [{ collection: "base", relation: "old-guard", oid: "100" }], epochs: collections.map(collection => ({ collection, revision: "10" })),
    tables: original.relations.map((name, index) => ({ name, oid: String(index + 200), owner: "10", relkind: "r", columns: [], indexes: [] })),
    acl: [], columnAcl: [], functions: [{ oid: "1", name: "dirty", owner: "10", acl: null, definition: "old-dirty" }, { oid: "2", name: "projection", owner: "10", acl: null, definition: "old-projection" }], triggers: [{ relation: "old-guard", name: "old", enabled: "A", definition: "old-trigger" }] };
  const after = { ...copy(before), guards: Array.from({ length: 35 }, (_, index) => ({ collection: collections[index % 4], relation: "guard-" + index, oid: String(1000 + index) })),
    epochs: before.epochs.map(row => ({ ...row, revision: "11" })), acl: copy(grants), functions: before.functions.map(row => ({ ...row, definition: "installed-" + row.name })),
    triggers: Array.from({ length: 42 }, (_, index) => ({ relation: "guard-" + index, name: "trigger-" + index, enabled: "A", definition: "installed-trigger-" + index })) };
  const old = { format: "yunipals-ypal-cache-guard-transition-v1", binding: original.binding, before, after, addedSelects: grants,
    beforeCatalogSha256: original.digest(original.catalog(before)), afterCatalogSha256: original.digest(original.catalog(after)), committed: false, officialRollbackRehearsed: true };
  const plan = { ...old, phase: "prepare-guards", originalPlanJson: JSON.stringify(old), preparationReceiptJson: null, verificationFence: null };
  const db = new Fake(before); return { before, after, old, plan, db };
}
const approval = () => ({ atUs: "10000000", checkedUs: "9000000", release: phase.RELEASE, identity: phase.IDENTITY, state: "ready", errorCode: null,
  probe: true, nativeMode: true, canonical: true, frontier: "same-frontier", frameFrontier: "same-frontier", implementation: phase.IMPLEMENTATION,
  checkedBlock: "10", frameBlock: "11", checkedHash: "0x" + "a".repeat(64), frameHash: "0x" + "b".repeat(64) });
class Fake {
  constructor(state) { this.state = copy(state); this.queries = []; this.snapshot = null; this.visibleCommits = []; this.approval = approval(); }
  async query(sql, values = []) {
    this.queries.push(sql); const text = sql.trim();
    if (text === "BEGIN") { this.snapshot = copy(this.state); return { rows: [] }; }
    if (text === "COMMIT") { this.visibleCommits.push(copy(this.state)); this.snapshot = null; return { rows: [] }; }
    if (text === "ROLLBACK") { if (this.snapshot) this.state = this.snapshot; this.snapshot = null; return { rows: [] }; }
    if (text.includes("pg_current_xact_id")) return { rows: [{ xid: "123" }] };
    if (text.includes("FROM pg_stat_activity")) return { rows: [{ value: { pid: 123, backendStart: "456", databaseOid: "17584", roleOid: "10" } }] };
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (text.startsWith("SELECT release_id FROM")) return { rows: [{ release_id: phase.RELEASE }] };
    if (text === phase.APPROVAL_SQL) return { rows: [{ jsonb_build_object: copy(this.approval) }] };
    if (text.startsWith("WITH wanted(collection")) return { rows: [{ jsonb_build_object: { valid: true } }] };
    if (text.startsWith("REVOKE SELECT")) { const row = grants.find(row => text.includes('"' + row.name.split(".")[1] + '"')); this.state.acl = this.state.acl.filter(item => item.name !== row.name); return { rows: [] }; }
    if (text.startsWith("GRANT SELECT")) { const row = grants.find(row => text.includes('"' + row.name.split(".")[1] + '"')); this.state.acl.push(copy(row)); return { rows: [] }; }
    const field = text.startsWith("SELECT collection,relation,") ? "guards" : text.startsWith("SELECT collection,revision") ? "epochs" : text.includes("pg_attribute a LEFT JOIN pg_attrdef") ? "tables" : text.includes("a.attnum AS column_number") ? "columnAcl" : text.includes("aclexplode(coalesce(c.relacl") ? "acl" : text.includes("pg_get_functiondef") ? "functions" : text.includes("pg_get_triggerdef") ? "triggers" : null;
    if (field) return { rows: copy(this.state[field]) };
    if (text.startsWith("SET ") || text.startsWith("LOCK TABLE ") || text.includes("pg_advisory_unlock")) return { rows: [] };
    throw Error("unexpected explicit PG fixture query: " + text.slice(0, 80));
  }
}
const proof = async () => ({ catalog: { explicitCurrentCatalogIOFixture: true }, reader: { explicitReadonlyReaderIOFixture: true }, allColumnAcl: [] });
async function preparedFixture(f) {
  let installed = 0; const packets = []; let opened = 0;
  const result = await execute(f.db, "apply", f.plan, async () => { installed++; f.db.state = copy(f.after); }, async packet => { packets.push(packet); return true; }, reader, proof, async () => { opened++; });
  assert.equal(installed, 1); assert.equal(opened, 1); assert.equal(packets.length, 1);
  assert.equal(packets[0].event, "commit-prepared"); assert.equal(packets[0].mode, "apply");
  assert.equal(packets[0].postProof.phaseContract.phase, "prepare-guards");
  assert.equal(result.result.oldC54CommitClaimed, false); assert.equal(result.result.readGrantsExternallyActivated, false);
  assert.equal(f.db.visibleCommits.length, 1); assert.deepEqual(f.db.visibleCommits[0].acl, []);
  assert.deepEqual(f.db.state.functions, f.after.functions); assert.equal(f.db.state.guards.length, 35); assert.equal(f.db.state.triggers.length, 42);
  assert.equal(f.db.queries.filter(sql => sql.startsWith("REVOKE SELECT")).length, 4);
  const state = copy(f.db.state);
  const plan = { ...f.plan, phase: "activate-reads", preparationReceiptJson: result.resultJson, verificationFence: {
    format: phase.FORMAT + "-verification-fence", preparationReceiptSha256: phase.digest(result.result), catalogSha256: phase.digest(phase.catalog(state)),
    epochs: copy(state.epochs), approvalSemantic: phase.semantic(f.db.approval), fullVerificationSha256: "f".repeat(64) } };
  return { plan, result, state };
}
let groups = 0;
{
  const f = fixture(); await preparedFixture(f); groups++;
}
{
  const f = fixture(); const { plan, state } = await preparedFixture(f); let packets = 0;
  const result = await execute(f.db, "apply", plan, () => { throw Error("activation must not reinstall"); }, async packet => {
    packets++; const p = packet.postProof.phaseContract; assert.equal(p.phase, "activate-reads"); assert.equal(p.approval.policyTTLSeconds, 120); assert.equal(p.approval.literalACKReserveSeconds, 5); assert.equal(p.approval.producerApprovalWrittenByThisGate, false); return true;
  }, reader, proof);
  assert.equal(packets, 1); assert.equal(result.result.readGrantsExternallyActivated, true); assert.equal(result.result.epochRowsIncremented, 0);
  assert.deepEqual(f.db.state.epochs, state.epochs); assert.deepEqual(f.db.state.acl, grants);
  assert.equal(f.db.queries.filter(sql => sql.startsWith("GRANT SELECT")).length, 4); groups++;
}
for (const field of ["epochs", "functions", "semantic"]) {
  const f = fixture(); const { plan } = await preparedFixture(f); f.db.queries = [];
  if (field === "epochs") f.db.state.epochs[0].revision = "12";
  if (field === "functions") f.db.state.functions[0].definition = "foreign-body";
  if (field === "semantic") f.db.approval.frontier = f.db.approval.frameFrontier = "different-frontier";
  await assert.rejects(execute(f.db, "apply", plan, () => { throw Error("no installer"); }, async () => true, reader, proof));
  assert.equal(f.db.queries.filter(sql => sql.startsWith("GRANT SELECT")).length, 0); groups++;
}
for (const which of ["prepare-guards", "activate-reads"]) {
  const f = fixture(); const p = which === "activate-reads" ? (await preparedFixture(f)).plan : f.plan;
  const before = copy(f.db.state); const error = new Error("lost literal ACK original error");
  await assert.rejects(execute(f.db, "apply", p, async () => { f.db.state = copy(f.after); }, async () => { throw error; }, reader, proof), actual => actual === error);
  assert.deepEqual(f.db.state, before); assert.equal(f.db.queries.filter(sql => sql === "ROLLBACK").length, 1); groups++;
}
for (const which of ["prepare-guards", "activate-reads"]) {
  const f = fixture(); const p = which === "activate-reads" ? (await preparedFixture(f)).plan : f.plan;
  const before = copy(f.db.state); const clock = process.hrtime.bigint; let offset = 0n;
  process.hrtime.bigint = () => clock() + offset;
  try {
    await assert.rejects(execute(f.db, "apply", p, async () => { f.db.state = copy(f.after); }, async () => { offset += 6000000000n; return true; }, reader, proof), /real_five_second_literal_ACK_tail/);
  } finally { process.hrtime.bigint = clock; }
  assert.deepEqual(f.db.state, before); groups++;
}
{
  const f = fixture(); f.plan.after.functions[0].definition = "fabricated-plan";
  await assert.rejects(execute(f.db, "apply", f.plan, async () => {}, async () => true, reader, proof)); assert.equal(f.db.queries.length, 0); groups++;
}
{
  const source = readFileSync(root + "ypal-ordinary-cache-continuation-authority-v1.py", "utf8");
  const expression = source.slice(source.indexOf('APPROVAL_SQL="""') + 'APPROVAL_SQL="""'.length, source.indexOf('\n\ndef approval_snapshot')).trim();
  assert(expression.endsWith('"""'));
  const sql = expression.slice(0, -3).replace(/"""\+(RELEASE|READ_SCHEMA)\+"""/g, (_, name) => name === "RELEASE" ? phase.RELEASE : phase.binding.readSchema);
  assert(!sql.includes('"""'));
  assert.equal(phase.APPROVAL_SQL, sql); groups++;
}
{
  const here = name => readFileSync(root + name, "utf8");
  assert.equal(here("ypal-ordinary-cache-two-phase-sql-v1.mjs").replace("./ypal-ordinary-cache-two-phase-driver-v1.mjs", "./ypal-ordinary-cache-driver-v5.mjs"), here("ypal-ordinary-cache-sql-v6.mjs"));
  let driver = here("ypal-ordinary-cache-two-phase-driver-v1.mjs").replace("./ypal-ordinary-cache-two-phase-v1.mjs", "./ypal-ordinary-cache-transition-v5.mjs");
  driver = driver.replace('assert.equal(mode, "apply", "only_explicit_two_phase_forward_apply_allowed");\n  exactFourReads(transition.originalPlan(plan), collector);', 'if (mode !== "rehearse") exactFourReads(plan, collector);');
  driver = driver.replace('postProof = { ...(await captureProof(db)), phaseContract: await transition.beforeAcknowledgement(client, plan) };', 'postProof = await captureProof(db);');
  driver = driver.replace('\n        transition.afterAcknowledgement(client, plan);', '');
  assert.equal(driver, here("ypal-ordinary-cache-driver-v5.mjs"));
  const oldComponent = here("ypal-ordinary-cache-transition-v5.mjs");
  const originalEffect = oldComponent.slice(oldComponent.indexOf("function effect(before, after) {"), oldComponent.indexOf("\nasync function begin(db) {"));
  assert(here("ypal-ordinary-cache-two-phase-v1.mjs").includes(originalEffect));
  const originalValidate = oldComponent.slice(oldComponent.indexOf("function validate(plan, committed) {"), oldComponent.indexOf("\nexport async function apply(db, plan, installReadCache) {")).replace("function validate(", "function validateOriginal(").replaceAll("digest(catalog(", "original.digest(catalog(");
  assert(here("ypal-ordinary-cache-two-phase-v1.mjs").includes(originalValidate)); groups++;
}
console.log(JSON.stringify({ format: "two-phase-source-and-transport-controls-v1", groupsPassed: groups, originalEntryAndDriverReversal: true, DBCalls: 0, providerCalls: 0 }));

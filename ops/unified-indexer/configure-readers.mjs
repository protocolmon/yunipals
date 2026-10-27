// Cold configuration: no old reader process, HTTP, preview or timing receipt.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const FORMAT = "yunipals-indexer-cold-sql-v1";
export const APPLY_REVIEWED = true;
const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const PROJECT = "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const PUBLISHER = "/opt/yunipals-unified/nonmarket-consumer-releases/771a75fbdf7dd804c6bb172222cb20583d6c3768511f0634c8193e6744495593";
const CACHE = ["read_epoch", "read_guard", "read_set", "read_member"].map(name => "metadata_projection." + name);
const COLLECTOR = "yunipals_unified_collector";
const COLLECTOR_OID = "73187672";
const BOUNDARIES = [{ chainId: 1, number: "26236452" }, { chainId: 56, number: "128816538" }, { chainId: 137, number: "95883932" }, { chainId: 8453, number: "52870956" }, { chainId: 8453, number: "52870977" }];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const encoded = value => JSON.stringify(canonical(value));
export const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : encoded(value)).digest("hex");
const equal = (a, b, message) => assert.equal(encoded(a), encoded(b), message);
const quote = value => { assert(/^[a-z][a-z0-9_]*$/.test(value)); return '"' + value + '"'; };
const scalar = async (db, sql) => { const { rows } = await db.query(sql); assert.equal(rows.length, 1); assert.equal(Object.keys(rows[0]).length, 1); return Object.values(rows[0])[0]; };

export function validateInput(input) {
  equal(Object.keys(input).sort(), ["format", "grants", "publication", "targetCatalog", "readCatalogBefore"].sort(), "exact_cold_input_keys");
  assert.equal(input.format, FORMAT);
  assert.equal(input.grants.length, 4);
  equal(input.grants.map(row => row.name).sort(), [...CACHE].sort(), "exact_four_cache_tables");
  for (const row of input.grants) assert(row.role === COLLECTOR && row.grantee === COLLECTOR_OID && row.privilege === "SELECT" && row.grantable === false && /^[1-9][0-9]*$/.test(row.grantor), "only_collector_four_SELECTs");
  assert.equal(input.publication.generationId, "105");
  assert.equal(input.publication.predecessorGenerationId, "103");
  assert.equal(input.publication.sourceRelease, "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3");
  assert.equal(input.publication.readIdentity, "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab");
  assert(typeof input.publication.metadataReleaseId === "string" && /^[\x21-\x7e]{1,128}$/.test(input.publication.metadataReleaseId));
  equal(Object.keys(input.publication).sort(), ["generationId", "predecessorGenerationId", "metadataReleaseId", "sourceRelease", "readIdentity", "validationSqlSha256", "originalObservationSha256", "candidateSourceSnapshot", "boundaryPoints"].sort(), "exact_publication_plan_keys");
  assert([input.publication.validationSqlSha256, input.publication.originalObservationSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)));
  equal(input.publication.boundaryPoints, BOUNDARIES, "all_original_canonical_boundary_points");
  assert(input.publication.candidateSourceSnapshot && typeof input.publication.candidateSourceSnapshot === "object");
  return input;
}

export function seedFromRecords(rehearsed, prepared) {
  const old = JSON.parse(rehearsed.sql.resultJson), result = prepared.result;
  assert(old.format === "yunipals-ypal-cache-guard-transition-v1" && old.committed === false && old.officialRollbackRehearsed === true);
  assert(prepared.acknowledged === true && prepared.mode === "apply" && result.phase === "prepare-guards" && result.committed === true && result.readGrantsExternallyActivated === false);
  const targetCatalog = structuredClone(old.after); targetCatalog.epochs = targetCatalog.epochs.map(row => ({ collection: row.collection }));
  const actual = structuredClone(result.after); actual.epochs = actual.epochs.map(row => ({ collection: row.collection }));
  equal(actual, { ...targetCatalog, acl: old.before.acl }, "actual_installed_guards_without_SELECTs");
  assert(prepared.postProof && prepared.postProof.catalog && Array.isArray(prepared.postProof.allColumnAcl));
  return { format: FORMAT, targetCatalog, grants: structuredClone(old.addedSelects), readCatalogBefore: structuredClone(prepared.postProof.catalog) };
}

export async function databaseIdentity(db, user) {
  const { rows } = await db.query("SELECT current_user,session_user,(SELECT oid::text FROM pg_roles WHERE rolname=current_user)AS role_oid,(SELECT oid::text FROM pg_database WHERE datname=current_database())AS database_oid,current_setting('port')AS port,host(inet_server_addr()) AS address");
  assert.equal(rows.length, 1); const value = rows[0];
  assert(value.current_user === user && value.session_user === user && value.role_oid === (user === "postgres" ? "10" : "16388") && value.database_oid === "17584" && value.port === "5432" && [null, "127.0.0.1", "::1"].includes(value.address), "fixed_main_backfill_database_identity");
  return value;
}

// Complete READ catalogue comparison; the four fixed SELECTs are the only delta.
export function readDelta(before, after, grants, tables) {
  const a = structuredClone(before), b = structuredClone(after);
  const edge = row => encoded(Object.fromEntries(["kind", "object", "object_name", "grantee", "grantor", "privilege", "grantable", "column_number"].map(key => [key, row[key] ?? null])));
  const prior = new Set(a.directRoleEdges.map(edge)), next = new Set(b.directRoleEdges.map(edge));
  const wanted = grants.map(row => edge({ kind: "relation", object: tables.find(table => table.name === row.name).oid, object_name: row.name, grantee: row.grantee, grantor: row.grantor, privilege: "SELECT", grantable: false }));
  assert([...prior].every(row => next.has(row)), "no_existing_READ_removal");
  equal([...next].filter(row => !prior.has(row)).sort(), wanted.sort(), "only_four_direct_READ_edges");
  delete a.directRoleEdges; delete b.directRoleEdges;
  for (const name of CACHE) {
    const old = a.relations.find(row => row.schema + "." + row.name === name), now = b.relations.find(row => row.schema + "." + row.name === name);
    assert(old && now, "four_complete_cache_relations"); old.acl = now.acl;
  }
  const old = a.effective.find(row => row.role === COLLECTOR), now = b.effective.find(row => row.role === COLLECTOR);
  assert(old && now);
  for (const name of CACHE) { assert(old.relations[name].select === false && now.relations[name].select === true); equal(old.relations[name].writes, now.relations[name].writes); old.relations[name].select = true; }
  equal(a, b, "all_other_READ_catalog_roles_functions_columns_unchanged");
}

async function commitACK(ack, phase, value, deadline = null) {
  const start = process.hrtime.bigint();
  assert.equal(await ack(phase, value), true, "literal_durable_root_ACK_required");
  const now = process.hrtime.bigint();
  assert(now - start < 5_000_000_000n && (deadline === null || now < deadline), "five_second_ACK_tail_and_native120_deadline");
}

async function nativeSources(db, cache) {
  assert.equal(cache.binding.readSchema, "yunipals_ownership_4e77f52b_v5");
  const rows = await scalar(db, "SELECT jsonb_agg(jsonb_build_object('collection',c,'ready',coalesce((yunipals_ownership_4e77f52b_v5.source_probe(c)->>'ready')::boolean,false))ORDER BY c)FROM unnest(ARRAY['ethereum','base','polygon','bnb'])c");
  equal(rows, ["base", "bnb", "ethereum", "polygon"].map(collection => ({ collection, ready: true })), "all_four_current_native_source_probes");
}

export async function activateCache(db, input, modules, ack) {
  validateInput(input);
  const { cache, catalogSql, columnSql } = modules;
  await databaseIdentity(db, "postgres");
  await cache.begin(db, true);
  try {
    const before = await cache.capture(db), fullBefore = await scalar(db, catalogSql), columns = await scalar(db, columnSql);
    equal(fullBefore, input.readCatalogBefore, "complete_accepted_READ_catalog_before_permissions");
    const expectedBefore = structuredClone(input.targetCatalog);
    expectedBefore.acl = expectedBefore.acl.filter(row => !input.grants.some(grant => encoded(row) === encoded(grant)));
    equal(cache.catalog(before), expectedBefore, "actual_prepared_guard_target_without_four_grants");
    assert.equal((await scalar(db, cache.guardSql())).valid, true, "genuine_native35_graph");
    await nativeSources(db, cache);
    const first = await cache.approval(db);
    for (const row of input.grants) await db.query(`GRANT SELECT ON TABLE ${row.name.split(".").map(quote).join(".")} TO ${quote(row.role)}`);
    const after = await cache.capture(db), fullAfter = await scalar(db, catalogSql);
    equal(cache.catalog(after), input.targetCatalog, "complete_target_guard_catalog");
    equal(before.epochs, after.epochs, "no_reinstall_or_epoch_increment");
    equal(before.columnAcl, after.columnAcl, "all_guard_column_ACLs_unchanged");
    equal(await scalar(db, columnSql), columns, "all_global_column_ACLs_unchanged");
    readDelta(fullBefore, fullAfter, input.grants, after.tables);
    const final = await cache.approval(db);
    equal(cache.semantic(first.snapshot), cache.semantic(final.snapshot), "same_canonical_native_semantic_frame");
    const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
    const deadline = BigInt(final.capturedMonotonicNanoseconds) + BigInt(final.remainingNanoseconds) - 5_000_000_000n;
    await commitACK(ack, "cache-selects-prepared", { xid, backend: await modules.reader.backendIdentity(db), targetCatalogSha256: hash(input.targetCatalog), globalColumnAclSha256: hash(columns), approval: final }, deadline);
    await db.query("COMMIT");
    equal(cache.catalog(await cache.capture(db)), input.targetCatalog, "committed_four_READ_catalog");
    return { committed: true, xid, additionalReadCount: 4, targetCatalogSha256: hash(input.targetCatalog) };
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
}

export async function configure(db, business, input, modules, ack) {
  validateInput(input);
  const cache = await activateCache(db, input, modules, ack);
  const before = await scalar(db, modules.catalogSql), after = structuredClone(before);
  for (const [name, oid] of Object.entries(modules.reader.LOGIN_ROLES)) { const row = after.roles.find(value => value.name === name); assert(row && String(row.oid) === oid && row.login === false); row.login = true; }
  const columns = await scalar(db, modules.columnSql);
  const logins = await modules.reader.changeReaderLogins(db, { mode: "roles", before, after, catalogSql: modules.catalogSql }, value => commitACK(ack, "reader-logins-prepared", value).then(() => true));
  equal(await scalar(db, modules.catalogSql), after, "committed_only_two_LOGIN_bits");
  equal(await scalar(db, modules.columnSql), columns, "LOGIN_preserves_global_columns");
  await databaseIdentity(business, "yunipals");
  await nativeSources(db, modules.cache);
  // The retained function owns the private session handle, canonical dual-CAS,
  // wallet staging and both collection stamps. No old service liveness callback.
  const publication = await modules.reader.publishPreparedCandidate(business, modules.official, input.publication, {
    privatePrepared: value => commitACK(ack, "wallet-private-prepared", value).then(() => true),
    beforeCommit: value => commitACK(ack, "generation-publication-prepared", value).then(() => true)
  });
  return { format: FORMAT, completed: true, cache, logins, publication, oldWarmACKClaimed: false, serviceActions: 0, automaticRetryAllowed: false };
}

export async function plan(db, business, seed, modules) {
  equal(Object.keys(seed).sort(), ["format", "targetCatalog", "grants", "readCatalogBefore"].sort(), "exact_private_plan_seed");
  await databaseIdentity(db, "postgres"); await databaseIdentity(business, "yunipals");
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let current, readCatalogBefore;
  try { current = await modules.cache.capture(db); readCatalogBefore = await scalar(db, modules.catalogSql); equal(readCatalogBefore, seed.readCatalogBefore, "known_accepted_READ_catalog_before_cold_plan"); await nativeSources(db, modules.cache); await modules.cache.approval(db); }
  finally { await db.query("ROLLBACK"); }
  await business.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let observation, snapshot;
  try { observation = await modules.reader.globalPublicationObservation(business, "105"); snapshot = (await business.query("SELECT validation->'sourceSnapshot' AS value FROM metadata_projection.generation WHERE id=$1", ["105"])).rows[0].value; }
  finally { await business.query("ROLLBACK"); }
  assert(observation.pointer.current === "103" && observation.candidate.id === "105" && observation.candidate.state === "ready" && observation.candidate.published === false && observation.archive === observation.candidate.metadataRelease);
  const publication = { generationId: "105", predecessorGenerationId: "103", metadataReleaseId: observation.candidate.metadataRelease,
    sourceRelease: modules.cache.binding.sourceRelease, readIdentity: modules.cache.binding.readIdentity,
    validationSqlSha256: observation.candidate.validationSha256, originalObservationSha256: hash(JSON.stringify(observation)), candidateSourceSnapshot: snapshot,
    boundaryPoints: structuredClone(BOUNDARIES) };
  const value = validateInput({ ...seed, publication });
  const before = structuredClone(seed.targetCatalog); before.acl = before.acl.filter(row => !seed.grants.some(grant => encoded(row) === encoded(grant)));
  equal(modules.cache.catalog(current), before, "fresh_planned_prepared_catalog");
  return value;
}

const PINS = {
  "ypal-ordinary-reader-sql-v6.mjs": "fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019",
  "ypal-ordinary-cache-two-phase-v1.mjs": "cd14d8dc2cdfaaf0e223d4531f28747519cdd7fb07fcfefad868546eea99687d",
  "ypal-ordinary-cache-transition-v5.mjs": "591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2",
  "ypal-combined-read-admission-v1.catalog.sql": "cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991",
  "ypal-restored-read-admission-v1.columns.sql": "8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf"
};
export function publicColumnBytes(value) {
  assert(typeof value === "string" && Buffer.byteLength(value) <= 100_000, "only_fixed_public_column_SQL_handoff");
  const raw = Buffer.from(value); assert.equal(hash(raw), PINS["ypal-restored-read-admission-v1.columns.sql"], "exact_public_column_SQL_handoff_hash"); return raw;
}
export function enhancedCatalog(raw) {
  const old = "'yunipals_ownership_4e77f52b_v4'", next = old + ",'yunipals_ownership_4e77f52b_v5'";
  assert(raw.split(old).length - 1 === 4 && raw.split("n.nspname=" + old).length - 1 === 1, "exact_four_V5_catalog_namespace_seams_required");
  let text = raw.replaceAll("n.nspname=" + old, "n.nspname IN(" + next + ")");
  text = text.replaceAll("IN('unified_ypal_20261023_v1'," + old, "IN('unified_ypal_20261023_v1'," + next);
  const clause = "has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')END";
  assert(text.split(clause).length - 1 === 1, "one_effective_relation_column_write_negative_required");
  return text.replaceAll(clause, "(has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')OR(c.nspname='yunipals_ownership_4e77f52b_v5'AND has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))END");
}
export async function installedModules(publicColumnSql) {
  const sources = {};
  for (const [name, digest] of Object.entries(PINS)) {
    if (name === "ypal-restored-read-admission-v1.columns.sql" && publicColumnSql !== undefined) {
      sources[name] = publicColumnBytes(publicColumnSql);
    } else sources[name] = readFileSync(OPS + "/" + name);
    assert.equal(hash(sources[name]), digest, "exact_accepted_business_source");
  }
  const manifestRaw = readFileSync(PUBLISHER + "/manifest.json");
  assert.equal(hash(manifestRaw), "2b3ea13e68a614920e082c784c8a9d70f193e113ec70075185ad14525f1b6b29");
  const manifest = JSON.parse(manifestRaw), official = {};
  assert.equal(manifest.artifactDigest, PUBLISHER.split("/").at(-1));
  for (const name of ["native-leaderboard-preparation", "projection-publication"]) { const row = manifest.files.find(value => value.path === "dist/" + name + ".mjs"); const raw = readFileSync(PUBLISHER + "/" + row.path); assert.equal(raw.length, row.bytes); assert.equal(hash(raw), row.sha256); Object.assign(official, await import(pathToFileURL(PUBLISHER + "/" + row.path).href)); }
  return { reader: await import(pathToFileURL(OPS + "/ypal-ordinary-reader-sql-v6.mjs").href), cache: await import(pathToFileURL(OPS + "/ypal-ordinary-cache-two-phase-v1.mjs").href), official, catalogSql: enhancedCatalog(sources["ypal-combined-read-admission-v1.catalog.sql"].toString().trim()), columnSql: sources["ypal-restored-read-admission-v1.columns.sql"].toString().trim() };
}

export async function worker() {
  assert.equal(process.getuid(), 111); assert.equal(process.getgid(), 113);
  const inputLines = createInterface({ input: process.stdin });
  const lines = inputLines[Symbol.asyncIterator](); let db, business;
  try {
    const first = await lines.next(); assert(!first.done, "initial_cold_SQL_request_required");
    const { input, databaseUrl, action, publicColumnSql } = JSON.parse(first.value);
    assert(["apply", "plan"].includes(action));
    if (action === "apply") assert(APPLY_REVIEWED, "reviewed_cold_SQL_entry_required");
    const url = new URL(databaseUrl); assert(["postgres:", "postgresql:"].includes(url.protocol) && decodeURIComponent(url.username) === "yunipals" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname) && (!url.port || url.port === "5432") && decodeURIComponent(url.pathname) === "/yunipals_backfill", "fixed_publication_connection");
    // The installed publisher reads its configuration when imported. Reuse the
    // same explicit private connection and native selectors as its SQL client.
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "unified_ypal_20261023_v1",
      READ_DATABASE_SCHEMA: "yunipals_ownership_4e77f52b_v5",
      OWNERSHIP_READ_SCHEMA: "yunipals_ownership_4e77f52b_v5",
      OWNERSHIP_READ_MODE: "unified",
      OWNERSHIP_RELEASE_ID: "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
      UNIFIED_INDEXER_RELEASE_ID: "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
      BASE_METADATA_INGESTION: "native",
      METADATA_SOURCE_MODE: "archive",
      YUNIPALS_PROJECTION_MODE: "generation",
      OFFCHAIN_DB_POOL_MAX: "1",
      API_DB_POOL_MAX: "1",
      PROJECTION_STORAGE_PATH: "/",
      PROJECTION_MIN_FREE_BYTES: "25000000000",
      PROJECTION_BACKUP_PEAK_BYTES: "0"
    });
    const { Client } = createRequire(PROJECT + "/package.json")("pg");
    db = new Client({ host: "/var/run/postgresql", port: 5432, user: "postgres", database: "yunipals_backfill", connectionTimeoutMillis: 5000 });
    business = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    const originalConnect = Client.prototype.connect;
    Client.prototype.connect = function (...args) { assert(this === db || this === business, "only_two_explicit_cold_SQL_clients"); return originalConnect.apply(this, args); };
    const modules = await installedModules(publicColumnSql);
    const ack = async (phase, value) => { const message = { event: "prepared", phase, value }; process.stdout.write(JSON.stringify(message) + "\n"); const next = await lines.next(); assert(!next.done, "root_ACK_input_closed"); const reply = JSON.parse(next.value); assert(reply.event === "root-authorized" && reply.phase === phase && reply.messageSha256 === hash(message)); return true; };
    await db.connect(); await business.connect(); const result = action === "apply" ? await configure(db, business, input, modules, ack) : await plan(db, business, input, modules);
    process.stdout.write(JSON.stringify({ event: "result", value: result }) + "\n");
  } finally {
    // stdin is otherwise a live handle even when initialization throws.
    inputLines.close(); process.stdin.destroy();
    await Promise.allSettled([Promise.resolve().then(() => db?.end()), Promise.resolve().then(() => business?.end())]);
  }
}

function save(directory, name, value) { const fd = openSync(directory + "/" + name, "wx", 0o600); try { writeSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); } const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
export async function collectChild(child, { action, input, databaseUrl, publicColumnSql, journal, timeoutMilliseconds = 1_200_000 }) {
  let spawnError = null;
  const exited = new Promise(resolveExit => { child.once("exit", (code, signal) => resolveExit({ code, signal })); child.once("error", error => { spawnError = error; resolveExit({ code: null, signal: null }); }); });
  let stderr = "", result = null, number = 0, killTimer;
  const stop = () => { child.stdin.end(); child.kill("SIGTERM"); killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000); };
  const phases = ["cache-selects-prepared", "reader-logins-prepared", "wallet-private-prepared", "generation-publication-prepared"];
  child.stdin.on("error", () => {}); // A refused worker may already have closed stdin.
  child.stderr.on("data", raw => { stderr = (stderr + raw.toString()).slice(0, 1_000_000); stop(); });
  const timeout = setTimeout(stop, timeoutMilliseconds);
  const outputLines = createInterface({ input: child.stdout });
  child.stdin.write(JSON.stringify({ input, databaseUrl, action, publicColumnSql }) + "\n");
  try {
    for await (const line of outputLines) {
      assert(line.length <= 8_000_000); const message = JSON.parse(line);
      if (message.event === "prepared") { assert(action === "apply" && message.phase === phases[number] && result === null, "one_exact_ordered_cold_ACK_per_phase"); save(journal, String(++number).padStart(2, "0") + "-" + message.phase + ".json", message); child.stdin.write(JSON.stringify({ event: "root-authorized", phase: message.phase, messageSha256: hash(message) }) + "\n"); }
      else { assert(message.event === "result" && result === null && (action === "plan" || number === 4)); result = message.value; save(journal, "business-result.json", result); child.stdin.end(); }
    }
    const status = await exited; assert(!spawnError && status.code === 0 && !stderr && result && (action === "plan" || result.completed === true), "cold_SQL_outcome_requires_private_journal_inspection_no_replay");
    save(journal, action === "plan" ? "plan.json" : "result.json", result); return result;
  } catch (error) { stop(); await exited; save(journal, "failure.json", { error: error.message, spawnError: spawnError?.message ?? null, stderr, automaticRetryAllowed: false, committedPhasesRequireInspection: true }); throw error; }
  finally { clearTimeout(timeout); clearTimeout(killTimer); outputLines.close(); child.stdin.end(); }
}
export async function main(args = process.argv.slice(2)) {
  if (args[0] === "--worker") return worker();
  if (!args.length) { console.log(JSON.stringify({ format: FORMAT, staticOnly: true, applyReviewed: APPLY_REVIEWED })); return; }
  if (args[0] === "--seed") {
    assert(args.length === 6 && args[2] === "--prepared" && args[4] === "--out"); assert.equal(process.getuid(), 0);
    const value = seedFromRecords(JSON.parse(readFileSync(resolve(args[1]))), JSON.parse(readFileSync(resolve(args[3]))));
    const output = resolve(args[5]), fd = openSync(output, "wx", 0o600); try { writeSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    console.log(JSON.stringify({ format: FORMAT, seedWritten: true, seedSha256: hash(readFileSync(output)), databaseConnections: 0 })); return;
  }
  assert(args.length === 4 && ["--apply", "--plan"].includes(args[0]) && args[2] === "--journal", "usage_--plan_or_apply_private_input_--journal_new_private_directory");
  const action = args[0].slice(2); if (action === "apply") assert(APPLY_REVIEWED, "reviewed_cold_SQL_entry_required"); assert.equal(process.getuid(), 0);
  const file = resolve(args[1]), journal = resolve(args[3]), row = lstatSync(file);
  assert(row.isFile() && !row.isSymbolicLink() && row.uid === 0 && row.nlink === 1 && (row.mode & 0o777) === 0o600);
  const raw = readFileSync(file), input = JSON.parse(raw); if (action === "apply") validateInput(input);
  assert(process.env.DATABASE_URL, "retained_private_publication_DATABASE_URL_required");
  // This one pinned public SQL file remains root0600 on disk. The restricted
  // child receives only its verified public bytes through the existing pipe.
  const publicColumnSql = readFileSync(OPS + "/ypal-restored-read-admission-v1.columns.sql", "utf8");
  publicColumnBytes(publicColumnSql);
  mkdirSync(journal, { mode: 0o700 }); save(journal, "intent.json", { format: FORMAT, inputSha256: hash(raw), sourceSha256: hash(readFileSync(fileURLToPath(import.meta.url))), automaticRetryAllowed: false });
  const child = spawn("/usr/bin/setpriv", ["--reuid=111", "--regid=113", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--pdeathsig=KILL", process.execPath, fileURLToPath(import.meta.url), "--worker"], { env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", TZ: "UTC" }, stdio: ["pipe", "pipe", "pipe"] });
  const result = await collectChild(child, { action, input, databaseUrl: process.env.DATABASE_URL, publicColumnSql, journal });
  console.log(JSON.stringify({ format: FORMAT, action, completed: true, generationId: action === "plan" ? result.publication.generationId : result.publication.after.candidate.id, resultSha256: hash(result), automaticRetryAllowed: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

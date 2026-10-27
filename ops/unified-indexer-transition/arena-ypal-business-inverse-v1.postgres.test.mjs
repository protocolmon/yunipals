// Real PG16 SQL/trigger/XID controls. Chain/source observations are local doubles.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composition, externalWork, extendLedgerSource } from "./arena-ypal-business-inverse-child-v1.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const require = createRequire(join(root, "apps/yunipals-market-api/package.json"));
const { Pool } = require("pg");
const url = process.env.ARENA_INVERSE_FIXTURE_URL;
assert(url && /^postgresql:\/\/postgres@127\.0\.0\.1:56983\/fixture$/.test(url), "fixed_disposable_local_fixture_only");
const temporary = mkdtempSync(join(tmpdir(), "arena-business-inverse-pg-"));
const pool = new Pool({ connectionString: url, max: 3, statement_timeout: 10000, lock_timeout: 2000 });
const checks = [], hash = (raw) => createHash("sha256").update(raw).digest("hex");
const child = await composition(readFileSync(join(here, "arena-modern-public-rollback-v1.mjs")));
const { retainedLedger } = await import("data:text/javascript;base64," + Buffer.from(extendLedgerSource(readFileSync(join(here, "arena-ypal-ordinary-v1.mjs")))).toString("base64"));
const D = child.DEPLOYMENT, H = "0x" + "a".repeat(64), I = "0x" + "b".repeat(64), NEXT = "0x" + "c".repeat(64);
const FLOOR = "52648146", OPEN = "accepted-open", CONTRACT = D.slice(5);
let db, ownedSchema = false, report;
try {
  // Reuse the exact authenticated offline resolver; add only a fixture export.
  const builderFile = join(here, "arena-ordinary-latest-complete-build-v1.mjs");
  let builder = readFileSync(builderFile, "utf8");
  const entries = builder.indexOf("export const ENTRIES ="), facade = builder.indexOf("export const FACADE ="), end = builder.indexOf("const sha =", facade);
  assert(entries >= 0 && facade > entries && end > facade);
  builder = builder.slice(0, facade) + 'export const FACADE = \'export { migrateArena } from "./schema.ts";\\nexport { ArenaSourceSwitch } from "./sourceSwitch.ts";\\n\';\n' + builder.slice(end);
  const file = join(temporary, "fixture-builder.mjs"); writeFileSync(file, builder);
  const { buildArtifact } = await import(pathToFileURL(file));
  const built = await buildArtifact(root); const artifact = join(temporary, "artifact"); mkdirSync(join(artifact, "dist"), { recursive: true });
  for (const [name, bytes] of Object.entries(built.outputs)) writeFileSync(join(artifact, name), bytes);
  symlinkSync(join(root, "apps/yunipals-market-api/node_modules"), join(artifact, "node_modules"));
  const { migrateArena, ArenaSourceSwitch } = await import(pathToFileURL(join(artifact, "dist/arena-owner-reader.mjs")));
  assert.equal((await pool.query("SELECT to_regnamespace('yunipals_arena')::text value")).rows[0].value, null, "fresh_disposable_fixture_schema_required");
  await migrateArena(pool); ownedSchema = true; db = await pool.connect();
  assert.equal((await db.query("SELECT count(*)::int n FROM yunipals_arena.operational_migration")).rows[0].n, 12); checks.push("genuine_twelve_operational_migrations_and_triggers");
  await db.query("INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode,halted)VALUES($1,$2,$3,'unified',true)", [D, CONTRACT, FLOOR]);
  await db.query("INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)VALUES($1,1,$2,$3,$4,$4,now(),$5)", [D, I, OPEN, H, D + "/1"]);
  await db.query("INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation)VALUES($1,1,0,'wallet',$2,'signature','ciphertext',$3)", [D, H, I]);
  await db.query("INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,provider_id,request,reserved_microusd,incarnation)VALUES($1,1,'media','image','real-provider-uuid','completed','real-provider-id','{}',1200,$2)", [D, I]);
  await db.query("INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,state,receipt_finalized,incarnation)VALUES($1,'settle',1,'real-signer',7,'0x010203',$2,'confirmed',true,$3)", [D, H, I]);
  await db.query("INSERT INTO yunipals_arena.identity_job(deployment,key,wallet,metadata,request_id,state,profile_hash,provider_id,reserved_microusd)VALUES($1,'identity-key','wallet','{}','real-identity-uuid','ready',$2,'identity-provider',2400)", [D, H]);
  const ledger = await retainedLedger(db); assert.equal(Object.keys(ledger).length, 11);
  const beforeSeal = hash(JSON.stringify(ledger)); checks.push("eleven_table_ledger_includes_real_UUID_provider_reservation_nonce_rawtx_ciphertext");
  await db.query("UPDATE yunipals_arena.identity_job SET reserved_microusd=2401 WHERE deployment=$1", [D]);
  await assert.rejects(retainedLedger(db, ledger), /retained_uuid_ciphertext_signed_bytes_or_identity_changed/);
  await db.query("UPDATE yunipals_arena.identity_job SET reserved_microusd=2400 WHERE deployment=$1", [D]);
  checks.push("identity_paid_reservation_is_additionally_sealed_in_same_eleven_table_protocol");
  const source = (release) => ({
    read: async (id) => ({ releaseId: release, indexedThroughBlock: FLOOR, tournament: id === "0" ? null : { id, incarnation: I, opened: { id: OPEN, blockNumber: FLOOR, blockHash: H }, inputFrozen: null, state: { phase: "open" } } }),
    list: async () => ({ ids: ["1"] })
  });
  const point = { getChainId: async () => 8453, getBlock: async () => ({ number: BigInt(FLOOR), hash: H, timestamp: BigInt(Math.floor(Date.now() / 1000)) }) };
  let currentSelection;
  const runtime = { operational: pool, retainedLedger, externalWork: (db) => externalWork(db, D), point, targetId: H, source: source(H), ArenaSourceSwitch, verifySwitch: async () => {} };
  const events = [];
  const payload = (targetKind, targetId) => ({ expectedSelection: currentSelection, targetKind, nativeReleaseId: H, floor: { block: FLOOR, hash: H }, retainedLedger: ledger, expectedIdentities: undefined });
  // Establish a real initial selected native epoch using the official body.
  const initial = new ArenaSourceSwitch({ pool, deployment: D, nativeSource: source(H), assertSourceSelection: async () => {} }, { kind: "unified", sourceId: H, source: source(H) }, point, async () => {}, { block: FLOOR, hash: H });
  const review = await initial.run(); await initial.run(review.reviewHash);
  currentSelection = await child.selected(db);
  await child.mutateMode(runtime, payload("unified", H), false, (row) => events.push(row));
  assert.equal((await db.query("SELECT halted FROM yunipals_arena.deployment WHERE id=$1", [D])).rows[0].halted, false);
  checks.push("completed_native_epoch_real_selector_and_unhalt_XID");
  await child.mutateMode(runtime, payload("legacy_rollback", NEXT), true, (row) => events.push(row));
  runtime.source = source(NEXT); runtime.targetId = NEXT;
  const nextPayload = payload("legacy_rollback", NEXT);
  const reviewed = await child.switchSource(runtime, nextPayload, (row) => events.push(row));
  // A changed reservation cannot mutate the actual accepted private record.
  await assert.rejects(db.query("UPDATE yunipals_arena.provider_task SET reserved_microusd=1201 WHERE request_id='real-provider-uuid'"), /immutable/);
  await assert.rejects(db.query("UPDATE yunipals_arena.transaction_intent SET nonce=8 WHERE deployment=$1", [D]), /immutable/);
  checks.push("actual_provider_and_signed_nonce_immutability_triggers");
  await child.switchSource(runtime, { ...nextPayload, applyHash: reviewed.reviewHash }, (row) => events.push(row));
  const selected = await child.selected(db); assert.equal(selected.kind, "legacy_rollback"); assert.equal(selected.source_id, NEXT);
  assert.notEqual(selected.epoch, currentSelection.epoch); currentSelection = selected;
  const switchIntent = events.find((row) => row.phase === "selection_commit_intent");
  assert.equal((await db.query("SELECT pg_xact_status($1::xid8) status", [switchIntent.xid])).rows[0].status, "committed");
  assert.equal(hash(JSON.stringify(await retainedLedger(db))), beforeSeal);
  checks.push("postcompleted_compatible_selector_real_committed_XID_and_all_private_bytes_unchanged");
  await assert.rejects(db.query("UPDATE yunipals_arena.source_switch_history SET review='{}' WHERE deployment=$1", [D]), /immutable/);
  await assert.rejects(db.query("DELETE FROM yunipals_arena.source_selection WHERE deployment=$1", [D]), /immutable/);
  checks.push("actual_selector_and_immutable_history_database_fences");
  await db.query("INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,state,incarnation)VALUES($1,'expire',1,'real-signer',8,'0x040506',$2,'submitted',$3)", [D, NEXT, I]);
  await assert.rejects(child.mutateMode(runtime, payload("legacy_rollback", NEXT), false, (row) => events.push(row)), /outstanding_external_work/);
  assert.equal((await db.query("SELECT halted FROM yunipals_arena.deployment WHERE id=$1", [D])).rows[0].halted, true);
  assert.equal((await child.selected(db)).epoch, selected.epoch); checks.push("submitted_transaction_fences_unhalt_without_replay_or_private_restore");
  await db.query("UPDATE yunipals_arena.transaction_intent SET state='confirmed',receipt_finalized=true WHERE nonce=8");
  await child.mutateMode(runtime, payload("legacy_rollback", NEXT), false, (row) => events.push(row));
  const unhalt = events.filter((row) => row.phase === "unhalt_commit_intent").at(-1);
  assert.equal((await db.query("SELECT pg_xact_status($1::xid8) status", [unhalt.xid])).rows[0].status, "committed");
  assert.equal((await retainedLedger(db, ledger)).verified, true); checks.push("explicitly_reconciled_work_then_real_owned_unhalt_preserves_original_ledger");
  // Return uses a fresh official review, never an old source success alias.
  await child.mutateMode(runtime, payload("unified", H), true, () => {}); runtime.source = source(H); runtime.targetId = H;
  const returnPayload = payload("unified", H), returnReview = await child.switchSource(runtime, returnPayload, () => {});
  const uncertain = [];
  await assert.rejects(child.switchSource(runtime, { ...returnPayload, applyHash: returnReview.reviewHash }, (row) => { uncertain.push(row); if (row.phase === "selection_commit_intent") throw Error("lost-before-commit"); }), /lost-before-commit/);
  assert.equal((await child.selected(db)).epoch, selected.epoch);
  assert.equal((await db.query("SELECT pg_xact_status($1::xid8) status", [uncertain[0].xid])).rows[0].status, "aborted");
  assert.equal((await retainedLedger(db, ledger)).verified, true); checks.push("lost_ACK_before_COMMIT_actual_aborted_XID_no_selector_or_private_change");
  const freshReturn = await child.switchSource(runtime, returnPayload, () => {});
  await child.switchSource(runtime, { ...returnPayload, applyHash: freshReturn.reviewHash }, () => {});
  assert.equal((await child.selected(db)).source_id, H); checks.push("fresh_reviewed_return_to_native_uses_new_epoch");
  // Execute the actual new runtime constructor's operational-only branch.
  // Only its dependency/endpoint factory is fixture-bound; public facade,
  // source sockets and RPC construction must never be reached by reconcile.
  let operationalConstructors = 0;
  class FixtureOperationalPool extends Pool {
    constructor(options) {
      assert.equal(options.host, "/var/run/postgresql"); assert.equal(options.port, 15438);
      assert.equal(options.database, "yunipals_arena"); assert.equal(options.user, "postgres");
      operationalConstructors++;
      super({ connectionString: url, max: options.max, statement_timeout: options.statement_timeout, lock_timeout: options.lock_timeout });
    }
  }
  const runtimeConstructor = new Function("createRequire", "need", "hash", "createHash", "ROOT",
    "return (" + child.loadRuntime.toString() + ");")(
    (file) => { assert.equal(file, child.ROOT + "/apps/yunipals-market-api/package.json"); return (name) => {
      assert.equal(name, "pg", "operational_reconcile_must_not_load_public_RPC_support"); return { Pool: FixtureOperationalPool };
    }; }, (value, message) => assert(value, message), hash, createHash, child.ROOT
  );
  const operationalOnly = await runtimeConstructor({ nativeReleaseId: "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
    cutoverChildSha256: "e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf",
    readPoolKind: "operational-reconcile", readPoolIdentity: null }, readFileSync(join(here, "arena-ypal-ordinary-v1.mjs")), -1, "reconcile");
  try {
    assert.equal(operationalConstructors, 1); assert.equal(operationalOnly.target, undefined); assert.equal(operationalOnly.point, undefined);
    const reconciled = await child.reconcile(operationalOnly, { intents: [switchIntent], retainedLedger: ledger });
    assert.equal(reconciled.selection.source_id, H); assert.equal(reconciled.retainedLedger.verified, true);
    assert.equal(reconciled.transactions[0].status, "committed");
  } finally { await operationalOnly.close(); }
  checks.push("genuine_operational_only_constructor_and_readonly_XID_ledger_reconcile_without_projector_or_RPC");
  report = { sourceOnly: true, postgres: (await db.query("SHOW server_version")).rows[0].server_version,
    checks, checksPassed: checks.length, providerCalls: 0, productionAccess: 0, fixture: "disposable_local_56983" };
} finally {
  db?.release();
  if (ownedSchema) {
    await pool.query("DROP SCHEMA yunipals_arena CASCADE");
    assert.equal((await pool.query("SELECT to_regnamespace('yunipals_arena')::text value")).rows[0].value, null);
  }
  await pool.end(); rmSync(temporary, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify({ ...report, fixtureSchemaRemoved: true }, null, 2) + "\n");

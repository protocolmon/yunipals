#!/usr/bin/env node
/** Owner-only committed-schema adoption and guarded source publication.
 * No migration, service command, provider, wallet, signer or broadcast import.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readSync, writeSync, fsyncSync, fstatSync, readlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { userInfo, hostname } from "node:os";

export const FORMAT = "yunipals-arena-direct-native-owner-v1";
export const DEPLOYMENT = "8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca";
export const SOURCE_ID = "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c";
export const SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";
const ROOT = "/opt/yunipals-unified/releases/" + SOURCE;
const ADAPTER = "/opt/yunipals-unified/operations/free-replay-20261020/arena-legacy-origin-adopt-v2.mjs";
const ADAPTER_SHA = "26deb0262b61d1c3e937b5968a8cd489a60a82fd28d22d32200bc6e444f70c8b";
const MARKERS = "/opt/yunipals-unified/operations/arena-role-inventory-20261021/operational-migrations.v1.json";
const MARKERS_SHA = "f6f8c50c7242671f8736acdedb724df7dfd6bf0fb510343af5482e2794cf8f5b";
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const canonical = (value) => JSON.stringify(value, function (_, v) {
  return v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v;
});
const need = (value, code) => { if (!value) throw new Error(code); };
export function validateAuthority(meta, target, value, action, input, childHash) {
  need(meta.isFile() && meta.uid === 0 && meta.gid === 0 && meta.nlink === 0 &&
    (meta.mode & 0o777) === 0o600 && meta.size > 0 && meta.size < 1024 &&
    target === "/memfd:arena-direct-native-root-authority (deleted)", "sealed_root_owner_authority_required");
  need(Object.keys(value).sort().join() === "action,childSha256,format,payloadSha256,planSha256" &&
    value.format === "yunipals-arena-direct-native-root-authority-v1" && value.action === action &&
    value.payloadSha256 === digest(input) && value.childSha256 === childHash &&
    /^[0-9a-f]{64}$/.test(value.planSha256), "exact_owner_authority_binding_required");
}
export const sealEqual = (a, b) => canonical(a.tables) === canonical(b.tables) && a.aadSha256 === b.aadSha256;
const LEDGER = Object.freeze({
  submission: ["deployment,tournament_id,seat,incarnation", "wallet,commitment,signature,ciphertext"],
  fighter_snapshot: ["deployment,tournament_id,nft_chain_id,collection,token_id,incarnation", "snapshot,snapshot_hash"],
  frozen_input: ["deployment,tournament_id,incarnation", "input_hash,ciphertext"],
  admission: ["deployment,tournament_id,nft_chain_id,collection,token_id,wallet,expiry,incarnation", "signature,ownership_block,ownership_hash"],
  provider_task: ["request_id", "deployment,tournament_id,incarnation,kind,asset,request,reserved_microusd,provider_id"],
  transaction_intent: ["action_id", "deployment,tournament_id,incarnation,purpose,signer,nonce,raw_transaction,tx_hash"],
  adjudication: ["deployment,tournament_id,incarnation", "input_hash,outcome_hash"],
  media_job: ["deployment,tournament_id,incarnation", "input_hash,outcome_hash"],
  identity_job: ["deployment,key", "request_id,wallet,metadata,provider_id,profile_hash"],
  provider_action_evidence: ["request_id", "evidence"],
  media_publication: ["deployment,tournament_id,incarnation,publication_hash", "manifest,source_evidence"]
});
export async function retainedLedger(db, expected) {
  const ledger = {};
  for (const [table, [keys, fields]] of Object.entries(LEDGER)) {
    const rows = (await db.query(`SELECT to_jsonb(t) AS body FROM yunipals_arena.${table} t ORDER BY to_jsonb(t)::text LIMIT 2001`)).rows;
    need(rows.length <= 2000, "bounded_retained_ledger_required");
    ledger[table] = rows.map(({body}) => {
      const key = keys.split(",").map(k => { need(body[k] !== null && body[k] !== undefined, "exact_retained_ledger_key_required"); return body[k]; });
      const sealed = {};
      for (const k of fields.split(",")) {
        need(Object.hasOwn(body, k), "retained_ledger_schema_changed");
        if (body[k] !== null) sealed[k] = digest(canonical(body[k]));
      }
      return {keySha256: digest(canonical(key)), fields: sealed};
    });
  }
  if (expected) {
    need(Object.keys(expected).sort().join() === Object.keys(LEDGER).sort().join(), "exact_owned_retained_ledger_required");
    for (const [table, rows] of Object.entries(expected)) {
      need(Array.isArray(rows) && rows.length <= 2000, "bounded_owned_ledger_rows_required");
      const available = [...ledger[table]];
      for (const row of rows) {
        const i = available.findIndex(now => now.keySha256 === row.keySha256 && Object.entries(row.fields).every(([k,v]) => now.fields[k] === v));
        need(i >= 0, "retained_uuid_ciphertext_signed_bytes_or_identity_changed"); available.splice(i,1);
      }
    }
    return {verified:true, sha256:digest(canonical(expected)), originalRows:Object.values(expected).reduce((n,r)=>n+r.length,0)};
  }
  return ledger;
}
export const originKey = (observed) => {
  const t = observed.tournament;
  need(t && observed.releaseId === SOURCE_ID && t.deployment === DEPLOYMENT, "canonical_origin_required");
  return { id: t.id, incarnation: t.incarnation, opened: t.opened };
};
export function event(value, fd = 1) {
  if (value.phase.endsWith("_commit_intent") || value.phase.endsWith("_committed")) {
    const s = fstatSync(fd);
    need(s.isFile() && s.uid === 0 && s.nlink === 1 && (s.mode & 0o777) === 0o600, "private_durable_owner_journal_required");
  }
  writeSync(fd, JSON.stringify({ format: FORMAT, ...value }) + "\n");
  // Root supplies an already-open private regular journal for mutating actions.
  try { fsyncSync(fd); } catch (e) { if (!["EINVAL", "ENOTSUP"].includes(e.code) || value.phase.endsWith("_commit_intent") || value.phase.endsWith("_committed")) throw e; }
}
export function scopedReadOnly(config) {
  const u = new URL(config.connectionString);
  need(["postgres:", "postgresql:"].includes(u.protocol), "fixed_postgres_url_required");
  const options = (u.searchParams.get("options") ?? config.options ?? "") +
    " -c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=180000";
  const bounds = { statement_timeout: 10000, lock_timeout: 2000, query_timeout: 15000, idle_in_transaction_session_timeout: 180000, connectionTimeoutMillis: 3000 };
  for (const [k, v] of Object.entries(bounds)) u.searchParams.set(k, String(v));
  u.searchParams.set("options", options);
  return { ...config, ...bounds, options, connectionString: u.href };
}
export async function canonicalFloor(source, point, floor, requiredBlock = floor.block) {
  const coverage = await source.read("0", { requiredThroughBlock: BigInt(requiredBlock) });
  const boundary = await point.getBlock({ blockNumber: BigInt(floor.block) });
  const head = await point.getBlock({ blockTag: "latest" });
  need(coverage.releaseId === SOURCE_ID && BigInt(coverage.indexedThroughBlock) >= BigInt(requiredBlock) &&
    boundary.hash === floor.hash && head.hash && head.number >= BigInt(coverage.indexedThroughBlock) &&
    await point.getChainId() === 8453 && Math.abs(Date.now() - Number(head.timestamp) * 1000) <= 120000,
    "actual_fresh_canonical_native_floor_required");
  return { block: floor.block, hash: floor.hash };
}
export async function onlineReview(db, source, verify, markers, floor, point) {
  const actual = (await db.query("SELECT version,checksum FROM yunipals_arena.operational_migration ORDER BY version")).rows;
  need(canonical(actual) === canonical(markers), "committed_twelve_markers_required");
  const target = (await db.query("SELECT id,contract,start_block::text,halted,indexer_mode FROM yunipals_arena.deployment WHERE id=$1", [DEPLOYMENT])).rows;
  need(target.length === 1 && target[0].id === DEPLOYMENT && target[0].contract.toLowerCase() === DEPLOYMENT.slice(5) &&
    target[0].start_block === "52648146" && target[0].indexer_mode === "legacy" && !target[0].halted, "original_unhalted_legacy_target_required");
  const selected = (await db.query("SELECT count(*)::int AS n FROM yunipals_arena.source_selection WHERE deployment=$1", [DEPLOYMENT])).rows[0];
  need(selected.n === 0, "initial_source_selector_must_be_absent");
  const ids = (await db.query("SELECT tournament_id::text AS id,incarnation,cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 ORDER BY tournament_id", [DEPLOYMENT])).rows;
  need(ids.length === 2 && ids.every(r => r.incarnation === "legacy" && r.cipher_context === DEPLOYMENT + "/" + r.id), "two_retained_legacy_origins_required");
  const required = (await db.query(`SELECT GREATEST(
    COALESCE((SELECT indexed_block FROM yunipals_arena.source_operational_cursor WHERE deployment=$1),0),
    COALESCE((SELECT max(receipt_block_number) FROM yunipals_arena.client_transaction WHERE deployment=$1),0),
    COALESCE((SELECT max(block_number) FROM yunipals_arena.transaction_receipt_history h JOIN yunipals_arena.transaction_intent i USING(action_id) WHERE i.deployment=$1 AND h.canonical),0),
    $2::bigint,$3::bigint)::text AS block`, [DEPLOYMENT, target[0].start_block, floor.block])).rows[0].block;
  await canonicalFloor(source, point, floor, required);
  const origins = [];
  for (const row of ids) {
    const observed = await source.read(row.id, { requiredThroughBlock: BigInt(required) });
    await verify(observed); origins.push(originKey(observed));
  }
  return { target: target[0], origins, floor, requiredThroughBlock: required, sourceId: SOURCE_ID };
}

/** Mode+adoption are one transaction. The caller's fsynced XID intent allows
 * exact SQL acknowledgement reconciliation; an after-graph alone is insufficient.
 */
export async function commitAdoption(runtime, expectedOrigins, emit = event) {
  const { operational, source, verify, markers, reviewOrigins, privateSeal, adoptOrigins, adopt } = runtime;
  const db = await operational.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["arena/source-selection/" + DEPLOYMENT]);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["arena/project/" + DEPLOYMENT]);
    const updated = await db.query("UPDATE yunipals_arena.deployment SET halted=true,indexer_mode='unified' WHERE id=$1 AND indexer_mode='legacy' AND NOT halted", [DEPLOYMENT]);
    need(updated.rowCount === 1, "exact_initial_mode_cas_required");
    const reviewed = await reviewOrigins(db, source, verify, markers);
    need(canonical(reviewed.observations.map(originKey)) === canonical(expectedOrigins), "reviewed_canonical_openings_changed");
    reviewed.privateSeal = await privateSeal(db);
    const result = await adoptOrigins(db, reviewed, source, verify, adopt, markers);
    const after = await privateSeal(db);
    need(canonical(after) === canonical(reviewed.privateSeal), "adoption_private_bytes_or_aad_changed");
    // Adoption may only change incarnation. Capture the continuation ledger
    // afterwards so every identity-scoped key contains its actual native origin.
    const retained = await retainedLedger(db);
    const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
    emit({ phase: "adoption_commit_intent", xid, origins: expectedOrigins, privateSeal: result.privateSeal, retainedLedger: retained });
    await db.query("COMMIT");
    emit({ phase: "adoption_committed", xid, adopted: 2, privateSeal: result.privateSeal, retainedLedger: retained });
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch {}
    throw error;
  } finally { db.release(); }
}

export async function publishSource(runtime, floor, emit = event) {
  const { operational, source, point, verifySwitch, ArenaSourceSwitch, assertArenaSourceBinding } = runtime;
  // The facade adds only a durable pre-COMMIT XID/expected-row acknowledgement.
  // The official switch still owns all review, locks, CAS, history and COMMIT SQL.
  let selectedRow;
  const pool = {
    connect: async () => {
      const db = await operational.connect();
      return {
        query: async (...args) => {
          const text = args[0];
          if (typeof text === "string" && /^(INSERT INTO|UPDATE) yunipals_arena\.source_selection/.test(text)) {
            const p = args[1]; selectedRow = { deployment: p[0], epoch: p[1], kind: p[2], sourceId: p[3], block: p[4], hash: p[5], reviewHash: p[6] };
          }
          if (text === "COMMIT") {
            need(selectedRow, "owned_selector_publication_required");
            const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
            emit({ phase: "selection_commit_intent", xid, selectedRow });
            const result = await db.query(...args);
            emit({ phase: "selection_committed", xid, selectedRow });
            return result;
          }
          return db.query(...args);
        },
        release: () => db.release()
      };
    }
  };
  const service = {
    pool, deployment: DEPLOYMENT, nativeSource: source,
    assertSourceSelection: async (db) => {
      const row = (await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1", [DEPLOYMENT])).rows[0];
      need(row?.indexer_mode === "unified" && row.halted, "halted_unified_source_switch_required");
      await assertArenaSourceBinding(db, DEPLOYMENT, undefined);
    }
  };
  const change = new ArenaSourceSwitch(service, { kind: "unified", sourceId: SOURCE_ID, source }, point, verifySwitch, floor);
  const review = await change.run();
  emit({ phase: "selection_review", reviewHash: review.reviewHash });
  return change.run(review.reviewHash);
}

export async function reconcile(db, intents, privateSeal, expectedLedger) {
  const selection = (await db.query("SELECT epoch::text,kind,source_id,accepted_block::text,accepted_hash,review_hash FROM yunipals_arena.source_selection WHERE deployment=$1", [DEPLOYMENT])).rows;
  const mode = (await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1", [DEPLOYMENT])).rows[0];
  const history = (await db.query("SELECT epoch::text,deployment,review_hash FROM yunipals_arena.source_switch_history WHERE deployment=$1 ORDER BY switched_at,epoch", [DEPLOYMENT])).rows;
  const identities = (await db.query("SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 ORDER BY tournament_id", [DEPLOYMENT])).rows;
  const seal = await privateSeal(db);
  const transactions = [];
  for (const intent of intents) {
    need(/^[1-9][0-9]*$/.test(intent.xid), "own_recorded_xid_required");
    const status = (await db.query("SELECT pg_xact_status($1::xid8) AS status", [intent.xid])).rows[0].status;
    transactions.push({ phase: intent.phase, xid: intent.xid, status });
  }
  const retained = expectedLedger ? await retainedLedger(db, expectedLedger) : null;
  return { mode, selection, history, identities, privateSeal: seal, transactions, retainedLedger: retained };
}

export async function unhaltDeployment(runtime, epoch, floor, emit=event) {
  await canonicalFloor(runtime.source, runtime.point, floor);
  const db = await runtime.operational.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["arena/source-selection/" + DEPLOYMENT]);
    const row = (await db.query("SELECT epoch::text,kind,source_id FROM yunipals_arena.source_selection WHERE deployment=$1 FOR SHARE", [DEPLOYMENT])).rows[0];
    need(row?.epoch === epoch && row.kind === "unified" && row.source_id === SOURCE_ID, "owned_selected_epoch_required");
    const update = await db.query("UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1 AND indexer_mode='unified' AND halted", [DEPLOYMENT]);
    need(update.rowCount === 1, "owned_halted_deployment_required");
    const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
    emit({ phase: "unhalt_commit_intent", xid, epoch });
    await db.query("COMMIT"); emit({ phase: "unhalt_committed", xid, epoch });
  } catch(e) { await db.query("ROLLBACK");throw e; } finally {db.release();}
}

export function publicDescriptor(fd, name, expected) {
  need(Number.isSafeInteger(fd) && fd > 2, "fixed_public_descriptor_required");
  const s = fstatSync(fd);
  need(s.isFile() && s.uid === 0 && s.gid === 0 && s.nlink === 0 && (s.mode & 0o777) === 0o600 &&
    s.size > 0 && s.size < 200000 && readlinkSync("/proc/self/fd/" + fd) === "/memfd:" + name + " (deleted)", "root_owned_anonymous_public_input_required");
  const raw = Buffer.alloc(s.size);
  need(readSync(fd, raw, 0, raw.length, 0) === s.size && fstatSync(fd).size === s.size && digest(raw) === expected, "exact_public_descriptor_bytes_required"); return raw;
}
async function runtime(payload, action, descriptors) {
  const adapter = publicDescriptor(descriptors.adapterFd, "arena-direct-native-adapter", ADAPTER_SHA);
  const markers = publicDescriptor(descriptors.markersFd, "arena-direct-native-markers", MARKERS_SHA);
  const { reviewOrigins, privateSeal, adoptOrigins } = await import("data:text/javascript;base64," + adapter.toString("base64"));
  const app = ROOT + "/apps/yunipals-market-api", req = createRequire(app + "/package.json");
  const { tsImport } = req("tsx/esm/api");
  const load = name => tsImport(app + "/src/arena/live/" + name + ".ts", { parentURL: pathToFileURL(app + "/package.json").href, tsconfig: app + "/tsconfig.json" });
  const [{ NativeArenaSource }, { verifyNativeArenaAction }, { adoptLegacyTournamentIdentity }, { ArenaSourceSwitch, arenaSourceSwitchVerifier }, { assertArenaSourceBinding }] = await Promise.all([load("nativeSource"), load("nativeAction"), load("tournamentIdentity"), load("sourceSwitch"), load("sourceSelection")]);
  const pg = req("pg"), { createPublicClient, http } = req("viem");
  const options = "-c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=180000 -c role=yunipals_arena_owner" + (["review","status","verify-source"].includes(action) ? " -c default_transaction_read_only=on" : "");
  const operational = new pg.Pool({ host: "/var/run/postgresql", port: 15438, database: "yunipals_arena", user: "postgres", max: 1, connectionTimeoutMillis: 3000, options });
  const physical = new pg.Pool(scopedReadOnly({ connectionString: payload.sourceUrl, max: 1 }));
  const { rpcBudgetProxyUrl } = await tsImport(app + "/src/rpcBudgetProxyRegistry.ts", { parentURL: pathToFileURL(app + "/package.json").href, tsconfig: app + "/tsconfig.json" });
  const point = createPublicClient({ transport: http(rpcBudgetProxyUrl("base", "production"), { retryCount: 0, timeout: 5000 }) });
  const source = new NativeArenaSource(physical, SOURCE_ID, DEPLOYMENT.slice(5), 52648146n);
  return { operational, physical, source, point, markers: JSON.parse(markers).markers, verify: o => verifyNativeArenaAction(point, o), verifySwitch: arenaSourceSwitchVerifier(point), adopt: adoptLegacyTournamentIdentity, reviewOrigins, privateSeal, adoptOrigins, ArenaSourceSwitch, assertArenaSourceBinding };
}

async function authenticate(payload) {
  const req = createRequire(ROOT + "/apps/yunipals-market-api/package.json"), pg = req("pg");
  const rows = [];
  for (const item of payload.authUrls) {
    const pool = new pg.Pool(scopedReadOnly({ connectionString: item.url, max: 1 }));
    try {
      const r = (await pool.query("SELECT current_user,session_user,(SELECT oid::bigint FROM pg_roles WHERE rolname=current_user)AS oid,current_setting('transaction_read_only')='on'AS read_only")).rows[0];
      need(r.current_user === item.name && r.session_user === item.name && Number(r.oid) === item.oid && r.read_only, "exact_dedicated_tcp_authentication_required");
      rows.push({ name: item.name, oid: item.oid, authenticated: true, readOnly: true });
    } finally { await pool.end(); }
  }
  return rows;
}

export async function main(descriptors = {action: process.argv[2], authorityFd: Number(process.argv[3]), childFd: Number(process.argv[4]), adapterFd: Number(process.argv[5]), markersFd: Number(process.argv[6])}) {
  need(hostname() === "yunipals-main" && userInfo().username === "postgres" && process.execPath === "/opt/node-v24.18.1/bin/node" && process.env.TSX_DISABLE_CACHE === "1", "fixed_postgres_owner_peer_required");
  const action = descriptors.action;
  need(["review", "commit", "publish", "status", "unhalt", "verify-source"].includes(action), "fixed_owner_action_required");
  const input = readFileSync(0); need(input.length < 500000, "bounded_internal_owner_payload_required");
  const fd = descriptors.authorityFd;
  need(Number.isSafeInteger(fd) && fd > 2, "root_authority_descriptor_required");
  const meta = fstatSync(fd), authority = JSON.parse(readFileSync(fd));
  // F_GET_SEALS is proven by the parent before exec; the child additionally
  // binds the anonymous root-owned FD, its exact content and its own bytes.
  const child = publicDescriptor(descriptors.childFd, "arena-direct-native-child", authority.childSha256);
  validateAuthority(meta, readlinkSync("/proc/self/fd/" + fd), authority, action, input, digest(child));
  const payload = JSON.parse(input);
  // Never emit exception messages or connection values, even from dependencies.
  for (const key of ["log", "warn", "error", "info", "debug"]) console[key] = () => {};
  if (action === "review") event({ phase: "dedicated_authentication", rows: await authenticate(payload) });
  const r = await runtime(payload, action, descriptors);
  try {
    if (action === "review") {
      const db = await r.operational.connect();
      try { await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const proof = await onlineReview(db, r.source, r.verifySwitch, r.markers, payload.floor, r.point); await db.query("ROLLBACK"); event({ phase: "online_review", proof }); } finally { db.release(); }
    } else if (action === "commit") {
      const adoption = await commitAdoption(r, payload.expectedOrigins);
      const selected = await publishSource(r, payload.floor);
      need(sealEqual(await r.privateSeal(r.operational), adoption.privateSeal), "private_history_changed_during_source_publication");
      event({ phase: "publication_complete", epoch: selected.epoch, reviewHash: selected.reviewHash });
    } else if (action === "publish") {
      need(payload.retainedLedger && payload.privateSeal, "owned_adoption_retention_proof_required");
      await retainedLedger(r.operational, payload.retainedLedger);
      need(sealEqual(await r.privateSeal(r.operational), payload.privateSeal), "pre_native_private_history_changed");
      const selected = await publishSource(r, payload.floor);
      need(sealEqual(await r.privateSeal(r.operational), payload.privateSeal), "private_history_changed_during_source_publication");
      event({ phase:"publication_complete",epoch:selected.epoch,reviewHash:selected.reviewHash });
    } else if (action === "status") {
      const db = await r.operational.connect();
      try { await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const state = await reconcile(db, payload.intents ?? [], r.privateSeal, payload.retainedLedger); await db.query("ROLLBACK"); event({ phase: "reconciled_state", state }); } finally { db.release(); }
    } else if (action === "verify-source") {
      await canonicalFloor(r.source,r.point,payload.floor);
      for (const expected of payload.expectedOrigins) {
        const observed=await r.source.read(expected.id,{requiredThroughBlock:BigInt(payload.floor.block)});
        need(canonical(originKey(observed))===canonical(expected),"owned_opening_changed_before_continuation");
        await r.verifySwitch(observed);
      }
      event({phase:"source_reverified",floor:payload.floor,origins:payload.expectedOrigins});
    } else if (action === "unhalt") {
      await unhaltDeployment(r,payload.epoch,payload.floor);
    }
  } finally { await Promise.all([r.operational.end(), r.physical.end()]); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { event({ phase: "refused", errorClass: error.name, fixedCode: "direct_native_owner_refused", rawMessagesExported: false }); process.exitCode = 1; });
}

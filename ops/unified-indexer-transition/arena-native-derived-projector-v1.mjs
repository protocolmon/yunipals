// Derive public compatibility state from accepted native canonical events only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, fstatSync, readlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

export const FORMAT = "yunipals-arena-native-derived-projector-v1";
export const MAX_PREFIX_EVENTS = 100000;
export const MAX_STATES = 1000;
export const canonical = (value) => JSON.stringify(value, (_, item) => {
  if (typeof item === "bigint") return String(item);
  return item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});
const hash = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value)).digest("hex");
const decimal = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const hex = (value) => typeof value === "string" && /^0x[a-f0-9]{64}$/.test(value);
const need = (value, code) => { if (!value) throw Error(code); };

export function checked(config) {
  need(config && config.format === FORMAT + "-config" && config.native && config.provision && config.sourceRole &&
    config.sourceRole.name === "arena_native_reader" && Number.isSafeInteger(config.sourceRole.oid) &&
    /^0x[a-f0-9]{40}$/.test(config.native.contract) && decimal(config.native.startBlock) &&
    hex(config.native.releaseId) && hex(config.native.abiHash) && hex(config.native.manifestHash) &&
    config.native.sourceId === "arena:8453:" + config.native.contract &&
    config.native.schema === "unified_ypal_20261023_v1" && config.native.schemaOid === "75963410" && config.native.buildId === "71e2a7f3b7" &&
    Number.isSafeInteger(config.maximumBlocks) && config.maximumBlocks >= 1 && config.maximumBlocks <= 10000000 &&
    Number.isSafeInteger(config.maximumEvents) && config.maximumEvents >= 1 && config.maximumEvents <= 10000 &&
    Number.isSafeInteger(config.pollMilliseconds) && config.pollMilliseconds >= 1000 && config.pollMilliseconds <= 30000,
    "exact_native_derived_configuration_required");
  return config;
}

export function normalized(row, config, source = false) {
  const args = typeof row.args === "string" ? JSON.parse(row.args) : row.args;
  need(decimal(row.block_number) && hex(row.block_hash) && hex(row.transaction_hash) &&
    Number.isSafeInteger(row.log_index) && row.log_index >= 0 && args && typeof args === "object" && !Array.isArray(args),
    "complete_native_event_payload_required");
  if (source) need(row.source_id === config.native.sourceId && row.chain_id === 8453 &&
    row.address === config.native.contract && row.abi_hash === config.native.abiHash &&
    row.id === "8453:" + config.native.contract + ":" + row.transaction_hash + ":" + row.log_index,
    "exact_native_event_source_and_identity_required");
  return { block_number: row.block_number, block_hash: row.block_hash, transaction_hash: row.transaction_hash,
    log_index: row.log_index, event_name: source ? row.name : row.event_name, args };
}

function ordered(rows) {
  need(rows.length <= MAX_PREFIX_EVENTS, "bounded_complete_arena_event_prefix_required");
  for (let index = 1; index < rows.length; index++) {
    const left = rows[index - 1], right = rows[index];
    need(BigInt(left.block_number) < BigInt(right.block_number) || left.block_number === right.block_number && left.log_index < right.log_index,
      "strict_native_block_log_order_required");
  }
  return rows;
}

async function sourcePrefix(db, schema, config, through) {
  const rows = (await db.query(`SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
    FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND block_number<=$2::bigint
    ORDER BY block_number,log_index LIMIT 100001`, [config.native.sourceId, String(through)])).rows;
  return ordered(rows.map((row) => normalized(row, config, true)));
}

async function targetPrefix(db, config, through) {
  const rows = (await db.query(`SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
    FROM yunipals_arena.chain_event WHERE deployment=$1 AND block_number<=$2::bigint
    ORDER BY block_number,log_index LIMIT 100001`, ["8453:" + config.native.contract, String(through)])).rows;
  return ordered(rows.map((row) => normalized(row, config)));
}

async function blockHash(db, schema, block) {
  const rows = (await db.query(`SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1::bigint`, [String(block)])).rows;
  need(rows.length === 1 && hex(rows[0].block_hash), "actual_complete_native_block_witness_required");
  return rows[0].block_hash;
}

async function canonicalBoundaryHash(db, schema, config, block) {
  const retained = (await db.query(`SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1::bigint`, [String(block)])).rows;
  const events = (await db.query(`SELECT DISTINCT block_hash FROM ${schema}.canonical_event
    WHERE source_id=$1 AND chain_id=8453 AND block_number=$2::bigint LIMIT 2`, [config.native.sourceId, String(block)])).rows;
  need(retained.length <= 1 && events.length <= 1 && retained.length + events.length > 0 &&
    [...retained, ...events].every((row) => hex(row.block_hash)) &&
    (retained.length === 0 || events.length === 0 || retained[0].block_hash === events[0].block_hash),
    "same_actual_native_event_or_retained_block_boundary_required");
  return { blockHash: (retained[0] ?? events[0]).block_hash,
    witnessKind: retained.length ? "retained-chain-block" : "complete-native-event-block" };
}

export async function nativeSnapshot(support, pool, config, work) {
  checked(config);
  const reader = await support.createIndexerReader(pool, { releaseId: config.native.releaseId });
  const release = reader.release;
  need(release.id === config.native.releaseId && release.schema === config.native.schema && release.buildId === config.native.buildId &&
    release.manifestHash === config.native.manifestHash, "exact_accepted_native_release_required");
  const definition = release.manifest.sources.find((row) => row.id === config.native.sourceId);
  need(definition?.enabled && definition.feature === "arena" && definition.chainId === 8453 &&
    definition.address === config.native.contract && String(definition.startBlock) === config.native.startBlock &&
    definition.abiHash === config.native.abiHash, "same_actual_native_arena_definition_required");
  return reader.snapshot(config.native.sourceId, { kind: "latest" }, async (db, { status }) => {
    need(["ready", "catching_up"].includes(status.readiness.reason) && status.anchor && status.errorCode === null,
      "genuine_latest_complete_native_readiness_required");
    const runtime = await support.readBoundRuntime(db, release);
    const complete = runtime.chains.find((row) => row.chainId === 8453)?.completeThroughBlock;
    need(runtime.frameworkReady && runtime.running && typeof complete === "bigint" && complete >= BigInt(config.native.startBlock),
      "actual_current_complete_native_boundary_required");
    const schema = support.sqlIdentifier(release.schema);
    const who = (await db.query("SELECT current_user AS role,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid")).rows[0];
    const schemaOid = (await db.query("SELECT oid::text AS oid FROM pg_namespace WHERE nspname=$1", [release.schema])).rows[0]?.oid;
    need(who?.role === config.sourceRole.name && who.oid === config.sourceRole.oid && who.database_oid === 17584 &&
      schemaOid === config.native.schemaOid, "actual_existing_native_reader_role_database_and_schema_required");
    const frame = { releaseId: release.id, schema: release.schema, schemaOid, buildId: release.buildId, manifestHash: release.manifestHash,
      definition, policy: { kind: "latest-complete", subsequentBlocks: 0 }, complete: String(complete),
      blockHash: await blockHash(db, schema, complete), frameworkReady: runtime.frameworkReady,
      readinessReason: status.readiness.reason, observationRevision: status.observationRevision };
    return work(db, schema, frame);
  });
}

async function deployment(db, config) {
  const rows = (await db.query("SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1", ["8453:" + config.native.contract])).rows;
  need(rows.length === 1 && rows[0].contract === config.native.contract && rows[0].start_block === config.native.startBlock &&
    rows[0].indexer_mode === "legacy" && rows[0].halted === false &&
    (rows[0].cursor === null || decimal(rows[0].cursor) && hex(rows[0].cursor_hash)), "same_unhalted_public_compatibility_deployment_required");
  return rows[0];
}

async function publicStateParity(support, source, schema, target, config) {
  const id = "8453:" + config.native.contract;
  const native = (await source.query(`SELECT tournament_id::text AS id,state FROM ${schema}.arena_tournament WHERE deployment=$1 ORDER BY tournament_id LIMIT 1001`, [id])).rows;
  const projected = (await target.query("SELECT id::text,state FROM yunipals_arena.tournament WHERE deployment=$1 ORDER BY id LIMIT 1001", [id])).rows;
  need(native.length <= MAX_STATES && canonical(native.map((row) => ({ id: row.id, state: support.nativeTournamentState(row.state) }))) ===
    canonical(projected), "same_complete_native_and_official_projected_tournament_state_required");
  const nativeCredit = (await source.query(`SELECT wallet,amount::text FROM ${schema}.arena_credit WHERE deployment=$1 ORDER BY wallet LIMIT 10001`, [id])).rows;
  const projectedCredit = (await target.query("SELECT wallet,amount::text FROM yunipals_arena.credit WHERE deployment=$1 ORDER BY wallet LIMIT 10001", [id])).rows;
  need(nativeCredit.length <= 10000 && canonical(nativeCredit) === canonical(projectedCredit), "same_complete_native_and_projected_public_credit_required");
  return hash({ tournaments: projected, credits: projectedCredit });
}

export async function projectBatch(support, sourcePool, targetPool, config) {
  checked(config);
  const target = await targetPool.connect();
  let locked = false, transaction = false;
  try {
    await support.targetCatalog(target, config.provision, true);
    locked = (await target.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["arena/project/8453:" + config.native.contract])).rows[0]?.locked === true;
    if (!locked) return { status: "busy", providerCalls: 0 };
    await target.query("INSERT INTO yunipals_arena.deployment(id,contract,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      ["8453:" + config.native.contract, config.native.contract, config.native.startBlock]);
    return await nativeSnapshot(support, sourcePool, config, async (source, schema, frame) => {
      await target.query("BEGIN"); transaction = true;
      const saved = await deployment(target, config), through = saved.cursor === null ? BigInt(config.native.startBlock) - 1n : BigInt(saved.cursor);
      need(through <= BigInt(frame.complete), "public_cursor_must_not_exceed_current_native_complete_boundary");
      const before = await sourcePrefix(source, schema, config, through), actual = await targetPrefix(target, config, through);
      need(canonical(before) === canonical(actual), "actual_public_prefix_must_equal_current_native_canonical_events");
      if (saved.cursor !== null) need((await canonicalBoundaryHash(source, schema, config, through)).blockHash === saved.cursor_hash, "prior_projected_native_boundary_changed");
      let end = through + BigInt(config.maximumBlocks) < BigInt(frame.complete) ? through + BigInt(config.maximumBlocks) : BigInt(frame.complete);
      let all = await sourcePrefix(source, schema, config, end), pending = all.filter((row) => BigInt(row.block_number) > through);
      if (pending.length > config.maximumEvents) {
        const excluded = BigInt(pending[config.maximumEvents].block_number);
        const whole = pending.filter((row) => BigInt(row.block_number) < excluded);
        end = whole.length ? BigInt(whole[whole.length - 1].block_number) : through;
        need(end > through, "one_native_block_exceeds_bounded_reducer_batch");
        all = all.filter((row) => BigInt(row.block_number) <= end);
        pending = all.filter((row) => BigInt(row.block_number) > through);
      }
      if (end < BigInt(frame.complete)) {
        // Historical chain_block witnesses are pruned after4096 blocks. Stop at
        // an actual full native event block, or an existing retained witness.
        // No hash is inferred for an arbitrary empty block between events.
        const witnessed = pending.length ? BigInt(pending[pending.length - 1].block_number) :
          BigInt((await source.query(`SELECT max(block_number)::text AS block_number FROM ${schema}.chain_block
            WHERE chain_id=8453 AND block_number>$1::bigint AND block_number<=$2::bigint`, [String(through), String(end)])).rows[0]?.block_number ?? through);
        need(witnessed > through, "batch_window_requires_actual_native_boundary_increase_maximum_blocks");
        end = witnessed;
        all = all.filter((row) => BigInt(row.block_number) <= end);
        pending = all.filter((row) => BigInt(row.block_number) > through);
      }
      need(pending.length <= config.maximumEvents && pending.every((row) => frame.definition.events.includes(row.event_name)), "bounded_defined_native_event_batch_required");
      const reducer = await support.publicOnlyPool({ connect: async () => ({ query: (text, args) => target.query(text, args), release() {} }) }).connect();
      for (const row of pending) await support.projectEvent(reducer, "8453:" + config.native.contract,
        { blockNumber: BigInt(row.block_number), blockHash: row.block_hash, transactionHash: row.transaction_hash,
          logIndex: row.log_index, eventName: row.event_name, args: row.args });
      need(canonical(await targetPrefix(target, config, end)) === canonical(all), "exact_projected_native_prefix_before_cursor_commit_required");
      const caughtUp = end === BigInt(frame.complete), stateSha256 = caughtUp ? await publicStateParity(support, source, schema, target, config) : null;
      const boundary = await canonicalBoundaryHash(source, schema, config, end), boundaryHash = boundary.blockHash;
      need((await target.query("UPDATE yunipals_arena.deployment SET cursor=$2,cursor_hash=$3,finalized_at=CASE WHEN $4 THEN now() ELSE finalized_at END WHERE id=$1",
        ["8453:" + config.native.contract, String(end), boundaryHash, caughtUp])).rowCount === 1, "one_owned_derived_cursor_update_required");
      await target.query("COMMIT"); transaction = false;
      return { status: caughtUp ? "caught-up" : "advanced", frame, targetCursor: String(end), targetHash: boundaryHash,
        boundaryWitnessKind: boundary.witnessKind,
        nativePrefixSha256: hash(all), nativePrefixEvents: all.length, publicStateSha256: stateSha256,
        batchEvents: pending.length, providerCalls: 0, nativeDatabaseWrites: 0, privateDatabaseWrites: 0,
        officialReducerBodyChanged: false, historicalDepth3ScannerSuccessClaimed: false };
    });
  } catch (error) {
    if (transaction) { await target.query("ROLLBACK"); transaction = false; }
    throw error;
  } finally {
    if (locked) await target.query("SELECT pg_advisory_unlock(hashtext($1))", ["arena/project/8453:" + config.native.contract]);
    target.release();
  }
}

export async function inspectCurrent(support, sourcePool, targetPool, config, writer = false) {
  return nativeSnapshot(support, sourcePool, config, async (source, schema, frame) => {
    const target = await targetPool.connect();
    try {
      const catalog = await support.targetCatalog(target, config.provision, writer);
      await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const saved = await deployment(target, config);
      need(saved.cursor === frame.complete && saved.cursor_hash === frame.blockHash && saved.finalized_at &&
        Math.abs(Date.now() - new Date(saved.finalized_at).getTime()) <= 180000, "fresh_derived_cursor_must_equal_current_native_complete_boundary");
      const native = await sourcePrefix(source, schema, config, frame.complete), projected = await targetPrefix(target, config, frame.complete);
      need(canonical(native) === canonical(projected), "complete_derived_canonical_prefix_changed");
      const state = await publicStateParity(support, source, schema, target, config);
      await target.query("ROLLBACK");
      return { validated: true, frame, catalog, targetCursor: saved.cursor, targetHash: saved.cursor_hash,
        nativePrefixSha256: hash(native), nativePrefixEvents: native.length, publicStateSha256: state,
        providerCalls: 0, databaseWrites: 0, historicalDepth3ScannerSuccessClaimed: false };
    } finally { try { await target.query("ROLLBACK"); } finally { target.release(); } }
  });
}

async function runtime(config) {
  const support = await import(new URL("./arena-inverse-support.mjs", import.meta.url).href);
  if(config.targetWriter===false){
    const sourcePool=support.nativeReadPoolClient(config.nativeReadPoolFd,config.readPoolIdentity);
    const targetPool=support.publicReadPoolClient(config.publicReadPoolFd,config.readPoolIdentity);
    return {support,sourcePool,targetPool,close:async()=>{await targetPool.end();await sourcePool.end();}};
  }
  const require = createRequire("/opt/yunipals-unified/releases/264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24/apps/yunipals-market-api/package.json");
  const { Pool } = require("pg");
  for (const [raw, user, database] of [[config.sourceUrl, config.sourceRole.name, "yunipals_backfill"],
    [config.targetUrl, config.provision.writerRole.name, config.provision.database.name],
    [config.publicReaderUrl,config.provision.readerRole.name,config.provision.database.name]]) {
    const url = new URL(raw);
    need(["postgres:", "postgresql:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      decodeURIComponent(url.username) === user && decodeURIComponent(url.pathname.slice(1)) === database && (url.port || "5432") === "5432",
      "exact_existing_local_native_and_public_target_credentials_required");
  }
  const bounds = { max: 1, statement_timeout: 30000, query_timeout: 35000, lock_timeout: 2000, connectionTimeoutMillis: 3000,
    idle_in_transaction_session_timeout: 120000 };
  const sourcePool = support.sharedReadPool(new Pool({ ...bounds, connectionString: config.sourceUrl, application_name: "arena_native_derived_source",
    options: "-c default_transaction_read_only=on" }));
  const targetReadPool=support.sharedReadPool(new Pool({...bounds,connectionString:config.publicReaderUrl,application_name:'arena_derived_public_read_shared',
    options:'-c default_transaction_read_only=on'}));
  const targetPool = new Pool({ ...bounds, connectionString: config.targetUrl, application_name: "arena_native_derived_target" });
  sourcePool.on("error", () => {}); targetPool.on("error", () => {});
  need(process.env.LISTEN_PID===String(process.pid)&&process.env.LISTEN_FDS==='1','one_actual_systemd_root_socket_required');
  const server=await support.serveNativeReadPool(sourcePool,{fd:3,path:config.readPoolSocket,
    identity:{...config.readPoolIdentity,runtimeEpoch:support.serviceRuntimeEpoch()},targetPool:targetReadPool});
  return { support, sourcePool, targetPool, close: async()=>{await server.close();await targetPool.end();await targetReadPool.end();await sourcePool.end();} };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length) { console.log(JSON.stringify({ format: FORMAT, staticOnly: true, databaseWrites: 0, providerCalls: 0, serviceActions: 0 })); return; }
  need(args.length === 3 && ["--run", "--inspect"].includes(args[0]), "explicit_derived_projector_action_required");
  need(hostname() === "yunipals-main" && process.versions.node === "24.18.1", "fixed_native_projector_host_and_node_required");
  let config;
  if (args[0] === "--run") {
    need(args[1] === "--public-config" && path.isAbsolute(args[2]) && userInfo().username === "yunipals-arena-native-derived", "owned_derived_service_configuration_required");
    const raw = readFileSync(args[2]); config = checked(JSON.parse(raw));
    const directory = process.env.CREDENTIALS_DIRECTORY;
    need(directory === "/run/credentials/yunipals-arena-native-derived-projector-v1.service", "exact_systemd_existing_credentials_directory_required");
    for (const [name, key, field] of [["native.env", "ARENA_INDEXER_DATABASE_URL", "sourceUrl"], ["writer.env", "ARENA_PUBLIC_ROLLBACK_DATABASE_URL", "targetUrl"],
      ['reader.env','ARENA_PUBLIC_ROLLBACK_DATABASE_URL','publicReaderUrl']]) {
      const credential = readFileSync(path.join(directory, name));
      need(hash(credential) === config.credentialSha256[name], "same_existing_projector_credential_bytes_required");
      const rows = credential.toString("utf8").trim().split("\n");
      need(rows.length === 1 && rows[0].startsWith(key + "="), "one_exact_existing_credential_key_required");
      config[field] = rows[0].slice(key.length + 1);
    }
    config.targetWriter = true;
  } else {
    need(args[1] === "--config-fd" && /^[0-9]+$/.test(args[2]) && userInfo().username === "postgres", "restricted_readonly_inspector_and_config_required");
    const fd = Number(args[2]), info = fstatSync(fd);
    need(info.isFile() && info.uid === 0 && info.gid === 0 && info.nlink === 0 && (info.mode & 511) === 384 && info.size <= 100000 &&
      readlinkSync("/proc/self/fd/" + fd).startsWith("/memfd:arena-native-derived-config"), "sealed_root_native_projector_configuration_required");
    config = checked(JSON.parse(readFileSync(fd))); config.targetWriter = false;
    const descriptors=[config.nativeReadPoolFd,config.publicReadPoolFd];
    need(descriptors.every((value)=>Number.isInteger(value)&&value>=3&&value!==fd)&&new Set(descriptors).size===2,
      'two_distinct_actual_root_delegated_read_channels_required');
    for(const value of descriptors){const row=fstatSync(value);need(row.isSocket()&&row.uid===0&&row.gid===0,
      'actual_root_connected_read_pool_socket_descriptors_required');}
  }
  const active = await runtime(config);
  let stopped = false, sequence = 0;
  process.once("SIGTERM", () => { stopped = true; }); process.once("SIGINT", () => { stopped = true; });
  try {
    do {
      const result = args[0] === "--inspect" ? await inspectCurrent(active.support, active.sourcePool, active.targetPool, config, config.targetWriter === true)
        : await projectBatch(active.support, active.sourcePool, active.targetPool, config);
      console.log(canonical({ format: FORMAT, processId: process.pid, sequence: ++sequence, observedAt: new Date().toISOString(), result }));
      if (args[0] === "--inspect") break;
      await setTimeout(config.pollMilliseconds);
    } while (!stopped);
  } finally { await active.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.log(JSON.stringify({ format: FORMAT, completed: false, fixedCode: "native_derived_projector_refused", providerCalls: 0 })); process.exitCode = 1; });

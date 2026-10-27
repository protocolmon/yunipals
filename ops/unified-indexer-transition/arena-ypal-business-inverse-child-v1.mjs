// Retain the authenticated source-switch transactions in a new owner domain.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v1";
export const TEMPLATE =
  "/opt/yunipals-unified/operations/free-replay-20261020/arena-modern-public-rollback-v1.mjs";
export const TEMPLATE_SHA =
  "f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

export const EXTERNAL_WORK_SQL = `SELECT jsonb_build_object(
 'provider',(SELECT count(*)::int FROM yunipals_arena.provider_task WHERE deployment=$1 AND state NOT IN('completed','failed','incomplete','cancelled')),
 'identity',(SELECT count(*)::int FROM yunipals_arena.identity_job WHERE deployment=$1 AND state NOT IN('ready','failed')),
 'transaction',(SELECT count(*)::int FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND (state NOT IN('confirmed','reverted') OR NOT receipt_finalized)),
 'client',(SELECT count(*)::int FROM yunipals_arena.client_transaction WHERE deployment=$1 AND state NOT IN('indexed','failed')),
 'media',(SELECT count(*)::int FROM yunipals_arena.media_job WHERE deployment=$1 AND state NOT IN('ready','needs-attention'))
) AS value`;

export async function externalWork(db, deployment) {
  const value = (await db.query(EXTERNAL_WORK_SQL, [deployment])).rows[0]?.value;
  if (
    !value ||
    Object.keys(value).sort().join() !==
      "client,identity,media,provider,transaction" ||
    !Object.values(value).every((count) => Number.isSafeInteger(count) && count === 0)
  ) {
    throw new Error("outstanding_external_work_requires_owned_halt_and_reconciliation");
  }
  return value;
}

export function extendLedgerSource(raw) {
  if (createHash("sha256").update(raw).digest("hex") !== "e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf") {
    throw new Error("exact_actual_ordinary_private_ledger_source_required");
  }
  const source = raw.toString("utf8");
  const before = '"request_id,wallet,metadata,provider_id,profile_hash"';
  if (source.split(before).length !== 2) throw new Error("one_owned_identity_reservation_ledger_seam_required");
  return source.replace(before, '"request_id,wallet,metadata,provider_id,profile_hash,reserved_microusd"');
}

function currentSource(raw) {
  if (sha(raw) !== TEMPLATE_SHA) {
    throw new Error("exact_frozen_business_inverse_transactions_required");
  }
  let source = raw.toString("utf8");
  const replace = (before, after) => {
    if (source.split(before).length !== 2) {
      throw new Error("one_exact_business_inverse_wire_seam_required");
    }
    source = source.replace(before, after);
  };
  replace(
    'export const FORMAT = "yunipals-arena-modern-public-rollback-child-v1";',
    `export const FORMAT = ${JSON.stringify(FORMAT)};`
  );
  replace(
    'export const SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";',
    'export const SOURCE = "e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234";'
  );
  replace(
    'export const ROOT = "/opt/yunipals-unified/releases/" + SOURCE;',
    'export const ROOT = "/opt/yunipals-unified/releases/264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";'
  );
  replace(
    'export const PROFILE_ID = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";',
    'export const PROFILE_ID = "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff";'
  );
  replace(
    'a.format==="yunipals-arena-modern-public-rollback-authority-v1"',
    'a.format==="yunipals-arena-ypal-business-inverse-authority-v1"'
  );
  // The native workers remain e6bc. Only the recovery support facade changes.
  const start = source.indexOf("export async function loadRuntime(payload,cutoverBytes) {");
  const end = source.indexOf("export async function main(action,authorityFd,childFd,cutoverFd) {", start);
  if (start < 0 || end < 0) {
    throw new Error("one_exact_business_inverse_runtime_constructor_required");
  }
  source = source.slice(0, start) + RUNTIME + "\n" + source.slice(end);
  replace(
    "export async function main(action,authorityFd,childFd,cutoverFd) {",
    "export async function main(action,authorityFd,childFd,cutoverFd,readPoolFd) {"
  );
  replace(
    "const runtime=await loadRuntime(payload,readFileSync(cutoverFd));",
    "const runtime=await loadRuntime(payload,readFileSync(cutoverFd),readPoolFd,action);"
  );
  replace(
    "if(!halted) await runtime.source.read(\"0\",{requiredThroughBlock:BigInt(payload.floor.block)});",
    "if(!halted){await runtime.externalWork(db);await runtime.source.read(\"0\",{requiredThroughBlock:BigInt(payload.floor.block)});}"
  );
  replace(
    'const service={pool,deployment:DEPLOYMENT,nativeSource:runtime.source,assertSourceSelection:async db=>{',
    'const service={pool,deployment:DEPLOYMENT,nativeSource:runtime.source,assertSourceSelection:async db=>{await runtime.externalWork(db);'
  );
  // This module has no legacy scanner entrypoint, even when executed directly.
  const scanner = source.indexOf('export const SCANNER_UNIT=');
  if (scanner < 0) throw new Error("exact_frozen_scanner_tail_required");
  return source.slice(0, scanner);
}

const RUNTIME = `export async function loadRuntime(payload,cutoverBytes,readPoolFd,action) {
  need(payload.nativeReleaseId==="0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3" &&
    payload.cutoverChildSha256==="e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf" &&
    hash(cutoverBytes)===payload.cutoverChildSha256,"exact_actual_ordinary_cutover_ledger_required");
  const ledgerBytes=Buffer.from((${extendLedgerSource.toString()})(cutoverBytes));
  const {retainedLedger}=await import("data:text/javascript;base64,"+ledgerBytes.toString("base64"));
  const req=createRequire(ROOT+"/apps/yunipals-market-api/package.json"),pg=req("pg");
  const bounds={max:1,connectionTimeoutMillis:3000,statement_timeout:10000,query_timeout:15000,lock_timeout:2000,idle_in_transaction_session_timeout:15000};
  const operational=new pg.Pool({...bounds,host:"/var/run/postgresql",port:15438,database:"yunipals_arena",user:"postgres",application_name:"arena_ypal_business_inverse_owner"});
  operational.on("error",()=>{});
  if(action==="reconcile"){
    need(payload.readPoolKind==="operational-reconcile" && payload.readPoolIdentity===null,"explicit_operational_readonly_reconcile_without_projection_claim_required");
    return {operational,retainedLedger,close:()=>operational.end()};
  }
  const support=payload.support;
  need(support && /^[a-f0-9]{64}$/.test(support.artifactDigest) && /^[a-f0-9]{64}$/.test(support.facadeSha256),"actual_support_artifact_and_facade_required");
  const file="/opt/yunipals-unified/arena-recovery-support/"+support.artifactDigest+"/dist/arena-inverse-support.mjs";
  const metadata=fs.lstatSync(file),bytes=readFileSync(file);
  need(metadata.isFile() && metadata.uid===0 && metadata.gid===0 && metadata.nlink===1 && (metadata.mode&18)===0 && hash(bytes)===support.facadeSha256,"actual_protected_recovery_support_facade_required");
  const facade=await import(pathToFileURL(file).href);
  need(hash(readFileSync(file))===support.facadeSha256,"recovery_support_changed_during_import");
  const {ArenaRollbackSource,arenaRollbackSourceId,NativeArenaSource,ArenaSourceSwitch,arenaSourceSwitchVerifier,publicReadPoolClient}=facade;
  const {createPublicClient,http}=req("viem"),{base}=req("viem/chains");
  need(payload.targetKind==="legacy_rollback" && payload.readPoolKind==="target" && payload.readPoolIdentity &&
    Number.isInteger(readPoolFd) && readPoolFd>=3 && fs.fstatSync(readPoolFd).isSocket() && typeof publicReadPoolClient==="function",
    "actual_root_delegated_shared_target_pool_without_new_reader_connection_required");
  const target=publicReadPoolClient(readPoolFd,payload.readPoolIdentity);
  for(const pool of [operational,target])pool.on("error",()=>{});
  need(payload.rpc.url==="http://127.0.0.1:19222/unified" && payload.rpc.profileId==="0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff","actual_ordinary_Base_evidence_route_required");
  const point=createPublicClient({chain:base,transport:http(payload.rpc.url,{retryCount:0,timeout:5000,fetchOptions:{headers:{"x-yunipals-unified-rpc-profile":payload.rpc.profileId,"x-yunipals-rpc-workload":"unified_evidence"}}})});
  const targetId=payload.targetKind==="legacy_rollback"?arenaRollbackSourceId(payload.targetUrl,CONTRACT,BigInt(START)):payload.nativeReleaseId;
  const source=payload.targetKind==="legacy_rollback"?new ArenaRollbackSource(target,targetId,CONTRACT,BigInt(START),payload.floor,point):new NativeArenaSource(target,targetId,CONTRACT,BigInt(START));
  const externalWork=async db=>{const value=(await db.query(${JSON.stringify(EXTERNAL_WORK_SQL)},[DEPLOYMENT])).rows[0]?.value;need(value && Object.keys(value).sort().join()==="client,identity,media,provider,transaction" && Object.values(value).every(v=>Number.isSafeInteger(v)&&v===0),"outstanding_external_work_requires_owned_halt_and_reconciliation");return value;};
  return {operational,target,point,targetId,source,retainedLedger,ArenaSourceSwitch,verifySwitch:arenaSourceSwitchVerifier(point),externalWork,close:()=>Promise.all([operational.end(),target.end()])};
}`;

export async function composition(raw = readFileSync(TEMPLATE)) {
  const source = currentSource(raw);
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

export async function main(...descriptors) {
  return (await composition()).main(...descriptors);
}

// Import and direct execution construct no runtime and perform no operation.

#!/usr/bin/env node
/** Compatible source recovery only. No schema, strategy/provider or signer import. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, fstatSync, readlinkSync, writeSync, fsyncSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { pathToFileURL } from "node:url";

export const SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";
export const ROOT = "/opt/yunipals-unified/releases/" + SOURCE;
export const DEPLOYMENT = "8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca";
export const CONTRACT = DEPLOYMENT.slice(5);
export const START = "52648146";
export const PROFILE_ID = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
export const FORMAT = "yunipals-arena-modern-public-rollback-child-v1";
const hash = b => createHash("sha256").update(b).digest("hex");
export const canonical = value => JSON.stringify(value, (_, v) => {
  if(typeof v === "bigint") return v.toString();
  return v && typeof v === "object" && !Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;
});
export function need(value, code) { if (!value) throw new Error(code); }
export const PUBLIC_TABLES = ["chain_event", "credit", "deployment", "tournament"];
const PRIVATE_READ = "SELECT seat,commitment FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat";
const PRIVATE_WRITE = "UPDATE yunipals_arena.frozen_input SET revealed_at=now() WHERE deployment=$1 AND tournament_id=$2 AND input_hash=$3";

/** The official projector mixes public state with optional legacy disclosure.
 * Only those exact two private statements are suppressed; every public query,
 * transaction, lock and cursor update is executed unchanged. Unknown SQL fails.
 * Public state is calculated before/independently of the disclosure branch.
 */
export function publicOnlyPool(pool, counters = {privateDisclosureReadsSkipped:0, privateDisclosureWritesSkipped:0}) {
  return { connect: async () => {
    const db = await pool.connect();
    return { query: async (text, args) => {
      need(typeof text === "string", "fixed_official_projector_sql_required");
      if (text === PRIVATE_READ) { counters.privateDisclosureReadsSkipped++; return {rows:[],rowCount:0}; }
      if (text === PRIVATE_WRITE) { counters.privateDisclosureWritesSkipped++; return {rows:[],rowCount:0}; }
      const relations = [...text.matchAll(/yunipals_arena\.([a-z_]+)/g)].map(x => x[1]);
      need(relations.every(x => PUBLIC_TABLES.includes(x)), "public_only_projection_relation_required");
      need(relations.length || /^(BEGIN|COMMIT|ROLLBACK|SELECT pg_(try_advisory_lock|advisory_unlock)\(hashtext\(\$1\)\)( AS locked)?)$/.test(text), "fixed_projector_control_statement_required");
      return db.query(text, args);
    }, release: () => db.release() };
  }};
}
export function readonly(config) {
  const u = new URL(config.connectionString);
  need(["postgres:","postgresql:"].includes(u.protocol), "postgres_target_required");
  const options = (u.searchParams.get("options") ?? "") + " -c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000";
  const bounds = {statement_timeout:10000,lock_timeout:2000,query_timeout:15000,connectionTimeoutMillis:3000};
  u.searchParams.set("options", options);
  for (const [k,v] of Object.entries(bounds)) u.searchParams.set(k,String(v));
  return {...config,...bounds,options,connectionString:u.href};
}
export function emit(value, fd=1) {
  const s=fstatSync(fd);
  if (value.phase.endsWith("_intent") || value.phase.endsWith("_committed")) need(s.isFile() && s.uid===0 && s.nlink===1 && (s.mode&511)===384,"durable_private_owner_journal_required");
  writeSync(fd,canonical({format:FORMAT,...value})+"\n");
  try {fsyncSync(fd);} catch(e) { if (!["EINVAL","ENOTSUP"].includes(e.code) || value.phase.endsWith("_intent") || value.phase.endsWith("_committed")) throw e; }
}
export function authority(fd, action, payload, ownSha) {
  const s=fstatSync(fd), a=JSON.parse(readFileSync(fd));
  need(s.isFile() && s.uid===0 && s.gid===0 && s.nlink===0 && (s.mode&511)===384 && s.size<4096 && readlinkSync("/proc/self/fd/"+fd).startsWith("/memfd:arena-public-root-authority"),"sealed_root_authority_required");
  need(a.format==="yunipals-arena-modern-public-rollback-authority-v1" && a.action===action && a.payloadSha256===hash(payload) && a.childSha256===ownSha,"exact_private_action_authority_required");
  return a;
}
export async function identities(db) {
  const r=await db.query("SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 ORDER BY tournament_id",[DEPLOYMENT]);
  need(r.rows.length<=1000 && r.rows.every(x=>x.incarnation!=="legacy"),"bounded_native_private_identities_required");
  return r.rows;
}
export function verifyIdentities(actual,expected) {
  if(!expected)return;
  need(Array.isArray(expected) && expected.length<=1000 && expected.every(old=>actual.some(now=>canonical(now)===canonical(old))),"prior_native_identity_or_cipher_context_changed");
}
export async function selected(db) {
  const rows=(await db.query("SELECT epoch::text,kind,source_id,accepted_block::text,accepted_hash,review_hash FROM yunipals_arena.source_selection WHERE deployment=$1",[DEPLOYMENT])).rows;
  need(rows.length===1,"actual_post_native_selected_epoch_required");return rows[0];
}
export function sameSelection(a,b) {return canonical(a)===canonical(b);}
export async function targetCatalog(db, expected, writer=false) {
  const role=(await db.query("SELECT current_user AS name,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,current_database() AS database,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,inet_server_addr()::text AS host,inet_server_port() AS port")).rows[0];
  need(role.name===(writer?expected.writerRole.name:expected.readerRole.name) && role.oid===(writer?expected.writerRole.oid:expected.readerRole.oid) && role.database_oid===expected.databaseOid,"actual_isolated_target_role_and_database_required");
  const attrs=(await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user")).rows[0];
  need(attrs.rolcanlogin && ["rolsuper","rolcreatedb","rolcreaterole","rolinherit","rolreplication","rolbypassrls"].every(k=>!attrs[k]),"nonowner_noninheriting_public_source_role_required");
  const owned=(await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n;
  const member=(await db.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR roleid=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n;
  need(owned===0 && member===0,"no_public_source_ownership_or_memberships_required");
  const rows=(await db.query(`SELECT c.relname,c.oid::int AS oid,c.relkind,has_table_privilege(current_user,c.oid,'SELECT') AS s,has_table_privilege(current_user,c.oid,'INSERT') AS i,has_table_privilege(current_user,c.oid,'UPDATE') AS u,has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_arena' AND c.relkind IN('r','p','v','m','f') ORDER BY c.relname`)).rows;
  need(rows.length===4 && rows.every((r,i)=>r.relname===PUBLIC_TABLES[i] && r.oid===expected.tables[r.relname] && r.relkind==="r" && r.s && !r.extra && r.i===writer && r.u===(writer&&r.relname!=="chain_event")),"exact_four_public_table_effective_permissions_required");
  const schema=(await db.query("SELECT has_schema_privilege(current_user,'yunipals_arena','USAGE') AS usage,has_schema_privilege(current_user,'yunipals_arena','CREATE') AS create,has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS extra")).rows[0];
  need(schema.usage && !schema.create && !schema.extra,"no_public_source_schema_database_creation_required");
  const ambient=(await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema','yunipals_arena') AND n.nspname !~ '^pg_toast|^pg_temp' AND c.relkind IN('r','p','v','m','f') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")).rows[0].n;
  need(ambient===0,"no_nonpublic_source_relation_access_required");
  return {name:role.name,oid:role.oid,databaseOid:role.database_oid,host:role.host,port:role.port,tables:expected.tables,writer};
}
export async function inspect(runtime,payload) {
  const db=await runtime.operational.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const selection=await selected(db);need(sameSelection(selection,payload.expectedSelection),"selected_epoch_or_source_changed");
    const mode=(await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[DEPLOYMENT])).rows[0];
    need(mode?.indexer_mode==="unified","compatible_native_mode_required");
    const native=await identities(db);
    verifyIdentities(native,payload.expectedIdentities);
    if(payload.retainedLedger) await runtime.retainedLedger(db,payload.retainedLedger);
    const ledger=await runtime.retainedLedger(db);
    const operationalIdentity=(await db.query("SELECT current_database() AS database,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,inet_server_addr()::text AS host,inet_server_port() AS port")).rows[0];
    await db.query("ROLLBACK");
    const target=payload.targetKind==="legacy_rollback"?await targetCatalog(runtime.target,payload.provision):
      (await runtime.target.query("SELECT current_user AS name,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,current_database() AS database,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS databaseOid,inet_server_addr()::text AS host,inet_server_port() AS port")).rows[0];
    if(payload.targetKind==="unified") need(target.name==="arena_native_reader" && target.oid===payload.nativeSourceRole.oid && target.databaseOid===17584,"actual_pinned_native_source_reader_required");
    need(!(operationalIdentity.host===target.host && operationalIdentity.port===target.port && operationalIdentity.database_oid===target.databaseOid),"isolated_public_database_required");
    const coverage=await runtime.source.read("0",{requiredThroughBlock:BigInt(payload.floor.block)});
    need(coverage.releaseId===runtime.targetId && BigInt(coverage.indexedThroughBlock)>=BigInt(payload.floor.block),"target_complete_coverage_below_floor");
    return {selection,mode,identities:native,retainedLedger:ledger,target,coverage:{sourceId:coverage.releaseId,indexedThroughBlock:coverage.indexedThroughBlock},floor:payload.floor};
  } finally {try{await db.query("ROLLBACK");}catch{}db.release();}
}
export async function mutateMode(runtime,payload,halted,out=emit) {
  const db=await runtime.operational.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",["arena/source-selection/"+DEPLOYMENT]);
    need(sameSelection(await selected(db),payload.expectedSelection),"mode_change_epoch_cas_required");
    const before=(await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[DEPLOYMENT])).rows[0];
    need(before?.indexer_mode==="unified" && before.halted!==halted,"exact_mode_transition_required");
    await runtime.retainedLedger(db,payload.retainedLedger);verifyIdentities(await identities(db),payload.expectedIdentities);
    if(!halted) await runtime.source.read("0",{requiredThroughBlock:BigInt(payload.floor.block)});
    need((await db.query("UPDATE yunipals_arena.deployment SET halted=$2 WHERE id=$1 AND indexer_mode='unified' AND halted=$3",[DEPLOYMENT,halted,!halted])).rowCount===1,"mode_transition_cas_failed");
    const phase=halted?"halt":"unhalt",xid=(await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
    out({phase:phase+"_commit_intent",xid,expectedSelection:payload.expectedSelection});
    await db.query("COMMIT");out({phase:phase+"_committed",xid});return{xid,halted};
  } catch(e){try{await db.query("ROLLBACK");}catch{}throw e;}finally{db.release();}
}
export async function switchSource(runtime,payload,out=emit) {
  let row;
  const pool={connect:async()=>{const db=await runtime.operational.connect();return{query:async(text,args)=>{
    if(typeof text==="string" && /^(INSERT INTO|UPDATE) yunipals_arena\.source_selection/.test(text)) row={deployment:args[0],epoch:args[1],kind:args[2],sourceId:args[3],block:args[4],hash:args[5],reviewHash:args[6]};
    if(text==="COMMIT") {need(row,"official_selector_row_required");const xid=(await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;out({phase:"selection_commit_intent",xid,selectedRow:row});const result=await db.query(text,args);out({phase:"selection_committed",xid,selectedRow:row});return result;}
    return db.query(text,args);
  },release:()=>db.release()};}};
  const service={pool,deployment:DEPLOYMENT,nativeSource:runtime.source,assertSourceSelection:async db=>{
    const mode=(await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[DEPLOYMENT])).rows[0];
    need(mode?.indexer_mode==="unified" && mode.halted,"halted_native_consumers_required");
    need(sameSelection(await selected(db),payload.expectedSelection),"reviewed_predecessor_epoch_required");
    await runtime.retainedLedger(db,payload.retainedLedger);verifyIdentities(await identities(db),payload.expectedIdentities);
  }};
  const change=new runtime.ArenaSourceSwitch(service,{kind:payload.targetKind,sourceId:runtime.targetId,source:runtime.source},runtime.point,runtime.verifySwitch,payload.floor);
  return change.run(payload.applyHash);
}
export async function reconcile(runtime,payload) {
  const db=await runtime.operational.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const mode=(await db.query("SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[DEPLOYMENT])).rows[0], selection=await selected(db), transactions=[];
    for(const row of payload.intents??[]) {need(/^[1-9][0-9]*$/.test(row.xid),"own_recorded_xid_required");transactions.push({phase:row.phase,xid:row.xid,status:(await db.query("SELECT pg_xact_status($1::xid8) AS status",[row.xid])).rows[0].status});}
    const ledger=await runtime.retainedLedger(db,payload.retainedLedger),native=await identities(db);verifyIdentities(native,payload.expectedIdentities);
    await db.query("ROLLBACK");return{mode,selection,transactions,retainedLedger:ledger,identities:native};
  } finally {try{await db.query("ROLLBACK");}catch{}db.release();}
}
export async function loadRuntime(payload,cutoverBytes) {
  const app=ROOT+"/apps/yunipals-market-api",req=createRequire(app+"/package.json"),{tsImport}=req("tsx/esm/api");
  const load=name=>tsImport(app+"/src/arena/live/"+name+".ts",{parentURL:pathToFileURL(app+"/package.json").href,tsconfig:app+"/tsconfig.json"});
  const [{ArenaRollbackSource,arenaRollbackSourceId},{NativeArenaSource},{ArenaSourceSwitch,arenaSourceSwitchVerifier}]=await Promise.all([load("rollbackSource"),load("nativeSource"),load("sourceSwitch")]);
  need(hash(cutoverBytes)===payload.cutoverChildSha256,"exact_sealed_cutover_child_required");
  const {retainedLedger}=await import("data:text/javascript;base64,"+cutoverBytes.toString("base64"));
  const pg=req("pg"),{createPublicClient,http}=req("viem"),{base}=req("viem/chains");
  const bounds={max:1,connectionTimeoutMillis:3000,statement_timeout:10000,query_timeout:15000,lock_timeout:2000,idle_in_transaction_session_timeout:15000};
  const operational=new pg.Pool({...bounds,host:"/var/run/postgresql",port:15438,database:"yunipals_arena",user:"postgres",application_name:"arena_public_recovery_owner"});
  const target=new pg.Pool(readonly({...bounds,connectionString:payload.targetUrl,application_name:"arena_public_recovery_read"}));
  for(const pool of [operational,target]) pool.on("error",()=>{});
  need(payload.rpc.url==="http://127.0.0.1:19202/unified" && payload.rpc.profileId===PROFILE_ID,"existing_free_only_proxy_profile_required");
  const point=createPublicClient({chain:base,transport:http(payload.rpc.url,{retryCount:0,timeout:15000,fetchOptions:{headers:{"x-yunipals-unified-rpc-profile":payload.rpc.profileId,"x-yunipals-rpc-workload":"unified_evidence"}}})});
  const targetId=payload.targetKind==="legacy_rollback"?arenaRollbackSourceId(payload.targetUrl,CONTRACT,BigInt(START)):payload.nativeReleaseId;
  const source=payload.targetKind==="legacy_rollback"?new ArenaRollbackSource(target,targetId,CONTRACT,BigInt(START),payload.floor,point):new NativeArenaSource(target,targetId,CONTRACT,BigInt(START));
  return {operational,target,point,targetId,source,retainedLedger,ArenaSourceSwitch,verifySwitch:arenaSourceSwitchVerifier(point),close:()=>Promise.all([operational.end(),target.end()])};
}
export async function main(action,authorityFd,childFd,cutoverFd) {
  need(hostname()==="yunipals-main" && userInfo().username==="postgres" && process.execPath==="/opt/node-v24.18.1/bin/node" && process.env.TSX_DISABLE_CACHE==="1","fixed_postgres_peer_required");
  const input=readFileSync(0);need(input.length<1000000,"bounded_private_input_required");authority(authorityFd,action,input,hash(readFileSync(childFd)));
  const payload=JSON.parse(input),s=fstatSync(cutoverFd);
  need(s.isFile() && s.uid===0 && s.gid===0 && s.nlink===0 && (s.mode&511)===384 && s.size<200000 && readlinkSync("/proc/self/fd/"+cutoverFd).startsWith("/memfd:arena-public-cutover-child"),"anonymous_exact_cutover_code_required");
  for(const k of ["log","warn","error","info","debug"])console[k]=()=>{};
  const runtime=await loadRuntime(payload,readFileSync(cutoverFd));
  try {
    const output=action==="inspect"?await inspect(runtime,payload):action==="halt"?await mutateMode(runtime,payload,true):action==="unhalt"?await mutateMode(runtime,payload,false):action==="switch"?await switchSource(runtime,payload):action==="reconcile"?await reconcile(runtime,payload):null;
    need(output,"fixed_public_recovery_action_required");emit({phase:"result",action,result:output});
  } finally{await runtime.close();}
}

export const SCANNER_UNIT="yunipals-arena-public-rollback-v1.service";
export const SCANNER_PROBE_UNIT="yunipals-arena-public-rollback-reader-probe-v1.service";
/** Narrow copy of the accepted descriptor/mount checks for this NEW namespace.
 * The actual scanner never supplies an alternate unit. A second fixed name is
 * reserved solely for the synthetic no-DB/no-RPC qualification service.
 */
export function readScannerCredential(io=fs, expectedUnit=SCANNER_UNIT, env=process.env) {
  const refuse=()=>{throw new Error("trusted_scanner_credential_required");};
  need([SCANNER_UNIT,SCANNER_PROBE_UNIT].includes(expectedUnit),"fixed_scanner_or_synthetic_probe_unit_required");
  const directory="/run/credentials/"+expectedUnit,path=directory+"/public-db.env";
  need(env.CREDENTIALS_DIRECTORY===directory,"exact_scanner_credential_namespace_required");
  const same=(a,b)=>["dev","ino","mode","uid","gid","size","mtimeMs","ctimeMs"].every(k=>a[k]===b[k]);
  const trusted=(p,mode)=>{const s=io.lstatSync(p);if(!s.isDirectory() || s.uid!==0 || s.gid!==0 || (s.mode&18)!==0 || (mode!==undefined&&(s.mode&4095)!==mode))refuse();return s;};
  const decode=x=>x.replace(/\\([0-7]{3})/g,(_,o)=>String.fromCharCode(parseInt(o,8)));
  const mount=()=>{
    const rows=io.readFileSync("/proc/self/mountinfo","utf8").trim().split("\n").map(line=>({line,fields:line.split(" ")})).filter(({fields:f})=>{const p=decode(f[4]??"");return p===directory||path.startsWith(p+"/")||p===path;}).sort((a,b)=>(b.fields[4]?.length??0)-(a.fields[4]?.length??0));
    const row=rows[0];if(!row || decode(row.fields[4]??"")!==directory || rows.filter(x=>decode(x.fields[4]??"")===directory).length!==1)refuse();
    const f=row.fields,sep=f.indexOf("-"),opts=new Set((f[5]??"").split(","));
    if(!/^[1-9][0-9]*$/.test(f[0]??"") || sep<6 || f[sep+1]!=="tmpfs" || f.slice(6,sep).some(x=>x!=="unbindable"&&!/^(shared|master|propagate_from):[1-9][0-9]*$/.test(x)) || opts.has("rw") || ["ro","nosuid","nodev","noexec","nosymfollow"].some(x=>!opts.has(x)))refuse();
    return {id:f[0],line:row.line};
  };
  const before=io.lstatSync(path);
  if(!before.isFile() || before.uid!==0 || before.gid!==0 || (before.mode&4095)!==288 || before.size<1 || before.size>10000)refuse();
  trusted("/run");trusted("/run/credentials");const dir=trusted(directory,360),initial=mount();
  const fd=io.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    if(!same(before,io.fstatSync(fd)))refuse();
    if(io.readFileSync("/proc/self/fdinfo/"+fd,"utf8").match(/^mnt_id:\s*([1-9][0-9]*)$/m)?.[1]!==initial.id)refuse();
    const value=io.readFileSync(fd,"utf8");
    if(!same(before,io.fstatSync(fd)) || !same(before,io.lstatSync(path)))refuse();
    trusted("/run");trusted("/run/credentials");
    if(!same(dir,trusted(directory,360)) || initial.line!==mount().line)refuse();
    return value.trim();
  } finally {io.closeSync(fd);}
}

export function writerUrl(env) {
  const rows=env.trim().split("\n");
  need(rows.length===1 && rows[0].startsWith("ARENA_PUBLIC_ROLLBACK_DATABASE_URL="),"exact_one_key_public_writer_file_required");
  const url=rows[0].slice("ARENA_PUBLIC_ROLLBACK_DATABASE_URL=".length);
  need(url.length<8192 && !/[\r\n'"`]/.test(url),"literal_public_writer_url_required");
  const u=new URL(url);need(["postgres:","postgresql:"].includes(u.protocol) && u.hostname==="127.0.0.1" && (u.port||"5432")==="5432" && u.pathname==="/yunipals_arena_public_rollback" && u.username==="arena_public_rollback_writer","fixed_local_public_writer_endpoint_required");
  return url;
}
export async function scanner(config, env=process.env, stop={requested:false}) {
  need(config.format==="yunipals-arena-public-scanner-v1" && config.sourceDigest===SOURCE && config.rpc.url==="http://127.0.0.1:19202/unified" && config.freeOnly===true && config.paidAuthority===false && config.rpc.profileId===PROFILE_ID,"exact_free_only_public_scanner_configuration_required");
  const app=ROOT+"/apps/yunipals-market-api",req=createRequire(app+"/package.json"),{tsImport}=req("tsx/esm/api");
  const load=name=>tsImport(app+"/src/arena/live/"+name+".ts",{parentURL:pathToFileURL(app+"/package.json").href,tsconfig:app+"/tsconfig.json"});
  const {projectConfirmedArena}=await load("projector");
  need(typeof env.CREDENTIALS_DIRECTORY==="string" && /^\/run\/credentials\/[a-z0-9_.-]+$/.test(env.CREDENTIALS_DIRECTORY),"actual_scanner_credential_mount_required");
  const url=writerUrl(readScannerCredential(fs,SCANNER_UNIT,env));
  const pg=req("pg"),{createPublicClient,http}=req("viem"),{base}=req("viem/chains");
  const pool=new pg.Pool({connectionString:url,max:1,application_name:"arena_isolated_public_scanner",statement_timeout:10000,lock_timeout:2000,connectionTimeoutMillis:3000,idle_in_transaction_session_timeout:15000});
  const point=createPublicClient({chain:base,transport:http(config.rpc.url,{retryCount:0,timeout:15000,fetchOptions:{headers:{"x-yunipals-unified-rpc-profile":config.rpc.profileId,"x-yunipals-rpc-workload":"unified_source"}}})});
  const counters={privateDisclosureReadsSkipped:0,privateDisclosureWritesSkipped:0};
  let timer,poolFailed=false;
  pool.on("error",()=>{poolFailed=true;stop.requested=true;stop.wake?.();});
  const wait=ms=>new Promise(resolve=>{timer=setTimeout(resolve,ms);stop.wake=()=>{clearTimeout(timer);resolve();};});
  try {
    const db=await pool.connect();try{await targetCatalog(db,config.provision,true);}finally{db.release();}
    need(await point.getChainId()===8453,"Base_public_scanner_required");
    const restricted=publicOnlyPool(pool,counters);
    while(!stop.requested){
      const result=await projectConfirmedArena(restricted,point,{id:DEPLOYMENT,contract:CONTRACT,startBlock:BigInt(START)});
      need(result.status!=="halted","isolated_confirmed_history_changed");
      writeSync(1,canonical({format:"yunipals-arena-public-scan-v1",status:result.status,...result.block?{block:result.block}:{},...counters})+"\n");
      await wait(result.status==="advanced"?1000:30000);
    }
    need(!poolFailed,"public_scanner_connection_failed");
  }finally{clearTimeout(timer);await pool.end();}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]==="--scanner") {
    const stop={requested:false};
    for(const s of ["SIGTERM","SIGINT"])process.on(s,()=>{stop.requested=true;stop.wake?.();});
    try {await scanner(JSON.parse(readFileSync(process.argv[3],"utf8")),process.env,stop);}catch{writeSync(2,"Isolated public scanner refused. No private state restored.\n");process.exitCode=1;}
  }else throw new Error("root_authority_entrypoint_only");
}

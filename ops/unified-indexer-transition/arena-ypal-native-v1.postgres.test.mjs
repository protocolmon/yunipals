/** Isolated PostgreSQL16 fixture; no production endpoint, provider or signer.
 * Only reviewOrigins' three fixed production metadata fields are adapted to
 * this newly created scratch database. Every migration, data, trigger, lock,
 * identity adoption, selector CAS and transaction acknowledgement is real SQL.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, closeSync, rmSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { commitAdoption, publishSource, unhaltDeployment, reconcile, originKey, onlineReview, retainedLedger, event as emitEvent, DEPLOYMENT, SOURCE_ID } from "./arena-ypal-native-v1.mjs";
import { reviewOrigins, privateSeal, adoptOrigins } from "./arena-ypal-native-v1.adoption.mjs";
const root=resolve(fileURLToPath(new URL("../..",import.meta.url))),app=join(root,"apps/yunipals-market-api");
assert.equal(process.cwd(),app,"Run from apps/yunipals-market-api with Node24 --import tsx.");
const info=JSON.parse(execFileSync("/usr/bin/docker",["inspect","yunipals-unified-arena-test-20261020"],{encoding:"utf8",timeout:5000,maxBuffer:100000}))[0];
assert.equal(info.Config.Image,"postgres:16.15");assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"],[{HostIp:"127.0.0.1",HostPort:"55441"}]);
const req=createRequire(join(app,"package.json")),{Pool}=req("pg");
const load=n=>import(pathToFileURL(join(app,"src/arena/live",n+".ts")));
const [{migrateArena},{projectEvent},{adoptLegacyTournamentIdentity},{ArenaSourceSwitch},{assertArenaSourceBinding},{StrategyCipher}]=await Promise.all(["schema","projection","tournamentIdentity","sourceSwitch","sourceSelection","crypto"].map(load));
const {manifestDigest}=await import(pathToFileURL(join(root,"packages/yunipals-indexer-server/src/identity.ts")));
const dbname="arena_direct_"+randomBytes(6).toString("hex"),base="postgres://postgres:arena-local-test@127.0.0.1:55441/";
const admin=new Pool({connectionString:base+"postgres",max:1}),pool=new Pool({connectionString:base+dbname,max:2,statement_timeout:10000,lock_timeout:2000});
const scratch=mkdtempSync(join(tmpdir(),"arena-direct-native-"));
const journal=join(scratch,"owner.jsonl"),fd=openSync(journal,"wx",0o600);chmodSync(journal,0o600);
let created=false,commits=0,failCommitAck=false,abortCommit=false;
const rows=()=>readFileSync(journal,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const emit=x=>emitEvent(x,fd), h=x=>"0x"+x.repeat(64),rules=h("c"),poolHash=h("d"),headHash=h("e");
const sourceMap=new Map(),blocks=new Map([[52900000n,headHash]]),signed="0x12345678",providerId="retained-provider-id";
const cipher=new StrategyCipher(randomBytes(32));
let unexpectedRequests=0;globalThis.fetch=async()=>{unexpectedRequests++;throw Error("Real HTTP forbidden");};
function wrapped(real){return {query:async(t,p)=>{
  if(t==="COMMIT"){
    const last=rows().at(-1);assert(last&&last.phase.endsWith("_commit_intent"),"Durable XID intent must precede actual COMMIT");
    const stat=(await real.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;assert.equal(last.xid,stat);
    if(abortCommit){abortCommit=false;throw Error("fixture_abort_before_commit");}
    const result=await real.query(t,p);commits++;if(failCommitAck){failCommitAck=false;throw Error("fixture_lost_commit_ack");}return result;
  }
  const result=await real.query(t,p);
  if(typeof t==="string"&&t.includes("current_database() AS database")&&t.includes("other_sessions")){
    assert.equal(result.rows[0].database,dbname);assert.equal(result.rows[0].port,"5432");assert.equal(result.rows[0].owner,"postgres");assert.equal(result.rows[0].other_sessions,0);
    return {...result,rows:result.rows.map(r=>({...r,database:"yunipals_arena",port:"15438",owner:"yunipals_arena_owner"}))};
  }return result;
},release:()=>real.release()};}
const operational={connect:async()=>wrapped(await pool.connect())};
const source={read:async(id,o)=>id==="0"?{releaseId:SOURCE_ID,indexedThroughBlock:"52900000",observedThroughBlock:"52900000"}:structuredClone(sourceMap.get(id)),list:async()=>({ids:[...sourceMap.keys()],indexedThroughBlock:"52900000",observedThroughBlock:"52900000"})};
const point={getChainId:async()=>8453,getBlock:async q=>q.blockTag?{number:52900000n,hash:headHash,timestamp:BigInt(Math.floor(Date.now()/1000))}:{number:q.blockNumber,hash:blocks.get(q.blockNumber),timestamp:BigInt(Math.floor(Date.now()/1000))}};
const verify=async o=>{assert.equal(o.releaseId,SOURCE_ID);assert.equal(blocks.get(BigInt(o.tournament.opened.blockNumber)),o.tournament.opened.blockHash);};
const runtime={operational,source,point,verify,verifySwitch:verify,reviewOrigins,privateSeal,adoptOrigins,adopt:adoptLegacyTournamentIdentity,ArenaSourceSwitch,assertArenaSourceBinding};
function forward(state,intents){
  const code="import json,runpy,sys\nm=runpy.run_path(sys.argv[1]);v=json.load(sys.stdin)\ntry: print(json.dumps(m['forward_phase'](v['state'],v['intents'],v['adoption'])))\nexcept m['CutoverFailure']: print(json.dumps({'refused':True}))";
  const result=JSON.parse(execFileSync("/usr/bin/python3",["-I","-c",code,join(root,"ops/unified-indexer-transition/arena-ypal-native-v1.py")],{input:JSON.stringify({state,intents,adoption:intents.find(x=>x.phase==="adoption_commit_intent")}),encoding:"utf8",timeout:5000,env:{PATH:"/usr/bin:/bin"}}));
  assert.notEqual(result.refused,true,"Owned forward boundary refused");return result;
}
try{
  await admin.query('CREATE DATABASE "'+dbname+'"');created=true;await migrateArena(pool);
  runtime.markers=(await pool.query("SELECT version,checksum FROM yunipals_arena.operational_migration ORDER BY version")).rows;assert.equal(runtime.markers.length,12);
  const expectedMarkers=JSON.parse(readFileSync(join(root,"ops/arena-consumer-release-review/operational-migrations.v1.json"),"utf8")).markers;
  assert.deepEqual(runtime.markers,expectedMarkers);
  await pool.query("INSERT INTO yunipals_arena.deployment(id,contract,start_block,cursor,cursor_hash,finalized_at) VALUES($1,$2,52648146,52900000,$3,now())",[DEPLOYMENT,DEPLOYMENT.slice(5),headHash]);
  for(const id of ["1","2"]){
    const n=52648146n+BigInt(id),tx=h(id),blockHash=h(id==="1"?"a":"b");blocks.set(n,blockHash);
    const db=await pool.connect();try{await db.query("BEGIN");await projectEvent(db,DEPLOYMENT,{blockNumber:n,blockHash,transactionHash:tx,logIndex:0,eventName:"TournamentOpened",args:{id:BigInt(id),deadline:1000n,rulesHash:rules,poolHash}});await db.query("COMMIT");}finally{db.release();}
    const state=(await pool.query("SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2",[DEPLOYMENT,id])).rows[0].state;
    const opened={id:DEPLOYMENT+":"+tx+":0",blockNumber:String(n),blockHash,transactionHash:tx,logIndex:0};
    sourceMap.set(id,{releaseId:SOURCE_ID,sourceId:"arena:"+DEPLOYMENT,indexedThroughBlock:"52900000",observedThroughBlock:"52900000",tournament:{deployment:DEPLOYMENT,id,state,opened,last:opened,inputFrozen:null,incarnation:manifestDigest({deployment:DEPLOYMENT,tournamentId:id,openedEventId:opened.id,openedBlockHash:blockHash})}});
  }
  const ciphertext=cipher.seal(DEPLOYMENT+"/1/seat/0",{text:"Retained private strategy"});
  await pool.query("INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext)VALUES($1,1,0,$2,$3,'0x12',$4)",[DEPLOYMENT,"0x"+"2".repeat(40),h("1"),ciphertext]);
  const requestId="00000000-0000-4000-8000-000000000001";
  await pool.query("INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,request,reserved_microusd,provider_id)VALUES($1,1,'referee','candidate',$2,'{}',700000,$3)",[DEPLOYMENT,requestId,providerId]);
  await pool.query("INSERT INTO yunipals_arena.transaction_intent(deployment,tournament_id,purpose,signer,nonce,raw_transaction,tx_hash)VALUES($1,1,'freeze-input',$2,1,$3,$4)",[DEPLOYMENT,"0x"+"3".repeat(40),signed,h("4")]);
  const before=await privateSeal(pool),expected=[...sourceMap.values()].map(originKey);
  const online=await onlineReview(pool,source,verify,runtime.markers,{block:"52900000",hash:headHash},point);
  assert.equal(online.requiredThroughBlock,"52900000");
  await assert.rejects(onlineReview(pool,source,verify,runtime.markers,{block:"52900000",hash:h("f")},point),/canonical_native_floor/);
  await assert.rejects(commitAdoption(runtime,[{id:"wrong"}],emit),/openings_changed/);
  assert.equal(commits,0);assert.equal(rows().length,0);assert.deepEqual(await privateSeal(pool),before);
  assert.equal((await pool.query("SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",[DEPLOYMENT])).rows[0].indexer_mode,"legacy");
  // Commit survives a deliberately lost SQL response. The same exact XID is
  // then read from PG, rather than inferring success from changed rows.
  failCommitAck=true;await assert.rejects(commitAdoption(runtime,expected,emit),/lost_commit_ack/);
  assert.equal(commits,1);let ledger=rows();assert.equal(ledger.at(-1).phase,"adoption_commit_intent");
  const retainedBaseline=ledger.find(x=>x.phase==="adoption_commit_intent").retainedLedger;
  const state=await reconcile(pool,ledger.filter(x=>x.phase.endsWith("_commit_intent")),privateSeal,retainedBaseline);
  assert.equal(state.retainedLedger.verified,true);
  assert.equal(forward(state,ledger.filter(x=>x.phase.endsWith("_commit_intent"))).phase,"publish");
  assert.equal(state.transactions[0].status,"committed");assert.equal(state.mode.halted,true);assert.equal(state.mode.indexer_mode,"unified");assert.equal(state.selection.length,0);
  assert(state.identities.every(x=>x.incarnation!=="legacy"&&x.bound_release_id===SOURCE_ID&&x.cipher_context===DEPLOYMENT+"/"+x.id));
  assert.deepEqual(await privateSeal(pool),before);
  const retained=(await pool.query("SELECT ciphertext,incarnation FROM yunipals_arena.submission WHERE deployment=$1",[DEPLOYMENT])).rows[0];assert.equal(retained.ciphertext,ciphertext);
  const provider=(await pool.query("SELECT request_id,provider_id FROM yunipals_arena.provider_task WHERE deployment=$1",[DEPLOYMENT])).rows[0];assert.deepEqual(provider,{request_id:requestId,provider_id:providerId});
  assert.equal((await pool.query("SELECT raw_transaction FROM yunipals_arena.transaction_intent WHERE deployment=$1",[DEPLOYMENT])).rows[0].raw_transaction,signed);
  await assert.rejects(commitAdoption(runtime,expected,emit),/initial_mode_cas/);assert.equal(commits,1);
  abortCommit=true;await assert.rejects(publishSource(runtime,{block:"52900000",hash:headHash},emit),/abort_before_commit/);assert.equal(commits,1);
  ledger=rows();const aborted=await reconcile(pool,ledger.filter(x=>x.phase.endsWith("_commit_intent")),privateSeal,retainedBaseline);
  assert.equal(aborted.transactions.at(-1).status,"aborted");assert.equal(forward(aborted,ledger.filter(x=>x.phase.endsWith("_commit_intent"))).phase,"publish");
  failCommitAck=true;await assert.rejects(publishSource(runtime,{block:"52900000",hash:headHash},emit),/lost_commit_ack/);assert.equal(commits,2);
  ledger=rows();const selectionIntent=ledger.filter(x=>x.phase==="selection_commit_intent").at(-1);assert(selectionIntent);assert(!ledger.some(x=>x.phase==="selection_committed"));
  const selected=await reconcile(pool,ledger.filter(x=>x.phase.endsWith("_commit_intent")),privateSeal,retainedBaseline);
  assert.equal(selected.transactions.filter(x=>x.status==="committed").length,2);assert.equal(selected.selection[0].epoch,selectionIntent.selectedRow.epoch);assert.equal(selected.selection[0].source_id,SOURCE_ID);
  assert.equal(forward(selected,ledger.filter(x=>x.phase.endsWith("_commit_intent"))).phase,"native");
  assert.deepEqual(selected.privateSeal.tables,before.tables);assert.equal(selected.privateSeal.aadSha256,before.aadSha256);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.source_switch_history")).rows[0].n,1);assert.equal(unexpectedRequests,0);
  await pool.query("UPDATE yunipals_arena.provider_task SET native_check_at=now()+interval '2 minutes' WHERE request_id=$1",[requestId]);
  assert.equal((await retainedLedger(pool,retainedBaseline)).verified,true);
  failCommitAck=true;await assert.rejects(unhaltDeployment(runtime,selectionIntent.selectedRow.epoch,{block:"52900000",hash:headHash},emit),/lost_commit_ack/);assert.equal(commits,3);
  ledger=rows();const done=await reconcile(pool,ledger.filter(x=>x.phase.endsWith("_commit_intent")),privateSeal,retainedBaseline);const finished=forward(done,ledger.filter(x=>x.phase.endsWith("_commit_intent")));
  assert.equal(finished.phase,"complete");assert.equal(finished.unhaltXid,ledger.find(x=>x.phase==="unhalt_commit_intent").xid);assert.equal(done.mode.halted,false);
  // Forward classification recognizes the committed unhalt, without issuing a
  // second UPDATE or creating a second source-switch history row.
  assert.equal(commits,3);assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.source_switch_history")).rows[0].n,1);
  const held=await pool.connect();try{
    await held.query("BEGIN");const xid=(await held.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;
    const extra={phase:"unhalt_commit_intent",xid,epoch:selectionIntent.selectedRow.epoch};const unknown=await reconcile(pool,[...ledger.filter(x=>x.phase.endsWith("_commit_intent")),extra],privateSeal,retainedBaseline);
    assert.equal(unknown.transactions.at(-1).status,"in progress");assert.throws(()=>forward(unknown,[...ledger.filter(x=>x.phase.endsWith("_commit_intent")),extra]));
  }finally{await held.query("ROLLBACK");held.release();}
  console.log(JSON.stringify({format:"yunipals-arena-ypal-native-local-postgres-v1",passed:true,postgres:"16.15",migrations:12,realCommitBoundaries:3,onlineReviewCanonicalFloorProven:true,preCommitFailureRolledBack:true,lostAcknowledgementsReconciledByActualXid:3,abortedSelectorForwardPublication:true,actualInProgressXidRefused:true,adoptedOrigins:2,ciphertextsAadProviderUuidSignedBytesPreserved:true,sourceSwitchHistoryRows:1,mutableRecoveryAllowedWithRetainedLedger:true,metadataFixtureOverrideOnly:["database","port","owner"],httpRequests:0,productionActions:0}));
}finally{closeSync(fd);await pool.end();if(created)await admin.query('DROP DATABASE "'+dbname+'" WITH (FORCE)');await admin.end();rmSync(scratch,{recursive:true,force:true});}

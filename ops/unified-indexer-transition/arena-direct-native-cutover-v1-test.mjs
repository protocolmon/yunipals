import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  validateAuthority, canonicalFloor, scopedReadOnly, originKey,
  SOURCE_ID, DEPLOYMENT, commitAdoption, publishSource, sealEqual, retainedLedger
} from "./arena-direct-native-cutover-v1.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
const h = "0x" + "a".repeat(64);
const meta = {isFile:()=>true,uid:0,gid:0,nlink:0,mode:0o100600,size:300};
const input=Buffer.from('{"internal":true}'), child="b".repeat(64);
const authority={format:"yunipals-arena-direct-native-root-authority-v1",action:"commit",payloadSha256:hash(input),planSha256:"c".repeat(64),childSha256:child};
test("anonymous root authority binds exact action, private payload and child",()=>{
  validateAuthority(meta,"/memfd:arena-direct-native-root-authority (deleted)",authority,"commit",input,child);
  for(const [key,value]of [["action","review"],["payloadSha256","d".repeat(64)],["childSha256","d".repeat(64)]])
    assert.throws(()=>validateAuthority(meta,"/memfd:arena-direct-native-root-authority (deleted)",{...authority,[key]:value},"commit",input,child));
  for(const change of [{uid:10},{gid:10},{nlink:1},{mode:0o100644},{size:2000}])assert.throws(()=>validateAuthority({...meta,...change},"/memfd:arena-direct-native-root-authority (deleted)",authority,"commit",input,child));
  assert.throws(()=>validateAuthority(meta,"/tmp/not-root-authority",authority,"commit",input,child));
});
function floorFixture(){
  return { source:{read:async()=>({releaseId:SOURCE_ID,indexedThroughBlock:"100"})}, point:{getChainId:async()=>8453,getBlock:async q=>q.blockTag?{number:100n,hash:h,timestamp:BigInt(Math.floor(Date.now()/1000))}:{number:90n,hash:h}},floor:{block:"90",hash:h}};
}
test("fresh floor requires actual canonical hash, coverage, Base and recent head",async()=>{
  const f=floorFixture();assert.deepEqual(await canonicalFloor(f.source,f.point,f.floor),f.floor);
  for(const change of [
    g=>g.point.getChainId=async()=>1,
    g=>g.point.getBlock=async()=>({number:100n,hash:"0x"+"b".repeat(64),timestamp:BigInt(Math.floor(Date.now()/1000))}),
    g=>g.source.read=async()=>({releaseId:SOURCE_ID,indexedThroughBlock:"89"}),
    g=>g.source.read=async()=>({releaseId:h,indexedThroughBlock:"100"}),
    g=>g.point.getBlock=async q=>({number:100n,hash:h,timestamp:1n})
  ]){const g=floorFixture();change(g);await assert.rejects(canonicalFloor(g.source,g.point,g.floor));}
});
test("readonly URL options and client bounds override hostile URL query without changing endpoint",()=>{
  const req=createRequire(new URL("../../apps/yunipals-market-api/package.json",import.meta.url)),{Client}=req("pg");
  const config=scopedReadOnly({connectionString:"postgres://role:fixture@127.0.0.1:5432/fixture?options=-c%20default_transaction_read_only%3Doff&statement_timeout=0&lock_timeout=0&query_timeout=0&connectionTimeoutMillis=0"});
  const p=new Client(config).connectionParameters;
  assert.equal(p.host,"127.0.0.1");assert.equal(p.user,"role");assert.equal(p.database,"fixture");
  assert.match(p.options, /default_transaction_read_only=off.*default_transaction_read_only=on/);
  assert.equal(Number(p.statement_timeout),10000);assert.equal(Number(p.lock_timeout),2000);assert.equal(Number(p.query_timeout),15000);assert.equal(config.connectionTimeoutMillis,3000);
});
test("opening binding excludes advancing last event but refuses a different release",()=>{
  const opened={id:"opening"},o={releaseId:SOURCE_ID,tournament:{deployment:DEPLOYMENT,id:"1",incarnation:h,opened,last:{id:"moving"}}};
  assert.deepEqual(originKey(o),{id:"1",incarnation:h,opened});assert.throws(()=>originKey({...o,releaseId:h}));
});
function adoptionFixture(){
  const calls=[],seal={tables:{submission:{count:1,sha256:"sealed"}},aadSha256:"aad",selectorsSha256:"s"}, origins=[{id:"1"}];
  let changed=false;
  const db={query:async(t)=>{calls.push(t);if(t.startsWith("UPDATE"))return{rowCount:1};if(t.includes("pg_current_xact_id"))return{rows:[{xid:"123"}]};return{rows:[]};},release:()=>calls.push("release")};
  const runtime={operational:{connect:async()=>db},source:{},verify:()=>{},markers:[],reviewOrigins:async()=>({observations:[{releaseId:SOURCE_ID,tournament:{deployment:DEPLOYMENT,id:"1",incarnation:h,opened:{id:"opened"}}}]}),privateSeal:async()=>({...seal,...changed?{aadSha256:"wrong"}:{}}),adoptOrigins:async()=>({privateSeal:seal}),adopt:()=>{}};
  return {runtime,calls,seal,expected:[{id:"1",incarnation:h,opened:{id:"opened"}}],change:()=>{runtime.adoptOrigins=async()=>{changed=true;return{privateSeal:seal};}}};
}
test("adoption emits its real transaction intent before COMMIT and ACK afterwards",async()=>{
  const f=adoptionFixture();await commitAdoption(f.runtime,f.expected,e=>f.calls.push(e.phase+":"+e.xid));
  assert(f.calls.indexOf("adoption_commit_intent:123")<f.calls.indexOf("COMMIT"));assert(f.calls.indexOf("COMMIT")<f.calls.indexOf("adoption_committed:123"));assert.equal(f.calls.at(-1),"release");
});
test("private seal or reviewed opening change rolls back without commit intent",async()=>{
  const f=adoptionFixture();f.change();await assert.rejects(commitAdoption(f.runtime,f.expected,e=>f.calls.push(e.phase)),/private_bytes/);assert(!f.calls.includes("COMMIT"));assert(f.calls.includes("ROLLBACK"));
  const g=adoptionFixture();await assert.rejects(commitAdoption(g.runtime,[{id:"different"}],()=>{}),/openings_changed/);assert(!g.calls.includes("COMMIT"));
});
test("official switch facade binds selector values and XID before its own COMMIT",async()=>{
  const calls=[],row={indexer_mode:"unified",halted:true};const db={query:async(t,p)=>{calls.push(t);if(t.includes("SELECT indexer_mode"))return{rows:[row]};if(t.includes("pg_current_xact_id"))return{rows:[{xid:"124"}]};return{rowCount:1,rows:[]};},release:()=>{}};
  class OfficialShape{constructor(service){this.service=service;}async run(review){const q=await this.service.pool.connect();try{await q.query("BEGIN");await this.service.assertSourceSelection(q);if(!review){await q.query("ROLLBACK");return{reviewHash:h};}await q.query("INSERT INTO yunipals_arena.source_selection VALUES($1,$2,$3,$4,$5,$6,$7)",[DEPLOYMENT,"epoch","unified",SOURCE_ID,"90",h,h]);await q.query("COMMIT");return{epoch:"epoch"};}finally{q.release();}}}
  const events=[];const r=await publishSource({operational:{connect:async()=>db},source:{},point:{},verifySwitch:()=>{},ArenaSourceSwitch:OfficialShape,assertArenaSourceBinding:async()=>{}},{block:"90",hash:h},e=>{events.push(e);calls.push(e.phase);});
  assert.equal(r.epoch,"epoch");assert.deepEqual(events.find(e=>e.phase==="selection_commit_intent").selectedRow,{deployment:DEPLOYMENT,epoch:"epoch",kind:"unified",sourceId:SOURCE_ID,block:"90",hash:h,reviewHash:h});assert(calls.indexOf("selection_commit_intent")<calls.indexOf("COMMIT"));
});
test("private seal equality ignores only selector/history digest",()=>{const a={tables:{submission:{sha256:"x"}},aadSha256:"y",selectorsSha256:"before"};assert(sealEqual(a,{...a,selectorsSha256:"after"}));assert(!sealEqual(a,{...a,aadSha256:"different"}));});
test("retained ciphertext rows bind full native incarnation and permit genuinely additional rows",async()=>{
  const original={deployment:DEPLOYMENT,tournament_id:"1",seat:0,incarnation:"0x"+"1".repeat(64),wallet:"wallet",commitment:"commit",signature:"signed",ciphertext:"sealed"};let bodies=[original];
  const db={query:async text=>({rows:text.includes(".submission ")?bodies.map(body=>({body})):[]})};
  const expected=await retainedLedger(db);assert.equal((await retainedLedger(db,expected)).verified,true);
  bodies=[{...original,incarnation:"0x"+"2".repeat(64)}];await assert.rejects(retainedLedger(db,expected),/retained_uuid/);
  bodies=[original,{...original,incarnation:"0x"+"2".repeat(64)}];assert.equal((await retainedLedger(db,expected)).verified,true);
  bodies=[];await assert.rejects(retainedLedger(db,expected),/retained_uuid/);
});

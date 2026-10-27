import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {publicOnlyPool,readonly,writerUrl,inspect,switchSource,mutateMode,sameSelection,verifyIdentities,readScannerCredential,SCANNER_UNIT,SCANNER_PROBE_UNIT,DEPLOYMENT} from "./arena-modern-public-rollback-v1.mjs";
const app=resolve(dirname(fileURLToPath(import.meta.url)),"../../apps/yunipals-market-api"),req=createRequire(app+"/package.json"),{tsImport}=req("tsx/esm/api");
const {projectEvent}=await tsImport(app+"/src/arena/live/projection.ts",{parentURL:pathToFileURL(app+"/package.json").href,tsconfig:app+"/tsconfig.json"});
const {automaticStrategy}=req("@protopals/yunipals-market-core/arena");
const H="0x"+"a".repeat(64),B="0x"+"b".repeat(64),CONTRACT=DEPLOYMENT.slice(5),ADDR=n=>"0x"+String(n).padStart(40,"0");
function reducerFixture(){
  const tables={events:[],tournaments:{},credit:{}},privateRows=[],calls=[];let reads=0,writes=0;
  const db={query:async(t,a=[])=>{
    calls.push(t);
    if(t.startsWith("INSERT INTO yunipals_arena.chain_event")){if(tables.events.some(x=>x[3]===a[3]&&x[4]===a[4]))return{rows:[],rowCount:0};tables.events.push(a);return{rows:[],rowCount:1};}
    if(t.startsWith("INSERT INTO yunipals_arena.tournament")){tables.tournaments[a[1]]=JSON.parse(a[2]);return{rows:[],rowCount:1};}
    if(t.startsWith("SELECT state FROM"))return{rows:[{state:structuredClone(tables.tournaments[a[1]])}]};
    if(t.startsWith("UPDATE yunipals_arena.tournament")){tables.tournaments[a[1]]=JSON.parse(a[2]);return{rows:[],rowCount:1};}
    if(t.startsWith("INSERT INTO yunipals_arena.credit")){tables.credit[a[1]]=(BigInt(tables.credit[a[1]]??"0")+BigInt(a[2])).toString();return{rows:[],rowCount:1};}
    if(t.startsWith("UPDATE yunipals_arena.credit")){assert(Object.hasOwn(tables.credit,a[1]));tables.credit[a[1]]=(BigInt(tables.credit[a[1]])+BigInt(a[2])).toString();return{rows:[],rowCount:1};}
    if(t.startsWith("SELECT seat,commitment FROM")){reads++;return{rows:privateRows};}
    if(t.startsWith("UPDATE yunipals_arena.frozen_input")){writes++;return{rows:[],rowCount:1};}
    if(t.startsWith("SELECT contract FROM"))return{rows:[{contract:CONTRACT}]};
    throw Error("unexpected_fixture_sql "+t);
  },release(){}};
  return {db,tables,calls,privateRows,counts:()=>({reads,writes})};
}
function events(id,automaticMask=0){
  let idx=0;const event=(eventName,args)=>({blockNumber:100n+BigInt(idx),blockHash:H,transactionHash:"0x"+(++idx).toString(16).padStart(64,"0"),logIndex:idx,eventName,args:{id:BigInt(id),...args}});
  const rows=[event("TournamentOpened",{deadline:1000n,rulesHash:H,poolHash:B}),event("TournamentTreasuryAssigned",{beneficiary:ADDR(6)}),event("JoinWindowStarted",{deadline:2000n})];
  for(let seat=0;seat<4;seat++)rows.push(event("Entered",{seat:BigInt(seat),player:ADDR(seat+1),nftChainId:8453n,collection:ADDR(10),tokenId:BigInt(seat+1)}));
  rows.push(event("IslandRequested",{requestId:1n}),event("RandomnessReceived",{word:123n}),event("IslandSelected",{islandId:1n,ticket:1n,beneficiary:ADDR(5)}),event("StrategiesOpened",{deadline:3000n}));
  if(automaticMask)rows.push(event("AutomaticStrategiesAssigned",{seatMask:BigInt(automaticMask)}));
  const commitments=Array.from({length:4},(_,s)=>(automaticMask&(1<<s))?automaticStrategy(CONTRACT,BigInt(id),s,H,123n).commitment:B);
  rows.push(event("InputFrozen",{deadline:4000n,inputHash:H,strategyCommitments:commitments}),event("ResultSettled",{resultHash:B,semifinalOneWinner:0n,semifinalTwoWinner:2n,champion:2n}),event("PayoutsReleased",{videoHash:H}));
  return{rows,commitments};
}
for(const mask of [0,5,15])test("official public reducer parity with private disclosure suppressed: mask="+mask,async()=>{
  const full=reducerFixture(),isolated=reducerFixture(),counters={privateDisclosureReadsSkipped:0,privateDisclosureWritesSkipped:0};
  const {rows,commitments}=events("1",mask);
  full.privateRows.push(...commitments.flatMap((commitment,seat)=>(mask&(1<<seat))?[]:[{seat,commitment}]));
  const db=await publicOnlyPool({connect:async()=>isolated.db},counters).connect();
  for(const row of rows){await projectEvent(full.db,DEPLOYMENT,row);await projectEvent(db,DEPLOYMENT,row);}
  // Duplicate replay must neither double credits nor reopen private disclosure.
  await projectEvent(full.db,DEPLOYMENT,rows.at(-1));await projectEvent(db,DEPLOYMENT,rows.at(-1));
  assert.deepEqual(isolated.tables,full.tables);assert.deepEqual(isolated.counts(),{reads:0,writes:0});
  assert.equal(full.counts().writes,1);assert.equal(counters.privateDisclosureReadsSkipped,1);
  assert.equal(isolated.tables.credit[ADDR(3)],"6000000");assert.equal(isolated.tables.credit[ADDR(5)],"400000");
});
test("unknown private statement and unknown control SQL never reach database",async()=>{
  const f=reducerFixture(),db=await publicOnlyPool({connect:async()=>f.db}).connect();
  for(const t of ["SELECT ciphertext FROM yunipals_arena.submission","DELETE FROM yunipals_arena.provider_task","CREATE TABLE private(x int)","SELECT pg_sleep(100)"])
    await assert.rejects(db.query(t));
  assert.equal(f.calls.length,0);
});
test("writer URL is a literal one-key credential for exact isolated endpoint",()=>{
  const u="postgresql://arena_public_rollback_writer:synthetic@127.0.0.1:5432/yunipals_arena_public_rollback";
  assert.equal(writerUrl("ARENA_PUBLIC_ROLLBACK_DATABASE_URL="+u+"\n"),u);
  for(const v of [u+"\nOTHER=1",u.replace("5432","15438"),u.replace("yunipals_arena_public_rollback","yunipals_arena"),u.replace("writer","reader"),"'"+u+"'"])
    assert.throws(()=>writerUrl("ARENA_PUBLIC_ROLLBACK_DATABASE_URL="+v));
});
test("readonly target URL overrides malicious DSN settings without changing endpoint",()=>{
  const {Client}=req("pg"),c=readonly({connectionString:"postgres://synthetic:fixture@127.0.0.1:5432/fixture?options=-c%20default_transaction_read_only%3Doff&statement_timeout=0"});
  const p=new Client(c).connectionParameters;assert.equal(p.host,"127.0.0.1");assert.match(p.options,/read_only=off.*read_only=on/);assert.equal(Number(p.statement_timeout),10000);
});
function stateFixture(){
  const selection={epoch:"initial",kind:"unified",source_id:H,accepted_block:"90",accepted_hash:H,review_hash:H},calls=[];
  const db={query:async(t,a)=>{calls.push(t);if(t.startsWith("SELECT epoch"))return{rows:[selection]};if(t.startsWith("SELECT indexer_mode"))return{rows:[{indexer_mode:"unified",halted:true}]};if(t.includes("tournament_identity"))return{rows:[{id:"1",incarnation:H}]};if(t.includes("pg_current_xact_id"))return{rows:[{xid:"123"}]};if(t.startsWith("UPDATE"))return{rowCount:1,rows:[]};return{rows:[{database:"operational",database_oid:1,host:"127.0.0.1",port:15438}]};},release(){}};
  return{selection,calls,db,payload:{expectedSelection:selection,targetKind:"unified",nativeSourceRole:{oid:12},floor:{block:"90",hash:H}},runtime:{operational:{connect:async()=>db},target:{query:async t=>{assert(!t.includes("pg_class"));return{rows:[{name:"arena_native_reader",oid:12,databaseOid:17584,host:"127.0.0.1",port:5432}]};}},retainedLedger:async()=>({verified:true}),source:{read:async()=>({releaseId:B,indexedThroughBlock:"100"})},targetId:B}};
}
test("return-to-native checks native role identity rather than four rollback tables",async()=>{
  const f=stateFixture(),r=await inspect(f.runtime,f.payload);assert.equal(r.target.name,"arena_native_reader");assert.equal(r.coverage.indexedThroughBlock,"100");
  f.payload.nativeSourceRole.oid=99;await assert.rejects(inspect(f.runtime,f.payload));
});
test("official source switch binds predecessor and journals actual XID before commit",async()=>{
  const f=stateFixture(),events=[];
  class Official{constructor(service){this.service=service;}async run(review){const d=await this.service.pool.connect();try{await d.query("BEGIN");await this.service.assertSourceSelection(d);if(!review){await d.query("ROLLBACK");return{applied:false,reviewHash:H};}await d.query("UPDATE yunipals_arena.source_selection SET epoch=$2",[DEPLOYMENT,"next","legacy_rollback",B,"90",H,H]);await d.query("COMMIT");return{applied:true,epoch:"next"};}finally{d.release();}}}
  const runtime={...f.runtime,ArenaSourceSwitch:Official};
  assert.equal((await switchSource(runtime,f.payload,e=>events.push(e))).applied,false);
  await switchSource(runtime,{...f.payload,targetKind:"legacy_rollback",applyHash:H},e=>{events.push(e);f.calls.push(e.phase);});
  assert(f.calls.indexOf("selection_commit_intent")<f.calls.lastIndexOf("COMMIT"));assert.equal(events.at(-1).phase,"selection_committed");assert.equal(events.at(-1).selectedRow.kind,"legacy_rollback");
  await assert.rejects(switchSource(runtime,{...f.payload,expectedSelection:{...f.selection,epoch:"foreign"}},()=>{}));
});
test("unhalt requires selected epoch CAS and preserved ledger before SQL",async()=>{
  const f=stateFixture(),events=[];await mutateMode(f.runtime,f.payload,false,e=>{events.push(e);f.calls.push(e.phase);});
  assert(f.calls.indexOf("unhalt_commit_intent")<f.calls.indexOf("COMMIT"));assert.equal(events.at(-1).xid,"123");
  const g=stateFixture();await assert.rejects(mutateMode(g.runtime,{...g.payload,expectedSelection:{...g.selection,epoch:"foreign"}},false,()=>{}));assert(!g.calls.includes("COMMIT"));
});

test("Python sorted JSON roundtrip preserves selection/identity equality",()=>{const f=stateFixture();assert(sameSelection(f.selection,JSON.parse(JSON.stringify(f.selection,Object.keys(f.selection).sort()))));const row={cipher_context:"original/aad",id:"1",incarnation:H};verifyIdentities([{...row}],JSON.parse(JSON.stringify([row])));assert.throws(()=>verifyIdentities([{...row,cipher_context:"changed"}],[row]));});

function credentialFixture(unit=SCANNER_UNIT) {
  const directory="/run/credentials/"+unit,path=directory+"/public-db.env",value="ARENA_PUBLIC_ROLLBACK_DATABASE_URL=synthetic-only\n";
  const regular={dev:1,ino:11,mode:0o100440,uid:0,gid:0,size:value.length,mtimeMs:1,ctimeMs:1,isFile:()=>true,isDirectory:()=>false};
  const dir={...regular,ino:12,mode:0o40550,isFile:()=>false,isDirectory:()=>true};
  const root={...dir,ino:13,mode:0o40755};
  let mounts=0,stats=0,dirStats=0,closed=0;
  const f={directory,path,value,regular,dir,env:{CREDENTIALS_DIRECTORY:directory},line:"55 42 0:12 / "+directory+" ro,nosuid,nodev,noexec,nosymfollow shared:657 master:526 - tmpfs tmpfs rw,size=1024",fdinfo:"pos:0\nmnt_id:\t55\n",afterFile:null,afterDir:null,afterMount:null};
  f.io={lstatSync(p){if(p===path){stats++;return stats>1&&f.afterFile?f.afterFile:f.regular;}if(p===directory){dirStats++;return dirStats>1&&f.afterDir?f.afterDir:f.dir;}assert(["/run","/run/credentials"].includes(p));return root;},openSync(p,flags){assert.equal(p,path);assert(flags&req("node:fs").constants.O_NOFOLLOW);return 17;},fstatSync(fd){assert.equal(fd,17);return f.fdStat??f.regular;},readFileSync(p){if(p==="/proc/self/mountinfo"){mounts++;return mounts>1&&f.afterMount?f.afterMount:f.line;}if(p==="/proc/self/fdinfo/17")return f.fdinfo;assert.equal(p,17);return f.value;},closeSync(fd){assert.equal(fd,17);closed++;}};
  f.closed=()=>closed;return f;
}
test("scanner namespace accepts actual root0440/private0550 readonly mount with kernel propagation tags",()=>{const f=credentialFixture();assert.equal(readScannerCredential(f.io,SCANNER_UNIT,f.env),f.value.trim());assert.equal(f.closed(),1);});
test("synthetic qualification unit is explicit and does not relax runtime namespace",()=>{const f=credentialFixture(SCANNER_PROBE_UNIT);assert.equal(readScannerCredential(f.io,SCANNER_PROBE_UNIT,f.env),f.value.trim());assert.throws(()=>readScannerCredential(f.io,SCANNER_UNIT,f.env));assert.throws(()=>readScannerCredential(f.io,"other.service",f.env));});
for(const [name,mutate] of [
  ["different credential directory",f=>f.env.CREDENTIALS_DIRECTORY+="/nested"],
  ["wrong file owner",f=>f.regular={...f.regular,uid:10}],
  ["wrong file group",f=>f.regular={...f.regular,gid:10}],
  ["group-readable ordinary file",f=>f.regular={...f.regular,mode:0o100640}],
  ["world-readable credential",f=>f.regular={...f.regular,mode:0o100444}],
  ["symlink credential",f=>f.regular={...f.regular,isFile:()=>false}],
  ["oversized credential",f=>f.regular={...f.regular,size:10001}],
  ["empty credential",f=>f.regular={...f.regular,size:0}],
  ["wrong private directory owner",f=>f.dir={...f.dir,uid:10}],
  ["wrong private directory mode",f=>f.dir={...f.dir,mode:0o40555}],
  ["writable mount",f=>f.line=f.line.replace(" ro,"," rw,")],
  ["missing nosymfollow",f=>f.line=f.line.replace(",nosymfollow","")],
  ["missing noexec",f=>f.line=f.line.replace(",noexec","")],
  ["wrong filesystem",f=>f.line=f.line.replace("- tmpfs","- ext4")],
  ["unknown propagation field",f=>f.line=f.line.replace("shared:657","unknown:657")],
  ["invalid propagation identity",f=>f.line=f.line.replace("shared:657","shared:0")],
  ["nested replacement mount",f=>f.line+="\n56 55 0:13 / "+f.path+" ro,nosuid,nodev,noexec,nosymfollow - tmpfs tmpfs rw"],
  ["duplicate namespace mount",f=>f.line+="\n"+f.line],
  ["wrong bound descriptor mount ID",f=>f.fdinfo="mnt_id:56\n"],
  ["descriptor inode replacement",f=>f.fdStat={...f.regular,ino:99}],
  ["file changed while read",f=>f.afterFile={...f.regular,ctimeMs:99}],
  ["directory changed while read",f=>f.afterDir={...f.dir,ino:99}],
  ["mount line changed while read",f=>f.afterMount=f.line.replace("master:526","master:527")]
])test("scanner credential refuses "+name,()=>{const f=credentialFixture();mutate(f);assert.throws(()=>readScannerCredential(f.io,SCANNER_UNIT,f.env));});

// Real isolated PG16 reducer/prefix/ACL controls. Native status/OIDs are fixture seams.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildArtifact } from "./arena-native-derived-support-build-v1.mjs";
import { projectBatch, inspectCurrent } from "./arena-native-derived-projector-v1.mjs";

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,"../..");
const require=createRequire(join(root,"apps/yunipals-market-api/package.json"));
const {Pool}=require("pg");
const url=process.env.ARENA_DERIVED_FIXTURE_URL;
assert.equal(url,"postgresql://postgres@127.0.0.1:56983/fixture","fixed_disposable_local_fixture_only");
const admin=new Pool({connectionString:url,max:1});
const sourceDB="ypal_native_derived_fixture",targetDB="ypal_public_derived_fixture";
const names=["arena_native_reader","ypal_derived_fixture_owner","ypal_derived_fixture_writer","ypal_derived_fixture_reader"];
const pools=[],databases=[],roles=[],checks=[];
const temporary=mkdtempSync(join(tmpdir(),"arena-derived-pg-"));
const H="0x"+"a".repeat(64),HASH=(n)=>"0x"+String(n).padStart(64,"0");
const contract="0xebd141b6ae36f74fe70b9139b262ee9771b72aca",deployment="8453:"+contract;
const floor=52648146n,wallet="0x"+"1".repeat(40),schema="unified_ypal_20261023_v1";
const makePool=(database,user="postgres")=>{const p=new Pool({host:"127.0.0.1",port:56983,database,user,max:2,statement_timeout:10000});pools.push(p);return p;};
let report;
try {
  for(const name of [sourceDB,targetDB]){
    assert.equal((await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[name])).rows[0].n,0);
    await admin.query('CREATE DATABASE "'+name+'"');databases.push(name);
  }
  for(const name of names){
    assert.equal((await admin.query("SELECT count(*)::int n FROM pg_roles WHERE rolname=$1",[name])).rows[0].n,0);
    await admin.query('CREATE ROLE "'+name+'" '+(name.endsWith("owner")?"NOLOGIN":"LOGIN")+' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');roles.push(name);
  }
  const sourceAdmin=makePool(sourceDB),targetAdmin=makePool(targetDB);
  await sourceAdmin.query(`REVOKE ALL ON DATABASE ${sourceDB} FROM PUBLIC;GRANT CONNECT ON DATABASE ${sourceDB} TO arena_native_reader;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}.canonical_event(id text,source_id text,chain_id int,address text,abi_hash text,name text,args jsonb,block_number bigint,block_hash text,transaction_hash text,log_index int);
    CREATE TABLE ${schema}.chain_block(chain_id int,block_number bigint PRIMARY KEY,block_hash text);
    CREATE TABLE ${schema}.arena_tournament(deployment text,tournament_id numeric,state jsonb);
    CREATE TABLE ${schema}.arena_credit(deployment text,wallet text,amount numeric);
    GRANT USAGE ON SCHEMA ${schema} TO arena_native_reader;GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO arena_native_reader`);
  await targetAdmin.query(`REVOKE ALL ON DATABASE ${targetDB} FROM PUBLIC;GRANT CONNECT ON DATABASE ${targetDB} TO ${names.slice(1).join(',')};GRANT CREATE ON DATABASE ${targetDB} TO ${names[1]}`);
  let ddl=readFileSync(join(root,"ops/arena-public-rollback-target-20261023/schema.sql"),"utf8");
  for(const [old,next]of [["arena_public_rollback_owner",names[1]],["arena_public_rollback_writer",names[2]],["arena_public_rollback_reader",names[3]]])ddl=ddl.replaceAll(old,next);
  await targetAdmin.query(ddl);checks.push("exact_four_public_table_DDL_and_nonowner_effective_ACLs");
  const catalog=(await targetAdmin.query("SELECT relname,oid::int FROM pg_class WHERE relnamespace='yunipals_arena'::regnamespace AND relkind='r'")).rows;
  const roleRows=(await admin.query("SELECT rolname,oid::int FROM pg_roles WHERE rolname=ANY($1)",[names])).rows;
  const oid=(name)=>roleRows.find((r)=>r.rolname===name).oid;
  const config={format:"yunipals-arena-native-derived-projector-v1-config",native:{releaseId:H,schema,schemaOid:"75963410",buildId:"71e2a7f3b7",manifestHash:HASH(2),
    sourceId:"arena:"+deployment,contract,startBlock:String(floor),abiHash:HASH(3)},sourceRole:{name:names[0],oid:oid(names[0])},
    provision:{databaseOid:(await admin.query("SELECT oid::int FROM pg_database WHERE datname=$1",[targetDB])).rows[0].oid,
      tables:Object.fromEntries(catalog.map((r)=>[r.relname,r.oid])),writerRole:{name:names[2],oid:oid(names[2])},readerRole:{name:names[3],oid:oid(names[3])}},
    maximumBlocks:1000,maximumEvents:1,pollMilliseconds:1000};
  const artifact=await buildArtifact(root);mkdirSync(join(temporary,"dist"));
  for(const [name,raw]of Object.entries(artifact.outputs))writeFileSync(join(temporary,name),raw);
  symlinkSync(join(root,"apps/yunipals-market-api/node_modules"),join(temporary,"node_modules"));
  const genuine=await import(pathToFileURL(join(temporary,"dist/arena-inverse-support.mjs")));
  const source=makePool(sourceDB,names[0]),writer=makePool(targetDB,names[2]),reader=makePool(targetDB,names[3]);
  let complete=floor+2n;
  const definition={id:config.native.sourceId,enabled:true,feature:"arena",chainId:8453,address:contract,startBlock:String(floor),abiHash:config.native.abiHash,
    events:["TournamentOpened","Entered","TournamentExpired","Claimed"]};
  // Only native framework status/physical OIDs are doubled. Event/prefix/state,
  // official reducer SQL, both transactions, permissions and target OIDs are real PG.
  const support={...genuine,readBoundRuntime:async()=>({frameworkReady:true,running:true,chains:[{chainId:8453,completeThroughBlock:complete}]}),
    createIndexerReader:async()=>({release:{id:H,schema,buildId:config.native.buildId,manifestHash:config.native.manifestHash,manifest:{sources:[definition]}},
      snapshot:async(_id,_policy,work)=>{const db=await source.connect();await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const observed={query:async(text,args)=>{
          if(text.startsWith("SELECT current_user AS role,")){const result=await db.query(text,args);result.rows[0].database_oid=17584;return result;}
          if(text==="SELECT oid::text AS oid FROM pg_namespace WHERE nspname=$1"){const result=await db.query(text,args);result.rows[0].oid="75963410";return result;}
          return db.query(text,args);}};
        try{return await work(observed,{status:{readiness:{reason:"ready"},anchor:{},errorCode:null,observationRevision:1}});}
        finally{await db.query("ROLLBACK");db.release();}}})};
  const event=async(n,name,args,log=0)=>{const tx=HASH(n+10);await sourceAdmin.query(`INSERT INTO ${schema}.canonical_event VALUES($1,$2,8453,$3,$4,$5,$6,$7,$8,$9,$10)`,
    ["8453:"+contract+":"+tx+":"+log,config.native.sourceId,contract,config.native.abiHash,name,args,String(floor+BigInt(n)),HASH(n+100),tx,log]);};
  for(let n=0;n<5;n++)await sourceAdmin.query(`INSERT INTO ${schema}.chain_block VALUES(8453,$1,$2)`,[String(floor+BigInt(n)),HASH(n+100)]);
  const state={id:"1",phase:"expired",deadline:123,rulesHash:H,poolHash:H,treasury:null,islandId:null,islandBeneficiary:null,requestId:null,randomWord:null,ticket:null,
    seats:[{seat:0,player:wallet,nftChainId:8453,collection:wallet,tokenId:"1"}],inputHash:null,commitments:null,resultHash:null,winners:null,videoHash:null,automaticStrategyMask:0};
  await event(0,"TournamentOpened",{id:"1",deadline:123,rulesHash:H,poolHash:H});
  await event(1,"Entered",{id:"1",seat:0,player:wallet,nftChainId:8453,collection:wallet,tokenId:"1"});
  await event(2,"TournamentExpired",{id:"1"});
  await sourceAdmin.query(`INSERT INTO ${schema}.arena_tournament VALUES($1,1,$2)`,[deployment,state]);
  await sourceAdmin.query(`INSERT INTO ${schema}.arena_credit VALUES($1,$2,2000000)`,[deployment,wallet]);
  // Real accepted indexing prunes old chain_block rows. Historical event-block
  // hashes remain actual canonical_event facts, never an arithmetic witness.
  await sourceAdmin.query(`DELETE FROM ${schema}.chain_block WHERE block_number<$1`,[String(complete)]);
  for(const status of ["advanced","advanced","caught-up"]){
    const batch=await projectBatch(support,source,writer,config);assert.equal(batch.status,status);
    assert.equal(batch.boundaryWitnessKind,status==="caught-up"?"retained-chain-block":"complete-native-event-block");
  }
  checks.push("pruned_historical_chain_blocks_use_complete_canonical_event_block_witnesses");
  let current=await inspectCurrent(support,source,reader,config);assert.equal(current.nativePrefixEvents,3);checks.push("genuine_official_reducer_three_bounded_transactions_and_full_prefix_state_credit_parity");
  await event(3,"Claimed",{player:wallet,amount:"1000000"});complete=floor+3n;
  await sourceAdmin.query(`UPDATE ${schema}.arena_credit SET amount=1000000`);
  assert.equal((await projectBatch(support,source,writer,config)).status,"caught-up");
  assert.equal((await inspectCurrent(support,source,reader,config)).nativePrefixEvents,4);checks.push("continuous_native_event_advance_without_RPC_or_scanner");
  await event(4,"Claimed",{player:wallet,amount:"500000"},0);await event(4,"Claimed",{player:wallet,amount:"500000"},1);complete=floor+4n;
  await sourceAdmin.query(`UPDATE ${schema}.arena_credit SET amount=0`);
  await assert.rejects(projectBatch(support,source,writer,config),/one_native_block_exceeds/);
  assert.equal((await targetAdmin.query("SELECT count(*)::int n FROM yunipals_arena.chain_event")).rows[0].n,4);checks.push("oversized_single_block_rolls_back_without_partial_reduction");
  config.maximumEvents=10;assert.equal((await projectBatch(support,source,writer,config)).status,"caught-up");
  current=await inspectCurrent(support,source,reader,config);assert.equal(current.nativePrefixEvents,6);checks.push("complete_dense_native_block_is_atomic");
  await sourceAdmin.query(`UPDATE ${schema}.canonical_event SET args='{}' WHERE name='Entered'`);
  await assert.rejects(projectBatch(support,source,writer,config),/actual_public_prefix/);
  await assert.rejects(inspectCurrent(support,source,reader,config),/complete_derived_canonical_prefix/);checks.push("changed_native_historical_payload_refuses_project_and_current");
  await sourceAdmin.query(`UPDATE ${schema}.canonical_event SET args=$1 WHERE name='Entered'`,[{id:"1",seat:0,player:wallet,nftChainId:8453,collection:wallet,tokenId:"1"}]);
  await sourceAdmin.query(`UPDATE ${schema}.chain_block SET block_hash=$1 WHERE block_number=$2`,[HASH(999),String(complete)]);
  await assert.rejects(projectBatch(support,source,writer,config),/prior_projected_native_boundary|same_actual_native_event_or_retained_block_boundary/);checks.push("changed_native_boundary_hash_refuses_without_reorg_reset");
  await sourceAdmin.query(`UPDATE ${schema}.chain_block SET block_hash=$1 WHERE block_number=$2`,[HASH(104),String(complete)]);
  await targetAdmin.query(`GRANT UPDATE ON yunipals_arena.chain_event TO ${names[2]}`);
  await assert.rejects(projectBatch(support,source,writer,config),/exact_four_public_table_effective_permissions/);checks.push("unexpected_effective_target_privilege_refused");
  await targetAdmin.query(`REVOKE UPDATE ON yunipals_arena.chain_event FROM ${names[2]}`);
  await targetAdmin.query("UPDATE yunipals_arena.deployment SET finalized_at=now()-interval '10 minutes'");
  await assert.rejects(inspectCurrent(support,source,reader,config),/fresh_derived_cursor/);checks.push("stale_equal_cursor_is_not_current");
  await projectBatch(support,source,writer,config);
  await sourceAdmin.query(`UPDATE ${schema}.arena_credit SET amount=1`);
  await assert.rejects(inspectCurrent(support,source,reader,config),/same_complete_native_and_projected_public_credit/);checks.push("complete_credit_state_mismatch_refused");
  await sourceAdmin.query(`UPDATE ${schema}.arena_credit SET amount=0`);
  complete=floor+2000n;
  await sourceAdmin.query(`DELETE FROM ${schema}.chain_block`);
  await sourceAdmin.query(`INSERT INTO ${schema}.chain_block VALUES(8453,$1,$2)`,[String(complete),HASH(2000)]);
  config.maximumBlocks=10;
  await assert.rejects(projectBatch(support,source,writer,config),/batch_window_requires_actual_native_boundary/);
  assert.equal((await targetAdmin.query("SELECT cursor::text FROM yunipals_arena.deployment")).rows[0].cursor,String(floor+4n));
  config.maximumBlocks=10000;
  assert.equal((await projectBatch(support,source,writer,config)).status,"caught-up");
  assert.equal((await inspectCurrent(support,source,reader,config)).targetCursor,String(complete));
  checks.push("empty_pruned_gap_refuses_unwitnessed_bounded_window_then_uses_actual_complete_boundary");
  report={checksPassed:checks.length,checks,providerCalls:0,productionAccess:0,nativeFrameworkStatusAndPhysicalOIDFixtures:true};
}finally{
  await Promise.all(pools.map((p)=>p.end()));
  for(const name of databases)await admin.query('DROP DATABASE "'+name+'"');
  for(const name of roles)await admin.query('DROP ROLE "'+name+'"');
  await admin.end();rmSync(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify({...report,fixtureDatabasesAndRolesRemoved:true},null,2));

import assert from 'node:assert/strict';
import * as original from './arena-native-derived-projector-v1.mjs';
import * as observer from './arena-native-derived-boundary-diagnostic-v1.mjs';
import {capture,eligible,WINDOW_MILLISECONDS,MAXIMUM_ATTEMPTS} from './arena-native-derived-projector-current-v2.mjs';
const H=(char)=>'0x'+char.repeat(64),contract='0x'+'a'.repeat(40);
const config={format:original.FORMAT+'-config',native:{contract,startBlock:'1',releaseId:H('1'),abiHash:H('2'),manifestHash:H('3'),
 sourceId:'arena:8453:'+contract,schema:'unified_ypal_20261023_v1',schemaOid:'75963410',buildId:'71e2a7f3b7'},
 sourceRole:{name:'arena_native_reader',oid:700},maximumBlocks:100,maximumEvents:100,pollMilliseconds:10000,provision:{}};
function fixture(options={}){
 const state={cursor:'9',complete:10n,clock:0,nativeLeases:0,targetLeases:0,sleeps:0,catalogs:0,originalCalls:0};
 const block=(through)=>through==='9'?H('9'):H('1');
 const nativeDb={query:async(text,values)=>{
  if(text.startsWith('SELECT current_user'))return{rows:[{role:config.sourceRole.name,oid:700,database_oid:17584}]};
  if(text.includes('pg_namespace'))return{rows:[{oid:config.native.schemaOid}]};
  if(text.startsWith('SELECT DISTINCT block_hash'))return{rows:[]};
  if(text.startsWith('SELECT block_hash'))return{rows:[{block_hash:block(values[0])}]};
  if(/canonical_event|arena_tournament|arena_credit/.test(text))return{rows:[]};
  throw Error('unexpected native fixture SQL');
 }};
 const release={id:config.native.releaseId,schema:config.native.schema,buildId:config.native.buildId,manifestHash:config.native.manifestHash,
 manifest:{sources:[{id:config.native.sourceId,enabled:true,feature:'arena',chainId:8453,address:contract,startBlock:'1',abiHash:config.native.abiHash}]}};
 const pool={connect:async()=>{
  state.targetLeases++;
  return{query:async(text)=>{
   if(text.startsWith('SELECT contract'))return{rows:[{contract,start_block:'1',cursor:state.cursor,cursor_hash:options.wrongHash?H('8'):block(state.cursor),
    finalized_at:options.stale?new Date(0):new Date(),indexer_mode:'legacy',halted:false}]};
   if(text.includes('FROM yunipals_arena.chain_event')&&options.badPrefix)return{rows:[{block_number:'5',block_hash:H('5'),transaction_hash:H('6'),log_index:0,event_name:'Fixture',args:{}}]};
   if(/^(BEGIN|ROLLBACK)|chain_event|tournament|credit/.test(text))return{rows:[]};
   throw Error('unexpected target fixture SQL');
  },release:()=>{state.targetLeases--;pool._released=Promise.resolve();}};
 }};
 const native={};
 const support={createIndexerReader:async()=>({release,snapshot:async(_id,_policy,work)=>{
  state.nativeLeases++;try{return await work(nativeDb,{status:{readiness:{reason:'ready'},anchor:{},errorCode:null,observationRevision:'fixture'}});}
  finally{state.nativeLeases--;native._released=Promise.resolve();}
 }}),readBoundRuntime:async()=>({chains:[{chainId:8453,completeThroughBlock:state.complete}],frameworkReady:true,running:true}),
 sqlIdentifier:(value)=>'"'+value+'"',targetCatalog:async()=>{state.catalogs++;if(options.catalogError)throw Error('hard_catalog_refusal');return{genuineCatalogFixture:true};}};
 const projector={...original,inspectCurrent:async(...args)=>{state.originalCalls++;const value=await original.inspectCurrent(...args);
  if(options.lateSuccess)state.clock=WINDOW_MILLISECONDS+1;return value;}};
 const sleep=async()=>{
  assert.equal(state.nativeLeases,0,'no native PG lease while waiting');assert.equal(state.targetLeases,0,'no public PG lease while waiting');
  state.sleeps++;state.clock+=options.noProgress?10001:10000;
  if(!options.noProgress){state.complete+=5n;state.cursor=String(state.complete);}
 };
 return{state,support,native,target:pool,projector,options:{now:()=>state.clock,sleep}};
}
let checks=0;
{
 const f=fixture(),result=await capture(f.projector,f.support,f.native,f.target,config,observer,f.options);
 assert.equal(result.validated,true);assert.equal(result.exactOriginalInspectorSuccess,true);
 assert.equal(f.state.sleeps,1);assert.equal(f.state.originalCalls,2);assert.equal(result.attempts.length,2);
 assert.equal(result.attempts[0].classification.fullPrefixEvents,0);assert.equal(result.attempts[0].discarded,true);
 assert.equal(result.attempts[0].wait.progressObserved,true);assert.equal(result.attempts[1].discarded,false);
 assert.equal(result.observation.targetCursor,'15');assert.equal(f.state.nativeLeases,0);assert.equal(f.state.targetLeases,0);checks++;
}
for(const options of [{catalogError:true},{wrongHash:true},{stale:true}]){
 const f=fixture(options);if(options.wrongHash)f.state.cursor='10';
 await assert.rejects(capture(f.projector,f.support,f.native,f.target,config,observer,f.options),(error)=>{
  assert.equal(error.currentCaptureAttempts.length,1);assert.equal(error.currentCaptureAttempts[0].discarded,true);
  assert.ok(error.currentCaptureAttempts[0].originalError);return true;
 });
 assert.equal(f.state.sleeps,0);assert.equal(f.state.originalCalls,1);assert.equal(f.state.nativeLeases,0);assert.equal(f.state.targetLeases,0);checks++;
}
{
 const f=fixture({badPrefix:true});await assert.rejects(capture(f.projector,f.support,f.native,f.target,config,observer,f.options),(error)=>{
  const row=error.currentCaptureAttempts[0];assert.equal(row.originalError.message,'fresh_derived_cursor_must_equal_current_native_complete_boundary');
  assert.equal(row.classifierError.message,'entire_projected_prefix_must_be_canonical_before_lag_retry');assert.equal(row.discarded,true);return true;
 });assert.equal(f.state.sleeps,0);assert.equal(f.state.originalCalls,1);assert.equal(f.state.nativeLeases,0);assert.equal(f.state.targetLeases,0);checks++;
}
{
 const f=fixture({lateSuccess:true});f.state.cursor='10';
 await assert.rejects(capture(f.projector,f.support,f.native,f.target,config,observer,f.options),(error)=>{
  assert.equal(error.message,'bounded_readonly_current_capture_window_expired');assert.equal(error.currentCaptureAttempts.length,1);
  assert.equal(error.currentCaptureAttempts[0].originalInspectorSucceeded,true);assert.equal(error.currentCaptureAttempts[0].discarded,true);return true;
 });checks++;
}
{
 const f=fixture({noProgress:true});await assert.rejects(capture(f.projector,f.support,f.native,f.target,config,observer,f.options),(error)=>{
  assert.equal(error.message,'bounded_readonly_current_capture_window_expired');assert.equal(error.currentCaptureAttempts.length,1);
  assert.equal(error.currentCaptureAttempts[0].wait.completed,false);return true;
 });assert.equal(f.state.originalCalls,1);assert.ok(f.state.sleeps>=8);assert.equal(f.state.nativeLeases,0);assert.equal(f.state.targetLeases,0);checks++;
}
{
 const observation={native:{complete:'10',frameworkReady:true,running:true},target:{cursor:'9',cursor_hash:H('9'),finalized_at:new Date()}};
 assert.equal(eligible(Error('fresh_derived_cursor_must_equal_current_native_complete_boundary'),observation),true);
 assert.equal(eligible(new TypeError('fresh_derived_cursor_must_equal_current_native_complete_boundary'),observation),false);
 observation.target.cursor='11';assert.equal(eligible(Error('fresh_derived_cursor_must_equal_current_native_complete_boundary'),observation),false);
 assert.equal(MAXIMUM_ATTEMPTS,12);assert.equal(WINDOW_MILLISECONDS,90000);checks++;
}
console.log(JSON.stringify({controls:checks,actualRuntimeQualification:false,databaseWrites:0,serviceActions:0,providerCalls:0}));

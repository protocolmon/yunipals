import assert from 'node:assert/strict';
import {inspectCurrent,nativeSnapshot,checked} from './arena-native-derived-projector-v1.mjs';
import {observedSupport,observedTarget,inspect,summarize} from './arena-native-derived-boundary-diagnostic-v1.mjs';

const H=(char)=>'0x'+char.repeat(64),contract='0x'+'a'.repeat(40);
const config={format:'yunipals-arena-native-derived-projector-v1-config',native:{contract,startBlock:'1',releaseId:H('1'),abiHash:H('2'),manifestHash:H('3'),
  sourceId:'arena:8453:'+contract,schema:'unified_ypal_20261023_v1',schemaOid:'75963410',buildId:'71e2a7f3b7'},
  sourceRole:{name:'arena_native_reader',oid:700},maximumBlocks:100,maximumEvents:100,pollMilliseconds:10000,provision:{}};
checked(config);
let checks=0;
const raw={chains:[{chainId:8453,completeThroughBlock:10n}],frameworkReady:true,running:true};
const observed={};const db={};
const wrapper=observedSupport({readBoundRuntime:async(current)=>{assert.equal(current,db);return raw;}},observed);
assert.equal(await wrapper.readBoundRuntime(db,{schema:config.native.schema}),raw);assert.equal(observed.native.complete,'10');checks++;
const row={contract,start_block:'1',cursor:'9',cursor_hash:H('9'),finalized_at:new Date(),indexer_mode:'legacy',halted:false};
const response={rows:[row]},calls=[];let released=false;
const target=observedTarget({connect:async()=>({query:async(...args)=>{calls.push(args);return response;},release:()=>{released=true;}})},null,{});
const lease=await target.connect();assert.equal(await lease.query('SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1',[]),response);
assert.equal(calls.length,1);lease.release();assert.equal(released,true);checks++;

function fixture(overrides={}){
  const queries=[];let nativeClosed=false,targetClosed=false;
  const nativeDb={query:async(text,values)=>{
    queries.push(text);
    if(text.startsWith('SELECT current_user'))return{rows:[{role:'arena_native_reader',oid:700,database_oid:17584}]};
    if(text.includes('pg_namespace'))return{rows:[{oid:'75963410'}]};
    if(text.startsWith('SELECT DISTINCT block_hash'))return{rows:[]};
    if(text.startsWith('SELECT block_hash'))return{rows:[{block_hash:values[0]==='9'?H('9'):H('1')}]};
    if(/canonical_event|arena_tournament|arena_credit/.test(text))return{rows:[]};
    throw Error('unexpected fixture source query');
  }};
  const release={id:config.native.releaseId,schema:config.native.schema,buildId:config.native.buildId,manifestHash:config.native.manifestHash,
    manifest:{sources:[{id:config.native.sourceId,enabled:true,feature:'arena',chainId:8453,address:contract,startBlock:'1',abiHash:config.native.abiHash}]}};
  const targetDb={query:async(text)=>{
    queries.push(text);
    if(text.startsWith('SELECT contract'))return{rows:[{...row,...overrides}]};
    if(/^(BEGIN|ROLLBACK)/.test(text))return{rows:[]};
    if(/chain_event|tournament|credit/.test(text))return{rows:[]};
    throw Error('unexpected fixture target query');
  },release(){}};
  const support={createIndexerReader:async()=>({release,snapshot:async(_source,_policy,work)=>work(nativeDb,{status:{readiness:{reason:'ready'},anchor:{},errorCode:null,observationRevision:'fixture'}})}),
    readBoundRuntime:async()=>raw,sqlIdentifier:(value)=>'"'+value+'"',targetCatalog:async()=>({actualCatalogFixture:true})};
  return{support,native:{end:async()=>{nativeClosed=true;}},target:{connect:async()=>targetDb,end:async()=>{targetClosed=true;}},queries,
    closed:()=>nativeClosed&&targetClosed};
}
const original={inspectCurrent,nativeSnapshot};
{
  const f=fixture(),result=await inspect(original,f.support,f.native,f.target,config);
  assert.equal(result.error.message,'fresh_derived_cursor_must_equal_current_native_complete_boundary');
  assert.equal(result.summary.cursorRelation,'strictly-behind');assert.equal(result.summary.finalizedFresh180Seconds,true);
  assert.equal(result.summary.savedBoundaryCanonical,true);assert.equal(result.summary.savedHashMatchesNativeComplete,false);
  assert.equal(result.canonicalProbeIsSeparateFreshSnapshot,true);assert.equal(result.currentProjectionQualified,false);
  assert.equal(f.closed(),true);assert.ok(f.queries.every((text)=>/^(SELECT|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|ROLLBACK)/.test(text)));checks++;
}
{
  const f=fixture({cursor:'10',cursor_hash:H('8')}),result=await inspect(original,f.support,f.native,f.target,config);
  assert.equal(result.summary.cursorRelation,'equal');assert.equal(result.summary.savedBoundaryCanonical,false);
  assert.equal(result.error.message,'fresh_derived_cursor_must_equal_current_native_complete_boundary');checks++;
}
{
  const f=fixture({finalized_at:new Date(0)}),result=await inspect(original,f.support,f.native,f.target,config);
  assert.equal(result.summary.finalizedFresh180Seconds,false);assert.equal(result.currentProjectionQualified,false);checks++;
}
{
  const f=fixture();f.support.targetCatalog=async()=>{throw Error('actual_catalog_refusal');};
  const result=await inspect(original,f.support,f.native,f.target,config);
  assert.equal(result.error.message,'actual_catalog_refusal');assert.equal(result.summary.cursorRelation,'unavailable');assert.equal(f.closed(),true);checks++;
}
{
  const f=fixture(),projector={...original,nativeSnapshot:async()=>{throw Error('separate_probe_refused');}};
  const result=await inspect(projector,f.support,f.native,f.target,config);
  assert.equal(result.error.message,'fresh_derived_cursor_must_equal_current_native_complete_boundary');
  assert.equal(result.observation.boundaryProbeFailure.message,'separate_probe_refused');assert.equal(result.summary.savedBoundaryCanonical,null);checks++;
}
{
  const f=fixture({cursor:'10',cursor_hash:H('1')}),result=await inspect(original,f.support,f.native,f.target,config);
  assert.equal(result.inspectionSucceeded,true);assert.equal(result.result.validated,true);assert.equal(result.currentProjectionQualified,false);
  assert.equal(result.summary.cursorRelation,'equal');assert.equal(f.closed(),true);checks++;
}
assert.equal(summarize({}).cursorRelation,'unavailable');
console.log(JSON.stringify({sourceFixtureControls:checks,actualRuntimeQualification:false,databaseWrites:0,serviceActions:0,providerCalls:0}));

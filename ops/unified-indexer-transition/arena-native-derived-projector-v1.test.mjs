// Genuine offline compilation and deterministic pure boundary controls.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildArtifact,publicHelpers,FACADE} from "./arena-native-derived-support-build-v1.mjs";
import {checked,normalized,FORMAT} from "./arena-native-derived-projector-v1.mjs";
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,"../..");
const sha=(raw)=>createHash('sha256').update(raw).digest('hex');
const artifact=await buildArtifact(root),expected=JSON.parse(readFileSync(here+'/arena-native-derived-support-v1.manifest.json'));
assert.deepEqual(artifact.manifest,expected);
for(const row of expected.files){assert.equal(sha(artifact.outputs[row.path]),row.sha256);assert.equal(artifact.outputs[row.path].length,row.bytes);}
assert.equal(expected.files.length,3);assert.equal(expected.inputs.length,49);
const helper=publicHelpers(readFileSync(here+'/arena-modern-public-rollback-v1.mjs'));
assert(helper.includes('SELECT seat,commitment FROM yunipals_arena.submission'));
assert(helper.includes('UPDATE yunipals_arena.frozen_input SET revealed_at=now()'));
assert(FACADE.includes('ArenaRollbackSource, arenaRollbackSourceId'));assert(FACADE.includes('ArenaSourceSwitch, arenaSourceSwitchVerifier'));
const contract='0x'+'1'.repeat(40),H='0x'+'2'.repeat(64);
const config={format:FORMAT+'-config',native:{contract,startBlock:'1',releaseId:H,manifestHash:H,abiHash:H,
  sourceId:'arena:8453:'+contract,schema:'unified_ypal_20261023_v1',schemaOid:'75963410',buildId:'71e2a7f3b7'},
  provision:{fixture:true},sourceRole:{name:'arena_native_reader',oid:1},maximumBlocks:1000,maximumEvents:10,pollMilliseconds:1000};
assert.equal(checked(config),config);
for(const bad of [{...config,maximumEvents:true},{...config,native:{...config.native,schema:'foreign'}},{...config,sourceRole:{name:'postgres',oid:1}}])assert.throws(()=>checked(bad));
const row={source_id:config.native.sourceId,chain_id:8453,address:contract,abi_hash:H,id:'8453:'+contract+':'+H+':0',
  name:'Claimed',args:{player:contract,amount:'1'},block_number:'1',block_hash:H,transaction_hash:H,log_index:0};
assert.equal(normalized(row,config,true).event_name,'Claimed');
for(const change of [{id:'foreign'},{chain_id:1},{abi_hash:'foreign'},{args:[]},{block_number:'01'},{log_index:-1}])assert.throws(()=>normalized({...row,...change},config,true));
console.log(JSON.stringify({checksPassed:4,groups:['actual_double_build_and_all_output_hashes','exact_retained_public_helper_and_rollback_exports','finite_config_refusals','native_canonical_event_payload_refusals'],providerCalls:0,databaseWrites:0}));

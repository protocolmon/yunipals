// Read-only observation around the genuine frozen exported current inspector.
import {createHash} from 'node:crypto';
import {fstatSync,readFileSync,readlinkSync} from 'node:fs';
import {hostname,userInfo} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const FORMAT='yunipals-root-native-derived-boundary-diagnostic-v1';
export const TARGET='/opt/yunipals-unified/arena-recovery-support/8b94c5c50da8adc1673e7d3971a374e8fef54c7c4f98323b8bd49ce72b542a99';
export const PROJECTOR_SHA='37c17e1bdaf22bfecd930ff97da8e6eb7b8337f57469cb16d487e0f6c77be319';
export const SUPPORT_SHA='08905983dc0f5556190d311fd648eecc9ebfea4c958e607902a93ac7a2ad24ba';
const hash=(raw)=>createHash('sha256').update(raw).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const DEPLOYMENT_QUERY='SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1';
const decimal=(value)=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const hex=(value)=>typeof value==='string'&&/^0x[a-f0-9]{64}$/.test(value);

export function observedSupport(support,observation){
  return {...support,readBoundRuntime:async(db,release)=>{
    const raw=await support.readBoundRuntime(db,release);
    observation.native={complete:String(raw.chains.find((row)=>row.chainId===8453)?.completeThroughBlock),
      frameworkReady:raw.frameworkReady,running:raw.running,schema:release.schema};
    return raw;
  }};
}

export function observedTarget(pool,support,observation){
  return {...pool,connect:async()=>{
    const client=await pool.connect();
    return {query:async(text,values)=>{
      const raw=await client.query(text,values);
      if(text===DEPLOYMENT_QUERY){
        need(!observation.target,'one_genuine_deployment_observation_required');
        observation.target=raw.rows.length===1?structuredClone(raw.rows[0]):null;
        observation.targetRows=raw.rows.length;observation.observedAtMilliseconds=Date.now();

      }
      return raw;
    },release:(...args)=>client.release(...args)};
  }};
}

export function summarize(observation){
  const native=observation.native,target=observation.target;
  const relation=native&&target&&decimal(native.complete)&&decimal(target.cursor)
    ?BigInt(target.cursor)<BigInt(native.complete)?'strictly-behind':BigInt(target.cursor)>BigInt(native.complete)?'ahead':'equal':'unavailable';
  const own=observation.savedBoundary,hashes=own?[...own.retained,...own.events]:[];
  const canonical=!!(own&&own.retained.length<=1&&own.events.length<=1&&hashes.length&&hashes.every((value)=>hex(value)&&value===target.cursor_hash));
  const finalized=target?.finalized_at?new Date(target.finalized_at).getTime():NaN;
  const age=Number.isFinite(finalized)?Math.abs(observation.observedAtMilliseconds-finalized):null;
  return {sampledNativeAndTarget:!!(native&&target),cursorRelation:relation,
    savedHashMatchesNativeComplete:observation.completeHashes?.length===1&&target?target.cursor_hash===observation.completeHashes[0]:null,
    savedBoundaryCanonical:own?canonical:null,finalizedAgeMilliseconds:age,finalizedFresh180Seconds:age!==null&&age<=180000,
    nativeFrameworkReady:native?.frameworkReady??null,nativeRunning:native?.running??null};
}

export async function inspect(projector,support,native,target,config){
  const observation={sourceId:config.native.sourceId};let result=null,error=null,cleanup=[];
  try{
    try{result=await projector.inspectCurrent(observedSupport(support,observation),native,observedTarget(target,support,observation),config,false);}
    catch(failure){error={class:failure?.constructor?.name??'Error',message:String(failure?.message??failure),code:failure?.code??null,stack:failure?.stack??null};}
    if(observation.native&&observation.target&&decimal(observation.native.complete)&&decimal(observation.target.cursor)){
      try{
        await projector.nativeSnapshot(support,native,config,async(db,schema,frame)=>{
          const complete=await db.query(`SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1::bigint`,[observation.native.complete]);
          const retained=await db.query(`SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1::bigint`,[observation.target.cursor]);
          const events=await db.query(`SELECT DISTINCT block_hash FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND block_number=$2::bigint LIMIT 2`,
            [observation.sourceId,observation.target.cursor]);
          observation.completeHashes=complete.rows.map((row)=>row.block_hash);
          observation.savedBoundary={retained:retained.rows.map((row)=>row.block_hash),events:events.rows.map((row)=>row.block_hash)};
          observation.canonicalProbeFrame=frame;
        });
      }catch(failure){observation.boundaryProbeFailure={class:failure?.constructor?.name??'Error',message:String(failure?.message??failure),code:failure?.code??null};}
    }
  }finally{cleanup=await Promise.allSettled([target.end(),native.end()]);}
  return {format:FORMAT,completed:true,inspectionSucceeded:error===null,result,error,observation,summary:summarize(observation),
    bothReadClientsClosed:cleanup.every((row)=>row.status==='fulfilled'),
    genuineUnchangedExportedInspector:true,returnedRuntimeAndRowsUnchanged:true,canonicalProbeIsSeparateFreshSnapshot:true,
    currentProjectionQualified:false,databaseWrites:0,serviceActions:0,providerCalls:0};
}

export function guardedConfig(fd){
  need(hostname()==='yunipals-main'&&process.versions.node==='24.18.1'&&userInfo().username==='postgres',
    'actual_restricted_native_boundary_diagnostic_host_and_Node_required');
  const row=fstatSync(fd);
  need(row.isFile()&&row.uid===0&&row.gid===0&&row.nlink===0&&(row.mode&511)===384&&row.size<=100000&&
    readlinkSync('/proc/self/fd/'+fd).startsWith('/memfd:arena-native-derived-config'),
    'same_sealed_root_native_inspection_configuration_required');
  const config=JSON.parse(readFileSync(fd));const descriptors=[config.nativeReadPoolFd,config.publicReadPoolFd];
  need(descriptors.every((value)=>Number.isInteger(value)&&value>=3&&value!==fd)&&new Set(descriptors).size===2,
    'two_distinct_actual_root_delegated_read_channels_required');
  for(const value of descriptors){const file=fstatSync(value);need(file.isSocket()&&file.uid===0&&file.gid===0,
    'actual_root_connected_read_pool_socket_descriptors_required');}
  return config;
}

export async function main(args=process.argv.slice(2)){
  if(!args.length){console.log(JSON.stringify({format:FORMAT,staticOnly:true,databaseWrites:0,serviceActions:0,providerCalls:0}));return;}
  need(args.length===3&&args[0]==='--diagnose'&&args[1]==='--config-fd'&&/^[0-9]+$/.test(args[2]),'one_explicit_readonly_boundary_diagnostic_required');
  const config=guardedConfig(Number(args[2]));
  const projectorFile=TARGET+'/dist/arena-native-derived-projector-v1.mjs',supportFile=TARGET+'/dist/arena-inverse-support.mjs';
  need(hash(readFileSync(projectorFile))===PROJECTOR_SHA&&hash(readFileSync(supportFile))===SUPPORT_SHA,
    'actual_frozen_37c_inspector_and_089_support_required');
  const projector=await import(pathToFileURL(projectorFile).href),support=await import(pathToFileURL(supportFile).href);
  projector.checked(config);config.targetWriter=false;
  const native=support.nativeReadPoolClient(config.nativeReadPoolFd,config.readPoolIdentity);
  const target=support.publicReadPoolClient(config.publicReadPoolFd,config.readPoolIdentity);
  console.log(JSON.stringify(await inspect(projector,support,native,target,config)));
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
  main().catch((error)=>{console.log(JSON.stringify({format:FORMAT,completed:false,error:{class:error?.constructor?.name,message:String(error?.message??error),code:error?.code??null,stack:error?.stack??null},databaseWrites:0,serviceActions:0,providerCalls:0}));process.exitCode=1;});

// A new read-only current proof; the running projector and IPC epoch stay old.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const FORMAT='yunipals-arena-native-derived-projector-current-v1';
export const WINDOW_MILLISECONDS=90000;
export const MAXIMUM_ATTEMPTS=12;
export const POLL_MILLISECONDS=500;
const OPS='/opt/yunipals-unified/operations/free-replay-20261020/';
const TARGET='/opt/yunipals-unified/arena-recovery-support/8b94c5c50da8adc1673e7d3971a374e8fef54c7c4f98323b8bd49ce72b542a99/';
const hash=(value)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const decimal=(value)=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const hex=(value)=>typeof value==='string'&&/^0x[a-f0-9]{64}$/.test(value);
const DEPLOYMENT_QUERY='SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1';
const ORIGINAL_REFUSAL='fresh_derived_cursor_must_equal_current_native_complete_boundary';

export async function released(native,target){
  await Promise.all([native._released,target._released].filter((value)=>value!==undefined));
}

function ordered(rows){
  need(rows.length<=100000,'bounded_complete_derived_classification_prefix_required');
  for(let i=1;i<rows.length;i++)need(BigInt(rows[i-1].block_number)<BigInt(rows[i].block_number)||
    rows[i-1].block_number===rows[i].block_number&&rows[i-1].log_index<rows[i].log_index,'strict_complete_classification_event_order_required');
  return rows;
}

async function prefix(projector,db,schema,config,through,source){
  const rows=source?(await db.query(`SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
    FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND block_number<=$2::bigint
    ORDER BY block_number,log_index LIMIT 100001`,[config.native.sourceId,through])).rows:
    (await db.query(`SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
    FROM yunipals_arena.chain_event WHERE deployment=$1 AND block_number<=$2::bigint
    ORDER BY block_number,log_index LIMIT 100001`,['8453:'+config.native.contract,through])).rows;
  return ordered(rows.map((row)=>projector.normalized(row,config,source)));
}

async function boundary(db,schema,config,through){
  const block=(await db.query(`SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1::bigint`,[through])).rows;
  const events=(await db.query(`SELECT DISTINCT block_hash FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND block_number=$2::bigint LIMIT 2`,[config.native.sourceId,through])).rows;
  need(block.length<=1&&events.length<=1&&block.length+events.length>0&&[...block,...events].every((row)=>hex(row.block_hash))&&
    (!block.length||!events.length||block[0].block_hash===events[0].block_hash),'actual_canonical_classification_boundary_required');
  return(block[0]??events[0]).block_hash;
}

async function deployment(db,config){
  const rows=(await db.query(DEPLOYMENT_QUERY,['8453:'+config.native.contract])).rows;
  need(rows.length===1&&rows[0].contract===config.native.contract&&rows[0].start_block===config.native.startBlock&&
    rows[0].indexer_mode==='legacy'&&rows[0].halted===false&&decimal(rows[0].cursor)&&hex(rows[0].cursor_hash),
    'same_nonempty_unhalted_owned_public_deployment_required');return rows[0];
}

export function eligible(error,observation,wallNow=Date.now()){
  const native=observation.native,saved=observation.target;
  if(error?.constructor!==Error||error.message!==ORIGINAL_REFUSAL||!native||!saved||!decimal(native.complete)||!decimal(saved.cursor)||
    !hex(saved.cursor_hash)||!saved.finalized_at||!native.frameworkReady||!native.running)return false;
  const age=Math.abs(wallNow-new Date(saved.finalized_at).getTime());
  return Number.isFinite(age)&&age<=180000&&BigInt(saved.cursor)<BigInt(native.complete);
}

export async function classify(projector,support,native,target,config,failed){
  return projector.nativeSnapshot(support,native,config,async(source,schema,frame)=>{
    need(BigInt(frame.complete)>=BigInt(failed.native.complete),'native_complete_boundary_cannot_rewind_during_classification');
    const client=await target.connect();
    try{
      await support.targetCatalog(client,config.provision,false);
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const current=await deployment(client,config),saved=failed.target;
      need(BigInt(current.cursor)>=BigInt(saved.cursor)&&BigInt(current.cursor)<=BigInt(frame.complete)&&
        current.finalized_at&&Math.abs(Date.now()-new Date(current.finalized_at).getTime())<=180000&&
        (current.cursor!==saved.cursor||current.cursor_hash===saved.cursor_hash),
        'fresh_nonrewinding_public_cursor_only_during_classification');
      need(await boundary(source,schema,config,saved.cursor)===saved.cursor_hash&&
        await boundary(source,schema,config,current.cursor)===current.cursor_hash,
        'both_sampled_and_current_public_boundary_hashes_must_be_canonical');
      const left=await prefix(projector,source,schema,config,current.cursor,true),right=await prefix(projector,client,null,config,current.cursor,false);
      need(projector.canonical(left)===projector.canonical(right),'entire_projected_prefix_must_be_canonical_before_lag_retry');
      await client.query('ROLLBACK');
      return{pureLagQualified:true,sampledNativeComplete:failed.native.complete,sampledTargetCursor:saved.cursor,
        classifiedNativeComplete:frame.complete,observedTargetCursor:current.cursor,fullPrefixEvents:left.length,
        fullPrefixSha256:hash(projector.canonical(left)),progressFloor:failed.native.complete};
    }finally{try{await client.query('ROLLBACK');}finally{client.release();}}
  });
}

export async function waitProgress(target,config,floor,window,sleep=(ms)=>setTimeout(ms)){
  let polls=0;
  for(;;){
    window();const client=await target.connect();let row;
    try{row=await deployment(client,config);}finally{client.release();}
    await released({},target);window();polls++;
    if(BigInt(row.cursor)>=BigInt(floor))return{polls,progressObserved:true};
    await sleep(POLL_MILLISECONDS);
  }
}

export async function capture(projector,support,native,target,config,observer,options={}){
  const now=options.now??(()=>performance.now()),sleep=options.sleep??((ms)=>setTimeout(ms)),started=now(),attempts=[];
  const window=()=>need(now()-started<WINDOW_MILLISECONDS,'bounded_readonly_current_capture_window_expired');
  try{
    for(let number=1;number<=MAXIMUM_ATTEMPTS;number++){
      window();const observation={sourceId:config.native.sourceId},begin=now();let result,error;
      const attempt={number,completed:false,discarded:true,originalInspectorSucceeded:false};attempts.push(attempt);
      try{result=await projector.inspectCurrent(observer.observedSupport(support,observation),native,
        observer.observedTarget(target,support,observation),config,false);}
      catch(failure){error=failure;}
      attempt.originalInspectorSucceeded=!error;
      attempt.elapsedMilliseconds=now()-begin;
      if(error)attempt.originalError={class:error?.constructor?.name??'Error',message:String(error?.message??error),code:error?.code??null};
      await released(native,target);window();
      if(!error){
        need(result.validated===true&&result.databaseWrites===0&&result.providerCalls===0,'unchanged_genuine_current_inspector_success_required');
        attempt.completed=true;attempt.discarded=false;attempt.elapsedMilliseconds=now()-begin;
        return{format:FORMAT,validated:true,observation:result,attempts,elapsedMilliseconds:now()-started,
          exactOriginalInspectorSuccess:true,originalOwner3CapturePassed:false,writerProgressWaitsOnly:true,
          databaseWrites:0,serviceActions:0,providerCalls:0};
      }
      if(!eligible(error,observation))throw error;
      let qualified;
      try{qualified=await classify(projector,support,native,target,config,observation);}
      catch(failure){attempt.classifierError={class:failure?.constructor?.name??'Error',message:String(failure?.message??failure),code:failure?.code??null};throw failure;}
      await released(native,target);window();
      attempt.classification=qualified;attempt.elapsedMilliseconds=now()-begin;
      need(number<MAXIMUM_ATTEMPTS,'bounded_readonly_current_capture_attempts_exhausted');
      attempt.wait={started:true,completed:false};
      attempt.wait={...await waitProgress(target,config,qualified.progressFloor,window,sleep),started:true,completed:true};
    }
    throw Error('bounded_readonly_current_capture_attempts_exhausted');
  }catch(error){error.currentCaptureAttempts=attempts;throw error;}
}

export async function main(args=process.argv.slice(2)){
  if(!args.length){console.log(JSON.stringify({format:FORMAT,staticOnly:true,databaseWrites:0,serviceActions:0,providerCalls:0}));return;}
  need(args.length===3&&args[0]==='--current'&&args[1]==='--config-fd'&&/^[0-9]+$/.test(args[2]),'one_explicit_readonly_current_capture_required');
  const observerFile=OPS+'arena-native-derived-boundary-diagnostic-v1.mjs';
  need(hash(readFileSync(observerFile))==='6a97f5c6cc37bd4790ef0f9b15438652fc7ba3580de5aad0af4faa16fcadbed7','actual_frozen_observational_wrapper_required');
  const observer=await import(pathToFileURL(observerFile).href),config=observer.guardedConfig(Number(args[2]));
  const projectorFile=TARGET+'dist/arena-native-derived-projector-v1.mjs',supportFile=TARGET+'dist/arena-inverse-support.mjs';
  need(hash(readFileSync(projectorFile))===observer.PROJECTOR_SHA&&hash(readFileSync(supportFile))===observer.SUPPORT_SHA,'actual_unchanged_projector_and_support_required');
  const projector=await import(pathToFileURL(projectorFile).href),support=await import(pathToFileURL(supportFile).href);
  projector.checked(config);config.targetWriter=false;
  const native=support.nativeReadPoolClient(config.nativeReadPoolFd,config.readPoolIdentity),target=support.publicReadPoolClient(config.publicReadPoolFd,config.readPoolIdentity);
  try{console.log(JSON.stringify(await capture(projector,support,native,target,config,observer)));}
  finally{await Promise.all([target.end(),native.end()]);}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
  main().catch((error)=>{console.log(JSON.stringify({format:FORMAT,completed:false,error:{class:error?.constructor?.name,message:String(error?.message??error),code:error?.code??null,stack:error?.stack??null},attempts:error?.currentCaptureAttempts??[],databaseWrites:0,serviceActions:0,providerCalls:0}));process.exitCode=1;});

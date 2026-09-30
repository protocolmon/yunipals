import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argumentsOf,postgresFrom,writeReport,safeFailure } from './metadata/support.js';

const args=argumentsOf({output:{type:'string',default:'docs/metadata-migration/runtime-independence.json'}});
const {pool,env}=await postgresFrom(String(args['env-file']));
const directory=await mkdtemp(join(tmpdir(),'metadata-runtime-check-'));
try{
  assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^metadata_archive_test_[a-z0-9_]+$/);
  assert.equal((await pool.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id='publisher-test-v1'")).rowCount,1);
  await pool.query("UPDATE metadata_source.archive_release SET state='active' WHERE release_id='publisher-test-v1'");
  await pool.query('UPDATE metadata.publication_runtime SET last_worker_at=NULL,base_error=NULL');
  const evidence=join(directory,'network.json'),preload=join(directory,'deny-http.mjs');
  await writeFile(preload,`import {writeFileSync} from 'node:fs';
const counts={rpc:0,forbidden:0};
globalThis.fetch=async(input)=>{
 const url=new URL(typeof input==='string'?input:input.url??input.href);
 if(url.hostname!=='rpc-check.invalid'){counts.forbidden++;writeFileSync(${JSON.stringify(evidence)},JSON.stringify(counts));throw new Error('Forbidden metadata HTTP');}
 counts.rpc++;writeFileSync(${JSON.stringify(evidence)},JSON.stringify(counts));
 return new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32005,message:'Synthetic RPC outage'}}),{headers:{'Content-Type':'application/json'}});
};`);
  // Deliberately do not inherit the invoking process's service/migration environment.
  const workerEnv:Record<string,string>={PATH:process.env.PATH??'',DATABASE_URL:env.DATABASE_URL,
    DATABASE_SCHEMA:'binding_check',READ_DATABASE_SCHEMA:'binding_check',METADATA_SOURCE_MODE:'archive',METADATA_CONCURRENCY:'2',METADATA_SCAN_BATCH_SIZE:'10'};
  for(const chain of [1,8453,137,56])workerEnv[`PONDER_RPC_URL_${chain}`]='https://rpc-check.invalid';
  const child=spawn(process.execPath,['--import',preload,'--import','tsx','lib/metadata/worker.ts'],{env:workerEnv,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=String(data);});child.stderr.on('data',data=>{output+=String(data);});
  const deadline=setTimeout(()=>child.kill('SIGKILL'),30000);
  const exited=new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
  const started=Date.now();
  while(child.exitCode===null&&child.signalCode===null&&Date.now()-started<20000){
    if((await pool.query('SELECT last_worker_at FROM metadata.publication_runtime')).rows[0]?.last_worker_at)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  child.kill('SIGTERM');
  const result=await exited;
  clearTimeout(deadline);assert.equal(result.signal,null,output);assert.equal(result.code,0,output);
  const network=JSON.parse(await readFile(evidence,'utf8'));assert.ok(network.rpc>0);assert.equal(network.forbidden,0);
  const runtime=(await pool.query('SELECT last_worker_at,base_error FROM metadata.publication_runtime')).rows[0];
  assert.ok(runtime.last_worker_at);assert.equal(runtime.base_error,'base_replay_unavailable');
  await writeReport(String(args.output),{checkedAt:new Date().toISOString(),complete:true,
    scope:'Actual archive worker process, isolated environment, disposable PostgreSQL; all HTTP intercepted, only synthetic RPC failure responses allowed',
    network,gracefulExit:true,workerHeartbeat:true,baseFailureIsolated:true,legacyCredentialsProvided:false});
  console.log(JSON.stringify({complete:true,...network}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{await pool.end();await rm(directory,{recursive:true,force:true});}

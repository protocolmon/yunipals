import assert from 'node:assert/strict';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join,resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { argumentsOf,postgresFrom,postgresToolEnvironment,writeReport,safeFailure } from './metadata/support.js';
import { assertRecoveryDatabase,fileHash,processRun,tableFingerprint } from './metadata/recovery.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { migrations } from '../lib/offchain/migrations.js';

const args=argumentsOf({input:{type:'string'},resume:{type:'boolean',default:false},report:{type:'string',default:'docs/metadata-migration/step-4-restore.json'}});
const {pool,env}=await postgresFrom(String(args['env-file']));
const started=performance.now();
try{
  const database=await assertRecoveryDatabase(pool),directory=resolve(String(args.input??''));
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));assert.equal(manifest.format,'metadata-recovery-bundle-v1');
  for(const [name,value] of Object.entries(manifest.files) as [string,any][]){assert.equal((await stat(join(directory,name))).size,value.bytes);assert.equal(await fileHash(join(directory,name)),value.sha256);}
  let progress:any={format:'metadata-recovery-restore-v1',database,release:manifest.release,startedAt:new Date().toISOString(),bundleManifestSha256:await fileHash(join(directory,'manifest.json')),groups:{},tables:{},complete:false};
  if(args.resume){progress=JSON.parse(await readFile(String(args.report),'utf8'));assert.equal(progress.database,database);assert.equal(progress.bundleManifestSha256,await fileHash(join(directory,'manifest.json')));}
  else assert.equal((await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname IN ('metadata','metadata_source',$1,$2,'solana_indexer')`,[manifest.sourceSchemas.physical,manifest.sourceSchemas.bnb])).rowCount,0,'Target database is not empty');
  await writeReport(String(args.report),progress);
  await pool.query('SET statement_timeout=0');
  for(const [group,schemas] of Object.entries({archive:['metadata_source'],durable:['metadata'],chain_reference:[manifest.sourceSchemas.physical,manifest.sourceSchemas.bnb],
    ...(manifest.sourceSchemas.solana?{solana:[manifest.sourceSchemas.solana]}:{})})){
    if(progress.groups[group])continue;
    for(const schema of schemas)await pool.query(`CREATE SCHEMA IF NOT EXISTS ${sqlIdentifier(schema)}`);
    const file=join(directory,`${group}.dump`),toc=(await promisify(execFile)('pg_restore',['--list',file])).stdout;
    const omitted:string[]=[];
    const filtered=toc.split('\n').filter(line=>{
      if(!/^\d+;.* TRIGGER /.test(line))return true;
      const match=line.match(/ TRIGGER metadata token_metadata (market_catalog_trait_(?:insert|update|delete)) /);
      if(match){omitted.push(match[1]);return false;}
      const ponder=line.match(/ TRIGGER (\S+) (\S+) (\S+) /);
      // These comparison tables do not run Ponder. Its generated live-query
      // notifications and temporary reorg journals belong to the live engine.
      const knownPonder=ponder!==null&&group==='chain_reference'&&ponder[1]===manifest.sourceSchemas.physical&&(
        (['token','token_lifecycle','transfer_event','admin_role_event'].includes(ponder[2])&&['live_query','reorg'].includes(ponder[3]))||
        (ponder[2]==='_ponder_checkpoint'&&ponder[3]==='live_query_notify'));
      assert.ok(knownPonder,'Unknown trigger dependency: recovery requires explicit review');
      omitted.push(`${ponder![1]}.${ponder![2]}.${ponder![3]}`);return false;
    }).join('\n');
    const listFile=join(directory,`${group}.restore-list`);await writeFile(listFile,filtered,{mode:0o600});
    console.log(JSON.stringify({phase:'restore',group,omitted}));const groupStarted=performance.now();
    await processRun('pg_restore',['--dbname',database,'--jobs=2','--no-owner','--no-acl','--exit-on-error',`--use-list=${listFile}`,file],postgresToolEnvironment(env.DATABASE_URL));
    progress.groups[group]={restoredAt:new Date().toISOString(),elapsedSeconds:(performance.now()-groupStarted)/1000,omittedDerivedTriggers:omitted};await writeReport(String(args.report),progress);
  }
  for(const [table,value] of Object.entries(manifest.tables) as [string,any][]){
    if(progress.tables[table])continue;
    const actual=await tableFingerprint(env.DATABASE_URL,table,value.keys);assert.equal(actual.rows,value.rows,`${table} count`);assert.equal(actual.sha256,value.sha256,`${table} content`);
    progress.tables[table]=actual;await writeReport(String(args.report),progress);console.log(JSON.stringify({phase:'verified',table,rows:actual.rows}));
  }
  // Only after proving the restored bytes, add empty derived/runtime tables.
  await pool.query(migrations[0]);await pool.query(migrations[1]);
  for(const [index,sql] of migrations.entries()){
    await pool.query(sql);await pool.query('INSERT INTO metadata.schema_migration(version) VALUES($1) ON CONFLICT DO NOTHING',[index+1]);
  }
  progress.complete=true;progress.verifiedAt=new Date().toISOString();progress.lastInvocationSeconds=(performance.now()-started)/1000;await writeReport(String(args.report),progress);
  console.log(JSON.stringify({complete:true,database,tables:Object.keys(progress.tables).length}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{await pool.end();}

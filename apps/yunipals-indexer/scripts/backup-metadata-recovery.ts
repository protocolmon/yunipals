import assert from 'node:assert/strict';
import { mkdir,stat,writeFile,link,unlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { argumentsOf,postgresFrom,postgresToolEnvironment,writeReport,safeFailure } from './metadata/support.js';
import { fileHash,processRun,tableFingerprint } from './metadata/recovery.js';

const args=argumentsOf({output:{type:'string'},release:{type:'string'},report:{type:'string',default:'docs/metadata-migration/step-4-backup.json'}});
const {pool,env}=await postgresFrom(String(args['env-file'])),client=await pool.connect();
try{
  assert.ok(args.output&&args.release);const output=resolve(String(args.output)),release=String(args.release);
  await mkdir(output,{mode:0o700}); // Refuse to overwrite an earlier bundle.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const archive=(await client.query('SELECT release_id,state FROM metadata_source.archive_release')).rows;
  assert.equal(archive.length,1,'Multi-release export needs an explicit retention inventory');assert.equal(archive[0].release_id,release);
  const physical=env.DATABASE_SCHEMA,bnb=env.BNB_DATABASE_SCHEMA??'bnb_indexer';
  const archiveTables=(await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='metadata_source' AND c.relkind='r' ORDER BY c.relname`)).rows.map(row=>`metadata_source.${row.relname}`);
  const durable=['token_metadata','metadata_revision','token_publication','publication_job','publication_cursor','publication_runtime','chain_event_cursor','token_visibility','wallet_visibility_nonce','ens_identity'].map(name=>`metadata.${name}`);
  const chainTables=[physical,bnb].flatMap(schema=>['token','token_lifecycle','transfer_event','admin_role_event'].map(name=>`${schema}.${name}`));
  chainTables.push(`${bnb}.sync_state`,`${physical}._ponder_checkpoint`,`${physical}._ponder_meta`);
  const groups={archive:archiveTables,durable,chain_reference:chainTables};
  const tableManifest:Record<string,unknown>={},files:Record<string,unknown>={};
  for(const [group,tables] of Object.entries(groups)){
    console.log(JSON.stringify({phase:'dump',group,tables:tables.length}));
    const temporary=join(output,`${group}.dump.part`),destination=join(output,`${group}.dump`);
    await writeFile(temporary,'',{flag:'wx',mode:0o600});
    await processRun('pg_dump',['--format=custom','--compress=1','--no-owner','--no-acl',`--snapshot=${snapshot}`,...tables.map(table=>`--table=${table}`),`--file=${temporary}`],postgresToolEnvironment(env.DATABASE_URL));
    await link(temporary,destination);await unlink(temporary);
    files[`${group}.dump`]={sha256:await fileHash(destination),bytes:(await stat(destination)).size};
    for(const table of tables){
      const key=(await client.query(`SELECT array_agg(a.attname::text ORDER BY ord.ordinality) AS keys FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY ord(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ord.attnum
        WHERE i.indrelid=$1::regclass AND i.indisprimary`,[table])).rows[0].keys as string[]|null;
      assert.ok(key?.length,`Missing primary key: ${table}`);
      const fingerprint=await tableFingerprint(env.DATABASE_URL,table,key,snapshot);tableManifest[table]={keys:key,...fingerprint};
      console.log(JSON.stringify({phase:'fingerprint',table,rows:fingerprint.rows}));
    }
  }
  await client.query('COMMIT');
  const sourcePaths=['package.json','package-lock.json','tsconfig.json','ponder.config.ts','ponder.schema.ts','ponder-env.d.ts','lib','src','scripts','test','vendor','docs','deploy','.env.example','README.md'];
  const existing:string[]=[];for(const path of sourcePaths)if(await stat(path).catch(()=>null))existing.push(path);
  await processRun('tar',['-czf',join(output,'application.tar.gz'),...existing]);
  await processRun('tar',['-czf',join(output,'dependencies.tar.gz'),'node_modules']);
  await processRun('tar',['-czf',join(output,'node-runtime.tar.gz'),'-C','/opt','node-v24.18.1']);
  for(const name of ['application.tar.gz','dependencies.tar.gz','node-runtime.tar.gz'])files[name]={sha256:await fileHash(join(output,name)),bytes:(await stat(join(output,name))).size};
  const report={format:'metadata-recovery-bundle-v1',createdAt:new Date().toISOString(),release,archiveState:archive[0].state,
    sourceSchemas:{physical,bnb},files,tables:tableManifest,scope:'Complete archive, bindings, Base evidence/revisions, HTTP history, URI/quarantine evidence, visibility/nonces, complete retained chain-event journals and comparison-only chain projections; code, pinned installed dependencies and Node runtime; no credentials',
    restoreVerified:false,offHostCopyVerified:false};
  await writeReport(join(output,'manifest.json'),report);await writeReport(String(args.report),{...report,output});
  console.log(JSON.stringify({complete:true,output,files:Object.keys(files).length,tables:Object.keys(tableManifest).length}));
}catch(error){await client.query('ROLLBACK');console.error({error:safeFailure(error),frames:error instanceof Error?error.stack?.split('\n').slice(1,4):[]});process.exitCode=1;}
finally{client.release();await pool.end();}

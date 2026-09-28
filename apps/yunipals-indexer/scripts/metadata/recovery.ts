import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { sqlIdentifier } from '../../lib/offchain/sql.js';
import { postgresToolEnvironment } from './support.js';
import type { Pool } from 'pg';

export const recoveryDatabasePattern=/^metadata_archive_test_recovery_[a-z0-9_]+$/;
/** Runtime modules read process.env, while CLI helpers read the selected file.
 * Refuse mismatches before importing any writer backed by the runtime pool.
 */
export function assertRecoveryRuntimeEnvironment(selected:NodeJS.ProcessEnv,runtime:NodeJS.ProcessEnv=process.env){
  for(const key of ['DATABASE_URL','DATABASE_SCHEMA','READ_DATABASE_SCHEMA','BNB_DATABASE_SCHEMA','METADATA_SOURCE_MODE','RARITY_READ_SOURCE']){
    if(selected[key]!==runtime[key])throw new Error(`Recovery runtime environment mismatch: ${key}`);
  }
}
export async function assertRecoveryDatabase(pool:Pool){
  const database=(await pool.query('SELECT current_database() AS name')).rows[0].name as string;
  assert.match(database,recoveryDatabasePattern,'Recovery writes require a dedicated disposable recovery database');return database;
}
export async function fileHash(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export function processRun(command:string,args:string[],env:NodeJS.ProcessEnv=process.env){
  return new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{env,stdio:['ignore','ignore','pipe']});
    // Driver output may contain connection settings/source values; never forward it.
    child.stderr.resume();child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} failed (${code}); details suppressed`)));});
}
export async function tableFingerprint(url:string,table:string,keys:string[],snapshot?:string){
  const [schema,name]=table.split('.');assert.ok(schema&&name&&!table.split('.').slice(2).length);assert.ok(keys.length);
  if(snapshot)assert.match(snapshot,/^[A-Fa-f0-9-]+$/);
  const query=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;${snapshot?`SET TRANSACTION SNAPSHOT '${snapshot}';`:''}
    COPY(WITH fingerprints AS MATERIALIZED(SELECT ${keys.map(sqlIdentifier).join(',')},
      encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS recovery_row_digest FROM ${sqlIdentifier(schema)}.${sqlIdentifier(name)} t)
      SELECT recovery_row_digest FROM fingerprints ORDER BY ${keys.map(sqlIdentifier).join(',')}) TO STDOUT;COMMIT;`;
  const hash=createHash('sha256');let rows=0;
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('psql',['-X','--quiet','--set','ON_ERROR_STOP=1','--command',query],{
      env:{...postgresToolEnvironment(url),PGOPTIONS:'-c timezone=UTC -c datestyle=ISO,YMD -c statement_timeout=0 -c work_mem=64MB'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',(chunk:Buffer)=>{hash.update(chunk);for(const byte of chunk)if(byte===10)rows++;});
    child.stderr.resume();child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Fingerprint failed for ${table}`)));
  });return {rows,sha256:hash.digest('hex'),algorithm:'sha256(stream of ordered SHA-256 row JSON digests with newline separators)'};
}

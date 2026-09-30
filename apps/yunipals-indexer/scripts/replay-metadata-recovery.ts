import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { argumentsOf,postgresFrom,writeReport,safeFailure } from './metadata/support.js';
import { assertRecoveryDatabase,tableFingerprint } from './metadata/recovery.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { ZERO_ADDRESS,collectionSlugs } from '../lib/constants.js';

const args=argumentsOf({input:{type:'string'},report:{type:'string',default:'docs/metadata-migration/step-4-chain-replay.json'}});
const {pool,env}=await postgresFrom(String(args['env-file'])),client=await pool.connect();
const started=performance.now();
try{
  const database=await assertRecoveryDatabase(pool),manifest=JSON.parse(await readFile(join(String(args.input),'manifest.json'),'utf8'));
  const physical=sqlIdentifier(manifest.sourceSchemas.physical),bnb=sqlIdentifier(manifest.sourceSchemas.bnb);
  const target=sqlIdentifier(env.DATABASE_SCHEMA),targetBnb=sqlIdentifier(env.BNB_DATABASE_SCHEMA??'recovery_bnb'),read=sqlIdentifier(env.READ_DATABASE_SCHEMA??'recovery_read');
  assert.notEqual(target,physical);assert.notEqual(targetBnb,bnb);assert.notEqual(target,targetBnb);assert.notEqual(read,target);assert.notEqual(read,targetBnb);
  await client.query("SELECT pg_advisory_lock(hashtext('metadata:chain-recovery'))");
  await client.query(`INSERT INTO metadata.chain_readiness(collection,state,reason) SELECT unnest($1::text[]),'rebuilding','recovery_event_replay'
    ON CONFLICT(collection) DO UPDATE SET state='rebuilding',reason='recovery_event_replay',verified_at=NULL,updated_at=now()`,[collectionSlugs]);
  await client.query('DELETE FROM metadata.derived_snapshot');
  await client.query('SET statement_timeout=0');await client.query("SET work_mem='64MB'");
  await client.query('BEGIN');
  for(const schema of [target,targetBnb,read])await client.query(`CREATE SCHEMA ${schema}`);
  for(const [output,reference] of [[target,physical],[targetBnb,bnb]])for(const table of ['token','token_lifecycle','transfer_event','admin_role_event']){
    await client.query(`CREATE TABLE ${output}.${table}(LIKE ${reference}.${table} INCLUDING ALL)`);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${output}.${table}`)).rows[0].count,0);
  }
  const evidence:any[]=[];
  for(const collection of collectionSlugs){
    const source=collection==='bnb'?bnb:physical,output=collection==='bnb'?targetBnb:target;
    console.log(JSON.stringify({phase:'replay',collection}));
    // Recompute lifecycles from the complete event journal; never copy saved owner/lifecycle state.
    const continuity=(await client.query(`WITH ordered AS(SELECT *,lag("to") OVER(PARTITION BY token_id ORDER BY block_number,transaction_index,log_index) AS previous_owner
      FROM ${source}.transfer_event WHERE collection=$1)
      SELECT count(*)::int AS errors FROM ordered WHERE CASE WHEN "from"=$2 THEN previous_owner IS NOT NULL AND previous_owner<>$2
        ELSE previous_owner IS DISTINCT FROM "from" END`,[collection,ZERO_ADDRESS])).rows[0].errors;
    assert.equal(continuity,0,`${collection}: inconsistent transfer journal`);
    await client.query(`INSERT INTO ${output}.transfer_event(id,collection,chain_id,contract_address,token_id,lifecycle,"from","to",block_number,block_timestamp,transaction_hash,transaction_index,log_index)
      SELECT id,collection,chain_id,contract_address,token_id,
        sum(CASE WHEN "from"=$2 THEN 1 ELSE 0 END) OVER(PARTITION BY token_id ORDER BY block_number,transaction_index,log_index ROWS UNBOUNDED PRECEDING)::integer,
        "from","to",block_number,block_timestamp,transaction_hash,transaction_index,log_index
      FROM ${source}.transfer_event WHERE collection=$1`,[collection,ZERO_ADDRESS]);
    await client.query(`INSERT INTO ${output}.token_lifecycle(collection,token_id,lifecycle,minted_to,mint_block,mint_timestamp,mint_transaction_hash,burned_at_block,burned_at_timestamp,burn_transaction_hash)
      SELECT m.collection,m.token_id,m.lifecycle,m."to",m.block_number,m.block_timestamp,m.transaction_hash,b.block_number,b.block_timestamp,b.transaction_hash
      FROM ${output}.transfer_event m LEFT JOIN ${output}.transfer_event b ON b.collection=m.collection AND b.token_id=m.token_id AND b.lifecycle=m.lifecycle AND b."to"=$2
      WHERE m.collection=$1 AND m."from"=$2`,[collection,ZERO_ADDRESS]);
    await client.query(`INSERT INTO ${output}.token(collection,chain_id,contract_address,token_id,owner,burned,lifecycle,mint_block,mint_timestamp,last_transfer_block,last_transfer_timestamp,last_transaction_hash)
      SELECT e.collection,e.chain_id,e.contract_address,e.token_id,e."to",e."to"=$2,e.lifecycle,l.mint_block,l.mint_timestamp,e.block_number,e.block_timestamp,e.transaction_hash
      FROM (SELECT DISTINCT ON(token_id) * FROM ${output}.transfer_event WHERE collection=$1 ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC) e
      JOIN ${output}.token_lifecycle l ON l.collection=e.collection AND l.token_id=e.token_id AND l.lifecycle=e.lifecycle`,[collection,ZERO_ADDRESS]);
    await client.query(`INSERT INTO ${output}.admin_role_event SELECT * FROM ${source}.admin_role_event WHERE collection=$1`,[collection]);
    const counts=(await client.query(`SELECT (SELECT count(*)::text FROM ${output}.token WHERE collection=$1) AS tokens,
      (SELECT count(*)::text FROM ${output}.token_lifecycle WHERE collection=$1) AS lifecycles,
      (SELECT count(*)::text FROM ${output}.transfer_event WHERE collection=$1) AS transfers,
      (SELECT max(block_number)::text FROM ${output}.transfer_event WHERE collection=$1) AS lastEventBlock`,[collection])).rows[0];
    evidence.push({collection,...counts,continuityErrors:continuity});
  }
  for(const table of ['token','token_lifecycle','transfer_event','admin_role_event'])await client.query(`CREATE VIEW ${read}.${table} AS SELECT * FROM ${target}.${table} UNION ALL SELECT * FROM ${targetBnb}.${table}`);
  await client.query(`CREATE TABLE ${targetBnb}.sync_state(LIKE ${bnb}.sync_state INCLUDING ALL); INSERT INTO ${targetBnb}.sync_state SELECT * FROM ${bnb}.sync_state`);
  await client.query(`CREATE TABLE ${target}._ponder_meta(LIKE ${physical}._ponder_meta INCLUDING ALL);INSERT INTO ${target}._ponder_meta SELECT * FROM ${physical}._ponder_meta`);
  await client.query('COMMIT');
  const comparisons:any[]=[];
  for(const [output,reference] of [[env.DATABASE_SCHEMA,manifest.sourceSchemas.physical],[env.BNB_DATABASE_SCHEMA??'recovery_bnb',manifest.sourceSchemas.bnb]])for(const table of ['token','token_lifecycle','transfer_event','admin_role_event']){
    const expected=manifest.tables[`${reference}.${table}`],actual=await tableFingerprint(env.DATABASE_URL,`${output}.${table}`,expected.keys);
    assert.equal(actual.rows,expected.rows,`${output}.${table} count`);assert.equal(actual.sha256,expected.sha256,`${output}.${table} values`);
    comparisons.push({table:`${output}.${table}`,reference:`${reference}.${table}`,...actual});
  }
  await writeReport(String(args.report),{format:'metadata-recovery-chain-replay-v1',verifiedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-started)/1000,database,complete:true,
    input:'Complete retained chain-event journal from the consistent recovery bundle, from each collection deployment through its recorded indexed checkpoint',
    scope:'Empty token, lifecycle, transfer and role tables; independent chronological ownership/lifecycle reconstruction; byte-equivalent results across every row. This does not claim a fresh RPC download or a Ponder/BNB ingestion benchmark.',evidence,comparisons});
  for(const chain of evidence)await client.query("UPDATE metadata.chain_readiness SET state='ready',checkpoint_block=$2,reason=NULL,verified_at=now(),updated_at=now() WHERE collection=$1",[chain.collection,chain.lasteventblock??chain.lastEventBlock]);
  console.log(JSON.stringify({complete:true,evidence}));
}catch(error){await client.query('ROLLBACK');console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{await client.query("SELECT pg_advisory_unlock(hashtext('metadata:chain-recovery'))").catch(()=>{});client.release();await pool.end();}

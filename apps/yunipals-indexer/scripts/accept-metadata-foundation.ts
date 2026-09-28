import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {argumentsOf,postgresFrom,safeFailure,writeReport} from './metadata/support.js';
const args=argumentsOf({release:{type:'string'}});
async function main(){
 const release=String(args.release??''),files=['reconciliation.json','reconciliation-review.json','identity-validation.json','experimental-validation.json','lookup-validation.json','family-lookup-validation.json','parent-validation.json','family-comparison.json','public-comparison.json','binding-validation.json','ownership-validation.json','base-event-validation.json','tests.json'];
 const reports:Record<string,any>={},evidence=[];
 for(const file of files){const data=await readFile(`docs/metadata-migration/${file}`,'utf8');reports[file]=JSON.parse(data);evidence.push({file,sha256:createHash('sha256').update(data).digest('hex')});if(reports[file].release!==undefined)assert.equal(reports[file].release,release);}
 const reconciliation=reports['reconciliation.json'];assert.equal(reconciliation.state,'complete');assert.equal(Object.keys(reconciliation.sources).length,2);
 for(const source of Object.values(reconciliation.sources) as any[]){assert.equal(source.state,'complete');assert.equal(String(source.count),source.expectedCount);assert.equal(source.rollingHash,source.expectedHash);}
 assert.equal(reports['reconciliation-review.json'].accepted,true);
 assert.equal(reports['parent-validation.json'].failures.length,0);assert.equal(reports['experimental-validation.json'].complete,true);
 assert(reports['family-comparison.json'].results.every((r:any)=>['matched','unrenderable_in_legacy'].includes(r.referenceStatus)&&['matched','legacy_burned_rejection','legacy_message_only'].includes(r.httpStatusKind)&&!r.error));
 assert(reports['public-comparison.json'].results.every((r:any)=>['matched','legacy_unavailable'].includes(r.status)));
 assert.equal(reports['binding-validation.json'].complete,true);
 const ownership=reports['ownership-validation.json'];assert(ownership.consistency.every((r:any)=>r.missing_event==='0'&&r.mismatches==='0'));assert(ownership.samples.every((r:any)=>['matched','burn_revert_confirmed'].includes(r.status)));
 assert.equal(reports['base-event-validation.json'].complete,true);assert.equal(reports['tests.json'].passed,true);
 const{pool}=await postgresFrom(String(args['env-file']));
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  assert.equal((await client.query('SELECT state FROM metadata_source.archive_release WHERE release_id=$1 FOR UPDATE',[release])).rows[0]?.state,'candidate');
  const runs=(await client.query(`SELECT namespace,rows_imported::text AS count,rolling_hash FROM metadata_source.import_run WHERE release_id=$1 AND namespace IN ('nfts.pmonCollection','nfts.pmonCollectionBurned') FOR UPDATE`,[release])).rows;
  assert.equal(runs.length,2);for(const run of runs){assert.equal(run.count,reconciliation.sources[run.namespace].expectedCount);assert.equal(run.rolling_hash,reconciliation.sources[run.namespace].expectedHash);}
  const result={release,acceptedAt:new Date().toISOString(),steps:[1,2],accepted:true,archiveState:'candidate',productionCutover:false,evidence,
   legacyExceptions:{orphanRecords:reports['identity-validation.json'].quarantined.length,unrenderableExperimentalRecords:reports['experimental-validation.json'].records.length,alreadyMissingTokenMetadata:reports['binding-validation.json'].gaps.length},
   scope:'Archive validation, verified lookup/parent/binding projections, existing four-chain ownership reads, and replayable Base Mint/Update facts.',
   remaining:'Production API/worker integration; Base tuple-to-human-metadata publication policy; full empty-chain recovery; final writer reconciliation and verified off-host backup; routing cutover and service retirement.'};
  await client.query("UPDATE metadata_source.import_run SET state='reconciled',updated_at=now() WHERE release_id=$1 AND namespace IN ('nfts.pmonCollection','nfts.pmonCollectionBurned')",[release]);
  await client.query('UPDATE metadata_source.archive_release SET validation_report=$2::jsonb WHERE release_id=$1',[release,JSON.stringify(result)]);
  await client.query('COMMIT');
  await writeReport('docs/metadata-migration/steps-1-2-acceptance.json',result);console.log(JSON.stringify(result));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch(e=>{console.error(safeFailure(e));process.exitCode=1;});

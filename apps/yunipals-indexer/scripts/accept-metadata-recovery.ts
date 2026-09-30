import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argumentsOf,writeReport,safeFailure } from './metadata/support.js';
import { fileHash } from './metadata/recovery.js';

const args=argumentsOf({'local-only':{type:'boolean',default:false},output:{type:'string'}});
const localOnly=Boolean(args['local-only']);
const output=String(args.output??`docs/metadata-migration/step-4-${localOnly?'local-acceptance':'acceptance'}.json`);
try{
  const directory='docs/metadata-migration',reports:Record<string,any>={},evidenceSha256:Record<string,string>={};
  for(const name of ['backup','restore','chain-replay','publication','derived','integrity','ownership','offhost','runtime','publisher-checks','tests','typecheck',...(localOnly?['encryption']:[])]){
    const file=`step-4-${name}.json`,path=join(directory,file);reports[name]=JSON.parse(await readFile(path,'utf8'));evidenceSha256[file]=await fileHash(path);
  }
  for(const name of ['restore','chain-replay','publication','derived','integrity','runtime','publisher-checks',...(localOnly?[]:['offhost'])])assert.equal(reports[name].complete,true,name);
  assert.equal(reports.tests.success,true);assert.equal(reports.tests.numFailedTests,0);
  assert.equal(reports.typecheck.complete,true);assert.equal(reports.typecheck.exitCode,0);
  for(const name of ['restore','chain-replay','publication','derived','integrity'])assert.equal(reports[name].database,reports.restore.database,name);
  if(reports.backup.finalizedFrom){
    assert.equal(reports.restore.bundleManifestSha256,reports.backup.finalizedFrom.manifestSha256);
    if(!localOnly){
      assert.equal(reports.offhost.manifestSha256,reports.backup.manifestSha256);
      assert.equal(reports.offhost.files['capture-manifest.json']?.plaintextSha256,reports.restore.bundleManifestSha256);
    }
  }else assert.equal(reports.restore.bundleManifestSha256,reports.backup.manifestSha256);
  if(!localOnly)assert.equal(reports.offhost.manifestSha256,reports.backup.manifestSha256);
  assert.equal(Object.keys(reports.restore.tables).length,Object.keys(reports.backup.tables).length);
  for(const [table,expected] of Object.entries(reports.backup.tables) as [string,any][]){assert.equal(reports.restore.tables[table].sha256,expected.sha256);assert.equal(reports.restore.tables[table].rows,expected.rows);}
  assert.equal(reports['chain-replay'].comparisons.length,8);
  const tokens=reports['chain-replay'].evidence.reduce((n:number,row:any)=>n+Number(row.tokens),0);
  assert.equal(reports.integrity.counts.publications,tokens);assert.equal(reports.derived.counts.tokens,tokens);
  assert.equal(reports.integrity.reviewedCoverageMatched,true);
  assert.equal(reports.publication.forbiddenRequests,0);assert.equal(reports.derived.forbiddenRequests,0);assert.equal(reports.runtime.network.forbidden,0);
  for(const row of reports.ownership.consistency){assert.equal(row.missing_event,'0');assert.equal(row.mismatches,'0');}
  assert.equal(reports.ownership.consistency.length,4);assert.ok(reports.ownership.samples.length>=12);
  for(const sample of reports.ownership.samples)assert.ok(['matched','burn_revert_confirmed'].includes(sample.status));
  if(!localOnly){
    for(const [file,expected] of Object.entries(reports.backup.files) as [string,any][]){
      assert.equal(reports.offhost.files[file]?.downloadDecryptionVerified,true,file);
      assert.equal(reports.offhost.files[file]?.plaintextSha256,expected.sha256,file);
      assert.equal(reports.offhost.files[file]?.bytes,expected.bytes,file);
    }
    assert.equal(reports.offhost.files['manifest.json']?.downloadDecryptionVerified,true);
  }else{
    assert.equal(reports.encryption.complete,true);
    for(const [file,expected] of Object.entries(reports.backup.files) as [string,any][]){
      assert.equal(reports.encryption.files[file]?.sha256,expected.sha256,file);
      assert.equal(reports.encryption.files[file]?.bytes,expected.bytes,file);
    }
    assert.equal(reports.encryption.files['manifest.json']?.sha256,reports.backup.manifestSha256);
  }
  evidenceSha256['STEP-4.md']=await fileHash(join(directory,'STEP-4.md'));
  await writeReport(output,{format:'metadata-recovery-acceptance-v1',release:reports.backup.release,checkedAt:new Date().toISOString(),
    localRecoveryVerified:true,offhostVerified:!localOnly,implementationAccepted:!localOnly,readyForStep5:!localOnly,readyForProductionCutover:false,
    scope:`Complete consistent archive restoration, full retained-event ownership replay into empty tables, offline republication and derived rebuild. ${localOnly?'Off-host verification remains pending.':'Encrypted off-host download/decryption verified.'} No fresh full RPC ingestion benchmark.`,
    tokens,published:reports.derived.counts.published,publication:reports.integrity.publication,
    recoveredMessageOnlyCache:reports.integrity.counts.recovered_message_only_cache,
    sourceRecords:reports.backup.tables['metadata_source.source_record'].rows,
    restoredTables:Object.keys(reports.restore.tables).length,canonicalComparisons:8,offhostFiles:Object.keys(reports.offhost.files??{}).length,
    tests:{unit:reports.tests.numPassedTests,databaseChecks:reports['publisher-checks'].passed.length},
    remaining:[...(localOnly?['Approve the specified sensitive recovery bundle upload, then verify off-host download/decryption']:[]),'Final source-writer checkpoint and affected reconciliation','Retained caller/ownership coverage decisions outside the four indexed collections; wallet linking is deferred and is not a gate',
      'Coordinated release activation, process configuration, routing and rollback','Observation before eligible legacy services are retired'],evidenceSha256});
  console.log(JSON.stringify({localRecoveryVerified:true,step4Complete:!localOnly,tokens}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}

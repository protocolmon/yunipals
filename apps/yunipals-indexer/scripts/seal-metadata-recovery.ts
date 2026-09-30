import assert from 'node:assert/strict';
import { readFile,mkdir,link,stat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { argumentsOf,writeReport,safeFailure } from './metadata/support.js';
import { fileHash,processRun } from './metadata/recovery.js';

// Preserve the original capture unchanged; finalize tested recovery tooling in a
// new bundle whose database dumps are provably identical to the restored files.
const args=argumentsOf({input:{type:'string'},output:{type:'string'}});
try{
  const input=resolve(String(args.input)),output=resolve(String(args.output));assert.notEqual(input,output);
  const capture=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')),captureHash=await fileHash(join(input,'manifest.json'));
  const restore=JSON.parse(await readFile('docs/metadata-migration/step-4-restore.json','utf8'));assert.equal(restore.complete,true);assert.equal(restore.bundleManifestSha256,captureHash);
  for(const [table,expected] of Object.entries(capture.tables) as [string,any][]){assert.equal(restore.tables[table]?.sha256,expected.sha256);assert.equal(restore.tables[table]?.rows,expected.rows);}
  const evidence:Record<string,string>={};
  for(const name of ['restore','chain-replay','publication','derived','integrity','publisher-checks','runtime']){
    const path=`docs/metadata-migration/step-4-${name}.json`,report=JSON.parse(await readFile(path,'utf8'));assert.equal(report.complete,true,name);evidence[name]=await fileHash(path);
  }
  for(const name of ['tests','typecheck']){
    const path=`docs/metadata-migration/step-4-${name}.json`,report=JSON.parse(await readFile(path,'utf8'));
    assert.equal(name==='tests'?report.success:report.complete,true,name);evidence[name]=await fileHash(path);
  }
  await mkdir(output,{mode:0o700});
  const files:any={};
  for(const [name,expected] of Object.entries(capture.files) as [string,any][]){
    assert.equal((await stat(join(input,name))).size,expected.bytes);assert.equal(await fileHash(join(input,name)),expected.sha256);
    if(name==='application.tar.gz')continue;await link(join(input,name),join(output,name));files[name]=expected;
  }
  await link(join(input,'manifest.json'),join(output,'capture-manifest.json'));
  files['capture-manifest.json']={sha256:captureHash,bytes:(await stat(join(input,'manifest.json'))).size};
  const paths=['package.json','package-lock.json','tsconfig.json','ponder.config.ts','ponder.schema.ts','ponder-env.d.ts','lib','src','scripts','test','vendor','docs','deploy','.env.example','README.md'];
  const existing=[];for(const path of paths)if(await stat(path).catch(()=>null))existing.push(path);
  await processRun('tar',['-czf',join(output,'application.tar.gz'),...existing]);
  files['application.tar.gz']={sha256:await fileHash(join(output,'application.tar.gz')),bytes:(await stat(join(output,'application.tar.gz'))).size};
  const manifest={...capture,createdAt:new Date().toISOString(),files,restoreVerified:true,offHostCopyVerified:false,
    finalizedFrom:{manifestSha256:captureHash,captureCreatedAt:capture.createdAt,originalApplicationSha256:capture.files['application.tar.gz'].sha256,
      reason:'Final tested recovery tools and reports; database dumps, installed dependencies and Node runtime are unchanged from the fully verified restore.'},verificationEvidenceSha256:evidence};
  await writeReport(join(output,'manifest.json'),manifest);
  // Reuse only ciphertext for unchanged plaintext. Updated application/manifest
  // files must be encrypted separately before any approved upload.
  await mkdir(join(output,'encrypted'),{mode:0o700});
  for(const name of Object.keys(files)){
    if(name==='application.tar.gz')continue;
    const priorName=name==='capture-manifest.json'?'manifest.json':name,prior=join(input,'encrypted',`${priorName}.gpg`);
    if(await stat(prior).catch(()=>null))await link(prior,join(output,'encrypted',`${name}.gpg`));
  }
  await writeReport('docs/metadata-migration/step-4-backup.json',{...manifest,output,manifestSha256:await fileHash(join(output,'manifest.json'))});
  console.log(JSON.stringify({complete:true,output,files:Object.keys(files).length,databaseDumpsUnchanged:true}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}

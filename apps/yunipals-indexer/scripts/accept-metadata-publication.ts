import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { argumentsOf,writeReport,safeFailure } from './metadata/support.js';
const args=argumentsOf({release:{type:'string'},output:{type:'string',default:'docs/metadata-migration/step-3-acceptance.json'}});
try{
  const directory='docs/metadata-migration/',release=String(args.release??''),evidence:Record<string,string>={};
  async function report(name:string){const data=await readFile(directory+name);evidence[name]=createHash('sha256').update(data).digest('hex');return JSON.parse(data.toString());}
  const source={scanned:0,renderable:0,exceptions:{} as Record<string,number>,peakShardRss:0};
  for(let shard=0;shard<4;shard++){
    const data=await report(`publication-coverage-${shard}.json`);assert.equal(data.release,release);assert.equal(data.shard,shard);assert.equal(data.shards,4);
    source.peakShardRss=Math.max(source.peakShardRss,data.peakRss);
    for(const value of Object.values(data.namespaces) as any[]){assert.equal(value.complete,true);source.scanned+=value.scanned;source.renderable+=value.valid;
      for(const [reason,count] of Object.entries(value.exceptions))source.exceptions[reason]=(source.exceptions[reason]??0)+Number(count);}
  }
  assert.equal(source.scanned,6957463);assert.equal(source.renderable,6957428);
  assert.deepEqual(source.exceptions,{'EXP:source_invalid':34,'unknown:source_invalid':1});
  const indexed={scanned:0,counts:{} as Record<string,number>,collections:{} as Record<string,unknown>};
  for(const name of ['indexed-publication.json','indexed-publication-bnb.json']){
    const data=await report(name);assert.equal(data.release,release);assert.equal(data.complete,true);
    for(const [collection,value] of Object.entries(data.collections) as [string,any][]){
      assert.equal(value.complete,true);assert.ok(!indexed.collections[collection]);assert.deepEqual(value.differences,{});
      assert.ok(Object.keys(value.counts).every(key=>['rendered','cache_matched','binding_unavailable','recovered_from_invalid_http_cache','media_unavailable'].includes(key)));
      indexed.scanned+=value.scanned;indexed.collections[collection]=value;
      for(const [key,count] of Object.entries(value.counts))indexed.counts[key]=(indexed.counts[key]??0)+Number(count);
    }
  }
  assert.equal(indexed.scanned,1072943);assert.equal(indexed.counts.rendered,1072868);assert.equal(indexed.counts.binding_unavailable,75);
  assert.equal(indexed.counts.recovered_from_invalid_http_cache,65640);
  assert.equal(indexed.counts.cache_matched+indexed.counts.recovered_from_invalid_http_cache,indexed.counts.rendered);
  const api=await report('api-validation.json'),publisher=await report('publisher-integration.json'),runtime=await report('runtime-independence.json'),tests=await report('step-3-tests.json'),production=await report('step-3-production-snapshot.json');
  const typecheck=await report('step-3-typecheck.json');assert.equal(typecheck.exitCode,0);assert.equal(typecheck.complete,true);
  for(const value of [api,publisher,runtime])assert.equal(value.complete,true);
  assert.equal(api.release,release);assert.equal(api.forbiddenRequests,0);assert.equal(runtime.network.forbidden,0);
  assert.equal(tests.success,true);assert.equal(tests.numFailedTests,0);
  assert.equal(production.active_releases,0);assert.equal(production.published_projection_rows,0);assert.equal(production.publication_jobs,0);assert.equal(production.candidate_state,'candidate');
  for(const name of ['caller-access-audit.json','caller-wallet-audit.json','routes.json','steps-1-2-acceptance.json'])await report(name);
  const gates=[
    'Step 4: full empty-chain and derived-projection rebuild, complete recovery export and verified off-host copy',
    'Step 5: confirm any required ownership outside the four indexed collections; wallet linking is explicitly deferred and is not a cutover requirement',
    'Step 5: review direct-port/external consumers, retirement handlers, request limits and ambiguous-owner responses',
    'Step 5: final source-writer checkpoint/reconciliation, complete publication/derived generations, measured production lag, activation/routing with coordinated rollback',
    'Step 6: observe replacement behavior and retire eligible services only after remaining callers migrate'
  ];
  await writeReport(String(args.output),{format:'metadata-publication-acceptance-v1',release,checkedAt:new Date().toISOString(),implementationAccepted:true,
    readyForProductionCutover:false,source,indexed,api:{publicSamples:api.public.length,qualifiedBulk:api.qualifiedBulk,burnedBulk:api.burnedBulk,staticIslands:api.staticIslands,latencyMs:api.latencyMs},
    tests:{passed:tests.numPassedTests,files:tests.testResults.length,typecheck,postgresChecks:publisher.passed.length},
    publicationBenchmark:publisher.publicationBenchmark,runtimeIndependence:runtime,
    basePolicy:'Mint and identical-tuple Updates supported; changed tuples quarantine current metadata until audited conversion exists; ownership continues',
    mediaPolicy:'Existing empty media URLs retained as valid historical traits; media coverage counted separately',
    ownershipPolicy:'Four indexed chains; ambiguous unqualified legacy IDs omit single-owner claims; other chain fields are historical',
    walletLinkingPolicy:"Wallet linking deferred by explicit user decision; use the supplied wallet only, retain 410 for expansion/account-linking requests, and require no linked-wallet preservation or caller migration before cutover",
    production,gates,evidenceSha256:evidence});
  console.log(JSON.stringify({implementationAccepted:true,source:source.scanned,indexed:indexed.scanned,recovered:indexed.counts.recovered_from_invalid_http_cache,cutover:false}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}

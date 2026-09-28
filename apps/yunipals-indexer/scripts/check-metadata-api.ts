import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { legacyMetadataRouter, validLegacyId } from "../lib/api/legacy-metadata.js";
import { LocalMetadataReader } from "../lib/metadata/resolve.js";
import { ArchiveReader } from "../lib/metadata/source/read.js";
import { immutableMetadata } from "../lib/metadata/publication.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";
import { contentHash } from "../lib/metadata/source/canonical.js";
import { staticNamespace } from "../lib/metadata/source/supplemental.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";

const args=argumentsOf({release:{type:"string"},output:{type:"string",default:"docs/metadata-migration/api-validation.json"}});
const {pool,env}=await postgresFrom(String(args["env-file"]));
const originalFetch=globalThis.fetch;
let forbiddenRequests=0;
globalThis.fetch=async()=>{forbiddenRequests++;throw new Error("External HTTP is forbidden during candidate API validation");};
try {
  const release=String(args.release??""),reader=new LocalMetadataReader(pool,env.READ_DATABASE_SCHEMA??env.DATABASE_SCHEMA,{releaseId:release,candidate:true});
  const archive=new ArchiveReader(pool,release,true),app=legacyMetadataRouter(reader);
  const corpus=JSON.parse(await readFile("docs/metadata-migration/public-comparison.json","utf8"));
  const families=JSON.parse(await readFile("docs/metadata-migration/family-comparison.json","utf8"));
  assert.equal(corpus.release,release);assert.equal(families.release,release);
  const stable=(document:Record<string,unknown>)=>contentHash(comparisonDocument(immutableMetadata(document)));
  const results:unknown[]=[],latencies:number[]=[];
  for(const sample of corpus.results){
    const start=performance.now(),response=await app.request(`/meta?id=${encodeURIComponent(sample.id)}`),body:any=await response.json();
    latencies.push(performance.now()-start);
    if(!validLegacyId(sample.id)){assert.deepEqual(body,{message:"Invalid id"});results.push({id:sample.id,status:"legacy_invalid_id"});continue;}
    if(body.message==="NFT is burned"){
      assert.equal(sample.status,"legacy_unavailable");results.push({id:sample.id,status:"legacy_burned"});continue;
    }
    assert.equal(response.status,200,`${sample.id}: ${JSON.stringify(body)}`);
    const expected=await archive.snapshot(sample.id);
    assert.equal(stable(body),stable(expected.document),`${sample.id}: traits differ`);
    const etag=response.headers.get("etag");assert.ok(etag);
    assert.equal((await app.request(`/meta?id=${sample.id}`,{headers:{"If-None-Match":etag}})).status,304);
    results.push({id:sample.id,status:"traits_matched",ownership:response.headers.get("x-metadata-ownership")});
  }
  let qualified=0,burned=0;
  for(const sample of families.results){
    if(!validLegacyId(sample.legacy_id))continue;
    const response=await app.request("/v1/getMetasById",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[sample.legacy_id,sample.legacy_id],genIdType:sample.family})});
    if(response.status===500 && (await response.clone().text()).includes("NFT is burned")){burned++;continue;}
    assert.equal(response.status,200,`${sample.family}/${sample.legacy_id}: ${await response.clone().text()}`);
    const body:any=await response.json();assert.equal(body.length,2);assert.deepEqual(body[0],body[1]);
    const source=await archive.lookup(sample.legacy_id,sample.family,false),snapshot=await archive.renderSource(source,false,true);
    assert.equal(stable(body[0]),stable(snapshot.document));qualified++;
  }
  const islands=(await pool.query(`SELECT r.source_key,b.payload->'document' AS document FROM metadata_source.source_record r
    JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.namespace=$2`,[release,staticNamespace])).rows;
  for(const island of islands){const response=await app.request(`/v1/island-meta/${island.source_key}`);assert.equal(response.status,200);assert.deepEqual(await response.json(),island.document);}
  assert.equal(islands.length,2);
  await assert.rejects(()=>new LocalMetadataReader(pool,env.READ_DATABASE_SCHEMA??env.DATABASE_SCHEMA).release(),{reason:"archive_unavailable"});
  assert.equal(forbiddenRequests,0);
  latencies.sort((a,b)=>a-b);
  await writeReport(String(args.output),{release,checkedAt:new Date().toISOString(),complete:true,scope:"Read-only candidate router requests; no network HTTP; native API and publication path separately verified in disposable PostgreSQL",
    public:results,qualifiedBulk:qualified,burnedBulk:burned,staticIslands:islands.length,forbiddenRequests,
    latencyMs:{samples:latencies.length,p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.floor(latencies.length*.95)],max:latencies.at(-1)}});
  console.log(JSON.stringify({complete:true,public:results.length,qualified,burned,islands:islands.length}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await pool.end();}

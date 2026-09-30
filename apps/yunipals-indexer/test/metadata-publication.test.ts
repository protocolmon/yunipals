import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { immutableMetadata, metadataSourceMode, MetadataUnavailable, publicationHash, validateMetadata } from "../lib/metadata/publication.js";
import { renderLegacySnapshot } from "../lib/metadata/render/snapshot.js";
import { legacyMetadataRouter } from "../lib/api/legacy-metadata.js";
import type { LocalMetadataReader } from "../lib/metadata/resolve.js";

const fixture=JSON.parse(readFileSync(new URL("./fixtures/metadata/gen1_booster.json",import.meta.url),"utf8"));
const document=renderLegacySnapshot(fixture.envelope,{publicFacing:true,metadataUpdatedAt:fixture.metadataUpdatedAt});
describe("local publication contract",()=>{
  it("rejects HTTP-success error bodies and incomplete documents",()=>{
    for(const value of [{message:"NFT is burned"},{message:"No polkamon found"},{...document,name:""},{...document,attributes:{}}])expect(()=>validateMetadata(value)).toThrow();
    expect(validateMetadata(document).id).toBe(document.id);
    expect(validateMetadata({...document,animation_url:""}).id).toBe(document.id);
    expect(validateMetadata({...document,image:"",animation_url:"",name:"Ghost Portal"}).name).toBe("Ghost Portal");
  });
  it("does not create trait revisions on owner or minted-state changes",()=>{
    expect(publicationHash({...document,address:"old",minted:true,ownerSince:"yesterday"})).toBe(publicationHash({...document,address:"new",minted:false,ownerSince:"today"}));
    expect(immutableMetadata(document)).not.toHaveProperty("address");
    expect(publicationHash({...document,name:"different"})).not.toBe(publicationHash(document));
  });
  it("keeps legacy mode explicit and rejects unknown runtime modes",()=>{
    expect(metadataSourceMode({})).toBe("legacy-http");expect(metadataSourceMode({METADATA_SOURCE_MODE:"archive"})).toBe("archive");
    expect(()=>metadataSourceMode({METADATA_SOURCE_MODE:"mongo-mirror"})).toThrow();
  });
});

describe("retained metadata HTTP contracts",()=>{
  function setup(){
    const byId=vi.fn(async(id:string,family?:string,variant?:string)=>({document:{...document,id},contentHash:"abc",release:"active-v1",ownership:"indexed_chain"}));
    const reader={byId,island:vi.fn(async()=>null),owned:vi.fn(async()=>[document])} as unknown as LocalMetadataReader;
    return {app:legacyMetadataRouter(reader),byId,reader};
  }
  it("preserves missing/invalid IDs, burned messages and missing NFTs",async()=>{
    const {app,byId}=setup();
    expect(await(await app.request('/meta')).json()).toEqual({message:"Missing id"});
    expect(await(await app.request('/meta?id=1&id=2')).json()).toEqual({message:"Invalid id"});
    byId.mockRejectedValueOnce(new MetadataUnavailable("burned"));
    const burned=await app.request('/meta?id=1');expect(burned.status).toBe(200);expect(await burned.json()).toEqual({message:"NFT is burned"});
    byId.mockRejectedValueOnce(Object.assign(new Error(),{code:"source_missing"}));expect((await app.request('/meta?id=1')).status).toBe(404);
  });
  it("supports HEAD, revalidation and cross-origin bulk preflight",async()=>{
    const {app}=setup();
    const response=await app.request('/meta?id=1');expect(response.headers.get('etag')).toBe('"abc"');
    expect(response.headers.get('x-metadata-ownership')).toBe('indexed_chain');
    expect((await app.request('/meta?id=1',{headers:{'If-None-Match':'"abc"'}})).status).toBe(304);
    expect(await(await app.request('/meta?id=1',{method:'HEAD'})).text()).toBe('');
    const options=await app.request('/v1/getMetasById',{method:'OPTIONS',headers:{Origin:'https://client.example','Access-Control-Request-Method':'POST'}});
    expect(options.headers.get('access-control-allow-methods')).toContain('POST');
  });
  it("preserves bulk order and duplicates, uses factory variant and rejects oversized input",async()=>{
    const {app,byId}=setup();const request=(body:unknown)=>app.request('/v1/getMetasById',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await request({ids:['2','1','2'],genIdType:'GEN1'});
    expect((await result.json() as {id:string}[]).map(x=>x.id)).toEqual(['2','1','2']);
    expect(byId).toHaveBeenCalledWith('2','GEN1','legacy-factory');
    expect((await(await request({ids:[2,'1',2],genIdType:'GEN1'})).json() as {id:string}[]).map(x=>x.id)).toEqual(['2','1','2']);
    expect((await request({ids:[Number.MAX_SAFE_INTEGER+1]})).status).toBe(400);
    expect((await request({ids:[]})).status).toBe(400);
    expect((await request({ids:Array(101).fill('1')})).status).toBe(413);
    byId.mockRejectedValueOnce(new MetadataUnavailable('burned'));expect((await request({ids:['1']})).status).toBe(500);
  });
  it("does not turn missing releases or unreconciled Base updates into successful metadata",async()=>{
    const {app,byId}=setup();
    for(const error of [new MetadataUnavailable('archive_unavailable','retry'),new MetadataUnavailable('base_tuple_requires_mapping','reconciliation_required')]){
      byId.mockRejectedValueOnce(error);expect((await app.request('/meta?id=1')).status).toBe(503);
    }
  });
  it("retains static-island errors and returns deliberate retirement responses",async()=>{
    const {app}=setup();expect((await app.request('/v1/island-meta/water/1')).status).toBe(404);
    expect((await app.request('/v1/rainbow/prepare')).status).toBe(410);expect((await app.request('/unknown')).status).toBe(404);
    expect((await app.request('/v1/all-meta-by-address?expandAddress=true&address=0x'+'a'.repeat(40))).status).toBe(410);
    const wallet=await app.request('/v1/all-meta-by-address?address=0x'+'a'.repeat(40));
    expect(await wallet.json()).toMatchObject({resultCount:1,metaData:[{id:document.id}],wallets:[{chainType:'EVM'}]});
  });
});

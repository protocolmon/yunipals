import{readFile}from'node:fs/promises';import{join}from'node:path';import{runInNewContext}from'node:vm';
import{ArchiveReader}from'../lib/metadata/source/read.js';import{decodeSource}from'../lib/metadata/source/ejson.js';
import*as pureUtilities from'../lib/metadata/render/legacy.cjs';
import{argumentsOf,postgresFrom,safeFailure,writeReport}from'./metadata/support.js';
const args=argumentsOf({release:{type:'string'}});
async function main(){const release=String(args.release??''),{pool}=await postgresFrom(String(args['env-file']));try{
 const code=await readFile(join(String(args['legacy-root']),'node_modules/@polkamon/feature-nft-transformation/src/lib/utils/transformer/legacyMetadataFactory.js'),'utf8');
 const reference:any={};runInNewContext(code,{exports:reference,require:(name:string)=>{if(!['@polkamon/web3-util-core','@polkamon/web3-util-pmons'].includes(name))throw new Error('Unexpected dependency');return pureUtilities;}});
 const factory=new reference.LegacyMetadataFactory(),reader=new ArchiveReader(pool,release,true);
 const rows=(await pool.query(`SELECT r.source_key,r.namespace,r.content_hash,r.legacy_id,r.asset_key,b.payload FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
  WHERE r.release_id=$1 AND r.family='EXP' ORDER BY r.source_key`,[release])).rows;
 const boundAssets=new Set((await pool.query('SELECT DISTINCT asset_key FROM metadata_source.asset_binding WHERE release_id=$1 AND asset_key=ANY($2::text[])',[release,rows.map(r=>r.asset_key)])).rows.map(r=>r.asset_key));
 const results=[];
 for(const row of rows){const doc=decodeSource(row.payload)as any,projected={...doc,nft:Object.fromEntries(Object.keys(reference.MandatoryNftProjection.nft).filter(k=>doc.nft?.[k]!==undefined).map(k=>[k,doc.nft[k]]))};
  let legacyError:string|null=null,localError:string|null=null;
  try{factory.envelopeToLegacy(projected);}catch(e){legacyError=e instanceof Error?e.name:'Error';}
  try{await reader.snapshotByAsset(row.asset_key,false,true);}catch(e){localError=e instanceof Error?e.name:'Error';}
  const bound=boundAssets.has(row.asset_key);
  results.push({namespace:row.namespace,key:row.source_key,hash:row.content_hash,id:row.legacy_id,legacyError,localError,bound});
 }
 const complete=rows.length===34&&results.every(r=>r.legacyError&&r.localError&&!r.bound);
 const report={release,observedAt:new Date().toISOString(),complete,records:results,disposition:'Preserve raw experimental records; do not fabricate chain identity or missing traits. No currently indexed token binding depends on these records.'};
 await writeReport('docs/metadata-migration/experimental-validation.json',report);console.log(JSON.stringify({complete,records:results.length,unexpected:results.filter(r=>!r.legacyError||!r.localError||r.bound)}));if(!complete)process.exitCode=2;
}finally{await pool.end();}}
main().catch(e=>{console.error(safeFailure(e));process.exitCode=1;});

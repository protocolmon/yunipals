import { readFile, appendFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { collectionSlugs,collections,ZERO_ADDRESS } from "../lib/constants.js";
import { sqlIdentifier } from "../lib/offchain/sql.js";
import { ArchiveReader } from "../lib/metadata/source/read.js";
import { rendererVersion } from "../lib/metadata/render/snapshot.js";
import { immutableMetadata,metadataError,validateMetadata } from "../lib/metadata/publication.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";
import { contentHash } from "../lib/metadata/source/canonical.js";
import { argumentsOf,postgresFrom,safeFailure,writeReport } from "./metadata/support.js";
const args=argumentsOf({release:{type:'string'},resume:{type:'boolean',default:false},limit:{type:'string',default:'0'},'batch-size':{type:'string',default:'2000'},collections:{type:'string',default:collectionSlugs.join(',')},output:{type:'string',default:'docs/metadata-migration/indexed-publication.json'}});
const {pool,env}=await postgresFrom(String(args['env-file'])),schema=sqlIdentifier(env.READ_DATABASE_SCHEMA??env.DATABASE_SCHEMA);
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
type Progress={cursor:string;scanned:number;counts:Record<string,number>;differences:Record<string,number>;complete:boolean};
type Report={format:string;release:string;rendererVersion:string;collections:Record<string,Progress>;elapsedSeconds:number;updatedAt:string;complete:boolean};
try{
  const release=String(args.release??''),output=String(args.output),reader=new ArchiveReader(pool,release,true),start=performance.now();
  const batchSize=Number(args['batch-size']);if(!Number.isInteger(batchSize)||batchSize<1||batchSize>5000)throw new Error('Invalid batch size');
  const selected=String(args.collections).split(',');if(selected.some(slug=>!collectionSlugs.includes(slug as any)))throw new Error('Invalid collection selection');
  await reader.checkRelease();
  let report:Report={format:'indexed-publication-v1',release,rendererVersion,collections:{},elapsedSeconds:0,updatedAt:'',complete:false};
  if(args.resume){report=JSON.parse(await readFile(output,'utf8'));if(report.release!==release||report.rendererVersion!==rendererVersion)throw new Error('Checkpoint changed');}
  const elapsed=report.elapsedSeconds;let invocation=0;
  for(const collection of collectionSlugs){
    if(!selected.includes(collection))continue;
    const p=report.collections[collection]??={cursor:'',scanned:0,counts:{},differences:{},complete:false};if(p.complete)continue;
    while(!stopping){
      const rows=(await pool.query(`WITH batch AS MATERIALIZED(SELECT token_id,lifecycle,burned FROM ${schema}.token WHERE collection=$2 AND token_id>$3 ORDER BY token_id LIMIT $7)
        SELECT t.token_id,t.burned,s.asset_key AS "assetKey",s.content_hash AS hash,blob.payload,s.source_burned AS burned_source,
          s.imported_at AS "importedAt",s.issue,m.document AS cached_document,b.asset_key AS bound_asset
        FROM batch t LEFT JOIN LATERAL(SELECT mint_transaction_hash,mint_block FROM ${schema}.token_lifecycle
          WHERE collection=$2 AND token_id=t.token_id AND lifecycle=t.lifecycle OFFSET 0) l ON true
        LEFT JOIN LATERAL(SELECT transaction_hash,log_index FROM ${schema}.transfer_event WHERE collection=$2
          AND token_id=t.token_id AND lifecycle=t.lifecycle AND transaction_hash=l.mint_transaction_hash
          AND block_number=l.mint_block AND "from"=$4 OFFSET 0) mint ON true
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=$5 AND b.contract_address=$6
          AND b.token_id=t.token_id AND b.mint_transaction_hash=mint.transaction_hash AND b.mint_log_index=mint.log_index
        LEFT JOIN LATERAL(SELECT * FROM metadata_source.source_record WHERE release_id=$1 AND asset_key=b.asset_key ORDER BY source_burned,source_key LIMIT 1) s ON true
        LEFT JOIN metadata_source.source_blob blob ON blob.content_hash=s.content_hash
        LEFT JOIN metadata.token_metadata m ON m.collection=$2 AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle ORDER BY t.token_id`,
        [release,collection,p.cursor,ZERO_ADDRESS,String(collections[collection].chainId),collections[collection].address,batchSize])).rows;
      if(!rows.length){p.complete=true;break;}
      const journal:unknown[]=[];const seen=new Set<string>();
      for(const row of rows){
        if(seen.has(row.token_id))throw new Error('Ambiguous canonical mint');seen.add(row.token_id);
        const count=(reason:string)=>{p.counts[reason]=(p.counts[reason]??0)+1;};
        if(!row.bound_asset){count('binding_unavailable');journal.push({collection,tokenId:row.token_id,reason:'binding_unavailable'});}
        else try{
          const rendered=await reader.renderSource({...row,burned:row.burned_source},true);validateMetadata(rendered.document);count('rendered');
          if(!rendered.document.image&&!rendered.document.animation_url){count('media_unavailable');journal.push({collection,tokenId:row.token_id,reason:'media_unavailable'});}
          let oldValid=true;try{validateMetadata(row.cached_document);}catch{oldValid=false;}
          if(!oldValid)count('recovered_from_invalid_http_cache');
          else{
            const old=comparisonDocument(immutableMetadata(row.cached_document)) as Record<string,unknown>;
            const next=comparisonDocument(immutableMetadata(rendered.document)) as Record<string,unknown>;
            if(contentHash(old)===contentHash(next))count('cache_matched');
            else{
              count('cache_difference');
              const fields=[...new Set([...Object.keys(old),...Object.keys(next)])].filter(key=>contentHash(old[key]??null)!==contentHash(next[key]??null));
              for(const field of fields)p.differences[field]=(p.differences[field]??0)+1;
              journal.push({collection,tokenId:row.token_id,reason:'cache_difference',fields});
            }
          }
        }catch(error){const reason=metadataError(error).reason;count(reason);journal.push({collection,tokenId:row.token_id,reason});}
        p.scanned++;invocation++;
      }
      if(journal.length)await appendFile(`${output}.differences.jsonl`,journal.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
      p.cursor=rows.at(-1).token_id;report.elapsedSeconds=elapsed+(performance.now()-start)/1000;report.updatedAt=new Date().toISOString();await writeReport(output,report);
      if(invocation%10000===0)console.log(JSON.stringify({collection,scanned:p.scanned,counts:p.counts}));
      if(Number(args.limit)>0&&invocation>=Number(args.limit)){stopping=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    if(stopping)break;
  }
  report.complete=selected.every(slug=>report.collections[slug]?.complete);report.updatedAt=new Date().toISOString();await writeReport(output,{...report,scope:selected});
  console.log(JSON.stringify({complete:report.complete,report:output}));
}catch(error){console.error(safeFailure(error));process.exitCode=1;}finally{await pool.end();}

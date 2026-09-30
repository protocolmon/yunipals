import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ArchiveReader } from "../lib/metadata/source/read.js";
import { rendererVersion } from "../lib/metadata/render/snapshot.js";
import { metadataError, validateMetadata } from "../lib/metadata/publication.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
const args=argumentsOf({release:{type:"string"},resume:{type:"boolean",default:false},limit:{type:"string",default:"0"},
  shard:{type:"string",default:"0"},shards:{type:"string",default:"1"},
  output:{type:"string",default:"docs/metadata-migration/publication-coverage.json"}});
let stopping=false;process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
type Progress={cursor:string;scanned:number;valid:number;exceptions:Record<string,number>;examples:Record<string,string[]>;rollingHash:string;complete:boolean};
type Report={format:string;release:string;rendererVersion:string;shard:number;shards:number;namespaces:Record<string,Progress>;updatedAt:string;elapsedSeconds:number;peakRss:number};
const {pool}=await postgresFrom(String(args["env-file"]));
try {
  const release=String(args.release??""),file=String(args.output),reader=new ArchiveReader(pool,release,true),started=performance.now();
  const shard=Number(args.shard),shards=Number(args.shards);
  if(!Number.isInteger(shards)||shards<1||shards>8||!Number.isInteger(shard)||shard<0||shard>=shards)throw new Error("Invalid coverage shard");
  await reader.checkRelease();
  let report:Report={format:"metadata-publication-coverage-v1",release,rendererVersion,shard,shards,namespaces:{},updatedAt:"",elapsedSeconds:0,peakRss:0};
  if(args.resume){report=JSON.parse(await readFile(file,"utf8"));if(report.release!==release||report.rendererVersion!==rendererVersion||report.shard!==shard||report.shards!==shards)throw new Error("Coverage checkpoint changed");}
  const elapsedBefore=report.elapsedSeconds;let invocation=0;
  for(const namespace of ["nfts.pmonCollection","nfts.pmonCollectionBurned"]){
    const p=report.namespaces[namespace]??={cursor:"",scanned:0,valid:0,exceptions:{},examples:{},rollingHash:"",complete:false};
    if(p.complete)continue;
    while(!stopping){
      const rows=(await pool.query(`SELECT r.source_key,r.asset_key AS "assetKey",r.content_hash AS hash,b.payload,
        r.source_burned AS burned,r.imported_at AS "importedAt",r.issue,r.family
        FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
        WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key>$3 AND (hashtext(r.source_key)&2147483647)%$4=$5
        ORDER BY r.source_key LIMIT 500`,[release,namespace,p.cursor,shards,shard])).rows;
      if(!rows.length){p.complete=true;break;}
      const hash=createHash("sha256").update(p.rollingHash);
      for(const row of rows){
        try {
          // Validate all served variants against every preserved envelope, not only current token bindings.
          const documents=await Promise.all([reader.renderSource(row,true),reader.renderSource(row,false),reader.renderSource(row,false,true)]);
          for(const snapshot of documents)validateMetadata(snapshot.document);
          p.valid++;hash.update(row.source_key).update(documents[0].inputHash);
        }catch(error){
          const reason=`${row.family??"unknown"}:${metadataError(error).reason}`;
          p.exceptions[reason]=(p.exceptions[reason]??0)+1;
          const examples=p.examples[reason]??=[];if(examples.length<20)examples.push(row.source_key);
          hash.update(row.source_key).update(reason);
        }
        p.scanned++;invocation++;
      }
      p.cursor=rows.at(-1).source_key;p.rollingHash=hash.digest("hex");report.updatedAt=new Date().toISOString();
      report.elapsedSeconds=elapsedBefore+(performance.now()-started)/1000;report.peakRss=Math.max(report.peakRss,process.memoryUsage().rss);
      await writeReport(file,report);
      if(invocation%10000===0)console.log(JSON.stringify({namespace,scanned:p.scanned,valid:p.valid,exceptions:p.exceptions,recordsPerSecond:Math.round(invocation/((performance.now()-started)/1000))}));
      if(Number(args.limit)>0 && invocation>=Number(args.limit)){stopping=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    await writeReport(file,report);if(stopping)break;
  }
  console.log(JSON.stringify({complete:Object.values(report.namespaces).length===2&&Object.values(report.namespaces).every(p=>p.complete),report:file}));
}catch(error){console.error(safeFailure(error));process.exitCode=1;}finally{await pool.end();}

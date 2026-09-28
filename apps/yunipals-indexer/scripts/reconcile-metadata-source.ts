import { readFile, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { archiveReleaseId, contentHash } from "../lib/metadata/source/canonical.js";
import { advanceSourceHash, sourceDifference } from "../lib/metadata/source/reconcile.js";
import { decodeSource } from "../lib/metadata/source/ejson.js";
import { argumentsOf, legacyMongo, postgresFrom, safeFailure, writeReport, type SourceDocument } from "./metadata/support.js";

const args = argumentsOf({ release:{type:"string"},resume:{type:"boolean",default:false},
  output:{type:"string",default:"docs/metadata-migration/reconciliation.json"},"batch-size":{type:"string",default:"2000"},
  "require-paused-writers":{type:"boolean",default:false} });
const sourceWriterUnits=["polkamon-core-graphql-api.service","polkamon-core-job-account-worker.service",...(["bsc","ethereum","polygon","solana"].map(chain=>
  `polkamon-core-job-nft-sync-worker-${chain}.service`))];
async function assertPausedWriters(){
  for(const unit of sourceWriterUnits){
    const {stdout}=await promisify(execFile)("systemctl",["show",unit,"-p","ActiveState","--value"]);
    if(stdout.trim()!=="inactive")throw new Error(`Source writer is not paused: ${unit}`);
  }
}
let stopping=false;
process.on("SIGTERM",()=>{stopping=true;}); process.on("SIGINT",()=>{stopping=true;});
type Audit = { cursor:string|null; count:number; sourceCount:number; rollingHash:string; expectedCount:string; expectedHash:string;
  upperBound:string; currentSourceUpper:string|null; state:string; counts:Record<string,number>;
  examples:Record<string,string[]>; groups:Record<string,{count:number;keys:string[]}> };
type Report = {format:string;release:string;startedAt:string;updatedAt:string;state:string;consistency:string;sources:Record<string,Audit>};
async function main() {
  const release=archiveReleaseId(String(args.release??"")),output=String(args.output),take=Number(args["batch-size"]);
  if (!Number.isSafeInteger(take)||take<1||take>2000) throw new Error("Invalid batch size");
  if(args["require-paused-writers"])await assertPausedWriters();
  let report:Report={format:"metadata-reconciliation-v1",release,startedAt:new Date().toISOString(),updatedAt:"",state:"running",
    consistency:args["require-paused-writers"]
      ?`Full source scan while the six inventoried GraphQL/NFT/account writer units are required inactive at the start, namespace boundaries and end. Other Mongo writers are not ruled out by this check.`
      :"Observations over an interval; legacy writers remain live. No activation or consistent final cutover checkpoint is implied.",sources:{}};
  if(args.resume){
    report=JSON.parse(await readFile(output,"utf8"));
    if(report.release!==release||report.format!=="metadata-reconciliation-v1"||
      report.consistency.includes("six inventoried GraphQL/NFT/account writer units")!==Boolean(args["require-paused-writers"]))
      throw new Error("Incompatible reconciliation checkpoint");
  }
  else {try{await readFile(output);throw new Error("Report exists; use --resume or a new output");}catch(error){if(!(error instanceof Error&&"code" in error&&error.code==="ENOENT"))throw error;}}
  const {pool}=await postgresFrom(String(args["env-file"]));
  const mongo=await legacyMongo(String(args["legacy-root"]));
  const save=async()=>{report.updatedAt=new Date().toISOString();await writeReport(output,report);};
  try {
    for(const name of ["pmonCollection","pmonCollectionBurned"]){
      if(args["require-paused-writers"])await assertPausedWriters();
      const namespace=`nfts.${name}`,collection=mongo.db.collection(name);
      const run=(await pool.query(`SELECT state,rows_imported::text AS count,rolling_hash AS hash,upper_bound FROM metadata_source.import_run WHERE release_id=$1 AND namespace=$2`,[release,namespace])).rows[0];
      if(!run||!["scanned","reconciled"].includes(run.state))throw new Error("Source import is incomplete");
      let audit=report.sources[namespace];
      if(!audit){
        const last=(await collection.find({},{projection:{_id:1}}).sort({_id:-1}).limit(1).toArray())[0];
        audit=report.sources[namespace]={cursor:null,count:0,sourceCount:0,rollingHash:"",expectedCount:run.count,expectedHash:run.hash,
          upperBound:run.upper_bound,currentSourceUpper:last?String(last._id):null,state:"running",counts:{},examples:{},groups:{}};
      }
      if(audit.expectedCount!==run.count||audit.expectedHash!==run.hash||audit.upperBound!==run.upper_bound)throw new Error("Import changed during reconciliation");
      if(audit.state==="complete")continue;
      let changes:{namespace:string;key:string;kind:string}[]=[];
      const note=(kind:string,key:string)=>{audit.counts[kind]=(audit.counts[kind]??0)+1;const list=audit.examples[kind]??=[];if(list.length<20)list.push(key);
        if(kind!=="equal")changes.push({namespace,key,kind});};
      while(!stopping){
        changes=[];
        const rows=(await pool.query(`WITH batch AS MATERIALIZED(SELECT source_key,content_hash,issue FROM metadata_source.source_record
          WHERE release_id=$1 AND namespace=$2 AND source_key>$3 ORDER BY source_key LIMIT $4)
          SELECT r.source_key AS key,r.content_hash AS hash,r.issue,b.payload FROM batch r
          JOIN metadata_source.source_blob b USING(content_hash) ORDER BY r.source_key`,[release,namespace,audit.cursor??"",take])).rows;
        const end=rows.at(-1)?.key??audit.currentSourceUpper;
        const docs=end&&(!audit.cursor||end>audit.cursor)?await collection.find({_id:{...(audit.cursor?{$gt:new mongo.driver.ObjectId(audit.cursor)}:{}),$lte:new mongo.driver.ObjectId(end)}},{maxTimeMS:30000}).hint("_id_").sort({_id:1}).limit(take*3+1).toArray():[];
        if(docs.length>take*3)throw new Error("Source key range grew unexpectedly; bounded reconciliation requires a smaller range");
        const current=new Map(docs.map(doc=>[String(doc._id),doc])); audit.sourceCount+=docs.length;
        for(const row of rows){
          const hash=contentHash(row.payload); if(hash!==row.hash)note("archive_hash_mismatch",row.key);
          audit.rollingHash=advanceSourceHash(audit.rollingHash,namespace,row.key,row.hash);audit.count++;
          const doc=current.get(row.key);current.delete(row.key);
          if(!doc)note("missing_from_live_source",row.key);
          else note(sourceDifference(row.payload,mongo.driver.BSON.EJSON.serialize(doc,{relaxed:false}),hash),row.key);
          if(row.issue)note(`identity:${row.issue}`,row.key);
          const decoded=decodeSource(row.payload) as SourceDocument;
          const group=JSON.stringify([decoded.genId?.type??null,decoded.origin?.type??null,decoded.chain?.id??null]);
          const stats=audit.groups[group]??={count:0,keys:[]};stats.count++;if(stats.keys.length<3)stats.keys.push(row.key);
          if(typeof decoded.nft?.name!=="string"||!decoded.nft?.attributes)note("missing_render_inputs",row.key);
        }
        for(const key of current.keys())note("new_source_key",key);
        if(end)audit.cursor=end;
        if(!rows.length){
          if(String(audit.count)!==audit.expectedCount)note("archive_count_mismatch",namespace);
          if(audit.rollingHash!==audit.expectedHash)note("archive_rolling_hash_mismatch",namespace);
          audit.state="complete";
        }
        // Journal first: a crash can repeat entries, but cannot lose differences
        // beyond the small examples retained in the progress report.
        if(changes.length)await appendFile(`${output}.changes.jsonl`,changes.map(row=>JSON.stringify(row)).join("\n")+"\n",{mode:0o600});
        await save();
        if(args["require-paused-writers"]&&audit.count%100000<take)await assertPausedWriters();
        if(audit.count%20000<take||audit.state==="complete")console.log(JSON.stringify({namespace,records:audit.count,state:audit.state,counts:audit.counts}));
        if(audit.state==="complete")break;
      }
      if(stopping)break;
    }
    report.state=Object.keys(report.sources).length===2&&Object.values(report.sources).every(a=>a.state==="complete")?"complete":"running";
    if(args["require-paused-writers"])await assertPausedWriters();
    await save();
    console.log(JSON.stringify({release,state:report.state,activated:false}));
    if(Object.values(report.sources).some(a=>Object.keys(a.counts).some(k=>!["equal","ownership_projection_changed"].includes(k))))process.exitCode=2;
  } finally {await mongo.client.close();await pool.end();}
}
main().catch(error=>{console.error(safeFailure(error));process.exitCode=1;});

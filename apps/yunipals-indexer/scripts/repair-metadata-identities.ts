import { sourceIdentity } from "../lib/metadata/source/identity.js";
import { decodeSource } from "../lib/metadata/source/ejson.js";
import { lockCandidate } from "../lib/metadata/source/archive.js";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";
import { argumentsOf,postgresFrom,safeFailure,writeReport } from "./metadata/support.js";
const args=argumentsOf({release:{type:"string"}});
async function main(){
 const release=archiveReleaseId(String(args.release??"")),{pool}=await postgresFrom(String(args["env-file"]));
 const client=await pool.connect();
 try{
  await client.query("BEGIN");await lockCandidate(client,release);
  const rows=(await client.query(`SELECT r.namespace,r.source_key,b.payload FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.issue IS NOT NULL`,[release])).rows;
  const fixed=[],quarantined=[];
  for(const row of rows){const identity=sourceIdentity(decodeSource(row.payload));
   if(identity.issue){quarantined.push({namespace:row.namespace,key:row.source_key,issue:identity.issue});continue;}
   fixed.push({namespace:row.namespace,key:row.source_key,...identity});
  }
  await client.query(`UPDATE metadata_source.source_record r SET asset_key=x."assetKey",issue=NULL
    FROM jsonb_to_recordset($2::jsonb) AS x(namespace text,key text,"assetKey" text)
    WHERE r.release_id=$1 AND r.namespace=x.namespace AND r.source_key=x.key`,[release,JSON.stringify(fixed)]);
  await client.query("COMMIT");
  const report={release,repaired:fixed.length,quarantined,rule:"BSC Baby source key, origin, bounded legacy ID and generation ID offset all agree; original envelopes unchanged",observedAt:new Date().toISOString()};
  await writeReport("docs/metadata-migration/identity-validation.json",report);console.log(JSON.stringify(report));
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();await pool.end();}
}
main().catch(e=>{console.error(safeFailure(e));process.exitCode=1;});

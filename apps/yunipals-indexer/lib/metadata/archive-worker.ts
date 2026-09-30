import { createPublicClient, http } from "viem";
import { mainnet, base, polygon, bsc } from "viem/chains";
import { pool } from "../offchain/db.js";
import { readSchemaName } from "../offchain/sql.js";
import { collections, type CollectionSlug } from "../constants.js";
import { collectionAbi } from "../abi.js";
import { baseRpcUrlOf, polygonRpcUrlOf, bnbRpcUrlOf } from "../rpc.js";
import { safeErrorMessage } from "../safe-error.js";
import { enqueuePublications, claimPublications, publishJob } from "./publish.js";
import { replayBaseMetadata } from "./base-replay.js";
import { auditArchiveUris } from "./uri-audit.js";

let stopping=false, nextBase=0, nextUri=0, nextEnqueue=0;
process.on("SIGTERM",()=>{stopping=true;}); process.on("SIGINT",()=>{stopping=true;});
const role=process.env.METADATA_WORKER_ROLE??'full';
if(role!=='full'&&role!=='publish-only')throw new Error('Invalid metadata worker role');
const concurrency=Number(process.env.METADATA_CONCURRENCY??8);
if (!Number.isInteger(concurrency) || concurrency<1 || concurrency>32) throw new Error("Invalid metadata concurrency");
const scanBatchSize=Number(process.env.METADATA_SCAN_BATCH_SIZE??5000);
if (!Number.isInteger(scanBatchSize) || scanBatchSize<1 || scanBatchSize>10000) throw new Error("Invalid metadata scan batch size");
const enqueueIntervalMs=Number(process.env.METADATA_ENQUEUE_INTERVAL_MS??5000);
if (!Number.isInteger(enqueueIntervalMs) || enqueueIntervalMs<1000 || enqueueIntervalMs>300000) throw new Error("Invalid metadata enqueue interval");
const clients={
  ethereum:createPublicClient({chain:mainnet,transport:http(process.env.PONDER_RPC_URL_1,{timeout:15000,retryCount:1})}),
  base:createPublicClient({chain:base,transport:http(baseRpcUrlOf(),{timeout:15000,retryCount:1})}),
  polygon:createPublicClient({chain:polygon,transport:http(polygonRpcUrlOf(),{timeout:15000,retryCount:1})}),
  bnb:createPublicClient({chain:bsc,transport:http(bnbRpcUrlOf(),{timeout:15000,retryCount:1})})
};
const resolveUri=async(collection:CollectionSlug,tokenId:string)=>clients[collection].readContract({address:collections[collection].address,
  abi:collectionAbi,functionName:"tokenURI",args:[BigInt(tokenId)]});

try {
  while(!stopping) {
    try {
      if(role==='full'&&Date.now()>=nextBase) {
        try {
          await replayBaseMetadata(pool,process.env,{advance:true,maxRanges:2,stopping:()=>stopping});
          await pool.query("UPDATE metadata.publication_runtime SET base_error=NULL,base_checked_at=now() WHERE singleton");
        } catch(error) {
          await pool.query("UPDATE metadata.publication_runtime SET base_error='base_replay_unavailable',base_checked_at=now() WHERE singleton");
          console.error("Base metadata replay deferred",safeErrorMessage(error));
        }
        nextBase=Date.now()+15000;
      }
      if(role==='full'&&Date.now()>=nextEnqueue){await enqueuePublications(pool,readSchemaName,scanBatchSize);nextEnqueue=Date.now()+enqueueIntervalMs;}
      if(role==='full'&&Date.now()>=nextUri){await auditArchiveUris(pool,readSchemaName,resolveUri);nextUri=Date.now()+60000;}
      const jobs=await claimPublications(pool,concurrency);
      const results=await Promise.allSettled(jobs.map(job=>publishJob(pool,readSchemaName,job,resolveUri)));
      for(const result of results) if(result.status==='rejected') console.error("Local publication failed; lease will expire",safeErrorMessage(result.reason));
      await pool.query("UPDATE metadata.publication_runtime SET last_worker_at=now() WHERE singleton");
      if(!jobs.length) await new Promise(resolve=>setTimeout(resolve,2000));
    } catch(error) {
      console.error("Metadata archive worker deferred",safeErrorMessage(error));
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  }
} finally {await pool.end();}

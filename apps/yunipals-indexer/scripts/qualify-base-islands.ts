import { baseReadClient,getBaseLogs,type BaseRpcMetrics } from "../lib/islands/base-rpc.js";
import { verifyBaseContract } from "../lib/islands/base-verify.js";
import { baseIslandCollection } from "../lib/islands/collections.js";

const url=process.env.BASE_ISLANDS_RPC_URL;
if (!url) throw new Error("BASE_ISLANDS_RPC_URL is required");
const metrics:BaseRpcMetrics={startedAtUTC:new Date().toISOString(),methods:{},responses:{}};
const client=baseReadClient(url,metrics);
const block=await client.getBlock({blockTag:"finalized",includeTransactions:false});
if (block.number===null||!block.hash) throw new Error("finalized_block_unavailable");
await verifyBaseContract(client,{number:block.number,hash:block.hash});
const from=BigInt(baseIslandCollection.deploymentBlock);
const logs=await getBaseLogs(client,from,from+99_999n);
console.log(JSON.stringify({qualifiedAtUTC:new Date().toISOString(),contract:baseIslandCollection.address,
  block:String(block.number),blockHash:block.hash,historicalRange:{from:String(from),to:String(from+99_999n)},
  logCount:logs.length,runtimeAndProvenanceVerified:true,rpc:metrics,transactionsBroadcast:0},null,2));

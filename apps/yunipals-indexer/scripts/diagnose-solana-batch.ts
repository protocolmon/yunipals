import { pool } from "../lib/offchain/db.js";
import { reserveRpcCredits, finishRpcUsage } from "../lib/solana/budget.js";
import { getAssetBatch, parseDasAsset, DasError } from "../lib/solana/das.js";

const batch = Number(process.argv[2]);
if (!Number.isSafeInteger(batch) || batch < 0 || batch > 9) throw new Error("invalid_batch_index");
const key = process.env.HELIUS_API_KEY;
if (!key) throw new Error("HELIUS_API_KEY_missing");
let usageId: number | undefined;
try {
  const ids = (await pool.query<{mint:string}>(`SELECT mint FROM solana_indexer.manifest_asset
    ORDER BY mint COLLATE "C" LIMIT 1000 OFFSET $1`,[batch*1000])).rows.map(row=>row.mint);
  if (ids.length !== 1000) throw new Error("solana_manifest_batch_incomplete");
  usageId = await reserveRpcCredits(pool,"getAssetBatch",null,10,
    Number(process.env.SOLANA_RPC_DAILY_CREDIT_LIMIT ?? 15_000),
    Number(process.env.SOLANA_RPC_ROLLING_31D_CREDIT_LIMIT ?? 500_000));
  const response=await getAssetBatch(key,ids);
  await finishRpcUsage(pool,usageId,"success",null);
  const issues=[];
  for(const entry of response){
    if(!entry || typeof entry!=="object" || !("id" in entry) || typeof entry.id!=="string"){
      issues.push({shape:"missing_or_invalid_entry"});continue;
    }
    try { parseDasAsset(entry,entry.id); }
    catch(error){
      const own="ownership" in entry && entry.ownership && typeof entry.ownership==="object"
        ? entry.ownership as Record<string,unknown> : null;
      const owner=own?.owner;
      issues.push({mint:entry.id,code:error instanceof Error?error.message:"invalid_asset",
        burnt:"burnt" in entry?entry.burnt:null,ownershipKeys:own?Object.keys(own):[],
        ownerType:typeof owner,ownerLength:typeof owner==="string"?owner.length:null});
    }
  }
  console.log(JSON.stringify({batch,returned:response.length,issues}));
} catch(error){
  if(usageId!==undefined)await finishRpcUsage(pool,usageId,"failed",
    error instanceof DasError?error.code:"diagnostic_failed").catch(()=>undefined);
  console.error(JSON.stringify({code:error instanceof DasError?error.code:"diagnostic_failed"}));
  process.exitCode=1;
} finally { await pool.end(); }

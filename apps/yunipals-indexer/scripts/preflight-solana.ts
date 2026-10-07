import { pool } from "../lib/offchain/db.js";
import { reserveRpcCredits, finishRpcUsage } from "../lib/solana/budget.js";
import { DasError, getAssetBatch, parseDasBatch } from "../lib/solana/das.js";

const key = process.env.HELIUS_API_KEY;
if (!key) throw new Error("HELIUS_API_KEY_missing");
const dayLimit = Number(process.env.SOLANA_RPC_DAILY_CREDIT_LIMIT ?? 15_000);
const rollingLimit = Number(process.env.SOLANA_RPC_ROLLING_31D_CREDIT_LIMIT ?? 500_000);
if (!Number.isSafeInteger(dayLimit) || dayLimit < 10 || !Number.isSafeInteger(rollingLimit) || rollingLimit < 10)
  throw new Error("solana_invalid_budget");

let usageId: number | undefined;
try {
  const mint = (await pool.query<{mint:string}>(`SELECT b.payload->>'targetId' AS mint
    FROM metadata_source.source_record a JOIN metadata_source.source_blob b USING(content_hash)
    WHERE a.release_id=(SELECT release_id FROM metadata_source.archive_release WHERE state='active')
      AND a.namespace='legacy.exomon-aliases' ORDER BY a.source_key LIMIT 1`)).rows[0]?.mint;
  if (!mint) throw new Error("solana_archive_manifest_missing");
  usageId = await reserveRpcCredits(pool,"getAssetBatch",null,10,dayLimit,rollingLimit);
  const result = parseDasBatch(await getAssetBatch(key,[mint]),[mint])[0];
  if (!result) throw new Error("solana_preflight_mint_missing");
  await finishRpcUsage(pool,usageId,"success",null);
  console.log(JSON.stringify({preflight:"passed",mint:result.mint,hasOwner:!!result.owner,
    burnt:result.burnt,delegated:result.delegated,creditsReserved:10}));
} catch (error) {
  if (usageId !== undefined) await finishRpcUsage(pool,usageId,"failed",
    error instanceof DasError?error.code:"solana_preflight_failed").catch(()=>undefined);
  console.error(JSON.stringify({preflight:"failed",code:error instanceof DasError?error.code
    :error instanceof Error && /^solana_/.test(error.message)?error.message:"solana_preflight_failed"}));
  process.exitCode=1;
} finally { await pool.end(); }

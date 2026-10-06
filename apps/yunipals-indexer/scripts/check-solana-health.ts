import { pool } from "../lib/offchain/db.js";
import { solanaStatus } from "../lib/solana/api.js";

try {
  const status=await solanaStatus(pool);
  const interval=Number(process.env.SOLANA_SYNC_INTERVAL_MS ?? 900_000);
  const maxMissing=Number(process.env.SOLANA_MAX_MISSING ?? 0);
  const dayLimit=Number(process.env.SOLANA_RPC_DAILY_CREDIT_LIMIT ?? 15_000);
  const rollingLimit=Number(process.env.SOLANA_RPC_ROLLING_31D_CREDIT_LIMIT ?? 500_000);
  const age=status.publishedAt ? Date.now()-new Date(status.publishedAt).getTime() : Infinity;
  const issues=[];
  if (!status.ready || age>2*interval+300_000) issues.push("snapshot_stale");
  if (status.manifestCount!==10_000) issues.push("manifest_count");
  if ((status.missingCount??Infinity)>maxMissing) issues.push("missing_count");
  if (status.indexedTokens!==10_000-(status.missingCount??Infinity)) issues.push("indexed_count");
  if (status.lastError) issues.push("worker_error");
  if (status.rpc.todayCredits>dayLimit || status.rpc.rolling31DayCredits>rollingLimit) issues.push("credit_limit");
  console.log(JSON.stringify({healthy:issues.length===0,issues,publishedRunId:status.publishedRunId,
    ageMs:age,manifestCount:status.manifestCount,indexedTokens:status.indexedTokens,
    missingCount:status.missingCount,rpc:status.rpc}));
  if (issues.length) process.exitCode=1;
} catch {
  console.error(JSON.stringify({healthy:false,issues:["health_check_failed"]}));
  process.exitCode=1;
} finally { await pool.end(); }

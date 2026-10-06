import { pool } from "../lib/offchain/db.js";
import { publishScan } from "../lib/solana/worker.js";

const runId=Number(process.argv[2]);
if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("solana_invalid_run_id");
try {
  const row=(await pool.query<{asset_count:number}>(`SELECT asset_count FROM solana_indexer.scan_run
    WHERE id=$1 AND state='failed' AND error_code='solana_scan_incomplete'`,[runId])).rows[0];
  if (!row) throw new Error("solana_run_not_republishable");
  await publishScan(runId,row.asset_count);
  console.log(JSON.stringify({state:"published",runId}));
} catch(error) {
  console.error(JSON.stringify({error:error instanceof Error && error.message.startsWith("solana_")
    ?error.message:"solana_publish_failed"}));
  process.exitCode=1;
} finally { await pool.end(); }

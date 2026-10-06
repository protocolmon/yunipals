import { pool } from "../lib/offchain/db.js";
import { syncOnce } from "../lib/solana/worker.js";
import { safeErrorMessage } from "../lib/safe-error.js";

try { console.log(JSON.stringify(await syncOnce())); }
catch(error){console.error(JSON.stringify({error:error instanceof Error && /^(solana_|das_|HELIUS_API_KEY)/.test(error.message)
  ?safeErrorMessage(error):"solana_sync_failed"}));process.exitCode=1;}
finally{await pool.end();}

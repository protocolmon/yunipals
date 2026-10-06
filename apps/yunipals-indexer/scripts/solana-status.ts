import { pool } from "../lib/offchain/db.js";
import { solanaStatus } from "../lib/solana/api.js";

try { console.log(JSON.stringify(await solanaStatus(pool),null,2)); }
catch { console.error("solana_status_unavailable");process.exitCode=1; }
finally { await pool.end(); }

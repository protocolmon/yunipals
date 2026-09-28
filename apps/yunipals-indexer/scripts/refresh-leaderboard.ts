import { pool } from "../lib/offchain/db.js";
import { refreshLeaderboard, refreshTraitIndex } from "../lib/leaderboard/refresh.js";

await refreshTraitIndex();
const result = await refreshLeaderboard();
console.log(`Refreshed ${result.wallets} wallets at ${result.updatedAt.toISOString()}`);
await pool.end();

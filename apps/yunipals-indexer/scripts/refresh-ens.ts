import { refreshLeaderboardEns } from "../lib/ens/refresh.js";
import { pool } from "../lib/offchain/db.js";

const result = await refreshLeaderboardEns();
console.log("Refreshed leaderboard ENS identities", result);
await pool.end();

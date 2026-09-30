import { pool } from "../offchain/db.js";
import { refreshLeaderboard, refreshTraitIndex } from "./refresh.js";
import { refreshLeaderboardEns } from "../ens/refresh.js";
import { rarityReadSource } from "../rarity/read-source.js";

const refreshMs = Number(process.env.LEADERBOARD_REFRESH_MS ?? 3_600_000);
let stopping = false;
let nextEnsRefreshAt = 0;
console.log(`Leaderboard rarity source=${rarityReadSource}`);
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const latest = await pool.query<{ updated_at: Date | null }>("SELECT max(updated_at) AS updated_at FROM leaderboard.wallet_stats");
let nextRefreshAt = latest.rows[0]?.updated_at
  ? latest.rows[0].updated_at.getTime() + refreshMs
  : 0;

while (!stopping) {
  while (!stopping && Date.now() < nextRefreshAt) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, nextRefreshAt - Date.now())));
  }
  if (stopping) break;
  const started = Date.now();
  try {
    await refreshTraitIndex();
    const result = await refreshLeaderboard();
    console.log(`Refreshed leaderboard wallets=${result.wallets} duration_ms=${Date.now() - started}`);
    if (Date.now() >= nextEnsRefreshAt) {
      const ens = await refreshLeaderboardEns();
      nextEnsRefreshAt = Date.now() + Number(process.env.ENS_REFRESH_MS ?? 86_400_000);
      console.log("Refreshed leaderboard ENS identities", ens);
    }
  } catch (error) {
    console.error("Leaderboard refresh failed", error);
  }
  nextRefreshAt = Date.now() + refreshMs;
}
await pool.end();

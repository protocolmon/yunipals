import pg from "pg";
import { runStakingSupportOnce, stakingSupportConfiguration, stakingSupportPeerUrl } from "../lib/islands/staking-support-worker.js";

// No implicit worker start, migration or loop. A staged owner-reviewed timer
// may invoke this finite command after roles/read views/DDL are accepted.
if (process.argv[2] !== "once") throw new Error("Use staking-support.ts once.");
const config = stakingSupportConfiguration();
const databaseUrl = stakingSupportPeerUrl(process.env.DATABASE_URL);
const abort = new AbortController();
process.once("SIGTERM", () => abort.abort());
process.once("SIGINT", () => abort.abort());
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 3000,
  statement_timeout: 8000, lock_timeout: 1000, idle_in_transaction_session_timeout: 10000,
  application_name: "yunipals-native-islands-staking-support" });
try {
  const result = await runStakingSupportOnce(pool, config, { signal: abort.signal });
  console.log(JSON.stringify({ event: "native_staking_support_completed", ...result }));
  if (!result.complete) process.exitCode = 2;
} catch {
  // RPC/SQL errors may contain private endpoints or wallet parameters.
  console.error(JSON.stringify({ event: "native_staking_support_unavailable", operationalWriteMayHaveOccurred: true }));
  process.exitCode = 1;
} finally {
  await pool.end();
}

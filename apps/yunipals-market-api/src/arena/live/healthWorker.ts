import { mkdir, rename, writeFile } from "node:fs/promises";
import pg from "pg";
import { isAddress } from "viem";
import { arenaHealth } from "./health";

const contract = process.env.ARENA_CONTRACT;
if (!contract || !isAddress(contract) || !process.env.ARENA_DATABASE_URL)
  throw new Error("Arena monitor deployment configuration is required.");
const pool = new pg.Pool({
  connectionString: process.env.ARENA_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  application_name: "yunipals_arena_monitor"
});
const directory = "/var/lib/yunipals-arena/health";
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const value = await arenaHealth(
    pool,
    `8453:${contract.toLowerCase()}`,
    process.env.ARENA_ENTRIES_ENABLED === "true"
  );
  const temporary = `${directory}/.status-${process.pid}.json`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporary, `${directory}/status.json`);
  console.log(
    JSON.stringify({
      status: value.status,
      issues: value.issues,
      externalRequests: 0
    })
  );
  if (value.status === "needs-attention") process.exitCode = 1;
} catch {
  console.error(
    "Arena operational health check failed; private database details suppressed."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

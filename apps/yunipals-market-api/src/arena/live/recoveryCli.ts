import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { createPublicClient, http, isAddress } from "viem";
import {
  planArenaRecovery,
  applyArenaRecovery,
  type ArenaRecoveryPlan
} from "./recovery";

const [command, path, limitOrHash, archivePath] = process.argv.slice(2);
if (
  !process.env.ARENA_DATABASE_URL ||
  !process.env.ARENA_CONTRACT ||
  !isAddress(process.env.ARENA_CONTRACT) ||
  !/^\d+$/.test(process.env.ARENA_DEPLOYMENT_BLOCK ?? "")
)
  throw new Error(
    "Operator database connection and exact Arena deployment configuration are required."
  );
if ((command !== "plan" && command !== "apply") || !path || !limitOrHash)
  throw new Error(
    "Usage: arena-recovery.mjs plan PRIVATE_PLAN_PATH MAX_BLOCKS | apply PRIVATE_PLAN_PATH REVIEWED_SHA256 PRIVATE_ARCHIVE_PATH"
  );
const contract = process.env.ARENA_CONTRACT;
const deployment = {
  id: `8453:${contract.toLowerCase()}`,
  contract,
  startBlock: BigInt(process.env.ARENA_DEPLOYMENT_BLOCK!)
};
const pool = new pg.Pool({
  connectionString: process.env.ARENA_DATABASE_URL,
  max: 1,
  statement_timeout: 60000,
  application_name: "yunipals_arena_recovery"
});
// Always the existing usage-limited Base proxy. No signing or provider credentials needed.
const rpc = createPublicClient({
  transport: http("http://127.0.0.1:19202", { retryCount: 0, timeout: 15000 })
});
try {
  if (
    (await pool.query<{ current_user: string }>("SELECT current_user")).rows[0]
      ?.current_user !== "yunipals_arena_owner"
  )
    throw new Error(
      "Run recovery under the isolated Arena owner role; never grant service workers recovery privileges."
    );
  if (command === "plan") {
    const plan = await planArenaRecovery(
      pool,
      rpc,
      deployment,
      Number(limitOrHash)
    );
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(plan, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600
    });
    console.log(
      JSON.stringify({
        status: plan.issues.length ? "needs-reconciliation" : "review-required",
        hash: plan.hash,
        summary: plan.summary,
        issues: plan.issues,
        planPath: path
      })
    );
  } else {
    if (!archivePath)
      throw new Error(
        "Apply requires a private archive path; no live records are discarded."
      );
    const plan = JSON.parse(await readFile(path, "utf8")) as ArenaRecoveryPlan;
    console.log(
      JSON.stringify(
        await applyArenaRecovery(pool, rpc, plan, limitOrHash, archivePath)
      )
    );
  }
} finally {
  await pool.end();
}

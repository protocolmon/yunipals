import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("src", { recursive: true }).filter(
  (file) =>
    // This standalone harness requires its own Anvil chain, PostgreSQL instance
    // and compiled contracts. Run it with test:arena:anvil.
    file.endsWith(".test.ts") && file !== "arena/live/anvil.test.ts"
);
if (!files.length) throw new Error("No marketplace tests found.");
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...files.sort().map((file) => `src/${file}`)
  ],
  {
    stdio: "inherit",
    env: process.env
  }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

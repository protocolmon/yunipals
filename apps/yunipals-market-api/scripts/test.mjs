import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("src", { recursive: true }).filter((file) =>
  file.endsWith(".test.ts")
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

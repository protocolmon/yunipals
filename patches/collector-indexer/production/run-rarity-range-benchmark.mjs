import { spawnSync } from "node:child_process";

const response = await fetch(
  "https://api.yunipals.com/yunipals-indexer/v1/leaderboards/monster-count?limit=1",
  { signal: AbortSignal.timeout(5000) }
);
if (!response.ok) throw new Error(`Leaderboard HTTP ${response.status}`);
const owner = (await response.json()).items?.[0]?.owner;
if (!/^0x[0-9a-fA-F]{40}$/.test(owner))
  throw new Error("No bounded benchmark sample is available.");

const result = spawnSync(
  "/opt/node-v24.18.1/bin/node",
  [
    "/tmp/yunipals-rarity-range-release/benchmark-collector-api.mjs",
    "--url=http://127.0.0.1:9013",
    `--owner=${owner}`,
    "--seconds=60",
    "--sessions=1",
    "--output=/tmp/yunipals-rarity-range-production-benchmark.json"
  ],
  { stdio: "inherit" }
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Benchmark exited with status ${result.status}`);

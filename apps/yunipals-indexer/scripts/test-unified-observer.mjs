import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  combinedObserver as config,
  observerEnvironment,
  observerPoolConfiguration,
  runCombinedObserver
} from "./unified-observer.ts";
const env = {
  UNIFIED_INDEXER_RELEASE_ID: config.releaseId,
  UNIFIED_RPC_PROFILE_ID: config.profileId,
  UNIFIED_RPC_PROFILE_FILE: config.profileFile,
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_FREE_ONLY: "true",
  ...Object.fromEntries(
    Object.entries(config.endpoints).map(([id, url]) => [
      `PONDER_RPC_URL_${id}`,
      url
    ])
  )
};
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../ops/unified-indexer-transition/ypal-combined-source-manifest-v1.json",
      import.meta.url
    )
  )
);
const release = {
  id: config.releaseId,
  schema: config.schema,
  buildId: config.buildId,
  manifestHash: config.manifestHash,
  manifest
};
let checks = 0;
assert.equal(observerPoolConfiguration.max, 2);
assert.equal(observerPoolConfiguration.user, "yunipals_unified_support");
assert.equal(observerPoolConfiguration.host, "/var/run/postgresql");
checks++;
for (const [key, value] of [
  ["UNIFIED_RPC_FREE_ONLY", "false"],
  ["UNIFIED_RPC_POLICY_REQUIRED", "false"],
  ["UNIFIED_RPC_REPLAY_PERMIT_ID", "0x" + "1".repeat(64)],
  ["UNIFIED_RPC_REPLAY_PERMIT_ID_56", "0x" + "1".repeat(64)],
  ["PONDER_RPC_URL_56", "http://127.0.0.1:19204/unified"],
  ["UNIFIED_INDEXER_RELEASE_ID", "0x" + "0".repeat(64)],
  ["UNIFIED_RPC_PROFILE_ID", "0x" + "0".repeat(64)],
  ["UNIFIED_RPC_PROFILE_FILE", "/tmp/profile.json"]
]) {
  assert.throws(
    () => observerEnvironment({ ...env, [key]: value }),
    /configuration_required/
  );
  checks++;
}
assert.ok(Object.isFrozen(observerEnvironment(env)));
assert.equal(
  observerEnvironment({ ...env, UNRELATED_SECRET: "never propagated" })
    .UNRELATED_SECRET,
  undefined
);
checks++;
function fixture() {
  const queries = [],
    events = [],
    sleeps = [],
    observed = [];
  let acquired = true,
    released = 0,
    preflight = 0,
    stop = false;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ acquired }], rowCount: 1 };
    },
    release: () => {
      released++;
    }
  };
  const pool = { connect: async () => client };
  const dependencies = {
    load: async () => release,
    runtime: async () => ({
      buildId: config.buildId,
      running: true,
      ready: true
    }),
    preflight: async (actual, inputs, options) => {
      preflight++;
      assert.equal(actual, manifest);
      assert.deepEqual(options.endpoints, config.endpoints);
      assert.equal(inputs.UNIFIED_RPC_FREE_ONLY, "true");
    },
    rpc: (id, inputs) => ({ id, inputs }),
    observe: async (_pool, current, id, rpc) => {
      assert.equal(current, release);
      assert.equal(id, rpc.id);
      observed.push(id);
      return "observed";
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > 3) stop = true;
    }
  };
  return {
    pool,
    queries,
    events,
    sleeps,
    observed,
    dependencies,
    options: { dependencies, log: (v) => events.push(v), stopping: () => stop },
    acquired: (v) => {
      acquired = v;
    },
    counts: () => ({ released, preflight })
  };
}
{
  const f = fixture();
  await runCombinedObserver(f.pool, "inspect", env, f.options);
  assert.deepEqual(f.queries, [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "COMMIT"
  ]);
  assert.equal(f.counts().preflight, 0);
  assert.equal(f.observed.length, 0);
  assert.equal(f.events[0].providerCalls, 0);
  checks++;
}
{
  const f = fixture();
  await runCombinedObserver(f.pool, "observe-once", env, f.options);
  assert.deepEqual(f.observed, [1, 56, 137, 8453]);
  assert.equal(f.counts().preflight, 1);
  assert.equal(f.counts().released, 1);
  assert.match(f.queries.at(-1), /pg_advisory_unlock/);
  checks++;
}
{
  const f = fixture();
  f.acquired(false);
  await assert.rejects(
    runCombinedObserver(f.pool, "worker", env, f.options),
    /already_running/
  );
  assert.equal(f.counts().preflight, 0);
  assert.equal(f.counts().released, 1);
  checks++;
}
{
  const f = fixture();
  f.dependencies.preflight = async () => {
    throw Error("private provider secret");
  };
  await assert.rejects(runCombinedObserver(f.pool, "worker", env, f.options));
  assert.equal(f.counts().released, 1);
  assert.match(f.queries.at(-1), /pg_advisory_unlock/);
  checks++;
}
{
  const f = fixture();
  f.dependencies.observe = async (_p, _r, id) => {
    if (id === 56) throw Error("private provider secret");
    return "observed";
  };
  await runCombinedObserver(f.pool, "observe-once", env, f.options);
  assert.equal(
    f.events.filter((v) => v.event === "combined_chain_observation_failed")
      .length,
    1
  );
  assert.equal(JSON.stringify(f.events).includes("secret"), false);
  checks++;
}
{
  const f = fixture();
  await runCombinedObserver(f.pool, "worker", env, f.options);
  assert.equal(f.observed.length, 4);
  assert.ok(f.sleeps.every((ms) => ms === 500));
  assert.deepEqual(config.delays, {
    1: 12000,
    56: 15000,
    137: 30000,
    8453: 4000
  });
  checks++;
}
{
  const f = fixture();
  f.dependencies.load = async () => ({ ...release, buildId: "foreign" });
  await assert.rejects(
    runCombinedObserver(f.pool, "worker", env, f.options),
    /release_required/
  );
  assert.equal(f.queries.length, 0);
  checks++;
}
{
  const f = fixture();
  await assert.rejects(
    runCombinedObserver(f.pool, "receipts-once", env, f.options),
    /command_required/
  );
  assert.equal(f.queries.length, 0);
  checks++;
}
console.log(
  JSON.stringify({
    passed: true,
    checks,
    providerCalls: 0,
    databaseConnections: 0
  })
);

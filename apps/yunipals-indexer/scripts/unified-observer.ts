import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg, { type Pool } from "pg";
import { indexerTransaction } from "../lib/unified/control-schema.js";
import { observeIndexerChain } from "../lib/unified/observer.js";
import {
  loadIndexerRelease,
  readBoundRuntime,
  type RegisteredRelease
} from "../lib/unified/releases.js";
import { evidenceRpc } from "../lib/unified/rpc.js";
import { preflightUnifiedRpc } from "../lib/unified/rpc-preflight.js";

// This entry observes the registered combined source. It never registers,
// indexes logs, processes receipts, promotes a release or starts another child.
export const combinedObserver = Object.freeze({
  releaseId:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  manifestHash:
    "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  schema: "unified_ypal_20261023_v1",
  buildId: "71e2a7f3b7",
  profileId:
    "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff",
  profileSha256:
    "c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b",
  profileFile:
    "/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/profile.json",
  endpoints: Object.freeze({
    1: "http://127.0.0.1:19221/unified",
    8453: "http://127.0.0.1:19222/unified",
    137: "http://127.0.0.1:19223/unified",
    56: "http://127.0.0.1:19224/unified"
  }),
  delays: Object.freeze({ 1: 12000, 56: 15000, 137: 30000, 8453: 4000 })
});
export const observerPoolConfiguration = Object.freeze({
  host: "/var/run/postgresql",
  port: 5432,
  database: "yunipals_backfill",
  user: "yunipals_unified_support",
  max: 2,
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
  application_name: "yunipals_combined_observer_v1"
});
const chains = [1, 56, 137, 8453] as const;
type ChainId = (typeof chains)[number];
type Command = "inspect" | "observe-once" | "worker";
type Dependencies = {
  load: typeof loadIndexerRelease;
  runtime: typeof readBoundRuntime;
  preflight: typeof preflightUnifiedRpc;
  rpc: typeof evidenceRpc;
  observe: typeof observeIndexerChain;
  sleep: (ms: number) => Promise<unknown>;
};
const ordinary: Dependencies = {
  load: loadIndexerRelease,
  runtime: readBoundRuntime,
  preflight: preflightUnifiedRpc,
  rpc: evidenceRpc,
  observe: observeIndexerChain,
  sleep
};

export function observerEnvironment(env: NodeJS.ProcessEnv) {
  if (
    env.UNIFIED_INDEXER_RELEASE_ID !== combinedObserver.releaseId ||
    env.UNIFIED_RPC_PROFILE_ID !== combinedObserver.profileId ||
    env.UNIFIED_RPC_PROFILE_FILE !== combinedObserver.profileFile ||
    env.UNIFIED_RPC_POLICY_REQUIRED !== "true" ||
    env.UNIFIED_RPC_FREE_ONLY !== "true" ||
    Object.entries(env).some(
      ([key, value]) =>
        key.startsWith("UNIFIED_RPC_REPLAY_PERMIT_ID") && Boolean(value)
    ) ||
    chains.some(
      (chain) =>
        env[`PONDER_RPC_URL_${chain}`] !== combinedObserver.endpoints[chain]
    )
  )
    throw new Error("combined_observer_configuration_required");
  // Retain only reviewed transport inputs; later caller mutations cannot turn
  // a running observer into a paid or differently routed workload.
  return Object.freeze({
    UNIFIED_INDEXER_RELEASE_ID: combinedObserver.releaseId,
    UNIFIED_RPC_PROFILE_ID: combinedObserver.profileId,
    UNIFIED_RPC_PROFILE_FILE: combinedObserver.profileFile,
    UNIFIED_RPC_POLICY_REQUIRED: "true",
    UNIFIED_RPC_FREE_ONLY: "true",
    ...Object.fromEntries(
      chains.map((chain) => [
        `PONDER_RPC_URL_${chain}`,
        combinedObserver.endpoints[chain]
      ])
    )
  });
}

function releaseIdentity(release: RegisteredRelease) {
  if (
    release.id !== combinedObserver.releaseId ||
    release.schema !== combinedObserver.schema ||
    release.buildId !== combinedObserver.buildId ||
    release.manifestHash !== combinedObserver.manifestHash ||
    JSON.stringify(
      [
        ...new Set(
          release.manifest.sources
            .filter((s) => s.enabled)
            .map((s) => s.chainId)
        )
      ].sort((a, b) => a - b)
    ) !== JSON.stringify(chains)
  )
    throw new Error("combined_observer_release_required");
}

export async function runCombinedObserver(
  pool: Pool,
  command: Command,
  environment: NodeJS.ProcessEnv,
  options: {
    stopping?: () => boolean;
    log?: (value: Record<string, unknown>) => void;
    dependencies?: Partial<Dependencies>;
  } = {}
) {
  if (!["inspect", "observe-once", "worker"].includes(command))
    throw new Error("combined_observer_command_required");
  const env = observerEnvironment(environment);
  const deps = { ...ordinary, ...options.dependencies };
  const log = options.log ?? (() => {});
  const stopping = options.stopping ?? (() => false);
  const release = await deps.load(pool, combinedObserver.releaseId);
  releaseIdentity(release);
  if (command === "inspect") {
    const runtime = await indexerTransaction(
      pool,
      (client) => deps.runtime(client, release),
      true
    );
    log({
      event: "combined_observer_inspected",
      releaseId: release.id,
      buildId: runtime.buildId,
      running: runtime.running,
      frameworkReady: runtime.frameworkReady,
      providerCalls: 0,
      writes: 0
    });
    return;
  }
  // One dedicated connection holds the session lock; the second serves the
  // official short transactions. The lock never changes a source/role/selector.
  const lease = await pool.connect();
  let acquired = false;
  const lock = `yunipals:combined-observer:${release.id}`;
  try {
    acquired =
      (
        await lease.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
          [lock]
        )
      ).rows[0]?.acquired === true;
    if (!acquired) throw new Error("combined_observer_already_running");
    await deps.preflight(release.manifest, env, {
      endpoints: combinedObserver.endpoints
    });
    const rpcs = new Map(chains.map((chain) => [chain, deps.rpc(chain, env)]));
    const observe = async (chainId: ChainId) => {
      try {
        const result = await deps.observe(
          pool,
          release,
          chainId,
          rpcs.get(chainId)!
        );
        log({
          event: "combined_chain_observation",
          chainId,
          result,
          ...(result === "waiting_retained"
            ? {
                reason: "provider_lag",
                retainedLastGoodProof: true,
                observationTimestampAdvanced: false
              }
            : {})
        });
      } catch {
        log({ event: "combined_chain_observation_failed", chainId });
      }
    };
    const loop = async (chainId: ChainId) => {
      while (!stopping()) {
        await observe(chainId);
        for (
          let waited = 0;
          waited < combinedObserver.delays[chainId] && !stopping();
          waited += 500
        )
          await deps.sleep(500);
      }
    };
    await Promise.all(
      chains.map((chain) =>
        command === "worker" ? loop(chain) : observe(chain)
      )
    );
  } finally {
    if (acquired) {
      try {
        await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          lock
        ]);
      } finally {
        lease.release(true);
      }
    } else lease.release(true);
  }
}

export async function combinedObserverMain(args = process.argv.slice(2)) {
  if (
    args.length !== 1 ||
    !["inspect", "observe-once", "worker"].includes(args[0]!)
  )
    throw new Error("Use unified-observer inspect|observe-once|worker.");
  const env = observerEnvironment(process.env);
  if (
    createHash("sha256")
      .update(readFileSync(combinedObserver.profileFile))
      .digest("hex") !== combinedObserver.profileSha256
  )
    throw new Error("combined_observer_profile_file_changed");
  const pool = new pg.Pool(observerPoolConfiguration);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runCombinedObserver(pool, args[0] as Command, env, {
      stopping: () => stopping,
      log: (value) => console.log(JSON.stringify(value))
    });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  combinedObserverMain().catch(() => {
    // Neither connection errors nor provider errors are serialized.
    console.error(JSON.stringify({ event: "combined_observer_failed" }));
    process.exitCode = 1;
  });

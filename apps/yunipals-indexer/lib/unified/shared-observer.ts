import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";

import { observeIndexerChain } from "./observer.js";
import { loadIndexerRelease, readBoundRuntime } from "./releases.js";
import { indexerTransaction } from "./control-schema.js";
import { evidenceRpc } from "./rpc.js";
import { preflightUnifiedRpc } from "./rpc-preflight.js";
import {
  sharedIndexerConsumerSettings,
  validateSharedIndexerDeployment,
  type SharedIndexerDeployment
} from "./shared-deployment.js";
import { manifestDigest } from "./sources.js";
import { readIndexerSourceStatus } from "../../../../packages/yunipals-indexer-server/src/status.js";

type Dependencies = {
  load: typeof loadIndexerRelease;
  runtime: typeof readBoundRuntime;
  preflight: typeof preflightUnifiedRpc;
  rpc: typeof evidenceRpc;
  observe: typeof observeIndexerChain;
  sleep: (milliseconds: number) => Promise<unknown>;
};
const ordinary: Dependencies = {
  load: loadIndexerRelease,
  runtime: readBoundRuntime,
  preflight: preflightUnifiedRpc,
  rpc: evidenceRpc,
  observe: observeIndexerChain,
  sleep
};

export function sharedObserverEnvironment(
  deployment: SharedIndexerDeployment,
  environment: NodeJS.ProcessEnv
): Readonly<Record<string, string> & { UNIFIED_RPC_PROFILE_FILE: string }> {
  const expected = sharedIndexerConsumerSettings(deployment);
  const keys = [
    "UNIFIED_INDEXER_RELEASE_ID",
    "UNIFIED_RPC_PROFILE_ID",
    "UNIFIED_RPC_POLICY_REQUIRED",
    "UNIFIED_RPC_FREE_ONLY",
    "PONDER_RPC_URL_1",
    "PONDER_RPC_URL_56",
    "PONDER_RPC_URL_137",
    "PONDER_RPC_URL_8453"
  ] as const;
  if (
    keys.some((key) => environment[key] !== expected[key]) ||
    !environment.UNIFIED_RPC_PROFILE_FILE?.startsWith("/") ||
    Object.entries(environment).some(
      ([key, value]) =>
        key.startsWith("UNIFIED_RPC_REPLAY_PERMIT_ID") && !!value
    )
  )
    throw new Error("shared_observer_configuration_mismatch");
  return Object.freeze({
    ...Object.fromEntries(keys.map((key) => [key, expected[key]])),
    UNIFIED_RPC_PROFILE_FILE: environment.UNIFIED_RPC_PROFILE_FILE
  });
}

export async function runSharedIndexerObserver(
  pool: Pool,
  deployment: SharedIndexerDeployment,
  command: "inspect" | "health" | "observe-once" | "worker",
  environment: NodeJS.ProcessEnv,
  options: {
    stopping?: () => boolean;
    log?: (event: Record<string, unknown>) => void;
    dependencies?: Partial<Dependencies>;
  } = {}
) {
  const specification = validateSharedIndexerDeployment(deployment);
  const env = sharedObserverEnvironment(specification, environment);
  const dependencies = { ...ordinary, ...options.dependencies };
  const stopping = options.stopping ?? (() => false);
  const log = options.log ?? (() => {});
  const release = await dependencies.load(pool, specification.releaseId);
  if (
    release.id !== specification.releaseId ||
    release.schema !== specification.schema ||
    release.buildId !== specification.buildId ||
    release.manifestHash !== specification.manifestHash ||
    manifestDigest(release.manifest) !== manifestDigest(specification.manifest)
  )
    throw new Error("shared_observer_registered_release_mismatch");
  if (command === "inspect" || command === "health") {
    const { runtime, sources } = await indexerTransaction(
      pool,
      async (db) => {
        const runtime = await dependencies.runtime(db, release);
        const sources = [];
        if (command === "health")
          for (const source of release.manifest.sources.filter(
            (source) => source.enabled
          )) {
            const status = await readIndexerSourceStatus(
              db,
              release,
              source.id,
              { kind: "latest" }
            );
            sources.push({
              sourceId: source.id,
              ready: status.readiness.ready,
              reason: status.readiness.reason
            });
          }
        return { runtime, sources };
      },
      true
    );
    log({
      event:
        command === "health"
          ? "shared_source_health"
          : "shared_observer_inspected",
      releaseId: release.id,
      running: runtime.running,
      frameworkReady: runtime.frameworkReady,
      ...(command === "health" ? { sources } : {}),
      providerCalls: 0,
      writes: 0
    });
    if (
      command === "health" &&
      (!runtime.running ||
        !runtime.frameworkReady ||
        sources.some((source) => !source.ready))
    )
      throw new Error("shared_source_unhealthy");
    return;
  }
  const lease = await pool.connect();
  const lock = `yunipals:shared-observer:${release.id}`;
  let acquired = false;
  try {
    acquired =
      (
        await lease.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
          [lock]
        )
      ).rows[0]?.acquired === true;
    if (!acquired) throw new Error("shared_observer_already_running");
    await dependencies.preflight(release.manifest, env, {
      endpoints: specification.rpcProfile.endpoints
    });
    const chains = [
      ...new Set(
        release.manifest.sources
          .filter((source) => source.enabled)
          .map((source) => source.chainId)
      )
    ];
    const delays: Record<number, number> = {
      1: 12000,
      56: 15000,
      137: 30000,
      8453: 4000
    };
    await Promise.all(
      chains.map(async (chainId) => {
        const rpc = dependencies.rpc(chainId, env);
        do {
          try {
            const result = await dependencies.observe(
              pool,
              release,
              chainId,
              rpc
            );
            log({ event: "shared_chain_observation", chainId, result });
          } catch {
            log({ event: "shared_chain_observation_failed", chainId });
          }
          if (command !== "worker") return;
          for (
            let elapsed = 0;
            elapsed < delays[chainId]! && !stopping();
            elapsed += 500
          )
            await dependencies.sleep(500);
        } while (!stopping());
      })
    );
  } finally {
    try {
      if (acquired)
        await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          lock
        ]);
    } finally {
      lease.release(true);
    }
  }
}

import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { migrateIndexerControl } from "../lib/unified/control-schema.js";
import { observeIndexerChain } from "../lib/unified/observer.js";
import {
  queueReceiptCandidates,
  claimReceiptJobs,
  enrichReceiptJob
} from "../lib/unified/receipt-worker.js";
import {
  loadIndexerRelease,
  registerIndexerRelease
} from "../lib/unified/releases.js";
import { evidenceRpc } from "../lib/unified/rpc.js";
import { buildSourceManifest } from "../lib/unified/sources.js";
import { preflightUnifiedRpc } from "../lib/unified/rpc-preflight.js";

const command = process.argv[2];
if (
  !["migrate", "register", "observe-once", "receipts-once", "worker"].includes(
    command ?? ""
  )
) {
  throw new Error(
    "Use unified-control.ts migrate|register|observe-once|receipts-once|worker."
  );
}
const databaseUrl = process.env.UNIFIED_INDEXER_DATABASE_URL;
if (!databaseUrl) throw new Error("UNIFIED_INDEXER_DATABASE_URL is required.");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 8,
  connectionTimeoutMillis: 5000
});
let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});
const log = (value: unknown) => console.log(JSON.stringify(value));
try {
  if (command === "migrate") {
    await migrateIndexerControl(pool);
    log({ event: "unified_control_migrated" });
  } else if (command === "register") {
    const schema = process.env.UNIFIED_INDEXER_SCHEMA;
    const buildId = process.env.UNIFIED_INDEXER_BUILD_ID;
    if (!schema || !buildId)
      throw new Error(
        "UNIFIED_INDEXER_SCHEMA and UNIFIED_INDEXER_BUILD_ID are required."
      );
    const release = await registerIndexerRelease(pool, {
      schema,
      buildId,
      manifest: buildSourceManifest()
    });
    log({
      event: "unified_candidate_registered",
      releaseId: release.id,
      schema: release.schema,
      buildId: release.buildId,
      manifestHash: release.manifestHash,
      activated: false
    });
  } else {
    const release = await loadIndexerRelease(
      pool,
      process.env.UNIFIED_INDEXER_RELEASE_ID
    );
    const chainIds = [
      ...new Set(
        release.manifest.sources
          .filter((source) => source.enabled)
          .map((source) => source.chainId)
      )
    ];
    await preflightUnifiedRpc(release.manifest, {
      ...process.env,
      UNIFIED_RPC_POLICY_REQUIRED: "true"
    });
    const rpcs = new Map(chainIds.map((id) => [id, evidenceRpc(id)]));
    const observe = async (chainId: number) => {
      try {
        const result = await observeIndexerChain(
          pool,
          release,
          chainId,
          rpcs.get(chainId)!
        );
        log({ event: "unified_chain_observation", chainId, result });
      } catch {
        log({ event: "unified_chain_observation_failed", chainId });
      }
    };
    const receipts = async (chainId: number) => {
      try {
        const queued = await queueReceiptCandidates(pool, release, chainId);
        const jobs = await claimReceiptJobs(pool, release, chainId, 4);
        const results: string[] = [];
        for (const job of jobs) {
          if (stopping) break;
          results.push(
            await enrichReceiptJob(pool, release, job, rpcs.get(chainId)!)
          );
        }
        if (queued || jobs.length)
          log({ event: "unified_receipt_batch", chainId, queued, results });
      } catch {
        log({ event: "unified_receipt_batch_failed", chainId });
      }
    };
    if (command === "observe-once") await Promise.all(chainIds.map(observe));
    else if (command === "receipts-once")
      await Promise.all(chainIds.map(receipts));
    else {
      const delays: Record<number, number> = {
        1: 12000,
        56: 15000,
        137: 30000,
        8453: 4000
      };
      // Separate application-support loops keep receipt RPC latency from
      // delaying Arena observations. Neither loop performs eth_getLogs scans.
      const loop = async (
        chainId: number,
        task: (id: number) => Promise<void>,
        delay: number
      ) => {
        while (!stopping) {
          await task(chainId);
          for (let waited = 0; waited < delay && !stopping; waited += 500)
            await sleep(500);
        }
      };
      await Promise.all(
        chainIds.flatMap((chainId) => [
          loop(chainId, observe, delays[chainId] ?? 15000),
          loop(chainId, receipts, 1000)
        ])
      );
    }
  }
} catch {
  // Transport errors can contain credential-bearing URLs. Operational status
  // stores bounded codes; never serialize raw provider/connection errors here.
  console.error(JSON.stringify({ event: "unified_control_failed", command }));
  process.exitCode = 1;
} finally {
  await pool.end();
}

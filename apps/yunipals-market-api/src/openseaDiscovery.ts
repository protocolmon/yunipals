import { setTimeout as delay } from "node:timers/promises";
import { createPool } from "@/db/pool";
import { assertReady } from "@/db/readiness";
import {
  readEnvironment,
  readOpenSeaDiscoveryEnvironment,
  readOpenSeaProbeEnvironment
} from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import {
  claimOpenSeaDiscovery,
  isOpenSeaDiscoveryDue,
  processOpenSeaDiscoveryPage,
  readOpenSeaDiscoveryStatus,
  pruneOpenSeaDiscoveryPages
} from "@/opensea/discovery";

// Explicitly bounded, resumable provider GET ingestion. This executable never
// constructs a publication-authorized client or sends an onchain transaction.
async function main() {
  const environment = readEnvironment();
  const config = readOpenSeaDiscoveryEnvironment();
  const credential = readOpenSeaProbeEnvironment();
  const coordinator = createOpenSeaRequestBudget();
  const pool = createPool(environment);
  pool.on("error", () =>
    console.error("Discovery database connection failed.")
  );
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await assertReady(pool, environment.deployment);
    if (!(await isOpenSeaDiscoveryDue(pool, config.chain))) {
      console.log(
        JSON.stringify({
          ...(await readOpenSeaDiscoveryStatus(pool, config.chain)),
          pagesProcessed: 0,
          deferred: true,
          providerWritesEnabled: false
        })
      );
      return;
    }
    const provider = new OpenSeaClient({
      apiKey: credential.apiKey,
      requestBudget: coordinator.backgroundBudget(
        { allPerHour: 180, fulfillmentPerMinute: 2 },
        {
          caller: "discovery",
          workload: "discovery",
          priority: "background"
        }
      )
    });
    const policies = new OpenSeaSharedPolicyResolver(
      coordinator.pool,
      coordinator.scope,
      provider,
      {
        maxDurationSeconds: credential.maxDurationSeconds
      }
    );
    const { collectionSlug } = (await policies.resolveBrowse(config.chain))
      .policy;
    const complete = new Set<string>();
    let pages = 0;
    let failed = false;
    while (
      !stopped &&
      !failed &&
      pages < config.maxPages &&
      complete.size < 2
    ) {
      let claimed = false;
      for (const side of ["listing", "offer"] as const) {
        if (complete.has(side) || stopped || pages >= config.maxPages) continue;
        const scan = await claimOpenSeaDiscovery(
          pool,
          config.chain,
          side,
          collectionSlug
        );
        if (!scan) {
          const status = await readOpenSeaDiscoveryStatus(pool, config.chain);
          const row = status.scans.find((row) => row.side === side);
          if (row?.discovery_state === "available") complete.add(side);
          else if (row?.discovery_state === "unavailable") failed = true;
          continue;
        }
        claimed = true;
        try {
          const result = await processOpenSeaDiscoveryPage(
            pool,
            provider,
            config.chain,
            scan,
            { scanIntervalMs: config.scanIntervalMs }
          );
          pages++;
          if (result.completed) complete.add(side);
        } catch {
          failed = true;
          break;
        }
      }
      if (!claimed && !failed && complete.size < 2 && !stopped)
        await delay(1000);
    }
    await pruneOpenSeaDiscoveryPages(pool);
    console.log(
      JSON.stringify(
        {
          ...(await readOpenSeaDiscoveryStatus(pool, config.chain)),
          pagesProcessed: pages,
          boundedRunComplete: complete.size === 2,
          providerWritesEnabled: false
        },
        null,
        2
      )
    );
    if (complete.size !== 2) process.exitCode = 1;
  } finally {
    await pool.end();
    await coordinator.close();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
try {
  await main();
} catch {
  console.error(
    "OpenSea discovery configuration or execution failed; credentials and raw errors suppressed."
  );
  process.exitCode = 1;
}

import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";

import { createApp } from "@/app";
import {
  createPool,
  createCatalogKeeperPool,
  createCatalogIndexerPool
} from "@/db/pool";
import { assertReady } from "@/db/readiness";
import { readEnvironment } from "@/environment";
import { BnbAdmissionService } from "@/bnb/admission";
import { BnbFulfillmentService } from "@/bnb/fulfillment";
import { BnbRecoveryService } from "@/bnb/recovery";
import { OrderReadService } from "@/reads/orders";
import { BnbDiscoveryReadService } from "@/reads/bnbDiscovery";
import { CatalogService } from "@/reads/catalog";
import { ActivityReadService } from "@/reads/activity";
import { OpenSeaRecoveryService } from "@/opensea/recovery";
import { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { createOpenSeaValidation } from "@/opensea/validation";
import {
  bnbValidationPolicy,
  createBnbValidationClient
} from "@/bnb/validation";
import { createProductionRuntime } from "@/productionRuntime";
import { CapabilityHealthService } from "@/capabilityHealth";

async function main() {
  const environment = readEnvironment();
  const pool = createPool(environment);
  const keepers = createCatalogKeeperPool(environment);
  keepers.on("error", () =>
    console.error("Catalog snapshot database connection failed.")
  );
  const indexerKeepers = createCatalogIndexerPool(environment);
  indexerKeepers?.on("error", () =>
    console.error("Catalog indexer connection failed.")
  );
  const catalog = new CatalogService(pool, keepers, { indexerKeepers });
  pool.on("error", () =>
    console.error("Marketplace database connection failed.")
  );
  const ready = () => assertReady(pool, environment.deployment);
  let bnbValidation;
  let openseaValidation;
  let openseaFulfillment;
  let productionRuntime: Awaited<
    ReturnType<typeof createProductionRuntime>
  > | null = null;
  try {
    await ready();
    if (environment.productionTrading) {
      productionRuntime = await createProductionRuntime(environment, pool);
      bnbValidation = productionRuntime.bnbValidation;
      openseaValidation = productionRuntime.openseaValidation;
      openseaFulfillment = productionRuntime.openseaFulfillment;
    } else if (environment.openseaValidation) {
      const validation = await createOpenSeaValidation(environment);
      openseaValidation = new OpenSeaAdmissionService(
        pool,
        validation.clients,
        validation.policies,
        validation.options
      );
      openseaFulfillment = new OpenSeaFulfillmentService(
        pool,
        validation.clients,
        validation.policies,
        validation.provider,
        { ...validation.options, providerMaxAgeMs: 300000 }
      );
    }
    if (environment.bnbValidationRpc) {
      const client = await createBnbValidationClient(
        environment.bnbValidationRpc
      );
      const options = { confirmations: 20n, indexerMaxAgeMs: 720000 };
      bnbValidation = {
        policy: bnbValidationPolicy,
        admission: new BnbAdmissionService(
          pool,
          client,
          bnbValidationPolicy,
          options
        ),
        fulfillment: new BnbFulfillmentService(
          pool,
          client,
          bnbValidationPolicy,
          options
        )
      };
    }
  } catch (error) {
    await Promise.allSettled([
      productionRuntime?.close() ?? Promise.resolve(),
      catalog.close()
    ]);
    await pool.end();
    throw error;
  }
  // Bound slow headers/bodies and idle sockets independently of database timeouts.
  const server = createServer(
    { requestTimeout: 15000, keepAliveTimeout: 5000 },
    getRequestListener(
      createApp(environment, ready, {
        capabilityHealth: new CapabilityHealthService(pool),
        recovery: new BnbRecoveryService(pool),
        openseaRecovery: new OpenSeaRecoveryService(pool),
        reads: new OrderReadService(pool),
        bnbDiscovery: new BnbDiscoveryReadService(pool),
        activity: new ActivityReadService(pool),
        catalog,
        bnbValidation,
        openseaValidation,
        openseaFulfillment
      }).fetch
    )
  );
  server.headersTimeout = 10000;
  server.on("error", () => {
    console.error("Marketplace HTTP listener failed.");
    process.exitCode = 1;
    stop();
  });
  server.listen(environment.port, environment.host, () =>
    console.log(
      JSON.stringify({
        service: "yunipals-market-api",
        status: "listening",
        deployment: environment.deployment
      })
    )
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    server.close(() => {
      void Promise.allSettled([
        catalog.close(),
        productionRuntime?.close() ?? Promise.resolve()
      ])
        .then(() => pool.end())
        .catch(() => {
          process.exitCode = 1;
        });
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

try {
  await main();
} catch (error) {
  console.error(
    "Marketplace startup failed; verify configuration, migrations and runtime privileges.",
    error instanceof Error ? error.message : "Unknown startup failure."
  );
  process.exitCode = 1;
}

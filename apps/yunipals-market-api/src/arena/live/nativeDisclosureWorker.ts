import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { arenaConfig, arenaRpcClients } from "./config";
import { StrategyCipher } from "./crypto";
import { ArenaIntake } from "./intake";
import { arenaNativeConfiguration } from "./nativeSource";
import { selectedArenaRuntimeSource } from "./selectedSourceRuntime";
import { NativeArenaDisclosure } from "./nativeDisclosure";
import { verifyNativeArenaAction } from "./nativeAction";

// Separate from the old projector: no getLogs, chain cursor, public projection,
// signer, inference submission or transaction broadcast is used here.
async function run() {
  const native = arenaNativeConfiguration();
  if (native.mode !== "unified")
    throw new Error("Explicit unified mode is required.");
  const config = arenaConfig();
  const common = {
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 15000
  };
  const sourcePool = new pg.Pool({
    ...common,
    connectionString: native.databaseUrl,
    max: 3,
    application_name: "arena_native_disclosure_source",
    options: "-c default_transaction_read_only=on"
  });
  const pool = new pg.Pool({
    ...common,
    connectionString: config.databaseUrl,
    max: 4,
    application_name: "arena_native_disclosure"
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const base = arenaRpcClients().get(8453)!;
    const { nativeSource, binding } = await selectedArenaRuntimeSource({
      pool,
      sourcePool,
      native,
      deployment: config.deployment,
      base,
      mediaKind: config.mediaKind
    });
    if (!nativeSource)
      throw new Error("Native disclosure source is unavailable.");
    const service = new ArenaIntake(
      pool,
      config.deployment.id,
      config.deployment.contract,
      config.origin,
      new StrategyCipher(config.encryptionKey),
      {
        message: (input) => base.verifyMessage(input),
        strategy: (input) => base.verifyTypedData(input)
      },
      nativeSource,
      binding,
      config.mediaKind,
      config.contractVersion
    );
    // Neither this command nor startup performs migrations or adopts legacy work.
    await service.ready();
    const work = new NativeArenaDisclosure(service, (observed) =>
      verifyNativeArenaAction(base, observed)
    );
    while (!stopped) {
      try {
        const result = await work.tick();
        if (result.checked)
          console.log(
            JSON.stringify({
              event: "arena_native_disclosure_checked",
              ...result
            })
          );
      } catch {
        console.error(
          "Native Arena disclosure unavailable; private inputs and scheduling leases retained."
        );
      }
      if (!stopped) await setTimeout(2000);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await Promise.all([pool.end(), sourcePool.end()]);
  }
}

try {
  await run();
} catch {
  console.error(
    "Native Arena disclosure could not start; check explicit source selection, operational adoption and grants."
  );
  process.exitCode = 1;
}

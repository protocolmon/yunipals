import { setTimeout } from "node:timers/promises";
import { arenaRuntime } from "./runtime";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaProviderMigration } from "./providerSchema";
import { NativeArenaProvider } from "./nativeProvider";
import { NativeArenaReferee } from "./nativeReferee";
import { verifyNativeArenaAction } from "./nativeAction";
import { StrategyCipher } from "./crypto";
import { ArenaRefereeApi } from "./refereeApi";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "./adjudication";

async function run() {
  if (arenaNativeConfiguration().mode !== "unified")
    throw new Error("Explicit unified mode is required.");
  const key = process.env.OPENAI_API_KEY,
    root = process.env.ARENA_REPOSITORY_ROOT;
  if (!key || !root)
    throw new Error("Existing referee configuration is required.");
  const runtime = await arenaRuntime({ native: true });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const migration = (
      await runtime.pool.query<{ checksum: string }>(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [arenaProviderMigration.version]
      )
    ).rows[0];
    if (migration?.checksum !== arenaProviderMigration.checksum)
      throw new Error("Native provider migration is required.");
    const guard = new NativeArenaProvider(
      runtime.service,
      (observed) =>
        verifyNativeArenaAction(runtime.clients.get(8453)!, observed),
      () => runtime.capacity.check(false)
    );
    const api = new ArenaRefereeApi(runtime.pool, key, fetch, guard);
    const adjudicator = new ArenaAdjudicator(
      runtime.pool,
      new StrategyCipher(runtime.config.encryptionKey),
      api,
      refereeSchema(root),
      productionValidator(root)
    );
    const worker = new NativeArenaReferee(runtime.service, api, adjudicator);
    while (!stopped) {
      try {
        await runtime.identityAnalysis.step(
          key,
          Number(process.env.ARENA_IDENTITY_ALLOWANCE_MICROUSD ?? "0"),
          Date.parse(process.env.ARENA_IDENTITY_ALLOWANCE_UNTIL ?? "")
        );
        const result = await worker.tick();
        if (result.tournamentId || result.retrieved)
          console.log(
            JSON.stringify({ event: "arena_native_referee", ...result })
          );
      } catch {
        console.error(
          "Native Arena referee needs reconciliation; private inputs and saved provider IDs retained."
        );
      }
      if (!stopped) await setTimeout(15000);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await runtime.close();
  }
}
try {
  await run();
} catch {
  console.error(
    "Native Arena referee could not start; check source selection, provider migration and existing private configuration."
  );
  process.exitCode = 1;
}

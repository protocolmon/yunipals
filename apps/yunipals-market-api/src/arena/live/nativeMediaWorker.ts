import { setTimeout } from "node:timers/promises";
import { arenaRuntime } from "./runtime";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaMediaMigration } from "./mediaSchema";
import { NativeArenaProvider } from "./nativeProvider";
import { NativeArenaMedia } from "./nativeMedia";
import { verifyNativeArenaAction } from "./nativeAction";
import { StrategyCipher } from "./crypto";
import { ArenaMediaApi } from "./mediaApi";
import { ArenaMedia } from "./media";

async function run() {
  if (arenaNativeConfiguration().mode !== "unified")
    throw new Error("Explicit unified mode is required.");
  const key = process.env.RUNWARE_API_KEY,
    root = process.env.ARENA_REPOSITORY_ROOT,
    storage = process.env.ARENA_MEDIA_ROOT;
  if (!key || !root || !storage)
    throw new Error("Existing media configuration is required.");
  const runtime = await arenaRuntime({ native: true });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const marker = (
      await runtime.pool.query<{ checksum: string }>(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [arenaMediaMigration.version]
      )
    ).rows[0];
    if (marker?.checksum !== arenaMediaMigration.checksum)
      throw new Error("Native media migration is required.");
    const guard = new NativeArenaProvider(
      runtime.service,
      (observed) =>
        verifyNativeArenaAction(runtime.clients.get(8453)!, observed),
      () => runtime.capacity.check(false)
    );
    const api = new ArenaMediaApi(runtime.pool, key, fetch, guard, storage);
    const media = new ArenaMedia(
      runtime.pool,
      new StrategyCipher(runtime.config.encryptionKey),
      api,
      root,
      storage
    );
    const worker = new NativeArenaMedia(runtime.service, api, media);
    while (!stopped) {
      try {
        const result = await worker.tick();
        if (result.tournamentId || result.retrieved)
          console.log(
            JSON.stringify({ event: "arena_native_media", ...result })
          );
      } catch {
        console.error(
          "Native Arena media needs reconciliation; saved provider UUIDs and origin folders retained."
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
    "Native Arena media could not start; check source selection, media migration and existing private configuration."
  );
  process.exitCode = 1;
}

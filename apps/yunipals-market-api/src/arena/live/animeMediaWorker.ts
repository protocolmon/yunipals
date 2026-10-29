import { arenaMediaMigration } from "./mediaSchema";
import { setTimeout } from "node:timers/promises";
import { arenaRuntime } from "./runtime";
import { NativeArenaProvider } from "./nativeProvider";
import { NativeArenaMedia } from "./nativeMedia";
import { ArenaMediaApi } from "./mediaApi";
import { ArenaMedia } from "./media";
import { StrategyCipher } from "./crypto";
import { verifyNativeArenaAction } from "./nativeAction";
import { animeMediaBuilder } from "./animeMedia";
import { AnimeDirectorApi } from "./animeDirectorApi";
import { ANIME_DIRECTOR_ASSET } from "./animeDirection";
import { animeRepository } from "./animeRepository";

/** Runware generation is disabled; Claude has its own bounded, durable task. */
class OfflineAnimeApi extends ArenaMediaApi {
  override async reserve(): Promise<never> {
    throw new Error("Anime media cannot reserve provider tasks.");
  }
  override async step(): Promise<never> {
    throw new Error("Anime media cannot call a generation provider.");
  }
}
const runtime = await arenaRuntime({ native: true });
if (!runtime.anime)
  throw new Error("This worker requires ARENA_MEDIA_KIND=anime.");
const root = animeRepository(),
  storage = process.env.ARENA_MEDIA_ROOT,
  chrome = process.env.ANIME_CHROME,
  node = process.env.ANIME_NODE,
  key = process.env.OPENROUTER_API_KEY;
if (!storage || !chrome || !node || !key)
  throw new Error(
    "Anime storage, pinned runtimes and OpenRouter access for Claude are required."
  );
const marker = (
  await runtime.pool.query<{ checksum: string }>(
    "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
    [arenaMediaMigration.version]
  )
).rows[0];
if (marker?.checksum !== arenaMediaMigration.checksum)
  throw new Error("Anime worker requires the native media migration.");
const guard = new NativeArenaProvider(
  runtime.service,
  (observed) => verifyNativeArenaAction(runtime.clients.get(8453)!, observed),
  () => runtime.capacity.check(false)
);
const api = new OfflineAnimeApi(
  runtime.pool,
  "offline-anime",
  async () => {
    throw new Error("Provider requests disabled.");
  },
  guard,
  storage
);
const director = new AnimeDirectorApi(runtime.pool, key, guard, storage);
const media = new ArenaMedia(
  runtime.pool,
  new StrategyCipher(runtime.config.encryptionKey),
  api,
  root,
  storage,
  undefined,
  animeMediaBuilder(root, runtime.anime, chrome, node, (job, input) =>
    director.direct(job, input)
  )
);
const worker = new NativeArenaMedia(runtime.service, api, media, (task) => {
  if (task.asset !== ANIME_DIRECTOR_ASSET)
    throw new Error("Unknown anime provider task.");
  return director.step(task.id, task.incarnation);
});
let stopped = false;
process.once("SIGTERM", () => {
  stopped = true;
});
process.once("SIGINT", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      const result = await worker.tick();
      if (result.tournamentId)
        console.log(JSON.stringify({ event: "anime_media", ...result }));
    } catch {
      console.error("Anime media needs recovery; existing job retained.");
    }
    if (!stopped) await setTimeout(15000);
  }
} finally {
  await runtime.close();
}

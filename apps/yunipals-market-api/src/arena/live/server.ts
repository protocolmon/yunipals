import { animeRead } from "./animeRead";
import { serve } from "@hono/node-server";
import { createArenaApp } from "./http";
import { arenaRuntime } from "./runtime";
import { arenaMediaRead } from "./mediaRead";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaMediaMigration } from "./mediaSchema";

const native = arenaNativeConfiguration().mode === "unified";
const runtime = await arenaRuntime({ native });
if (native) {
  const marker = (
    await runtime.pool.query<{ checksum: string }>(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [arenaMediaMigration.version]
    )
  ).rows[0];
  if (marker?.checksum !== arenaMediaMigration.checksum) {
    await runtime.close();
    throw new Error("Native Arena API requires the media migration.");
  }
}
const app = createArenaApp(runtime.service, {
  entriesEnabled: runtime.config.entriesEnabled,
  mediaKind: runtime.config.mediaKind,
  eligibilityRegistry: runtime.config.eligibilityRegistry,
  ...(runtime.anime ? animeRead(runtime) : {}),
  launchMode: runtime.config.launchMode,
  rules: {
    rulesHash: runtime.catalog.rulesHash,
    manifest: runtime.catalog.manifest
  },
  identityStatus: (key) => runtime.identityAnalysis.status(key),
  admit: runtime.admit,
  context: (id) => runtime.compiler.context(id),
  strategyReady: async (id) => (await runtime.compiler.context(id)).ready,
  media: process.env.ARENA_MEDIA_ROOT
    ? arenaMediaRead(
        runtime.pool,
        runtime.config.deployment.id,
        process.env.ARENA_MEDIA_ROOT,
        native ? runtime.service : undefined
      )
    : undefined
});
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: runtime.config.port
});
async function stop() {
  server.close();
  await runtime.close();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
console.log("Arena API listening on loopback.");

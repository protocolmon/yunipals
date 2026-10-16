import { serve } from "@hono/node-server";
import { createArenaApp } from "./http";
import { arenaRuntime } from "./runtime";
import { arenaMediaRead } from "./mediaRead";

const runtime = await arenaRuntime();
const app = createArenaApp(runtime.service, {
  entriesEnabled: runtime.config.entriesEnabled,
  launchMode: runtime.config.launchMode,
  rules: {
    rulesHash: runtime.catalog.rulesHash,
    manifest: runtime.catalog.manifest
  },
  admit: runtime.admit,
  identityStatus: (key) => runtime.identityAnalysis.status(key),
  context: (id) => runtime.compiler.context(id),
  strategyReady: async (id) => (await runtime.compiler.context(id)).ready,
  media: process.env.ARENA_MEDIA_ROOT
    ? arenaMediaRead(
        runtime.pool,
        runtime.config.deployment.id,
        process.env.ARENA_MEDIA_ROOT
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
  await runtime.pool.end();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
console.log("Arena API listening on loopback.");

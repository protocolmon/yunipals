import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { loadArenaLabCatalog } from "./catalog";
import { createArenaLabApp } from "./http";
import { ArenaLabService, type PrivateTournament } from "./service";
import { ArenaStore } from "./store";
import { addArenaProductionRoutes } from "./production";
import { createArenaProductionWorker } from "./productionWorker";

if (process.env.ARENA_LAB !== "1" || process.env.NODE_ENV === "production")
  throw new Error(
    "This entrypoint is a local lab, not a production tournament service. Set ARENA_LAB=1."
  );
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = resolve(
  process.env.ARENA_LAB_STATE_DIR || resolve(root, ".arena-lab")
);
mkdirSync(directory, { recursive: true, mode: 0o700 });
if ((statSync(directory).mode & 0o077) !== 0)
  throw new Error("Arena Lab state directory must be private (mode 700).");
const keyPath = resolve(directory, "storage.key");
if (existsSync(resolve(directory, "arena.sqlite")) && !existsSync(keyPath))
  throw new Error(
    "Existing arena state is missing its key. Restore the key; do not replace it."
  );
try {
  writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
if ((statSync(keyPath).mode & 0o077) !== 0)
  throw new Error("Arena Lab storage key must be private (mode 600).");
const weight = Number(process.env.ARENA_GENESIS_WEIGHT || 3);
const store = new ArenaStore<PrivateTournament>(
  resolve(directory, "arena.sqlite"),
  readFileSync(keyPath)
);
const service = new ArenaLabService(store, loadArenaLabCatalog(root, weight));
const app = createArenaLabApp(service);
addArenaProductionRoutes(app, service, directory);
const port = Number(process.env.ARENA_LAB_PORT || 53901);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local arena port.");
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(
    `Arena Lab: http://127.0.0.1:${port}/api/arena/catalog (test randomness; Genesis ${weight}:1)`
  );
});
const productionWorker = createArenaProductionWorker(root, directory, service);
const productionTimer = setInterval(() => {
  try {
    productionWorker.tick();
  } catch {
    console.error("Arena production authorization needs operator attention.");
  }
}, 15000);
const timer = setInterval(() => {
  try {
    service.fulfillPendingTestDraws();
  } catch {
    console.error(
      "Arena Lab draw worker needs attention; no fallback island selected."
    );
  }
}, 1500);
function stop() {
  clearInterval(timer);
  clearInterval(productionTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

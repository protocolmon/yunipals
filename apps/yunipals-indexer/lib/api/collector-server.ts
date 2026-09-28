import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiPool } from "../offchain/db.js";
import { resolveOwner, InvalidOwnerError, OwnerNameUnresolvedError, EnsUnavailableError } from "../ens/resolver.js";
import { metadataSourceMode } from "../metadata/publication.js";
import { chainReadiness } from "../metadata/chain-readiness.js";
import { registerCollectorRoutes } from "./collector-routes.js";

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], exposeHeaders: ["Server-Timing"] }));
app.onError((error, c) => {
  if (error instanceof InvalidOwnerError) return c.json({ error: "invalid_owner", message: error.message }, 400);
  if (error instanceof OwnerNameUnresolvedError) return c.json({ error: "owner_name_unresolved", message: error.message }, 404);
  if (error instanceof EnsUnavailableError) return c.json({ error: "ens_resolution_unavailable" }, 503);
  // Do not log owner URLs, cursors, or database connection details.
  const code = "code" in error ? String(error.code) : error.name;
  console.error("Collector read unavailable", { code });
  return c.json({ error: "database_unavailable" }, 503);
});
app.get("/ready", async c => { await apiPool.query("SELECT 1"); return c.json({ status: "ready" }); });
registerCollectorRoutes(app, {
  pool: apiPool,
  resolveOwner: async (input, chains) => {
    const owner = await resolveOwner(input, chains);
    if (!Object.keys(owner.addresses).length) throw new OwnerNameUnresolvedError(`No address record found for ${input}`);
    return owner;
  },
  checkReadiness: async chains => metadataSourceMode() === "archive" ? chainReadiness(apiPool, chains) : { ready: true }
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.COLLECTOR_API_PORT ?? 9012) });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  server.close(() => { void apiPool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 5000).unref();
});

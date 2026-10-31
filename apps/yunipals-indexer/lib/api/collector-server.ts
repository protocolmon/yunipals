import { registerMonsterVersionRoutes } from "../versions/routes.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiPool } from "../offchain/db.js";
import {
  resolveOwner,
  InvalidOwnerError,
  OwnerNameUnresolvedError,
  EnsUnavailableError
} from "../ens/resolver.js";
import { metadataSourceMode } from "../metadata/publication.js";
import { chainReadiness } from "../metadata/chain-readiness.js";
import { metadataReadiness } from "../metadata/status.js";
import { registerCollectorRoutes } from "./collector-routes.js";
import { unifiedOwnershipReads, ownershipReadConfig } from "../offchain/sql.js";
import {
  assertOwnershipAvailable,
  assertOwnershipSourceSelection
} from "../ownership/readiness.js";
import { withOwnershipRequest } from "../ownership/request-snapshot.js";
import { chainSelection } from "./chains.js";
import { collectionSlugs } from "../constants.js";

const app = new Hono();
await assertOwnershipSourceSelection(apiPool);
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    exposeHeaders: ["Server-Timing", "X-Indexer-Release"]
  })
);
app.use("*", async (c, next) => {
  if (!unifiedOwnershipReads || c.req.method !== "GET") return next();
  return withOwnershipRequest(
    apiPool,
    (db) =>
      assertOwnershipAvailable(
        db,
        chainSelection(c.req.url)?.chains ?? collectionSlugs
      ),
    async () => {
      await next();
      c.header("X-Indexer-Release", ownershipReadConfig.releaseId!);
    }
  );
});
app.onError((error, c) => {
  if (error instanceof InvalidOwnerError)
    return c.json({ error: "invalid_owner", message: error.message }, 400);
  if (error instanceof OwnerNameUnresolvedError)
    return c.json(
      { error: "owner_name_unresolved", message: error.message },
      404
    );
  if (error instanceof EnsUnavailableError)
    return c.json({ error: "ens_resolution_unavailable" }, 503);
  // Do not log owner URLs, cursors, or database connection details.
  const code = "code" in error ? String(error.code) : error.name;
  console.error("Collector read unavailable", { code });
  return c.json({ error: "database_unavailable" }, 503);
});
app.get("/ready", async (c) => {
  await apiPool.query("SELECT 1");
  const metadata = await metadataReadiness(apiPool);
  return c.json(
    { status: metadata.ready ? "ready" : "not_ready", metadata },
    metadata.ready ? 200 : 503
  );
});
registerMonsterVersionRoutes(app, {
  pool: apiPool,
  resolveOwner: async (input, chains) => resolveOwner(input, chains)
});
registerCollectorRoutes(app, {
  pool: apiPool,
  resolveOwner: async (input, chains) => {
    const owner = await resolveOwner(input, chains);
    if (!Object.keys(owner.addresses).length)
      throw new OwnerNameUnresolvedError(
        `No address record found for ${input}`
      );
    return owner;
  },
  checkReadiness: async (chains) =>
    metadataSourceMode() === "archive"
      ? chainReadiness(apiPool, chains)
      : { ready: true }
});
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.COLLECTOR_API_PORT ?? 9012)
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(() => {
      void apiPool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });

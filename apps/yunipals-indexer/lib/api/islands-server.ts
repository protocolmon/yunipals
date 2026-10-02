import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiPool } from "../offchain/db.js";
import { physicalPonderSchemaName } from "../offchain/sql.js";
import { islandsReadiness } from "../islands/readiness.js";
import { islandsOpenApiPaths } from "./islands-openapi.js";
import { registerIslandsRoutes } from "./islands-routes.js";

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));
app.onError((_error, c) =>
  c.json({ error: "islands_database_unavailable" }, 503)
);
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/ready", async (c) => {
  const readiness = await islandsReadiness(apiPool, physicalPonderSchemaName);
  const ready = process.env.API_ISLANDS_ENABLED === "true" && readiness.ready;
  return c.json({ ...readiness, ready }, ready ? 200 : 503);
});
app.get("/v2/collections/ethereum-islands/openapi.json", (c) =>
  c.json({
    openapi: "3.0.3",
    info: { title: "Yunipals Ethereum Islands", version: "1.0.0" },
    servers: [{ url: "/yunipals-indexer" }],
    paths: islandsOpenApiPaths
  })
);
registerIslandsRoutes(app, {
  pool: apiPool,
  schemaName: physicalPonderSchemaName
});

const server = serve({
  fetch: app.fetch,
  hostname: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 9015)
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void apiPool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Pool } from "pg";
import { boosterReadiness } from "../boosters/readiness.js";
import { boosterDeployment } from "../boosters/config.js";
import {
  BoosterArtworkStore,
  registerBoosterArtworkRoutes
} from "../boosters/artwork.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { registerBoosterRoutes } from "./booster-routes.js";

/** Feature reads share the Ponder source, independently of OG derived caches. */
export function createBoosterApi(dependencies: {
  pool: Pick<Pool, "query">;
  schemaName: string;
  artworkDirectory?: string;
}) {
  const app = new Hono();
  sqlIdentifier(dependencies.schemaName);
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      allowHeaders: ["Content-Type", "If-None-Match"],
      exposeHeaders: ["ETag", "Retry-After"]
    })
  );
  app.onError(() =>
    new Response(JSON.stringify({ error: "booster_index_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    })
  );
  app.get("/healthz", (c) => c.json({ service: "yunipals-booster-api", alive: true }));
  app.get("/readyz", async (c) => {
    c.header("Cache-Control", "no-store");
    const deployment = boosterDeployment();
    if (!deployment)
      return c.json({ ready: false, error: "boosters_not_configured" }, 503);
    const source = await boosterReadiness(dependencies.pool, dependencies.schemaName, deployment.engine);
    return c.json({
      ...source,
      chainId: 8453,
      collection: deployment.monsters,
      engine: deployment.engine
    }, source.ready ? 200 : 503);
  });
  registerBoosterRoutes(app, {
    ...dependencies,
    readSnapshot: (deployment) => boosterReadiness(dependencies.pool, dependencies.schemaName, deployment.engine)
  });
  if (dependencies.artworkDirectory)
    registerBoosterArtworkRoutes(
      app,
      new BoosterArtworkStore(dependencies.artworkDirectory)
    );
  return app;
}

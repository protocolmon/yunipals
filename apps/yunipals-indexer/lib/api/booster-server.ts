import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createBoosterApi } from "./booster-app.js";

export function startBoosterApi() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const schemaName = process.env.BOOSTER_DATABASE_SCHEMA?.trim();
  if (!schemaName) throw new Error("BOOSTER_DATABASE_SCHEMA is required");
  const port = Number(process.env.BOOSTER_API_PORT ?? 9030);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("BOOSTER_API_PORT must be a port between 1024 and 65535");
  const pool = new pg.Pool({
    connectionString,
    application_name: "yunipals_booster_api",
    max: 2,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 3000,
    options: "-c default_transaction_read_only=on"
  });
  pool.on("error", () => console.error("Booster API database connection unavailable"));
  const app = createBoosterApi({
    pool,
    schemaName,
    artworkDirectory: process.env.BOOSTER_ARTWORK_DIRECTORY?.trim() || undefined
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void pool.end().then(
        () => process.exit(0),
        () => process.exit(1)
      );
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return { app, pool, server };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  startBoosterApi();

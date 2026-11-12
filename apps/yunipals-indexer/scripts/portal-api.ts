import { loadEnvFile } from "node:process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPortalRuntime } from "../lib/portals/runtime.js";
import { registerPortalRoutes } from "../lib/portals/routes.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);

async function main() {
  if (process.env.OPENAI_API_KEY || process.env.PORTALS_GRADER_PRIVATE_KEY)
    throw new Error(
      "The portal API must use its own configuration without worker signing or AI credentials."
    );
  const port = Number(process.env.PORTALS_PORT ?? "8931");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid portal API port.");
  const origins = (process.env.PORTALS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !origins.length ||
    origins.some((origin) => {
      const url = new URL(origin);
      return (
        url.origin !== origin ||
        (url.protocol !== "https:" &&
          !["http://localhost", "http://127.0.0.1"].some((prefix) =>
            origin.startsWith(`${prefix}:`)
          ))
      );
    })
  )
    throw new Error("Configure exact portal frontend origins.");
  const runtime = await createPortalRuntime();
  try {
    await access(runtime.assets.directory, constants.R_OK | constants.X_OK);
    await runtime.ledger.cursor();
    await runtime.store.cursor();
    const app = new Hono();
    app.use(
      "/v1/portals/*",
      cors({
        origin: (origin) => (origins.includes(origin) ? origin : undefined),
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type"]
      })
    );
    app.get("/healthz", (c) => c.json({ running: true }));
    registerPortalRoutes(app, { runtime: async () => runtime });
    const server = serve({
      fetch: app.fetch,
      hostname: process.env.PORTALS_BIND_HOST ?? "127.0.0.1",
      port
    });
    console.log("Portal API started.");
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      let closing = false;
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          if (closing) return;
          closing = true;
          server.close((error) => (error ? reject(error) : resolve()));
        });
    });
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error(
    "Portal API could not start. Check its isolated configuration, database and artifact permissions."
  );
  process.exitCode = 1;
});

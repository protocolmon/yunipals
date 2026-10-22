import { serve } from "@hono/node-server";
import { apiPool } from "../offchain/db.js";
import { assertOwnershipSourceSelection } from "../ownership/readiness.js";
import { createIslandsApp } from "./islands-app.js";

await assertOwnershipSourceSelection(apiPool);
const app = createIslandsApp(apiPool);
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
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

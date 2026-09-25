import assert from "node:assert/strict";
import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";
import pg from "pg";

import { createApp } from "../src/app.ts";
import { readEnvironment } from "../src/environment.ts";
import { BnbDiscoveryReadService } from "../src/reads/bnbDiscovery.ts";
import { OrderReadService } from "../src/reads/orders.ts";

const databaseUrl = process.env.MARKET_TEST_DATABASE_URL;
assert.ok(databaseUrl, "A disposable fork database is required");
const endpoint = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
assert.match(endpoint.pathname, /^\/yunipals_bnb_fork_[ab]$/);
const pool = new pg.Pool({ connectionString: databaseUrl });
const app = createApp(
  readEnvironment({ MARKET_DEPLOYMENT: "staging", MARKET_DATABASE_URL: databaseUrl }),
  async () => {},
  { bnbDiscovery: new BnbDiscoveryReadService(pool), reads: new OrderReadService(pool) }
);
const server = createServer(getRequestListener(app.fetch));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.send?.({ port: address.port });
});
process.once("SIGTERM", () => {
  server.close(() => void pool.end().then(() => process.exit(0)));
  server.closeAllConnections();
});

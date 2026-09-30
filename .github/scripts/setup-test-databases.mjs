import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/yunipals-market-api/package.json", import.meta.url)
);
const { Client } = require("pg");
const fixture = process.argv[2];
assert.ok(["marketplace", "indexer"].includes(fixture), "Unknown CI fixture");

const marketplace = fixture === "marketplace";
const value =
  process.env[
    marketplace ? "MARKET_TEST_DATABASE_URL" : "CI_POSTGRES_ADMIN_URL"
  ];
assert.ok(value, "Disposable CI database URL is required");
const url = new URL(value);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.search, "", "Connection overrides are not allowed");
assert.equal(url.hash, "");
assert.equal(
  url.username,
  marketplace ? "market_test_owner" : "indexer_test_owner"
);
assert.equal(url.pathname, marketplace ? "/yunipals_market_test" : "/postgres");

const client = new Client({
  connectionString: value,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000
});
await client.connect();
try {
  if (marketplace) {
    const scripts = new URL(
      "../../apps/yunipals-market-api/scripts/",
      import.meta.url
    );
    await client.query(
      await readFile(new URL("init-test-role.sql", scripts), "utf8")
    );
    const grants = await readFile(
      new URL("grant-runtime.sql", scripts),
      "utf8"
    );
    await client.query(
      grants.replaceAll(':"market_runtime_role"', '"market_test_runtime"')
    );
    console.log("Restricted marketplace test role is ready");
  } else {
    for (const name of [
      "yunipals_bnb_test",
      "yunipals_rarity_test",
      "yunipals_ponder_dependency_test"
    ]) {
      const result = await client.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [name]
      );
      if (!result.rowCount) await client.query(`CREATE DATABASE "${name}"`);
      console.log(`Disposable database ready: ${name}`);
    }
  }
} finally {
  await client.end();
}

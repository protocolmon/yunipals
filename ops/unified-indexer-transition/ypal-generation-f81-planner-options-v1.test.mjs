// Only the separate localhost PG16 synthetic fixture; no application import.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { authenticateArtifact } from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const require = createRequire(
  "/root/yunipals/apps/yunipals-indexer/package.json"
);
const { Client } = require("pg");
const endpoint = "postgresql://postgres@127.0.0.1:56981/postgres";
const originalOptions = process.env.PGOPTIONS;
const rows = [];
try {
  process.env.PGOPTIONS = "-c enable_nestloop=off";
  for (const override of [null, "-c enable_nestloop=on"]) {
    const url = new URL(endpoint);
    if (override) url.searchParams.set("options", override);
    const client = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000
    });
    try {
      await client.connect();
      const row = (
        await client.query(`SELECT current_setting('server_version_num')AS version,
        current_user AS role,current_database()AS database,current_setting('enable_nestloop')AS nested_loop`)
      ).rows[0];
      assert(
        row.version.startsWith("16") &&
          row.role === "postgres" &&
          row.database === "postgres"
      );
      assert.equal(row.nested_loop, override ? "on" : "off");
      rows.push({
        urlOptionsPresent: override !== null,
        enableNestloop: row.nested_loop
      });
    } finally {
      await client.end();
    }
  }
  const source = authenticateArtifact(
    "/tmp/yunipals-generation-snapshot-runtime-v2-final-20261024"
  );
  assert(!source.includes("enable_nestloop"));
  assert(source.includes("SET LOCAL work_mem = '64MB'"));
  assert(source.includes("SET LOCAL work_mem = '256MB'"));
  process.stdout.write(
    JSON.stringify({
      PGOPTIONSInheritedWhenURLHasNoOptions: true,
      URLSpecificOptionsOverridePGOPTIONS: true,
      frozenF81DoesNotOverrideNestedLoopSetting: true,
      productionURLStillRequiresPresenceOnlyInspection: true,
      probes: rows,
      productionCalls: 0,
      providerCalls: 0
    }) + "\n"
  );
} finally {
  if (originalOptions === undefined) delete process.env.PGOPTIONS;
  else process.env.PGOPTIONS = originalOptions;
}

// Execute the unchanged genuine all-six normalized-query fixture in a new local
// database. Only the dependency URL/database name in the test harness differ.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(root + "/apps/yunipals-indexer/package.json");
const { Client } = require("pg");
const original = readFileSync(
  root + "/ops/unified-indexer/ownership-parity.test.mjs",
  "utf8"
);
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  "b338476203b31ffd42087f8d52318f5e9a0731bb87087faa20955359c1976660"
);
const database = "parity_v4_queries_" + randomBytes(5).toString("hex");
const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const admin = new Client({ connectionString: base + "postgres" });
const dir = mkdtempSync(path.join(os.tmpdir(), "ypal-parity-v4-pg-"));
let created = false;
try {
  await admin.connect();
  assert.equal(
    (await admin.query("SHOW server_version_num")).rows[0].server_version_num,
    "160015"
  );
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  const test = original
    .replace(
      'from "./ownership-parity.mjs"',
      "from " +
        JSON.stringify(
          pathToFileURL(
            root +
              "/ops/unified-indexer-transition/ownership-parity-peer-v2.mjs"
          ).href
        )
    )
    .replace(
      'new URL("../../apps/yunipals-indexer/package.json", import.meta.url)',
      JSON.stringify(root + "/apps/yunipals-indexer/package.json")
    )
    .replace(
      '"/yunipals_ownership_parity_test"',
      JSON.stringify("/" + database)
    );
  const file = path.join(dir, "all-six-original.test.mjs");
  writeFileSync(file, test, { flag: "wx" });
  const output = execFileSync(process.execPath, [file], {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1000000,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      OWNERSHIP_PARITY_TEST_DATABASE_URL: base + database
    }
  });
  assert.match(output, /(?:pass 4|# pass 4)/);
  assert(!output.includes("# skipped 1"));
  console.log(
    JSON.stringify({
      passed: true,
      originalFixtureCases: 4,
      genuineAllSixPostgresCase: true,
      frozenQueryProducer: "peer-v2",
      fixtureOnly: true,
      providerCalls: 0,
      productionCalls: 0
    })
  );
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
}

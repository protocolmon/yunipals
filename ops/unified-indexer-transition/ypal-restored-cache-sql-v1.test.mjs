import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  proofCapture,
  validateRequest
} from "./ypal-restored-cache-sql-v1.mjs";

const root = new URL("./", import.meta.url);
const request = {
  catalogSql: readFileSync(
    new URL("ypal-combined-read-admission-v1.catalog.sql", root),
    "utf8"
  ),
  columnsSql: readFileSync(
    new URL("ypal-restored-read-admission-v1.columns.sql", root),
    "utf8"
  ),
  generationId: null,
  mode: "inspect",
  planJson: null,
  readerSql: ""
};
// Preserve the exact protected f603 catalog compiler, without constructing it.
const { execFileSync } = await import("node:child_process");
request.readerSql = execFileSync(
  "/usr/bin/python3",
  [
    "-I",
    "-B",
    "-c",
    `import importlib.util
p=${JSON.stringify(new URL("../booster-launch/ypal-reader-cutover-v1.py", root).pathname)}
s=importlib.util.spec_from_file_location('fixed_catalog',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.catalog_sql(),end='')`
  ],
  { encoding: "utf8", timeout: 5000 }
);
assert.equal(validateRequest(request), request);
for (const [key, value] of [
  ["columnsSql", request.columnsSql + " "],
  ["catalogSql", request.catalogSql + " "],
  ["readerSql", request.readerSql + " "],
  ["mode", "arbitrary"]
])
  assert.throws(() => validateRequest({ ...request, [key]: value }));
assert.throws(() => validateRequest({ ...request, arbitrarySql: "GRANT ALL" }));
const calls = [];
const client = {
  query: async (sql) => {
    calls.push(sql);
    return {
      rows: [
        {
          jsonb_build_object:
            calls.length === 1
              ? { complete: "catalog" }
              : { complete: "collector" },
          coalesce: [{ grantee: "0", privilege: "SELECT" }]
        }
      ]
    };
  }
};
const proof = await proofCapture(client, request)();
assert.deepEqual(calls, [
  request.catalogSql,
  request.readerSql,
  request.columnsSql
]);
assert.deepEqual(proof, {
  catalog: { complete: "catalog" },
  reader: { complete: "collector" },
  allColumnAcl: [{ grantee: "0", privilege: "SELECT" }]
});
console.log(
  JSON.stringify({
    passed: true,
    checks: 7,
    databaseCalls: 0,
    providerCalls: 0,
    fixedSQLOnly: true
  })
);

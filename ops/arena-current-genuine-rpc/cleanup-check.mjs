import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(new URL("../../apps/yunipals-market-api/package.json", import.meta.url))("pg");
const attempt = process.argv[2];
assert.match(attempt, /^[a-z]$/);
const directory = `/tmp/yunipals-arena-current-genuine-rpc-20261022-${attempt}`;
const result = JSON.parse(await readFile(`${directory}/result.json`, "utf8"));
const pool = new pg.Pool({connectionString:"postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/yunipals_ponder_dependency_test",max:1});
try {
  const schemas = (await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'arena_rpc_%' ORDER BY nspname")).rows;
  const releaseRows = result.report ? (await pool.query("SELECT count(*)::int AS n FROM yunipals_indexer_control.release WHERE physical_schema=$1", [result.report.nativeSchema])).rows[0].n : null;
  const namespaceAbsent = result.report ? (await pool.query("SELECT to_regnamespace($1) IS NULL AS absent", [result.report.nativeSchema])).rows[0].absent : null;
  const cleanup = JSON.parse(await readFile(`${directory}/cleanup.json`, "utf8"));
  assert.equal(cleanup.operationalSchemaRemoved,true);
  assert.ok(result.children.every(child=>!existsSync(`/proc/${child.pid}`)));
  if (result.passed) { assert.equal(releaseRows,0); assert.equal(namespaceAbsent,true); }
  const value={attempt,checkedAt:new Date().toISOString(),ownedChildrenAbsent:true,operationalSchemaRemovedReceipt:true,ownedNativeNamespaceAbsent:namespaceAbsent,ownedReleaseRows:releaseRows,remainingArenaRpcNamespaces:schemas.length};
  await writeFile(`${directory}/cleanup-verified.json`,JSON.stringify(value,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(value));
} finally {await pool.end();}

// Whole actual successful_worker body; only process/output evidence is a fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../../apps/yunipals-market-api/package.json"));
const { Pool } = require("pg");
const url = process.env.GENERATION_ACCEPT_FIXTURE_URL;
assert.equal(url, "postgresql://postgres@127.0.0.1:56983/fixture", "fixed_disposable_local_PG_only");
const name = "ypal_accept_v3_fixture";
const admin = new Pool({ connectionString: url, max: 1, statement_timeout: 10000 });
let pool, owned = false;
const checks = [];
const started = Date.now() / 1000 - 100;
const snapshot = { version: 1, releaseId: "local-release", readIdentity: "local-identity", physicalSchema: "unified_ypal_20261023_v1", metadataReleaseId: "local-metadata", predecessor: "103", capturedAt: new Date((started + 50) * 1000).toISOString(), anchors: [{ localFixture: true }], baseMetadataFrontier: "local-frontier" };
const validation = { sourceSnapshot: snapshot, localFixture: true };

async function run(original, options = {}) {
  const proc = spawn("python3", ["-I", "-B", join(here, "ypal-ordinary-generation-accept-v3.test.py"), "--postgres"], { stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.write(JSON.stringify({ original, startedUnix: started, validation: options.validation ?? validation, predecessor: options.predecessor ?? "103" }) + "\n");
  let done, stderr = "", queries = 0;
  proc.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 10000);
  const completion = new Promise((resolve) => proc.once("close", (code) => resolve(code)));
  try {
    for await (const line of createInterface({ input: proc.stdout, crlfDelay: Infinity })) {
      const value = JSON.parse(line);
      if (!Object.hasOwn(value, "query")) { done = value; continue; }
      const sql = value.query;
      assert(sql.startsWith("SELECT to_jsonb(g)||jsonb_build_object(") || sql.startsWith("SELECT count(*)FROM metadata_projection.generation WHERE id="));
      assert(!sql.includes(";"), "single_readonly_actual_query_required");
      queries++;
      const db = await pool.connect();
      try {
        await db.query("BEGIN READ ONLY");
        const rows = await db.query(sql);
        let scalar = Object.values(rows.rows[0])[0];
        if (sql.startsWith("SELECT count(*)")) scalar = Number(scalar);
        proc.stdin.write(JSON.stringify({ value: scalar }) + "\n");
      } catch (error) { proc.stdin.write(JSON.stringify({ error: error.code }) + "\n"); }
      finally { await db.query("ROLLBACK"); db.release(); }
    }
    const code = await completion;
    assert.equal(code, 0, stderr); assert.equal(stderr, ""); assert(done); return { ...done, queries };
  } finally { clearTimeout(timer); proc.stdin.end(); }
}

async function reset(row = {}) {
  await pool.query("TRUNCATE metadata_projection.generation");
  await pool.query("INSERT INTO metadata_projection.generation(id,state,published_at,ownership_release_id,ownership_read_identity,metadata_release_id,validation,started_at)VALUES(105,$1,$2,$3,$4,$5,$6,to_timestamp($7))", [
    row.state ?? "ready", row.published ?? null, row.release ?? "local-release", row.identity ?? "local-identity", row.metadata ?? "local-metadata", JSON.stringify(row.validation ?? validation), row.started ?? started
  ]);
}

try {
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1", [name])).rows[0].n, 0, "fresh_owned_fixture_database_required");
  await admin.query('CREATE DATABASE "' + name + '"'); owned = true;
  pool = new Pool({ connectionString: url.replace(/fixture$/, name), max: 1, statement_timeout: 10000 });
  await pool.query("CREATE SCHEMA metadata_projection");
  await pool.query("CREATE TABLE metadata_projection.generation(id bigint PRIMARY KEY,state text,published_at timestamptz,ownership_release_id text,ownership_read_identity text,metadata_release_id text,validation jsonb,started_at timestamptz)");
  await reset();
  let result = await run(true); assert.equal(result.done, false); assert.equal(result.fixedCode, "fixture_SQLSTATE_42601"); assert.equal(result.queries, 2); checks.push("genuine_original_whole_validator_reproduces_42601");
  result = await run(false); assert.equal(result.done, true); assert.equal(result.generationId, "105"); assert.equal(result.validationRetained, true); assert.equal(result.queries, 2); checks.push("genuine_successor_whole_validator_passes_both_real_readonly_queries_and_snapshot");
  for (const [label, row] of [
    ["state", { state: "building" }], ["publication", { published: new Date().toISOString() }],
    ["release", { release: "foreign-release" }], ["identity", { identity: "foreign-identity" }],
    ["validation", { validation: { foreign: true } }], ["started_before_worker", { started: started - 2 }]
  ]) {
    await reset(row); result = await run(false); assert.equal(result.done, false, label); assert.equal(result.fixedCode, "actual_new_ready_unpublished_row_GEN_validation_and_worker_start_boundary_required"); checks.push("whole_validator_refuses_" + label);
  }
  await reset(); result = await run(false, { predecessor: "102" }); assert.equal(result.done, false); checks.push("whole_validator_refuses_wrong_predecessor");
  for (const [label, delta] of [
    ["stale_snapshot", { capturedAt: new Date((started - 2) * 1000).toISOString() }],
    ["foreign_physical_schema", { physicalSchema: "foreign" }], ["empty_anchors", { anchors: [] }], ["empty_frontier", { baseMetadataFrontier: "" }]
  ]) {
    const changed = { ...validation, sourceSnapshot: { ...snapshot, ...delta } };
    await reset({ validation: changed }); result = await run(false, { validation: changed }); assert.equal(result.done, false, label); assert.equal(result.queries, 2); assert.equal(result.fixedCode, "genuine_fresh_worker_source_snapshot_and_GEN_validation_required"); checks.push("whole_validator_refuses_" + label);
  }
  process.stdout.write(JSON.stringify({ sourceOnly: true, postgres: (await pool.query("SHOW server_version")).rows[0].server_version, checksPassed: checks.length, checks, productionAccess: 0, candidateAcceptance: 0 }) + "\n");
} finally {
  await pool?.end();
  if (owned) await admin.query('DROP DATABASE "' + name + '"');
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1", [name])).rows[0].n, 0);
  await admin.end();
}

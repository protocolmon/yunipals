// Only the existing disposable localhost PG16 fixture. No production/provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { begin, relations, RELEASE } from "./ypal-ordinary-cache-two-phase-v1.mjs";
import { readCacheSchemaStatements } from "../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts";
import { nativeBaseMetadataMigrations } from "../../apps/yunipals-indexer/lib/metadata/native-base-schema.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { Client } = createRequire(root + "apps/yunipals-indexer/package.json")("pg");
const info = JSON.parse(execFileSync("/usr/bin/docker", ["--host=unix:///var/run/docker.sock", "inspect", "yunipals-unified-indexer-test-20261020"], { encoding: "utf8", timeout: 10000 }))[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "56967" }]);
const database = "ypal_two_phase_fence_" + randomBytes(5).toString("hex");
const url = name => "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Client({ connectionString: url("postgres") });
const first = new Client({ connectionString: url(database) });
const second = new Client({ connectionString: url(database) });
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const checks = []; let created = false;
const upsert = `INSERT INTO metadata_source.native_base_metadata_state
(release_id,read_identity,state,frontier,implementation,checked_block,checked_hash,checked_at,error_code)
VALUES($1,'same-read','ready','same-frontier','same-implementation',$2,$3,clock_timestamp(),NULL)
ON CONFLICT(release_id) DO UPDATE SET read_identity=EXCLUDED.read_identity,state='ready',frontier=EXCLUDED.frontier,
implementation=EXCLUDED.implementation,checked_block=EXCLUDED.checked_block,checked_hash=EXCLUDED.checked_hash,
checked_at=EXCLUDED.checked_at,error_code=NULL`;
async function refused(label, sql, values = []) {
  await assert.rejects(second.query(sql, values), error => error.code === "55P03"); checks.push(label);
}
try {
  await admin.connect(); await admin.query(`CREATE DATABASE ${quote(database)} OWNER unified_test TEMPLATE template0`); created = true;
  await first.connect(); await second.connect();
  for (const schema of new Set(relations.map(name => name.split(".")[0]))) await first.query(`CREATE SCHEMA ${quote(schema)}`);
  await first.query(readCacheSchemaStatements[0]); await first.query(nativeBaseMetadataMigrations[0]);
  for (const name of relations.filter(name => !["metadata_projection.read_epoch", "metadata_source.native_base_metadata_state"].includes(name))) {
    await first.query(`CREATE TABLE ${name.split(".").map(quote).join(".")}(fixture_id integer)`);
  }
  const dirty = readCacheSchemaStatements.find(sql => sql.startsWith("CREATE OR REPLACE FUNCTION metadata_projection.read_cache_dirty()"));
  assert(dirty); await first.query(dirty);
  await first.query("INSERT INTO metadata_projection.read_epoch VALUES('base',0)");
  await first.query("CREATE TRIGGER read_cache_dirty AFTER INSERT OR UPDATE OR DELETE ON metadata_source.native_base_metadata_state FOR EACH ROW EXECUTE FUNCTION metadata_projection.read_cache_dirty('native_base_approval')");
  await first.query(upsert, [RELEASE, "1", "hash-one"]);
  const prior = (await first.query("SELECT checked_at,checked_block::text,checked_hash FROM metadata_source.native_base_metadata_state")).rows[0];
  const epoch = (await first.query("SELECT revision::text FROM metadata_projection.read_epoch WHERE collection='base'")).rows[0].revision;
  await begin(first, true); // The exact production component's 26SRE+approvalSUE+rowKEYSHARE statements.
  await second.query("SET lock_timeout='100ms';SET statement_timeout='2s'");
  await second.query(upsert, [RELEASE, "2", "hash-two"]);
  const renewed = (await second.query("SELECT checked_at,checked_block::text,checked_hash FROM metadata_source.native_base_metadata_state")).rows[0];
  assert(renewed.checked_at >= prior.checked_at); assert.equal(renewed.checked_block, "2"); assert.equal(renewed.checked_hash, "hash-two");
  assert.equal((await second.query("SELECT revision::text FROM metadata_projection.read_epoch WHERE collection='base'")).rows[0].revision, epoch);
  checks.push("real_worker_non_key_UPSERT_renews_without_epoch_change");
  await refused("semantic_frontier_change_blocks_on_epoch", "UPDATE metadata_source.native_base_metadata_state SET frontier='changed' WHERE release_id=$1", [RELEASE]);
  await refused("semantic_error_blocks_on_epoch", "UPDATE metadata_source.native_base_metadata_state SET state='blocked',error_code='native_base_check_failed' WHERE release_id=$1", [RELEASE]);
  await refused("primary_release_key_change_blocked", "UPDATE metadata_source.native_base_metadata_state SET release_id='foreign-release' WHERE release_id=$1", [RELEASE]);
  await refused("approval_delete_blocked", "DELETE FROM metadata_source.native_base_metadata_state WHERE release_id=$1", [RELEASE]);
  await refused("new_release_insert_blocks_on_epoch", upsert, ["new-release", "3", "hash-three"]);
  await refused("approval_table_DDL_blocked", "ALTER TABLE metadata_source.native_base_metadata_state ADD COLUMN foreign_column integer");
  await refused("approval_trigger_DDL_blocked", "CREATE OR REPLACE TRIGGER read_cache_dirty AFTER INSERT OR UPDATE OR DELETE ON metadata_source.native_base_metadata_state FOR EACH ROW EXECUTE FUNCTION metadata_projection.read_cache_dirty('native_base_approval')");
  await refused("direct_epoch_change_blocked", "UPDATE metadata_projection.read_epoch SET revision=revision+1");
  assert.equal((await second.query("SELECT frontier FROM metadata_source.native_base_metadata_state WHERE release_id=$1", [RELEASE])).rows[0].frontier, "same-frontier");
  checks.push("readers_continue_with_original_semantic_state");
  await first.query("ROLLBACK");
  await second.query("UPDATE metadata_source.native_base_metadata_state SET frontier='changed-after-release' WHERE release_id=$1", [RELEASE]);
  assert.equal(BigInt((await second.query("SELECT revision::text FROM metadata_projection.read_epoch WHERE collection='base'")).rows[0].revision), BigInt(epoch) + 1n);
  checks.push("later_semantic_change_increments_and_invalidates_saved_epoch");
  await first.query("BEGIN"); await first.query("LOCK TABLE metadata_source.native_base_metadata_state IN SHARE ROW EXCLUSIVE MODE");
  await refused("original_SRE_mode_blocks_the_same_genuine_UPSERT", upsert, [RELEASE, "4", "hash-four"]);
  await first.query("ROLLBACK");
  console.log(JSON.stringify({ format: "local-two-phase-real-PG-fence-controls-v1", checks, groupsPassed: checks.length, productionCalls: 0, providerCalls: 0, fixtureCleanupRequired: true }));
} finally {
  await first.query("ROLLBACK").catch(() => {}); await first.end().catch(() => {}); await second.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE ${quote(database)} WITH(FORCE)`); await admin.end();
}

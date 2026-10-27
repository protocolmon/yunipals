/** Fixed candidate registration through the unchanged official owner function.
 * No environment-derived source builder, provider RPC, migration or selection.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RELEASE_ROOT = "/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6";
export const PROFILE = "/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/profile.json";
export const PROFILE_SHA = "c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b";
export const INPUT = Object.freeze({ schema: "unified_ypal_20261023_v1", buildId: "71e2a7f3b7" });
export const MANIFEST_HASH = "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112";
export const RELEASE_ID = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3";
export const PINS = Object.freeze({
  "apps/yunipals-indexer/lib/unified/releases.ts": "233a600717529e71859ae4e17f0c5b487b8edbdf84557c5d35645b60f3af0e5b",
  "packages/yunipals-indexer-server/src/releases.ts": "98d35c8ac5831ff4b4397579259ae5201caa0f662a23f8fb9ba65a76f4f464c6",
  "packages/yunipals-indexer-server/src/identity.ts": "1ec0dab250ec8b93e93dd1f864bc6257dfada2520d3fcac94e7c8697703224ae",
  "packages/yunipals-indexer-server/src/database.ts": "3ff91209b43d755a9010a8ff8f6a2c99b4698c7eba57787353791d1a0299aa1b",
  "packages/yunipals-indexer-server/src/ponder-reader.ts": "cec123e750017b46a099dbbe2f7b155e330273c87a4757b1e4b07aed33405c4a",
  "packages/yunipals-indexer-client/src/sources.ts": "05e1ad7cdf5da6fbf7615294bf94552ac291032aadb911be65ea5d6506544b1c",
  "packages/yunipals-indexer-client/src/ponder.ts": "850f53b560c45a7bb3641d90277bdda723e1abdb0fc8a29ce38ec5530f3409ba"
});
export const sha = (raw) => createHash("sha256").update(raw).digest("hex");
export async function official(root = RELEASE_ROOT) {
  for (const [name, pin] of Object.entries(PINS)) assert.equal(sha(readFileSync(root + "/" + name)), pin);
  const owner = await import(pathToFileURL(root + "/apps/yunipals-indexer/lib/unified/releases.ts").href);
  const identity = await import(pathToFileURL(root + "/packages/yunipals-indexer-server/src/identity.ts").href);
  return { ...owner, ...identity };
}
export function candidate(api, raw) {
  assert.equal(sha(raw), PROFILE_SHA);
  const manifest = JSON.parse(raw).manifest;
  assert.equal(api.sourceManifestHash(manifest), MANIFEST_HASH);
  assert.equal(manifest.sources.length, 12);
  const release = { ...INPUT, manifest, manifestHash: MANIFEST_HASH, id: RELEASE_ID };
  assert.equal(api.manifestDigest({ ...INPUT, manifestHash: MANIFEST_HASH }), RELEASE_ID);
  return release;
}
export const CATALOG_SQL = `SELECT jsonb_build_object(
  'database',current_database(),'user',current_user,'client',inet_client_addr(),
  'schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='unified_ypal_20261023_v1'),
  'active',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY name) FROM yunipals_indexer_control.active_release a),'[]'::jsonb),
  'releases',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'schema',physical_schema,'buildId',build_id,'manifestHash',manifest_hash,'manifest',manifest) ORDER BY id) FROM yunipals_indexer_control.release),'[]'::jsonb)) AS value`;

export async function snapshot(db, api, release) {
  const runtime = await api.readBoundRuntime(db, release);
  assert.equal(runtime.running, true);
  assert.ok(Date.now() - runtime.observedAtMs >= 0 && Date.now() - runtime.observedAtMs <= 180000);
  const value = (await db.query(CATALOG_SQL)).rows[0].value;
  assert.deepEqual([value.database, value.user, value.client, value.schemaOid], ["yunipals_backfill", "postgres", null, "75963410"]);
  const candidates = value.releases.filter((row) => row.id === RELEASE_ID || row.schema === INPUT.schema);
  assert.ok(candidates.length <= 1);
  if (candidates.length) assert.deepEqual(candidates[0], { id: release.id, schema: release.schema, buildId: release.buildId, manifestHash: release.manifestHash, manifest: release.manifest });
  const binding = {
    releaseId: RELEASE_ID, ...INPUT, manifestHash: MANIFEST_HASH, schemaOid: value.schemaOid,
    targetRegistered: candidates.length === 1,
    activeReleaseHash: api.manifestDigest(value.active),
    unrelatedReleaseHash: api.manifestDigest(value.releases.filter((row) => !candidates.includes(row))),
    unrelatedReleaseCount: value.releases.length - candidates.length
  };
  return { ...binding, reviewHash: api.manifestDigest(binding) };
}
async function limits(db) {
  await db.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='20s'; SET LOCAL search_path=pg_catalog");
}
export async function execute(pool, api, release, phase, expected) {
  assert.ok(["review", "rehearse", "commit", "reconcile"].includes(phase));
  if (phase !== "review") assert.match(expected ?? "", /^0x[0-9a-f]{64}$/);
  if (phase === "review" || phase === "reconcile") {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await limits(db);
      const result = await snapshot(db, api, release);
      if (phase === "reconcile") {
        assert.equal(result.targetRegistered, true);
        const old = { ...result, targetRegistered: false }; delete old.reviewHash;
        assert.equal(api.manifestDigest(old), expected);
      }
      await db.query("ROLLBACK");
      return { ...result, phase, registered: result.targetRegistered, databaseCommitted: false, activated: false, providerRequests: 0 };
    } finally { await db.query("ROLLBACK").catch(() => {}); db.release(); }
  }
  let before, after;
  // Retain the exact official transaction/body. The adapter supplies bounded
  // pre/post conditions in that same transaction and substitutes only its final
  // COMMIT for the deliberately requested rollback rehearsal.
  const bounded = { async connect() {
    const db = await pool.connect();
    return { release: () => db.release(), async query(sql, params) {
      if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ") {
        const result = await db.query(sql); await limits(db);
        await db.query("SELECT pg_advisory_xact_lock(178858,9071)");
        before = await snapshot(db, api, release);
        assert.equal(before.targetRegistered, false);
        assert.equal(before.reviewHash, expected);
        return result;
      }
      if (sql === "COMMIT") {
        after = await snapshot(db, api, release);
        assert.equal(after.targetRegistered, true);
        assert.deepEqual({ ...after, targetRegistered: false, reviewHash: before.reviewHash }, before);
        return db.query(phase === "rehearse" ? "ROLLBACK" : "COMMIT");
      }
      return db.query(sql, params);
    } };
  } };
  const result = await api.registerIndexerRelease(bounded, { ...INPUT, manifest: release.manifest });
  assert.equal(result.id, RELEASE_ID);
  assert.ok(before && after);
  return { ...after, phase, reviewedHash: before.reviewHash, registered: phase === "commit", databaseCommitted: phase === "commit", activated: false, providerRequests: 0 };
}
export async function main(args = process.argv.slice(2)) {
  const [phase, expected] = args;
  assert.equal(args.length, phase === "review" ? 1 : 2);
  assert.equal(process.versions.node, "24.18.1");
  assert.equal(process.getuid(), 111); assert.equal(process.getgid(), 113);
  const api = await official();
  const release = candidate(api, readFileSync(PROFILE));
  const { default: pg } = await import(pathToFileURL(RELEASE_ROOT + "/apps/yunipals-market-api/node_modules/pg/lib/index.js").href);
  const pool = new pg.Pool({ host: "/var/run/postgresql", port: 5432, user: "postgres", database: "yunipals_backfill", max: 1, connectionTimeoutMillis: 5000, query_timeout: 20000, application_name: "yunipals_combined_release_owner_v1" });
  try { console.log(JSON.stringify(await execute(pool, api, release, phase, expected))); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("fixed_combined_registration_failed"); process.exitCode = 1;
});

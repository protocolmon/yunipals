// Read-only preflight for the existing official refresh-leaderboard CLI.
// Run only with the retained worker's four env files and staged v4 selectors.
const root = "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const schema = "yunipals_ownership_35cdcb32_v4";
const identity = "0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d";
const release = "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c";
let pool, client;
try {
  for (const [key, value] of Object.entries({ OWNERSHIP_READ_MODE: "unified", OWNERSHIP_READ_SCHEMA: schema,
    READ_DATABASE_SCHEMA: schema, OWNERSHIP_RELEASE_ID: release, YUNIPALS_PROJECTION_MODE: "generation",
    BASE_METADATA_INGESTION: "native", METADATA_SOURCE_MODE: "archive" })) {
    if (process.env[key] !== value) throw new Error("exact_v4_refresh_selectors_required");
  }
  ({ pool } = await import(root + "/lib/offchain/db.ts"));
  const { collectionSlugs } = await import(root + "/lib/constants.ts");
  const { assertOwnershipAvailable, ownershipReadIdentity } = await import(root + "/lib/ownership/readiness.ts");
  const { assertChainReady } = await import(root + "/lib/metadata/chain-readiness.ts");
  const { assertProjectionBuildCapacity } = await import(root + "/lib/metadata/projection-refresh.ts");
  client = await pool.connect();
  await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'");
  await assertOwnershipAvailable(client, collectionSlugs);
  await assertChainReady(client, collectionSlugs);
  await assertProjectionBuildCapacity(client);
  if ((await ownershipReadIdentity(client))?.identity !== identity) throw new Error("v4_refresh_identity_required");
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ ready: true, readIdentity: identity, officialReadinessChecks: true, officialCapacityCheck: true, databaseWrites: 0 }));
} catch {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ ready: false, failure: "v4_refresh_precondition_failed", privateValuesExported: false }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool?.end();
}

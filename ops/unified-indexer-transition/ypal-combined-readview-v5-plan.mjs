// Pure official-creator recorder. No database connection, provider or grant.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOwnershipReadViews } from "../../apps/yunipals-indexer/lib/unified/ownership-views.ts";
import {
  manifestDigest,
  sourceManifestHash
} from "../../packages/yunipals-indexer-server/src/identity.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const entry = "apps/yunipals-indexer/lib/unified/ownership-views.ts";
const priorFile =
  "ops/unified-indexer-transition/ypal-combined-readview-v1.preparation.json";
const manifestFile =
  "ops/unified-indexer-transition/ypal-combined-source-manifest-v1.json";

export async function prepareReadViewV5() {
  assert.equal(process.versions.node, "24.18.1");
  const previousBytes = readFileSync(path.join(root, priorFile));
  assert.equal(
    sha(previousBytes),
    "091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b"
  );
  const previous = JSON.parse(previousBytes);
  const manifestBytes = readFileSync(path.join(root, manifestFile));
  assert.equal(
    sha(manifestBytes),
    "a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7"
  );
  const manifest = JSON.parse(manifestBytes);
  const release = {
    id: previous.sourceRelease,
    schema: previous.physicalSchema,
    buildId: previous.buildId,
    manifestHash: previous.manifestHash,
    manifest
  };
  assert.equal(sourceManifestHash(manifest), release.manifestHash);
  assert.equal(
    manifestDigest({
      schema: release.schema,
      buildId: release.buildId,
      manifestHash: release.manifestHash
    }),
    release.id
  );
  const readSchema = "yunipals_ownership_4e77f52b_v5";
  const definitions = previous.definitions;
  const configs = definitions
    .map((definition) => ({
      ...definition,
      source: manifest.sources.find(
        (source) => source.id === definition.sourceId
      )
    }))
    .sort((a, b) => a.collection.localeCompare(b.collection));
  const nativeBase = manifest.sources.find(
    (source) => source.id === "metadata:base"
  );
  assert.equal(
    manifestDigest({ version: 4, releaseId: release.id, configs, nativeBase }),
    previous.readIdentity
  );
  const statements = [];
  const db = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes("SELECT value AS app"))
        return {
          rows: [
            {
              app: {
                version: "6",
                build_id: release.buildId,
                heartbeat_at: 1000,
                is_ready: 0,
                is_locked: 0,
                is_dev: 0
              },
              checkpoints: [],
              witnesses: []
            }
          ],
          rowCount: 1
        };
      if (sql.includes("SELECT id,chain_id,manifest_hash,definition FROM"))
        return {
          rows: manifest.sources.map((source) => ({
            id: source.id,
            chain_id: source.chainId,
            manifest_hash: release.manifestHash,
            definition: JSON.stringify(source)
          })),
          rowCount: manifest.sources.length
        };
      assert.match(
        sql,
        /^(?:BEGIN$|COMMIT$|ROLLBACK$|SET LOCAL |SELECT pg_advisory_xact_lock\(|SELECT 1 FROM pg_namespace |CREATE |INSERT |REVOKE )/
      );
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const result = await createOwnershipReadViews(
    { connect: async () => db },
    release,
    readSchema,
    definitions
  );
  assert.equal(
    result.identity,
    manifestDigest({ version: 5, releaseId: release.id, configs, nativeBase })
  );
  assert.equal(result.created, true);
  assert.equal(result.activated, false);
  const writes = statements.filter((row) =>
    /^(CREATE|INSERT|REVOKE) /.test(row.sql)
  );
  assert.equal(writes.length, 19);
  assert.equal(
    statements.some((row) =>
      /^(UPDATE|DELETE|DROP|ALTER|GRANT|TRUNCATE) /.test(row.sql)
    ),
    false
  );
  for (const row of writes)
    assert.ok(
      row.sql.includes(`"${readSchema}".`) ||
        row.sql === `CREATE SCHEMA "${readSchema}"`
    );

  // Resolve the actual repository import closure without installing or running
  // a bundle. The resulting source pins accompany the recorded SQL plan.
  const require = createRequire(
    path.join(root, "apps/yunipals-market-api/package.json")
  );
  const esbuild = require("esbuild");
  const build = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    metafile: true,
    logLevel: "silent"
  });
  const officialSourcePins = Object.fromEntries(
    Object.keys(build.metafile.inputs)
      .sort()
      .map((name) => {
        assert.ok(
          !path.isAbsolute(name) &&
            !name.split("/").includes("..") &&
            !name.includes("node_modules")
        );
        return [name, sha(readFileSync(path.join(root, name)))];
      })
  );
  return {
    format: "yunipals-combined-readview-offline-preparation-v5",
    preparedOnly: true,
    sourceRelease: release.id,
    physicalSchema: release.schema,
    buildId: release.buildId,
    manifestHash: release.manifestHash,
    readSchema,
    readIdentity: result.identity,
    previousReadSchema: previous.readSchema,
    previousReadIdentity: previous.readIdentity,
    definitions,
    semanticVersion: 5,
    readinessChange:
      "latest_default_verified_complete_prefix_after_framework_ready_only",
    depthAndFinalizedPoliciesChanged: false,
    producerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    sourceManifestFileSha256: sha(manifestBytes),
    previousPreparationSha256: sha(previousBytes),
    officialSourcePins,
    compilerVersion: esbuild.version,
    expectedOwnerStatements: writes,
    expectedOwnerStatementsSha256: sha(encode(writes)),
    installedCreatorQualified: false,
    grantsPrepared: false,
    databaseQueries: 0,
    providerRequests: 0,
    previousSchemaModified: false,
    nativeDataWritten: false,
    servicesOrSelectorsChanged: false
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [flag, output, ...extra] = process.argv.slice(2);
  assert.equal(flag, "--out");
  assert.ok(path.isAbsolute(output) && !extra.length);
  const plan = await prepareReadViewV5();
  const bytes = encode(plan);
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      readSchema: plan.readSchema,
      readIdentity: plan.readIdentity,
      statements: plan.expectedOwnerStatements.length,
      sourcePins: Object.keys(plan.officialSourcePins).length,
      sha256: sha(bytes),
      databaseQueries: 0,
      providerRequests: 0
    })
  );
}

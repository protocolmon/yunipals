// Genuine existing snapshot tests plus one new pre-COMMIT failure seam.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha } from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const args = process.argv.slice(2);
assert.deepEqual([args.length, args[0]], [2, "--tree"]);
assert(path.isAbsolute(args[1]));
const tree = args[1];
// Extra files support only the synthetic fixture. Never overwrite any of the
// authenticated runtime inputs reconstructed in this tree.
for (const folder of [
  "apps/yunipals-indexer/lib",
  "packages/yunipals-indexer-server/src",
  "packages/yunipals-indexer-client/src",
  "packages/yunipals-market-core/src"
])
  cpSync(path.join(root, folder), path.join(tree, folder), {
    recursive: true,
    force: false,
    errorOnExist: false
  });
for (const name of [
  "ypal-combined-readview-v1.preparation.json",
  "ypal-combined-rpc-profile-v1.json"
]) {
  const target = path.join(tree, "ops/unified-indexer-transition", name);
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, "ops/unified-indexer-transition", name), target);
  }
}
mkdirSync(path.join(tree, "apps/yunipals-indexer/scripts"), {
  recursive: true
});
const test = readFileSync(
  path.join(root, "apps/yunipals-indexer/scripts/test-projection-snapshot.mjs"),
  "utf8"
);
assert.equal(
  sha(test),
  "62fe40f285f6e6e564d181560fb1126eafab24268bff68710ebade4de898a5dc"
);
assert.equal(
  sha(
    readFileSync(
      path.join(
        tree,
        "apps/yunipals-indexer/lib/metadata/projection-refresh.ts"
      )
    )
  ),
  "27b7828f96be5f94ea974ed21da85bc1b43775431b762df71655fa81a1da5c42"
);
const marker = "  const generated = await refreshProjectionGeneration();";
assert.equal(test.split(marker).length, 2);
const artifact = "/tmp/ypal-generation-statistics-runtime-v3-20261025";
assert.equal(
  sha(readFileSync(path.join(artifact, "manifest.json"))),
  "4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442"
);
const executableCopy = mkdtempSync(
  path.join(os.tmpdir(), "ypal-statistics-v3-cli-")
);
cpSync(artifact, executableCopy, { recursive: true });
symlinkSync(
  path.join(root, "apps/yunipals-indexer/node_modules"),
  path.join(executableCopy, "node_modules"),
  "dir"
);
const failure = `
  const failureBaseline = async () => (await db.query(
    "SELECT jsonb_build_object('generations',(SELECT jsonb_agg(to_jsonb(g)ORDER BY id)FROM metadata_projection.generation g),'search',(SELECT count(*)FROM metadata_projection.search),'trait',(SELECT count(*)FROM metadata_projection.trait),'revision',(SELECT count(*)FROM metadata_projection.revision),'facet',(SELECT count(*)FROM metadata_projection.facet),'status',(SELECT count(*)FROM metadata_projection.facet_status),'active',(SELECT to_jsonb(a)FROM metadata_projection.active a),'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s),'wallets',(SELECT jsonb_agg(to_jsonb(w)ORDER BY scope,owner)FROM leaderboard.wallet_stats w))AS value"
  )).rows[0].value;
  const beforeAnalyzeFailure = await failureBaseline();
  const failedCommands = [];
  const touchedClients = [];
  const ordinaryConnect = appPools.pool.connect;
  appPools.pool.connect = async function(...args) {
    const client = await ordinaryConnect.apply(this,args);
    const ordinaryQuery = client.query;
    touchedClients.push({client,ordinaryQuery});
    client.query = function(sql,...values) {
      failedCommands.push(sql);
      if(sql === 'ANALYZE metadata_projection.trait')
        throw Error('synthetic_candidate_trait_analyze_failure');
      return ordinaryQuery.call(this,sql,...values);
    };
    return client;
  };
  try {
    await assert.rejects(refreshProjectionGeneration({publish:false}),
      /synthetic_candidate_trait_analyze_failure/);
  } finally {
    appPools.pool.connect = ordinaryConnect;
    for(const {client,ordinaryQuery} of touchedClients)client.query=ordinaryQuery;
  }
  const traitInsert = failedCommands.findIndex(sql=>sql.startsWith('INSERT INTO metadata_projection.trait'));
  const revisionInsert = failedCommands.findIndex(sql=>sql.startsWith('INSERT INTO metadata_projection.revision'));
  const analyzeAttempt = failedCommands.indexOf('ANALYZE metadata_projection.trait');
  assert(traitInsert>=0 && revisionInsert>traitInsert && analyzeAttempt>revisionInsert);
  assert(failedCommands.slice(analyzeAttempt).includes('ROLLBACK'));
  assert(!failedCommands.some(sql=>sql.startsWith('INSERT INTO metadata_projection.facet')));
  assert.deepEqual(await failureBaseline(),beforeAnalyzeFailure);
  checks.push('new_trait_ANALYZE_failure_rolls_back_candidate_payload_snapshot_and_global_state_before_facets');
  const actualCli = JSON.parse(execFileSync(process.execPath,
    [${JSON.stringify(path.join(executableCopy, "dist/generation-prepare.mjs"))}],
    {cwd:${JSON.stringify(path.join(tree, "apps/yunipals-indexer"))},env:process.env,
      encoding:'utf8',timeout:30000}));
  assert(actualCli.event==='native_generation_prepared' && actualCli.prepared===true &&
    actualCli.built===true && actualCli.validated===true && actualCli.published===false);
  const actualCliRow = (await db.query(
    'SELECT state,published_at,validation FROM metadata_projection.generation WHERE id=$1',
    [actualCli.generationId])).rows[0];
  assert.equal(actualCliRow.state,'ready');assert.equal(actualCliRow.published_at,null);
  assert.equal(actualCliRow.validation.search_count,'4');
  assert.equal(actualCliRow.validation.revision_count,'4');
  assert.equal(actualCliRow.validation.scope_count,'15');
  assert.equal(actualCliRow.validation.sourceSnapshot.readIdentity,plan.readIdentity);
  assert.deepEqual((await failureBaseline()).active,beforeAnalyzeFailure.active);
  assert.deepEqual((await failureBaseline()).wallets,beforeAnalyzeFailure.wallets);
  assert.deepEqual((await failureBaseline()).stamps,beforeAnalyzeFailure.stamps);
  checks.push('actual_new_bundled_preparation_CLI_builds_validates_and_preserves_global_data_pool4');
`;
const adapted = test
  .replace(
    "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/",
    "postgresql://postgres@127.0.0.1:56981/"
  )
  .replace('OFFCHAIN_DB_POOL_MAX: "2"', 'OFFCHAIN_DB_POOL_MAX: "4"')
  .replace(marker, failure + marker);
const target = path.join(
  tree,
  "apps/yunipals-indexer/scripts/test-projection-statistics-v3.mjs"
);
writeFileSync(target, adapted);
try {
  process.stdout.write(
    execFileSync(
      process.execPath,
      [
        "--import",
        path.join(
          root,
          "apps/yunipals-indexer/node_modules/tsx/dist/loader.mjs"
        ),
        target
      ],
      {
        cwd: tree,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", TZ: "UTC" },
        timeout: 120000,
        maxBuffer: 2000000,
        encoding: "utf8"
      }
    )
  );
} finally {
  rmSync(executableCopy, { recursive: true, force: true });
}

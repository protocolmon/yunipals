import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
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

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const name =
  "ops/unified-indexer-transition/ypal-latest-complete-main-api-build-v1.mjs";
const temporary = mkdtempSync(path.join(os.tmpdir(), "ypal-main-api-build-"));
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const invoke = (tree, out) =>
  execFileSync(process.execPath, [path.join(tree, name), "--out", out], {
    cwd: tree,
    encoding: "utf8",
    timeout: 30000
  });
const checks = [];
try {
  const first = path.join(temporary, "first");
  invoke(root, first);
  const manifest = JSON.parse(readFileSync(first + "/manifest.json"));
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.inputs.length, 94);
  assert.equal(manifest.publicApprovalTtlChanged, false);
  assert.equal(manifest.nativeWritePrivilegesAdded, false);
  assert.equal(manifest.scope, "main_api_latest_complete_readiness_only");
  assert.deepEqual(
    manifest.inputs
      .filter((row) => row.sha256 !== row.previousConsumerSha256)
      .map((row) => row.path)
      .sort(),
    [
      "packages/yunipals-indexer-client/src/readiness.ts",
      "packages/yunipals-indexer-server/src/status.ts"
    ].sort()
  );
  for (const item of manifest.files) {
    const raw = readFileSync(first + "/" + item.path);
    assert.equal(digest(raw), item.sha256);
    if (item.path.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", first + "/" + item.path]);
  }
  checks.push("one_main_api_syntax_two_outputs_and_two_latest_complete_deltas");
  const pins = new Map(manifest.inputs.map((row) => [row.path, row.sha256]));
  for (const entry of ["main-api"]) {
    const map = JSON.parse(readFileSync(first + "/dist/" + entry + ".mjs.map"));
    for (let i = 0; i < map.sources.length; i++) {
      const source = path.posix.normalize(
        "apps/yunipals-indexer/dist/" + map.sources[i]
      );
      assert.equal(digest(map.sourcesContent[i]), pins.get(source), source);
    }
  }
  checks.push(
    "every_embedded_source_map_content_equals_its_reviewed_inventory_input"
  );
  symlinkSync(
    path.join(root, "apps/yunipals-indexer/node_modules"),
    first + "/node_modules",
    "dir"
  );
  const importProbe = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import {pathToFileURL} from 'node:url';
    let network = 0;
    net.Socket.prototype.connect = function(){network++; throw Error('network_forbidden');};
    globalThis.fetch = async()=>{network++; throw Error('network_forbidden');};
    const root = process.argv[1];
    const {app} = await import(pathToFileURL(root+'/dist/main-api.mjs'));
    assert.equal(typeof app.fetch,'function');
    const response=await app.request('/v1/indexer/action-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,400);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await response.json(),{error:'invalid_action_evidence_request'});
    assert.equal(network,0);
    console.log(JSON.stringify({imports:true,networkCalls:network,businessQueries:0}));
  `;
  const imported = JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", importProbe, first],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: "/usr/bin:/bin",
          DATABASE_URL:
            "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
          DATABASE_SCHEMA: "synthetic_native",
          READ_DATABASE_SCHEMA: "synthetic_read_v4",
          OWNERSHIP_READ_MODE: "unified",
          OWNERSHIP_READ_SCHEMA: "synthetic_read_v4",
          OWNERSHIP_RELEASE_ID: "0x" + "1".repeat(64),
          YUNIPALS_PROJECTION_MODE: "generation",
          METADATA_SOURCE_MODE: "archive",
          BASE_METADATA_INGESTION: "native"
        }
      }
    )
  );
  assert.deepEqual(imported, {
    imports: true,
    networkCalls: 0,
    businessQueries: 0
  });
  checks.push(
    "actual_relocated_app_import_and_malformed_route_refusal_without_network_or_database"
  );
  const clone = path.join(temporary, "tree");
  mkdirSync(clone);
  const extra = [
    name,
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/api/booster-openapi.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/api/booster-routes.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/leaderboard/refresh.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/metadata/projection-refresh.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/packages/yunipals-market-core/src/boosters.ts",
    "ops/unified-indexer-transition/consumer-final-package-v1.RELEASE-MANIFEST.json",
    "ops/unified-indexer-transition/ypal-main-api-runtime-v1.manifest.json",
    "ops/unified-indexer-transition/marketplace-consumer-runtime-baseline-rpc-policy-v1.ts",
    "ops/unified-indexer-transition/nonmarket-consumer-runtime-baseline-rpc-preflight-v1.ts",
    "ops/unified-indexer-transition/ypal-generation-baseline-indexer-package-v1.json",
    "ops/unified-indexer-transition/ypal-generation-baseline-market-core-package-v1.json",
    "ops/unified-indexer-transition/ypal-generation-baseline-lock-v1.yaml"
  ];
  for (const file of new Set([
    ...manifest.inputs.map((r) => r.path),
    ...extra
  ])) {
    mkdirSync(path.dirname(path.join(clone, file)), { recursive: true });
    cpSync(path.join(root, file), path.join(clone, file));
  }
  for (const app of ["apps/yunipals-indexer", "apps/yunipals-market-api"])
    symlinkSync(
      path.join(root, app, "node_modules"),
      path.join(clone, app, "node_modules"),
      "dir"
    );
  symlinkSync(
    path.join(root, "node_modules"),
    path.join(clone, "node_modules"),
    "dir"
  );
  const relocated = path.join(temporary, "relocated");
  invoke(clone, relocated);
  assert.equal(
    digest(readFileSync(first + "/manifest.json")),
    digest(readFileSync(relocated + "/manifest.json"))
  );
  for (const item of manifest.files)
    assert(
      readFileSync(first + "/" + item.path).equals(
        readFileSync(relocated + "/" + item.path)
      )
    );
  checks.push(
    "fresh_relocated_build_reuses_dependencies_without_copy_or_install_and_is_byte_identical"
  );
  const changed = "packages/yunipals-indexer-client/src/readiness.ts";
  const original = readFileSync(path.join(clone, changed));
  writeFileSync(
    path.join(clone, changed),
    Buffer.concat([original, Buffer.from("\n// unreviewed\n")])
  );
  const refusal = spawnSync(
    process.execPath,
    [path.join(clone, name), "--out", path.join(temporary, "refuse")],
    { cwd: clone, encoding: "utf8", timeout: 30000 }
  );
  assert.equal(refusal.error, undefined);
  assert.notEqual(refusal.status, 0);
  assert(refusal.stderr.includes(changed));
  checks.push("changed_reviewed_source_refuses_without_publishing_output");
  console.log(
    JSON.stringify({
      passed: true,
      groups: checks.length,
      checks,
      productionQueries: 0,
      providerCalls: 0,
      dependencyInstalls: 0
    })
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

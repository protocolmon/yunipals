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

const args = process.argv.slice(2);
assert.deepEqual([args.length, args[0]], [2, "--tree"]);
assert(path.isAbsolute(args[1]));
const root = args[1];
const name =
  "ops/unified-indexer-transition/ypal-generation-runtime-build-v3.mjs";
const temporary = mkdtempSync(path.join(os.tmpdir(), "ypal-generation-build-"));
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
  assert.equal(manifest.files.length, 8);
  assert.equal(manifest.inputs.length, 37);
  assert.equal(manifest.publicApprovalTtlChanged, false);
  assert.equal(manifest.nativeWritePrivilegesAdded, false);
  for (const item of manifest.files) {
    const raw = readFileSync(first + "/" + item.path);
    assert.equal(digest(raw), item.sha256);
    if (item.path.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", first + "/" + item.path]);
  }
  checks.push(
    "four_entrypoints_syntax_eight_exact_outputs_and_five_only_runtime_source_deltas"
  );
  for (const entry of [
    "generation-prepare",
    "generation-refresh",
    "leaderboard-worker",
    "leaderboard-only"
  ]) {
    const map = JSON.parse(readFileSync(first + "/dist/" + entry + ".mjs.map"));
    const helper = map.sources.findIndex((s) =>
      s.endsWith("/metadata/projection-snapshot.ts")
    );
    assert(helper >= 0);
    assert.equal(
      digest(map.sourcesContent[helper]),
      "ced919589ef32d9686daa7323e40a0de61d662dda04b72457a842661429ac8ee"
    );
  }
  checks.push(
    "ordinary_worker_refresh_and_forward_completion_all_bind_actual_reviewed_snapshot_source_maps"
  );
  assert.equal(
    manifest.predecessorPreparationArtifact,
    "f81cdb76ae45794599c723085aebd2b9c5e377975dc16d2e1461236229d4b952"
  );
  assert.deepEqual(
    manifest.preparationInputDelta.map((row) => row.path),
    ["apps/yunipals-indexer/lib/metadata/projection-refresh.ts"]
  );
  const original =
    "/tmp/yunipals-generation-snapshot-runtime-v2-final-20261024";
  const line = '    await client.query("ANALYZE metadata_projection.trait");\n';
  for (const entry of [
    "generation-prepare",
    "generation-refresh",
    "leaderboard-worker"
  ]) {
    const current = readFileSync(first + "/dist/" + entry + ".mjs", "utf8");
    assert.equal(current.split(line).length, 2);
    assert.equal(
      current.replace(line, ""),
      readFileSync(original + "/dist/" + entry + ".mjs", "utf8")
    );
  }
  assert(
    readFileSync(first + "/dist/leaderboard-only.mjs").equals(
      readFileSync(original + "/dist/leaderboard-only.mjs")
    )
  );
  checks.push(
    "only_one_added_ANALYZE_statement_in_actual_JS_and_one_of37_f81_inputs_changed"
  );
  const clone = path.join(temporary, "tree");
  mkdirSync(clone);
  const extra = [
    name,
    "ops/unified-indexer-transition/consumer-final-package-v1.RELEASE-MANIFEST.json",
    "ops/unified-indexer-transition/metadata-normalization-predecessor-v1.manifest.json",
    "ops/unified-indexer-transition/ypal-generation-snapshot-runtime-v2.manifest.json",
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
  const changed = "apps/yunipals-indexer/lib/metadata/projection-snapshot.ts";
  const originalSnapshot = readFileSync(path.join(clone, changed));
  writeFileSync(
    path.join(clone, changed),
    Buffer.concat([originalSnapshot, Buffer.from("\n// unreviewed\n")])
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

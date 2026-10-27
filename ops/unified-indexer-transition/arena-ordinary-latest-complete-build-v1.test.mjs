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
import {
  PINS,
  pinned,
  ENTRIES,
  FACADE,
  SOURCE
} from "./arena-ordinary-latest-complete-build-v1.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const name =
  "ops/unified-indexer-transition/arena-ordinary-latest-complete-build-v1.mjs";
const temporary = mkdtempSync(
  path.join(os.tmpdir(), "arena-ordinary-readiness-")
);
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const checks = [];
const invoke = (tree, target) =>
  JSON.parse(
    execFileSync(process.execPath, [path.join(tree, name), "--out", target], {
      encoding: "utf8",
      timeout: 30000,
      cwd: tree
    })
  );
try {
  const first = path.join(temporary, "first");
  invoke(root, first);
  const manifest = JSON.parse(readFileSync(first + "/manifest.json"));
  assert.equal(manifest.predecessorSourceDigest, SOURCE);
  assert.equal(manifest.uniqueWorkerEntries, 7);
  assert.equal(manifest.nativeWorkerUnits, 8);
  assert.equal(manifest.files.length, 16);
  assert.equal(manifest.businessBodiesChanged, false);
  assert.equal(manifest.migrationsPerformed, 0);
  assert.equal(manifest.inputs.length, 92);
  assert.deepEqual(
    manifest.inputs
      .filter((row) => !row.newFacade && row.sha256 !== row.predecessorSha256)
      .map((row) => row.path)
      .sort(),
    [PINS.readiness[0], PINS.status[0]].sort()
  );
  assert.equal(
    manifest.inputs.find((row) => row.newFacade).sha256,
    sha(FACADE)
  );
  for (const row of manifest.files) {
    const raw = readFileSync(first + "/" + row.path);
    assert.equal(sha(raw), row.sha256);
    if (row.path.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", first + "/" + row.path]);
  }
  checks.push(
    "exact_264a_source_1796_reconstruction_seven_workers_facade_only_two_deltas"
  );
  const pins = new Map(
    manifest.inputs.map((row) => ["accepted264a:" + row.path, row.sha256])
  );
  for (const entry of [...Object.keys(ENTRIES), "arena-owner-reader"]) {
    const map = JSON.parse(readFileSync(first + "/dist/" + entry + ".mjs.map"));
    for (let i = 0; i < map.sources.length; i++)
      assert.equal(
        sha(map.sourcesContent[i]),
        pins.get(map.sources[i]),
        map.sources[i]
      );
  }
  checks.push(
    "all_embedded_source_map_contents_equal_accepted_source_inventory"
  );
  symlinkSync(
    path.join(root, "apps/yunipals-market-api/node_modules"),
    first + "/node_modules",
    "dir"
  );
  const probe = `import assert from 'node:assert/strict';import net from 'node:net';import{pathToFileURL}from'node:url';let calls=0;
  net.Socket.prototype.connect=function(){calls++;throw Error('network_forbidden')};globalThis.fetch=async()=>{calls++;throw Error('network_forbidden')};
  const m=await import(pathToFileURL(process.argv[1]+'/dist/arena-owner-reader.mjs'));
  for(const k of ['NativeArenaSource','verifyNativeArenaAction','adoptLegacyTournamentIdentity','ArenaSourceSwitch','arenaSourceSwitchVerifier','assertArenaSourceBinding'])assert.equal(typeof m[k],'function',k);
  assert.throws(()=>new m.NativeArenaSource({},'bad','bad',0n));
  const source=new m.NativeArenaSource({},'0x'+'a'.repeat(64),'0x'+'b'.repeat(40),10n);assert.equal(source.definition.startBlock,'10');
  assert.equal(calls,0);console.log(JSON.stringify({calls,exports:Object.keys(m).length}));`;
  assert.deepEqual(
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", probe, first],
        { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin" } }
      )
    ),
    { calls: 0, exports: 6 }
  );
  checks.push(
    "actual_business_facade_import_has_no_network_database_or_worker_activation"
  );
  const clone = path.join(temporary, "tree");
  mkdirSync(clone);
  const copy = (file) => {
    mkdirSync(path.dirname(path.join(clone, file)), { recursive: true });
    if (file === PINS.archive[0]) {
      writeFileSync(path.join(clone, file), pinned(root, PINS.archive));
    } else {
      cpSync(path.join(root, file), path.join(clone, file));
    }
  };
  const metadata = [
    name,
    ...Object.values(PINS).map(([name]) => name),
    "ops/unified-indexer-transition/ypal-generation-baseline-lock-v1.yaml"
  ];
  for (const file of new Set([
    ...metadata,
    ...manifest.inputs.filter((row) => !row.newFacade).map((row) => row.path)
  ]))
    copy(file);
  symlinkSync(
    path.join(root, "apps/yunipals-market-api/node_modules"),
    path.join(clone, "apps/yunipals-market-api/node_modules"),
    "dir"
  );
  const relocated = path.join(temporary, "relocated");
  invoke(clone, relocated);
  assert.ok(
    readFileSync(first + "/manifest.json").equals(
      readFileSync(relocated + "/manifest.json")
    )
  );
  for (const row of manifest.files)
    assert.ok(
      readFileSync(first + "/" + row.path).equals(
        readFileSync(relocated + "/" + row.path)
      )
    );
  checks.push(
    "relocated_repeat_build_byte_identical_without_install_or_new_dependencies"
  );
  // Accepted predecessor source comes from the pinned overlay, so unrelated
  // current worktree changes cannot silently enter an Arena worker.
  const previous = "apps/yunipals-market-api/src/arena/live/nativeSource.ts";
  writeFileSync(
    path.join(clone, previous),
    "throw Error('unreviewed current source');\n"
  );
  const ignored = path.join(temporary, "accepted-old");
  invoke(clone, ignored);
  assert.ok(
    readFileSync(first + "/manifest.json").equals(
      readFileSync(ignored + "/manifest.json")
    )
  );
  checks.push(
    "pinned_overlay_prevents_unrelated_current_business_source_leakage"
  );
  const changed = path.join(clone, PINS.readiness[0]);
  writeFileSync(
    changed,
    Buffer.concat([readFileSync(changed), Buffer.from("\n// changed\n")])
  );
  const refused = spawnSync(
    process.execPath,
    [path.join(clone, name), "--out", path.join(temporary, "refused")],
    { encoding: "utf8", timeout: 30000 }
  );
  assert.notEqual(refused.status, 0);
  assert.ok(refused.stderr.includes(PINS.readiness[0]));
  checks.push("changed_reviewed_readiness_refuses_before_artifact_publication");
  console.log(
    JSON.stringify({
      passed: true,
      groups: checks.length,
      checks,
      artifactDigest: manifest.artifactDigest,
      productionEffects: 0
    })
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

// Local public-source build only. No network, dependency install, DB or services.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workerSource, SCHEDULER_FILE } from "./ypal-native-metadata-approval-worker-v1.mjs";

export const FORMAT = "yunipals-native-metadata-approval-runtime-v1";
export const PREDECESSOR_DIGEST = "cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc";
export const PREDECESSOR_MANIFEST_SHA = "6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const schedulerPath = "ops/unified-indexer-transition/" + SCHEDULER_FILE;
const policyPath = "ops/unified-indexer-transition/ypal-native-metadata-approval-worker-v1.mjs";
const workerPath = "apps/yunipals-indexer/lib/metadata/archive-worker.ts";
const nativePath = "apps/yunipals-indexer/lib/metadata/native-base.ts";

export async function build({ predecessor, recoveryRoots, out }) {
  assert.equal(process.versions.node, "24.18.1", "Exact acknowledged Node compiler required");
  assert.ok(path.isAbsolute(predecessor) && path.isAbsolute(out) && !existsSync(out), "Fresh absolute output required");
  const priorRaw = readFileSync(path.join(predecessor, "manifest.json"));
  assert.equal(sha(priorRaw), PREDECESSOR_MANIFEST_SHA);
  const prior = JSON.parse(priorRaw);
  assert.equal(prior.artifactDigest, PREDECESSOR_DIGEST); assert.equal(prior.inputs.length, 84); assert.equal(prior.files.length, 6);
  assert.equal(sha(readFileSync(path.join(predecessor, "metafile.json"))), prior.metafileSha256);
  const sourceBytes = new Map();
  for (const file of prior.files) {
    const raw = readFileSync(path.join(predecessor, file.path)); assert.equal(raw.length, file.bytes); assert.equal(sha(raw), file.sha256);
    if (!file.path.endsWith(".map")) continue;
    const map = JSON.parse(raw);
    assert.equal(map.sources.length, map.sourcesContent.length);
    for (let index = 0; index < map.sources.length; index++) {
      const name = path.posix.normalize("apps/yunipals-indexer/dist/" + map.sources[index]);
      assert.ok(!name.startsWith("../") && !path.isAbsolute(name));
      const bytes = Buffer.from(map.sourcesContent[index]);
      if (sourceBytes.has(name)) assert.ok(sourceBytes.get(name).equals(bytes));
      sourceBytes.set(name, bytes);
    }
  }
  const materialized = mkdtempSync(path.join(os.tmpdir(), "ypal-native-approval-source-"));
  const inputs = [];
  for (const row of prior.inputs) {
    assert.ok(!path.isAbsolute(row.path) && !row.path.split("/").includes("..") && /\.(ts|cjs|json|yaml)$/.test(row.path));
    let bytes = sourceBytes.get(row.path);
    if (!bytes || sha(bytes) !== row.sha256) {
      bytes = undefined;
      for (const origin of [root, ...recoveryRoots]) {
        assert.ok(path.isAbsolute(origin));
        const candidate = path.join(origin, row.path);
        if (existsSync(candidate)) {
          const actual = readFileSync(candidate);
          if (sha(actual) === row.sha256) { bytes = actual; break; }
        }
      }
    }
    assert.ok(bytes && sha(bytes) === row.sha256 && bytes.length === row.bytes, "Exact predecessor public input required: " + row.path);
    const destination = path.join(materialized, row.path); mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes, { flag: "wx", mode: 0o644 });
    inputs.push({ path: row.path, bytes: bytes.length, sha256: sha(bytes), predecessorSha256: row.sha256 });
  }
  assert.equal(inputs.find((row) => row.path === nativePath).sha256, "710b77ba8035679ed74eceffd2d4e78a39b343d05613d19c7d446a388b2e8441");
  const require = createRequire(path.join(root, "apps/yunipals-market-api/package.json"));
  const compiler = require("esbuild"); assert.equal(compiler.version, prior.compiler.esbuild);
  assert.equal(sha(readFileSync(process.execPath)), prior.compiler.nodeSha256);
  const compilerRequire = createRequire(require.resolve("esbuild/package.json"));
  const compilerPaths = [require.resolve("esbuild/lib/main.js"), require.resolve("esbuild/package.json"), compilerRequire.resolve("@esbuild/linux-x64/bin/esbuild")];
  const compilerFiles = compilerPaths.map((name) => ({ role: name.endsWith("bin/esbuild") ? "native" : name.endsWith("package.json") ? "package" : "javascript", bytes: readFileSync(name).length, sha256: sha(readFileSync(name)) }));
  assert.deepEqual(compilerFiles, prior.compiler.files);
  const packages = new Set(["yunipals-indexer-server", "yunipals-indexer-client", "yunipals-market-core"]);
  const workspace = { name: "exact-predecessor-workspace", setup(builder) {
    builder.onResolve({ filter: /^@protopals\// }, (request) => {
      const [scope, name, ...rest] = request.path.split("/"); assert.equal(scope, "@protopals"); assert.ok(packages.has(name));
      const directory = path.join(materialized, "packages", name), pkg = JSON.parse(readFileSync(path.join(directory, "package.json")));
      const target = pkg.exports[rest.length ? "./" + rest.join("/") : "."]; assert.equal(typeof target, "string");
      const result = path.resolve(directory, target); assert.ok(result.startsWith(directory + path.sep)); return { path: result };
    });
  } };
  const configuration = prior.configuration, app = path.join(materialized, "apps/yunipals-indexer");
  const baseline = await compiler.build({ ...configuration, absWorkingDir: app, plugins: [workspace] });
  for (const file of baseline.outputFiles) assert.equal(sha(file.contents), prior.files.find((row) => row.path === "dist/" + path.basename(file.path)).sha256, "Exact six-file predecessor reproduction required");
  const scheduler = readFileSync(path.join(root, schedulerPath));
  const schedulerDestination = path.join(materialized, schedulerPath); mkdirSync(path.dirname(schedulerDestination), { recursive: true }); writeFileSync(schedulerDestination, scheduler, { flag: "wx", mode: 0o644 });
  const policy = readFileSync(path.join(root, policyPath));
  const transformed = workerSource(readFileSync(path.join(materialized, workerPath)), "../../../../" + schedulerPath);
  const patch = { name: "single-flight-native-approval-only", setup(builder) {
    builder.onLoad({ filter: /[/\\]lib[/\\]metadata[/\\]archive-worker\.ts$/ }, (request) => {
      assert.equal(path.resolve(request.path), path.join(materialized, workerPath));
      return { contents: transformed, loader: "ts" };
    });
  } };
  const first = await compiler.build({ ...configuration, absWorkingDir: app, plugins: [workspace, patch] });
  const second = await compiler.build({ ...configuration, absWorkingDir: app, plugins: [workspace, patch] });
  assert.deepEqual(first.metafile, second.metafile);
  const files = first.outputFiles.map((file, index) => {
    assert.equal(file.path, second.outputFiles[index].path); assert.ok(Buffer.from(file.contents).equals(Buffer.from(second.outputFiles[index].contents)));
    return { path: "dist/" + path.basename(file.path), bytes: file.contents.length, sha256: sha(file.contents) };
  });
  assert.equal(files.length, 6);
  const changedOutputs = files.filter((file) => file.sha256 !== prior.files.find((row) => row.path === file.path).sha256).map((row) => row.path).sort();
  assert.deepEqual(changedOutputs, ["dist/metadata-worker.mjs", "dist/metadata-worker.mjs.map"]);
  const sourcePaths = Object.keys(first.metafile.inputs).map((name) => path.relative(materialized, path.resolve(app, name))).sort();
  assert.ok(sourcePaths.includes(schedulerPath));
  assert.ok(sourcePaths.every((name) => name === schedulerPath || inputs.some((row) => row.path === name)));
  for (const row of inputs) assert.equal(sha(readFileSync(path.join(materialized, row.path))), row.sha256);
  const binding = {
    format: FORMAT, scope: "same_worker_single_flight_native_approval_scheduling_only",
    predecessorArtifactDigest: PREDECESSOR_DIGEST, predecessorManifestSha256: PREDECESSOR_MANIFEST_SHA,
    predecessorSixOutputsReproduced: true, predecessorInputsByteIdentical: true,
    inputs: [...inputs, { path: schedulerPath, bytes: scheduler.length, sha256: sha(scheduler), predecessorSha256: null }],
    inputTransform: { path: workerPath, predecessorSha256: inputs.find((row) => row.path === workerPath).sha256, compiledSha256: sha(transformed),
      policyFile: policyPath, policySha256: sha(policy) },
    compiler: prior.compiler, configuration, changedOutputs, files,
    metafileSha256: sha(encoded(first.metafile)), builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    quietApprovalCheckSeconds: 60, approvalValiditySeconds: 90, sameWorkerAndPool: true, additionalIngestors: 0,
    commandMapping: prior.commandMapping, externalImports: prior.externalImports,
    requiredWorkingDirectory: prior.requiredWorkingDirectory, requiredRuntimeDependencyTarget: prior.requiredRuntimeDependencyTarget,
    installationRequiresAcknowledgedPredecessorRuntimeVerification: true, runtimeDependencyTargetVerifiedHere: false,
    repeatedBuildByteIdentical: true, nodeModulesInstalled: false, databaseWrites: 0, serviceActions: 0, providerCalls: 0,
    runtimeCadenceQualified: false, newMetadataEpochRequired: true
  };
  const digest = sha(encoded(binding)), manifest = { ...binding, artifactDigest: digest };
  mkdirSync(out, { mode: 0o755 }); mkdirSync(path.join(out, "dist"), { mode: 0o755 });
  for (const file of first.outputFiles) writeFileSync(path.join(out, "dist", path.basename(file.path)), file.contents, { flag: "wx", mode: 0o644 });
  writeFileSync(path.join(out, "manifest.json"), encoded(manifest), { flag: "wx", mode: 0o644 });
  writeFileSync(path.join(out, "metafile.json"), encoded(first.metafile), { flag: "wx", mode: 0o644 });
  return { artifactDigest: digest, manifestSha256: sha(encoded(manifest)), inputs: binding.inputs.length, outputFiles: files.length,
    changedOutputs, runtimeCadenceQualified: false, newMetadataEpochRequired: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = { recoveryRoots: [] };
  if (!args.length) console.log(JSON.stringify({ format: FORMAT + "-builder", staticOnly: true, databaseWrites: 0, serviceActions: 0, providerCalls: 0 }));
  else {
    assert.equal(args.length % 2, 0);
    for (let index = 0; index < args.length; index += 2) {
      const [key, value] = args.slice(index, index + 2); assert.ok(["--predecessor", "--recovery-root", "--out"].includes(key));
      if (key === "--recovery-root") options.recoveryRoots.push(value);
      else { const name = key.slice(2); assert.equal(options[name], undefined); options[name] = value; }
    }
    console.log(JSON.stringify(await build(options)));
  }
}

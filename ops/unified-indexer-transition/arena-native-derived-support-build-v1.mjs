// Offline build: accepted Arena bodies plus an explicit native-event projector.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acceptedSources, SOURCE } from "./arena-ordinary-latest-complete-build-v1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HERE = "ops/unified-indexer-transition/";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
export const ORIGINAL_BUILDER_SHA = "011ba9d3a3769024b8cee3c321aae263c8c0a023c417f286a2a5011693710e88";
export const PUBLIC_HELPER_SHA = "f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2";
export const FACADE = [
  'export { NativeArenaSource, nativeTournamentState } from "./nativeSource.ts";',
  'export { ArenaRollbackSource, arenaRollbackSourceId } from "./rollbackSource.ts";',
  'export { ArenaSourceSwitch, arenaSourceSwitchVerifier } from "./sourceSwitch.ts";',
  'export { projectEvent } from "./projection.ts";',
  'export { createIndexerReader } from "@protopals/yunipals-indexer-server/readers";',
  'export { readBoundRuntime } from "../../../../../packages/yunipals-indexer-server/src/releases.ts";',
  'export { sqlIdentifier } from "@protopals/yunipals-indexer-server/database";',
  'export { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";',
  'export { publicOnlyPool, targetCatalog } from "./nativeDerivedPublicOnly.ts";',
  'export { sharedReadPool, serveNativeReadPool, nativeReadPoolClient, publicReadPoolClient, serviceRuntimeEpoch } from "./nativeReadPool.ts";'
].join("\n") + "\n";

export function publicHelpers(raw) {
  assert.equal(sha(raw), PUBLIC_HELPER_SHA);
  const text = raw.toString("utf8");
  const one = (begin, end) => {
    assert.equal(text.split(begin).length, 2);
    assert.equal(text.split(end).length, 2);
    const start = text.indexOf(begin), stop = text.indexOf(end, start);
    assert.ok(stop > start);
    return text.slice(start, stop);
  };
  return [
    'export function need(value, code) { if (!value) throw new Error(code); }',
    one('export const PUBLIC_TABLES = ', '\n/** The official projector'),
    one('export function publicOnlyPool(', '\nexport function readonly('),
    one('export async function targetCatalog(', '\nexport async function inspect(')
  ].join("\n");
}

export async function buildArtifact(tree = root) {
  assert.equal(process.versions.node, "24.18.1");
  assert.equal(sha(readFileSync(path.join(tree, HERE + "arena-ordinary-latest-complete-build-v1.mjs"))), ORIGINAL_BUILDER_SHA);
  const accepted = acceptedSources(tree), app = "apps/yunipals-market-api";
  const require = createRequire(path.join(tree, app, "package.json"));
  const compiler = require("esbuild"); assert.equal(compiler.version, "0.25.12");
  const declarations = JSON.parse(accepted.source(app + "/package.json"));
  const external = Object.keys(declarations.dependencies).filter((name) => !name.startsWith("@protopals/"));
  const workspace = new Map(["market-core", "indexer-client", "indexer-server"].map((name) => {
    const location = "packages/yunipals-" + name;
    return ["@protopals/yunipals-" + name, { location, exports: JSON.parse(accepted.source(location + "/package.json")).exports }];
  }));
  const facade = app + "/src/arena/live/nativeDerivedSupport.ts";
  const publicFacade = app + "/src/arena/live/nativeDerivedPublicOnly.ts";
  const helperRaw = readFileSync(path.join(tree, HERE + "arena-modern-public-rollback-v1.mjs"));
  const poolName=HERE+'arena-native-read-pool-v1.mjs',poolRaw=readFileSync(path.join(tree,poolName));
  const extra = new Map([[facade, Buffer.from(FACADE)], [publicFacade, Buffer.from(publicHelpers(helperRaw))],
    [app+'/src/arena/live/nativeReadPool.ts',poolRaw]]);
  const used = new Map();
  const extension = (name) => {
    for (const candidate of [name, name.replace(/\.js$/, ".ts"), name + ".ts", name + ".json", name + "/index.ts"])
      if (extra.has(candidate) || accepted.inventory.has(candidate)) return candidate;
    throw Error("Unaccepted support import: " + name);
  };
  const plugin = { name: "actual-accepted-Arena-native-derived-support", setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      let name;
      if (args.kind === "entry-point") name = path.posix.normalize(args.path);
      else if (args.path.startsWith("node:") || external.some((key) => args.path === key || args.path.startsWith(key + "/")))
        return { path: args.path, external: true };
      else if (args.path.startsWith("@/")) name = app + "/src/" + args.path.slice(2);
      else if (args.path.startsWith(".")) name = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
      else {
        const item = [...workspace].find(([key]) => args.path.startsWith(key + "/"));
        assert.ok(item, "Undeclared support dependency");
        const [key, value] = item, target = value.exports["." + args.path.slice(key.length)];
        assert.equal(typeof target, "string"); name = path.posix.join(value.location, target);
      }
      return { path: extension(name), namespace: "accepted-native-support" };
    });
    build.onLoad({ filter: /.*/, namespace: "accepted-native-support" }, (args) => {
      const raw = extra.get(args.path) ?? accepted.source(args.path);
      used.set(args.path, raw);
      return { contents: raw.toString("utf8"), loader: args.path.endsWith(".json") ? "json" : "ts" };
    });
  }};
  const configuration = { entryPoints: { "arena-inverse-support": facade }, absWorkingDir: tree, outdir: "dist",
    outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", target: "node24",
    external, sourcemap: true, metafile: true, write: false };
  const first = await compiler.build({ ...configuration, plugins: [plugin] }), firstUsed = new Map(used);
  used.clear();
  const second = await compiler.build({ ...configuration, plugins: [plugin] });
  assert.deepEqual(used, firstUsed); assert.deepEqual(first.metafile, second.metafile);
  const outputs = Object.fromEntries(first.outputFiles.map((row, index) => {
    assert.equal(row.path, second.outputFiles[index].path);
    assert.ok(Buffer.from(row.contents).equals(Buffer.from(second.outputFiles[index].contents)));
    return ["dist/" + path.basename(row.path), Buffer.from(row.contents)];
  }));
  const projectorName = HERE + "arena-native-derived-projector-v1.mjs";
  outputs["dist/arena-native-derived-projector-v1.mjs"] = readFileSync(path.join(tree, projectorName));
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", app + "/package.json", app + "/tsconfig.json",
    ...[...workspace.values()].map((row) => row.location + "/package.json")]) firstUsed.set(name, accepted.source(name));
  firstUsed.set(HERE + "arena-modern-public-rollback-v1.mjs", helperRaw);
  firstUsed.set(projectorName, outputs["dist/arena-native-derived-projector-v1.mjs"]);
  firstUsed.set(poolName,poolRaw);
  const inputs = [...firstUsed].sort(([a], [b]) => a.localeCompare(b)).map(([name, raw]) => ({
    path: name, bytes: raw.length, sha256: sha(raw), acceptedSha256: accepted.inventory.get(name)?.sha256 ?? null,
    newSupport: extra.has(name) || name.startsWith(HERE)
  }));
  const manifest = { format: "yunipals-arena-native-derived-support-artifact-v1", builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    acceptedArenaSourceDigest: SOURCE, acceptedReadinessArtifact: "e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234",
    sourceOrigin: "accepted_native_canonical_event_latest_complete", historicalDepth3ScannerSuccessClaimed: false,
    facade: "dist/arena-inverse-support.mjs", projector: "dist/arena-native-derived-projector-v1.mjs", inputs,
    files: Object.entries(outputs).map(([name, raw]) => ({ path: name, bytes: raw.length, sha256: sha(raw) })),
    nodeVersion: process.versions.node, dependencyDeclarations: declarations.dependencies, dependencyRuntimeSource: SOURCE,
    officialReducerBodyChanged: false, privateStatementsSuppressed: 2, databaseWrites: 0, providerCalls: 0, servicesChanged: 0 };
  manifest.artifactDigest = sha(encoded(manifest));
  return { manifest, outputs };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (!args.length) console.log(JSON.stringify({ staticOnly: true, databaseWrites: 0, providerCalls: 0, servicesChanged: 0 }));
  else {
    assert.equal(args.length, 2); assert.equal(args[0], "--out"); assert.ok(path.isAbsolute(args[1]) && !existsSync(args[1]));
    const { manifest, outputs } = await buildArtifact(); mkdirSync(args[1]); mkdirSync(path.join(args[1], "dist"));
    for (const [name, raw] of Object.entries(outputs)) writeFileSync(path.join(args[1], name), raw, { flag: "wx", mode: 0o644 });
    writeFileSync(path.join(args[1], "manifest.json"), encoded(manifest), { flag: "wx", mode: 0o644 });
    console.log(JSON.stringify({ artifactDigest: manifest.artifactDigest, manifestSha256: sha(encoded(manifest)), files: manifest.files.length, inputs: manifest.inputs.length }));
  }
}

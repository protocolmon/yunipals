// Rebuild the accepted Arena workers and owner-reader facade with exactly the
// two reviewed latest-complete readiness changes. No installs or live effects.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
export const SOURCE =
  "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";
export const PINS = {
  base: [
    "ops/arena-consumer-release-review/rendered-v1/RELEASE-MANIFEST.json",
    "1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8"
  ],
  overlay: [
    "docs/unified-indexer/arena-live-compat-build-overlay-manifest-2026-10-22.json",
    "a7ec13c29a7af5f37390fffabd27ce7c1b9aa8f8bb1b254f8fafe32123b13393"
  ],
  archive: [
    "docs/unified-indexer/source-publication-2026-10-22/arena-live-compat-build-overlay.tar.gz",
    "4975231a4a19ebbb32490a255e1e9f532f3593cb422b5fed1371922829d2505b"
  ],
  readiness: [
    "packages/yunipals-indexer-client/src/readiness.ts",
    "06b4f87fa9d1446b32d157d215ab45701152552b1b730d84561f8bce244b6aab"
  ],
  status: [
    "packages/yunipals-indexer-server/src/status.ts",
    "e3a46cc4add4678d73723ec3d885d825ae4a95bc93d47506c80832bb6d5d460d"
  ]
};
export const ENTRIES = {
  "arena-server": "server",
  "arena-native-disclosure": "nativeDisclosureWorker",
  "arena-native-client": "nativeClientWorker",
  "arena-native-referee": "nativeRefereeWorker",
  "arena-native-media": "nativeMediaWorker",
  "arena-native-execution": "nativeExecutionWorker",
  "arena-capacity": "capacityWorker"
};
export const FACADE =
  [
    'export { NativeArenaSource } from "./nativeSource.ts";',
    'export { verifyNativeArenaAction } from "./nativeAction.ts";',
    'export { adoptLegacyTournamentIdentity } from "./tournamentIdentity.ts";',
    'export { ArenaSourceSwitch, arenaSourceSwitchVerifier } from "./sourceSwitch.ts";',
    'export { assertArenaSourceBinding } from "./sourceSelection.ts";'
  ].join("\n") + "\n";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const safe = (name) => {
  assert.ok(
    typeof name === "string" &&
      name.length < 500 &&
      !name.includes("\\") &&
      !path.posix.isAbsolute(name) &&
      path.posix.normalize(name) === name &&
      !name.split("/").some((part) => ["", ".", ".."].includes(part)),
    "Exact relative source path required"
  );
  return name;
};
// Archived source remains reproducible from its immutable public Git revision.
// Keep the ordinary checkout free of duplicated compressed source trees.
export function pinned(tree, [name, digest]) {
  const file = path.join(tree, name);
  const raw =
    name === PINS.archive[0] && !existsSync(file)
      ? execFileSync(
          "git",
          ["show", `78ba19fb3325678e4c21aa20b7c5fb5d905eda59:${name}`],
          {
            cwd: tree,
            maxBuffer: 16_000_000
          }
        )
      : readFileSync(file);
  assert.equal(sha(raw), digest, name);
  return raw;
}

// The pinned public tar contains regular files and local PAX mtime/path headers
// only. Parse in memory; never extract a path, symlink or executable archive.
export function archiveFiles(raw) {
  const bytes = gunzipSync(raw, { maxOutputLength: 16000000 });
  const files = new Map();
  let offset = 0,
    pax = null;
  const text = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  const octal = (b) => {
    const v = text(b).trim();
    assert.match(v, /^[0-7]*$/);
    return Number.parseInt(v || "0", 8);
  };
  while (bytes.subarray(offset, offset + 512).some((b) => b !== 0)) {
    const header = bytes.subarray(offset, offset + 512);
    assert.equal(header.length, 512);
    const checksum = [...header].reduce(
      (n, b, i) => n + (i >= 148 && i < 156 ? 32 : b),
      0
    );
    assert.equal(checksum, octal(header.subarray(148, 156)));
    const size = octal(header.subarray(124, 136));
    assert.ok(size <= 4000000 && offset + 512 + size <= bytes.length);
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    const type = text(header.subarray(156, 157));
    if (type === "x") {
      assert.equal(pax, null);
      pax = {};
      for (let i = 0; i < body.length; ) {
        const space = body.indexOf(32, i),
          count = Number(body.subarray(i, space));
        assert.ok(
          space > i &&
            Number.isSafeInteger(count) &&
            count > 0 &&
            i + count <= body.length
        );
        const line = body.subarray(space + 1, i + count).toString("utf8");
        assert.ok(line.endsWith("\n"));
        const equal = line.indexOf("="),
          key = line.slice(0, equal);
        assert.ok(["mtime", "path"].includes(key) && !(key in pax));
        pax[key] = line.slice(equal + 1, -1);
        i += count;
      }
    } else {
      assert.equal(type, "0");
      const prefix = text(header.subarray(345, 500));
      const name = safe(
        pax?.path ??
          [prefix, text(header.subarray(0, 100))].filter(Boolean).join("/")
      );
      assert.equal(files.has(name), false, "Duplicate archive source");
      assert.equal(octal(header.subarray(100, 108)), 0o644);
      files.set(name, Buffer.from(body));
      pax = null;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(pax, null);
  assert.ok(bytes.subarray(offset).every((b) => b === 0));
  assert.equal(files.size, 1294);
  return files;
}

export function acceptedSources(tree = root) {
  const base = JSON.parse(pinned(tree, PINS.base));
  const overlayBytes = pinned(tree, PINS.overlay),
    overlay = JSON.parse(overlayBytes);
  const archive = archiveFiles(pinned(tree, PINS.archive));
  assert.ok(
    archive.get("arena-live-compat-overlay-manifest.json").equals(overlayBytes)
  );
  archive.delete("arena-live-compat-overlay-manifest.json");
  assert.equal(base.files.length, 1746);
  assert.equal(overlay.files.length, 1293);
  assert.equal(sha(encoded(base.files)), base.sourceDigest);
  const patches = new Map(
    overlay.files.map((row) => {
      const name = safe(row.path),
        raw = archive.get(name);
      assert.ok(
        raw &&
          raw.length === row.bytes &&
          sha(raw) === row.sha256 &&
          row.mode === 0o644,
        name
      );
      return [name, raw];
    })
  );
  assert.equal(patches.size, archive.size);
  const seen = new Set(),
    rows = base.files.map((row) => {
      const name = safe(row.path);
      assert.equal(seen.has(name), false);
      seen.add(name);
      const raw = patches.get(name);
      return raw ? { path: name, bytes: raw.length, sha256: sha(raw) } : row;
    });
  for (const name of [...patches.keys()]
    .filter((name) => !seen.has(name))
    .sort()) {
    const raw = patches.get(name);
    rows.push({ path: name, bytes: raw.length, sha256: sha(raw) });
  }
  assert.equal(rows.length, 1796);
  assert.equal(sha(encoded(rows)), SOURCE);
  const manifest = { ...base, files: rows, sourceDigest: SOURCE };
  assert.equal(
    sha(encoded(manifest)),
    "fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e"
  );
  const inventory = new Map(rows.map((row) => [row.path, row]));
  const changes = new Map(
    [PINS.readiness, PINS.status].map((entry) => [
      entry[0],
      pinned(tree, entry)
    ])
  );
  function source(name) {
    safe(name);
    const row = inventory.get(name);
    assert.ok(row, "Unaccepted source: " + name);
    const baseline =
      name === "pnpm-lock.yaml"
        ? "ops/unified-indexer-transition/ypal-generation-baseline-lock-v1.yaml"
        : name;
    const raw =
      changes.get(name) ??
      patches.get(name) ??
      readFileSync(path.join(tree, baseline));
    assert.equal(
      sha(raw),
      changes.has(name)
        ? PINS[name === PINS.readiness[0] ? "readiness" : "status"][1]
        : row.sha256,
      name
    );
    return raw;
  }
  return { inventory, source, changes };
}

export async function buildArtifact(tree = root) {
  assert.equal(process.versions.node, "24.18.1");
  const accepted = acceptedSources(tree),
    app = "apps/yunipals-market-api";
  const require = createRequire(path.join(tree, app, "package.json"));
  const compiler = require("esbuild");
  assert.equal(compiler.version, "0.25.12");
  const declarations = JSON.parse(accepted.source(app + "/package.json"));
  const external = Object.keys(declarations.dependencies).filter(
    (name) => !name.startsWith("@protopals/")
  );
  const workspace = new Map(
    ["market-core", "indexer-client", "indexer-server"].map((name) => {
      const location = "packages/yunipals-" + name;
      return [
        "@protopals/yunipals-" + name,
        {
          location,
          exports: JSON.parse(accepted.source(location + "/package.json"))
            .exports
        }
      ];
    })
  );
  const used = new Map();
  const extension = (name) => {
    for (const candidate of [
      name,
      name.replace(/\.js$/, ".ts"),
      name + ".ts",
      name + ".json",
      name + "/index.ts"
    ])
      if (accepted.inventory.has(candidate)) return candidate;
    throw Error("Unaccepted import: " + name);
  };
  const facadeName = app + "/src/arena/live/ordinaryLatestCompleteFacade.ts";
  const plugin = {
    name: "exact-accepted-Arena-plus-two-readiness-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        let name;
        if (args.kind === "entry-point") name = path.posix.normalize(args.path);
        else if (
          args.path.startsWith("node:") ||
          external.some(
            (name) => args.path === name || args.path.startsWith(name + "/")
          )
        )
          return { path: args.path, external: true };
        else if (args.path.startsWith("@/")) {
          const config = JSON.parse(accepted.source(app + "/tsconfig.json"));
          assert.deepEqual(config.compilerOptions.paths["@/*"], ["./src/*"]);
          name = app + "/src/" + args.path.slice(2);
        } else if (args.path.startsWith("."))
          name = path.posix.normalize(
            path.posix.join(path.posix.dirname(args.importer), args.path)
          );
        else {
          const pkg = [...workspace].find(([name]) =>
            args.path.startsWith(name + "/")
          );
          assert.ok(pkg, "Undeclared external dependency: " + args.path);
          const [key, value] = pkg,
            target = value.exports["." + args.path.slice(key.length)];
          assert.equal(typeof target, "string");
          name = path.posix.join(value.location, target);
        }
        return {
          path: name === facadeName ? name : extension(name),
          namespace: "accepted264a"
        };
      });
      build.onLoad({ filter: /.*/, namespace: "accepted264a" }, (args) => {
        const raw =
          args.path === facadeName
            ? Buffer.from(FACADE)
            : accepted.source(args.path);
        used.set(args.path, raw);
        return {
          contents: raw.toString("utf8"),
          loader: args.path.endsWith(".json") ? "json" : "ts"
        };
      });
    }
  };
  const configuration = {
    entryPoints: Object.fromEntries([
      ...Object.entries(ENTRIES).map(([name, file]) => [
        name,
        app + "/src/arena/live/" + file + ".ts"
      ]),
      ["arena-owner-reader", facadeName]
    ]),
    absWorkingDir: tree,
    outdir: "dist",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external,
    sourcemap: true,
    metafile: true,
    write: false
  };
  const first = await compiler.build({ ...configuration, plugins: [plugin] });
  const firstUsed = new Map(used);
  used.clear();
  const second = await compiler.build({ ...configuration, plugins: [plugin] });
  assert.deepEqual(used, firstUsed);
  assert.deepEqual(first.metafile, second.metafile);
  assert.equal(first.outputFiles.length, 16);
  const files = first.outputFiles.map((row, i) => {
    assert.equal(row.path, second.outputFiles[i].path);
    assert.ok(
      Buffer.from(row.contents).equals(
        Buffer.from(second.outputFiles[i].contents)
      )
    );
    return {
      path: "dist/" + path.basename(row.path),
      bytes: row.contents.length,
      sha256: sha(row.contents)
    };
  });
  const metadata = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    app + "/package.json",
    app + "/tsconfig.json",
    app + "/scripts/build.mjs",
    ...[...workspace.values()].map((v) => v.location + "/package.json")
  ];
  for (const name of metadata) firstUsed.set(name, accepted.source(name));
  const inputs = [...firstUsed]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, raw]) => ({
      path: name,
      bytes: raw.length,
      sha256: sha(raw),
      predecessorSha256: accepted.inventory.get(name)?.sha256 ?? null,
      newFacade: name === facadeName
    }));
  const deltas = inputs.filter(
    (row) => row.predecessorSha256 !== row.sha256 && !row.newFacade
  );
  assert.deepEqual(
    deltas.map((row) => row.path).sort(),
    [PINS.readiness[0], PINS.status[0]].sort()
  );
  const compilerRequire = createRequire(
    require.resolve("esbuild/package.json")
  );
  const compilerFiles = [
    require.resolve("esbuild/lib/main.js"),
    require.resolve("esbuild/package.json"),
    compilerRequire.resolve("@esbuild/linux-x64/bin/esbuild")
  ].map((file) => ({
    role: file.endsWith("bin/esbuild")
      ? "native"
      : file.endsWith("package.json")
        ? "package"
        : "javascript",
    bytes: readFileSync(file).length,
    sha256: sha(readFileSync(file))
  }));
  const outputs = Object.fromEntries(
    first.outputFiles.map((row) => [
      "dist/" + path.basename(row.path),
      Buffer.from(row.contents)
    ])
  );
  const manifest = {
    format: "yunipals-arena-ordinary-latest-complete-artifact-v1",
    builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    predecessorSourceDigest: SOURCE,
    predecessorSourceManifestSha256:
      "fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e",
    scope: "eight_Arena_workers_and_owner_reader_latest_complete_only",
    uniqueWorkerEntries: 7,
    nativeWorkerUnits: 8,
    ownerReaderFacade: "dist/arena-owner-reader.mjs",
    inputs,
    files,
    compilerFiles,
    nodeVersion: process.versions.node,
    buildConfiguration: configuration,
    dependencyDeclarations: declarations.dependencies,
    dependencyRuntimeSource: SOURCE,
    businessBodiesChanged: false,
    contractsChanged: false,
    migrationsPerformed: 0,
    databaseWrites: 0,
    providerCalls: 0,
    servicesChanged: 0
  };
  delete manifest.buildConfiguration.absWorkingDir;
  manifest.artifactDigest = sha(encoded(manifest));
  return { manifest, outputs };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  assert.ok(
    path.isAbsolute(args[1]) && !existsSync(args[1]),
    "Fresh absolute artifact output required"
  );
  const { manifest, outputs } = await buildArtifact();
  mkdirSync(args[1]);
  mkdirSync(path.join(args[1], "dist"));
  for (const [name, raw] of Object.entries(outputs))
    writeFileSync(path.join(args[1], name), raw, { flag: "wx", mode: 0o644 });
  writeFileSync(path.join(args[1], "manifest.json"), encoded(manifest), {
    flag: "wx",
    mode: 0o644
  });
  console.log(
    JSON.stringify({
      artifactDigest: manifest.artifactDigest,
      manifestSha256: sha(encoded(manifest)),
      files: manifest.files.length,
      inputs: manifest.inputs.length,
      productionEffects: 0
    })
  );
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const root = path.resolve(project, "../..");
const require = createRequire(path.join(project, "package.json"));
const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild");
const profiles = {
  "main-api": "lib/api/server.ts",
  "collector-api": "lib/api/collector-server.ts",
  "islands-api": "lib/api/islands-server.ts",
  "portal-api": "scripts/portal-api.ts",
  "portal-worker": "scripts/portal-worker.ts",
  "versions-audit": "scripts/audit-base-initial-owners.ts",
  "versions-solana": "scripts/extend-monster-versions-solana.ts",
  "versions-import": "scripts/import-monster-versions.ts",
  "read-cache": "lib/metadata/read-cache-worker.ts",
  "metadata-worker": "lib/metadata/worker.ts",
  "verify-islands": "scripts/verify-islands.ts",
  "islands-metadata": "lib/islands/worker.ts",
  "shared-observer": "scripts/shared-indexer-observer.ts",
  "shared-parity": "scripts/verify-shared-indexer.ts",
  "shared-receipts": "scripts/unified-control.ts",
  "shared-qualify": "scripts/qualify-shared-indexer.ts",
  "projection-capacity": "scripts/check-projection-capacity.ts",
  "projection-prepare": "scripts/prepare-native-generation.ts",
  "projection-publish": "scripts/publish-native-generation.ts",
  "read-cache-prepare": "scripts/prepare-native-read-cache.ts",
  "read-cache-schema": "scripts/migrate-read-cache.ts",
  leaderboard: "lib/leaderboard/worker.ts",
  "native-base-metadata": "scripts/unified-base-metadata.ts"
};
const args = process.argv.slice(2);
assert(
  args.length === 4 &&
    args[0] === "--worker" &&
    Object.hasOwn(profiles, args[1]) &&
    args[2] === "--outdir" &&
    args[3],
  "Usage: build-application-worker.mjs --worker WORKER_PROFILE --outdir FRESH_DIRECTORY"
);
assert(Number(process.versions.node.split(".")[0]) >= 24, "Node 24 required");
const profile = args[1];
const output = path.resolve(args[3]);
assert(!existsSync(output), "Fresh output directory required");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const packageRaw = readFileSync(path.join(project, "package.json"));
const { dependencies } = JSON.parse(packageRaw);
// Workspace source must be bundled so artifacts do not depend on whichever
// workspace checkout happens to supply the installed third-party packages.
const externalPackages = Object.keys(dependencies)
  .filter((name) => !dependencies[name].startsWith("workspace:"))
  .sort();
const filename = "dist/" + profile + ".mjs";
const result = await compiler.build({
  absWorkingDir: project,
  entryPoints: [profiles[profile]],
  outfile: filename,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: externalPackages,
  banner: {
    js: 'import { createRequire as __runtimeCreateRequire } from "node:module"; const require = __runtimeCreateRequire(import.meta.url);'
  },
  legalComments: "none",
  metafile: true,
  write: false,
  logLevel: "warning"
});
assert.equal(result.outputFiles.length, 1);
const inputs = Object.keys(result.metafile.inputs).map((name) => {
  const absolute = path.resolve(project, name);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  assert(!relative.startsWith("../") && !path.isAbsolute(relative));
  const raw = readFileSync(absolute);
  return { path: relative, bytes: raw.length, sha256: sha(raw) };
});
inputs.push({
  path: "apps/yunipals-indexer/package.json",
  bytes: packageRaw.length,
  sha256: sha(packageRaw)
});
inputs.sort((a, b) => a.path.localeCompare(b.path));
const raw = result.outputFiles[0].contents;
// Bundling moves import.meta.url to dist/. Keep the slab renderer's pinned
// fonts beside the bundle so publication never depends on host system fonts.
const assets = inputs.some((input) =>
  input.path.endsWith("/lib/portals/slab.ts")
)
  ? ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "LICENSE.txt"].map((name) => {
      const source = "apps/yunipals-indexer/lib/portals/fonts/" + name;
      const bytes = readFileSync(path.join(root, source));
      inputs.push({ path: source, bytes: bytes.length, sha256: sha(bytes) });
      return { path: "dist/fonts/" + name, bytes };
    })
  : [];
inputs.sort((a, b) => a.path.localeCompare(b.path));
const binding = {
  format: "yunipals-application-worker-runtime-v1",
  profile,
  compiler: { node: process.versions.node, esbuild: compiler.version },
  builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  sourceEntrypoint: profiles[profile],
  entrypoint: filename,
  externalPackages,
  dependencyVersions: dependencies,
  inputs,
  files: [
    { path: filename, bytes: raw.length, sha256: sha(raw) },
    ...assets.map((asset) => ({
      path: asset.path,
      bytes: asset.bytes.length,
      sha256: sha(asset.bytes)
    }))
  ]
};
const manifest = { ...binding, artifactDigest: sha(encode(binding)) };
mkdirSync(output, { mode: 0o755 });
mkdirSync(path.join(output, "dist"), { mode: 0o755 });
writeFileSync(path.join(output, filename), raw, { mode: 0o644, flag: "wx" });
for (const asset of assets) {
  mkdirSync(path.dirname(path.join(output, asset.path)), { recursive: true });
  writeFileSync(path.join(output, asset.path), asset.bytes, {
    mode: 0o644,
    flag: "wx"
  });
}
writeFileSync(path.join(output, "manifest.json"), encode(manifest), {
  mode: 0o644,
  flag: "wx"
});
console.log(
  JSON.stringify({
    profile,
    artifactDigest: manifest.artifactDigest,
    manifestSha256: sha(encode(manifest)),
    files: binding.files.length,
    sourceFiles: inputs.length
  })
);

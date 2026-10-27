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
  "read-cache": "lib/metadata/read-cache-worker.ts",
  "verify-islands": "scripts/verify-islands.ts",
  "islands-metadata": "lib/islands/worker.ts"
};
const args = process.argv.slice(2);
assert(
  args.length === 4 &&
    args[0] === "--worker" &&
    Object.hasOwn(profiles, args[1]) &&
    args[2] === "--outdir" &&
    args[3],
  "Usage: build-application-worker.mjs --worker main-api|read-cache|verify-islands|islands-metadata --outdir FRESH_DIRECTORY"
);
assert(Number(process.versions.node.split(".")[0]) >= 24, "Node 24 required");
const profile = args[1];
const output = path.resolve(args[3]);
assert(!existsSync(output), "Fresh output directory required");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const packageRaw = readFileSync(path.join(project, "package.json"));
const { dependencies } = JSON.parse(packageRaw);
const externalPackages = Object.keys(dependencies).sort();
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
  files: [{ path: filename, bytes: raw.length, sha256: sha(raw) }]
};
const manifest = { ...binding, artifactDigest: sha(encode(binding)) };
mkdirSync(output, { mode: 0o755 });
mkdirSync(path.join(output, "dist"), { mode: 0o755 });
writeFileSync(path.join(output, filename), raw, { mode: 0o644, flag: "wx" });
writeFileSync(path.join(output, "manifest.json"), encode(manifest), {
  mode: 0o644,
  flag: "wx"
});
console.log(
  JSON.stringify({
    profile,
    artifactDigest: manifest.artifactDigest,
    manifestSha256: sha(encode(manifest)),
    files: 1,
    sourceFiles: inputs.length
  })
);

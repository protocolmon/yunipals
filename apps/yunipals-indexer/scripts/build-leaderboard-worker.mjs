import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const root = path.resolve(project, "../..");
const require = createRequire(path.join(project, "package.json"));
const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild");
const args = process.argv.slice(2);
assert(
  args.length === 2 && args[0] === "--outdir" && args[1],
  "Usage: build-leaderboard-worker.mjs --outdir FRESH_DIRECTORY"
);
assert(
  Number(process.versions.node.split(".")[0]) >= 24,
  "Node 24 or later required"
);
const output = path.resolve(args[1]);
assert(!existsSync(output), "Output directory must be fresh");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const entrypoint = "lib/leaderboard/worker.ts";
const packageRaw = readFileSync(path.join(project, "package.json"));
const { dependencies } = JSON.parse(packageRaw);
const externalPackages = Object.keys(dependencies).sort();
const result = await compiler.build({
  absWorkingDir: project,
  entryPoints: [entrypoint],
  outfile: "dist/leaderboard-worker.mjs",
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
const externalImports = [
  ...new Set(
    Object.values(result.metafile.outputs).flatMap((item) =>
      item.imports.filter((entry) => entry.external).map((entry) => entry.path)
    )
  )
].sort();
assert(
  externalImports.every(
    (name) =>
      externalPackages.some(
        (item) => name === item || name.startsWith(item + "/")
      ) ||
      builtinModules.includes(name) ||
      (name.startsWith("node:") && builtinModules.includes(name.slice(5)))
  ),
  "Only declared application packages and Node builtins may remain external"
);
assert.equal(result.outputFiles.length, 1);
const artifact = result.outputFiles[0];
const text = Buffer.from(artifact.contents).toString("utf8");
const analyzed = text.indexOf('"ANALYZE metadata_projection.trait"');
const facet = text.indexOf("INSERT INTO metadata_projection.facet\n");
const vacuum = text.indexOf("VACUUM (ANALYZE");
assert(
  analyzed >= 0 && facet > analyzed && vacuum > facet,
  "Current pre-facet ANALYZE and post-build VACUUM must be present in order"
);
const files = [
  {
    path: "dist/leaderboard-worker.mjs",
    bytes: artifact.contents.length,
    sha256: sha(artifact.contents)
  }
];
const binding = {
  format: "yunipals-leaderboard-worker-runtime-v1",
  compiler: { node: process.versions.node, esbuild: compiler.version },
  builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  sourceEntrypoint: entrypoint,
  entrypoint: files[0].path,
  externalPackages,
  dependencyVersions: dependencies,
  externalImports,
  inputs,
  files
};
const manifest = { ...binding, artifactDigest: sha(encoded(binding)) };
mkdirSync(output, { mode: 0o755 });
mkdirSync(path.join(output, "dist"), { mode: 0o755 });
writeFileSync(path.join(output, files[0].path), artifact.contents, {
  flag: "wx",
  mode: 0o644
});
writeFileSync(path.join(output, "manifest.json"), encoded(manifest), {
  flag: "wx",
  mode: 0o644
});
console.log(
  JSON.stringify({
    artifactDigest: manifest.artifactDigest,
    manifestSha256: sha(encoded(manifest)),
    entrypoint: manifest.entrypoint,
    outputFiles: files.length,
    sourceFiles: inputs.length,
    externalPackages
  })
);

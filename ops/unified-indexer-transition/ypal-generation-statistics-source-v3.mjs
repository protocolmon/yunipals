// Reconstruct exact public f81 inputs, then add only the approved ANALYZE seam.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateArtifact,
  sha
} from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const args = process.argv.slice(2);
assert.deepEqual([args.length, args[0], args[2]], [4, "--artifact", "--out"]);
const artifact = args[1];
const output = args[3];
assert(
  path.isAbsolute(artifact) && path.isAbsolute(output) && !existsSync(output)
);
authenticateArtifact(artifact);
const manifest = JSON.parse(readFileSync(path.join(artifact, "manifest.json")));
const embedded = new Map();
for (const row of manifest.files.filter((row) => row.path.endsWith(".map"))) {
  const map = JSON.parse(readFileSync(path.join(artifact, row.path)));
  map.sources.forEach((name, index) => {
    assert(name.startsWith("../"));
    const filename = "apps/yunipals-indexer/" + name.slice(3);
    const raw = Buffer.from(map.sourcesContent[index]);
    if (embedded.has(filename)) assert(embedded.get(filename).equals(raw));
    embedded.set(filename, raw);
  });
}
const replacements = {
  "apps/yunipals-indexer/package.json":
    "ypal-generation-baseline-indexer-package-v1.json",
  "packages/yunipals-market-core/package.json":
    "ypal-generation-baseline-market-core-package-v1.json",
  "pnpm-lock.yaml": "ypal-generation-baseline-lock-v1.yaml"
};
mkdirSync(output);
const write = (filename, bytes) => {
  const target = path.join(output, filename);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: "wx" });
};
const restored = [];
for (const row of manifest.inputs) {
  let bytes = readFileSync(path.join(root, row.path));
  if (sha(bytes) !== row.sha256) {
    const name = replacements[row.path];
    bytes =
      embedded.get(row.path) ??
      (name &&
        readFileSync(path.join(root, "ops/unified-indexer-transition", name)));
    assert(bytes, "No authenticated reconstruction source: " + row.path);
    restored.push(row.path);
  }
  assert.equal(bytes.length, row.bytes);
  assert.equal(sha(bytes), row.sha256, row.path);
  write(row.path, bytes);
}
const filename = "apps/yunipals-indexer/lib/metadata/projection-refresh.ts";
const before = readFileSync(path.join(output, filename), "utf8");
const marker =
  "    // This limit is local to the build transaction; the facet sort runs once for all scopes.\n";
assert.equal(before.split(marker).length, 2);
const after = before.replace(
  marker,
  '    // Include the new generation in statistics before planning its facet joins.\n    await client.query("ANALYZE metadata_projection.trait");\n' +
    marker
);
assert.equal(
  sha(after),
  "27b7828f96be5f94ea974ed21da85bc1b43775431b762df71655fa81a1da5c42"
);
writeFileSync(path.join(output, filename), after);
for (const name of [
  "ypal-generation-runtime-build-v2.mjs",
  "ypal-generation-runtime-build-v3.mjs",
  "consumer-final-package-v1.RELEASE-MANIFEST.json",
  "metadata-normalization-predecessor-v1.manifest.json",
  "marketplace-consumer-runtime-baseline-rpc-policy-v1.ts",
  "nonmarket-consumer-runtime-baseline-rpc-preflight-v1.ts",
  "ypal-generation-baseline-indexer-package-v1.json",
  "ypal-generation-baseline-market-core-package-v1.json",
  "ypal-generation-baseline-lock-v1.yaml",
  "ypal-generation-snapshot-runtime-v2.manifest.json"
])
  write(
    "ops/unified-indexer-transition/" + name,
    readFileSync(path.join(root, "ops/unified-indexer-transition", name))
  );
for (const directory of [
  "node_modules",
  "apps/yunipals-indexer/node_modules",
  "apps/yunipals-market-api/node_modules"
])
  symlinkSync(path.join(root, directory), path.join(output, directory), "dir");
process.stdout.write(
  JSON.stringify({
    sourceOnly: true,
    reconstructedF81InputCount: manifest.inputs.length,
    reconstructedDriftedInputs: restored,
    changedInput: filename,
    changedSourceSha256: sha(after),
    output,
    dependencyInstalls: 0,
    databaseCalls: 0,
    providerCalls: 0
  }) + "\n"
);

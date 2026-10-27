// Compile only the actual official readonly V5 witness API. No DB or provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = "ops/unified-indexer-transition/ypal-v5-witness-official-v1";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const rawPlan = readFileSync(
  path.join(
    root,
    "ops/unified-indexer-transition/ypal-combined-readview-v5.preparation.json"
  )
);
assert.equal(
  sha(rawPlan),
  "d968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7"
);
assert.equal(process.versions.node, "24.18.1");
const plan = JSON.parse(rawPlan);
const require = createRequire(
  path.join(root, "apps/yunipals-market-api/package.json")
);
const compiler = require("esbuild");
const configuration = {
  absWorkingDir: root,
  entryPoints: [base + ".entry.ts"],
  outfile: base + ".mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  write: false,
  metafile: true,
  logLevel: "silent"
};
const first = await compiler.build(configuration);
const second = await compiler.build(configuration);
assert.deepEqual(first.outputFiles[0].contents, second.outputFiles[0].contents);
assert.deepEqual(first.metafile, second.metafile);
const inputs = Object.fromEntries(
  Object.keys(first.metafile.inputs)
    .sort()
    .map((name) => {
      assert(!path.isAbsolute(name) && !name.split("/").includes(".."));
      const digest = sha(readFileSync(path.join(root, name)));
      assert(
        name === base + ".entry.ts" || plan.officialSourcePins[name] === digest
      );
      return [name, digest];
    })
);
const output = Object.values(first.metafile.outputs);
assert.equal(output.length, 1);
assert.deepEqual(
  output[0].exports.sort(),
  ["loadIndexerRelease", "readBoundRuntime", "readIndexerSourceStatus"].sort()
);
assert(
  output[0].imports.every((row) => row.external && row.path === "node:crypto")
);
const descriptor = {
  format: "yunipals-v5-witness-official-closure-v1",
  buildOnly: true,
  producerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  compilerVersion: compiler.version,
  sourcePlanSha256: sha(rawPlan),
  readSchema: plan.readSchema,
  readIdentity: plan.readIdentity,
  sourcePins: inputs,
  exports: output[0].exports.sort(),
  runtimeImports: output[0].imports,
  artifact: {
    file: path.basename(base + ".mjs"),
    sha256: sha(first.outputFiles[0].contents),
    bytes: first.outputFiles[0].contents.length
  },
  repeatBuildEqual: true,
  databaseQueries: 0,
  providerRequests: 0
};
writeFileSync(path.join(root, base + ".mjs"), first.outputFiles[0].contents, {
  flag: "wx",
  mode: 0o644
});
writeFileSync(
  path.join(root, base + ".sources.json"),
  JSON.stringify(descriptor, null, 2) + "\n",
  { flag: "wx", mode: 0o644 }
);
console.log(
  JSON.stringify({
    sourceFiles: Object.keys(inputs).length,
    artifactSha256: descriptor.artifact.sha256,
    runtimeImports: descriptor.runtimeImports,
    repeatBuildEqual: true,
    databaseQueries: 0,
    providerRequests: 0
  })
);

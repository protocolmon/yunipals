// V3: exact f81 preparation with candidate trait statistics before facets.
// No installs, network, database, Ponder build or service work.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const app = path.join(root, "apps/yunipals-indexer");
const compilerApp = path.join(root, "apps/yunipals-market-api");
const args = process.argv.slice(2);
assert.equal(args.length, 2, "Usage: --out /absolute/fresh/directory");
assert.equal(args[0], "--out");
const output = args[1];
assert.ok(path.isAbsolute(output));
assert.equal(existsSync(output), false, "Output must be fresh.");
assert.equal(process.versions.node, "24.18.1");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const parentPath = path.join(
  root,
  "ops/unified-indexer-transition/consumer-final-package-v1.RELEASE-MANIFEST.json"
);
const parentBytes = readFileSync(parentPath);
assert.equal(
  sha(parentBytes),
  "6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801"
);
const parent = JSON.parse(parentBytes);
const original = new Map(parent.files.map((file) => [file.path, file]));
const priorArtifactPath = path.join(
  root,
  "ops/unified-indexer-transition/metadata-normalization-predecessor-v1.manifest.json"
);
const priorArtifactBytes = readFileSync(priorArtifactPath);
assert.equal(
  sha(priorArtifactBytes),
  "5ec079d363660bf3f7ce471e6301de46d464fedde064fa424187b335a4d5192d"
);
const priorArtifact = JSON.parse(priorArtifactBytes);
const priorInputs = new Map(priorArtifact.inputs.map((row) => [row.path, row]));
const allowedChanges = new Map([
  [
    "apps/yunipals-indexer/scripts/prepare-native-generation.ts",
    "c2580b117f280f9d05c5d2a2a79543e575ce368392d8d2c5de470b684f84c45a"
  ],
  [
    "apps/yunipals-indexer/lib/metadata/projection-refresh.ts",
    "27b7828f96be5f94ea974ed21da85bc1b43775431b762df71655fa81a1da5c42"
  ],
  [
    "apps/yunipals-indexer/lib/metadata/projection-snapshot.ts",
    "ced919589ef32d9686daa7323e40a0de61d662dda04b72457a842661429ac8ee"
  ],
  [
    "apps/yunipals-indexer/lib/leaderboard/refresh.ts",
    "6e923676a8273a74bc6d16c7bfdb0b6c1a2832c77aa6429d172edb70155d4373"
  ],
  [
    "apps/yunipals-indexer/scripts/refresh-leaderboard-only.ts",
    "d2170695cf2dc390a0186399626bcd65297fc7b4c5ac0e0acbf544d0f59063d8"
  ]
]);
// Proxy-only runtime changes must not leak into this consumer artifact.
const substitutions = new Map([
  [
    "pnpm-lock.yaml",
    "ops/unified-indexer-transition/ypal-generation-baseline-lock-v1.yaml"
  ],
  [
    "packages/yunipals-market-core/package.json",
    "ops/unified-indexer-transition/ypal-generation-baseline-market-core-package-v1.json"
  ],
  [
    "apps/yunipals-indexer/package.json",
    "ops/unified-indexer-transition/ypal-generation-baseline-indexer-package-v1.json"
  ],
  [
    "packages/yunipals-indexer-server/src/rpc-policy.ts",
    "ops/unified-indexer-transition/marketplace-consumer-runtime-baseline-rpc-policy-v1.ts"
  ],
  [
    "apps/yunipals-indexer/lib/unified/rpc-preflight.ts",
    "ops/unified-indexer-transition/nonmarket-consumer-runtime-baseline-rpc-preflight-v1.ts"
  ]
]);
const baselineBytes = new Map(
  [...substitutions].map(([name, file]) => {
    const bytes = readFileSync(path.join(root, file));
    assert.equal(sha(bytes), original.get(name).sha256, name);
    return [name, bytes];
  })
);
const baselinePlugin = {
  name: "acknowledged-consumer-rpc-inputs",
  setup(build) {
    build.onLoad({ filter: /[/\\]rpc-(?:policy|preflight)\.ts$/ }, (args) => {
      const bytes = baselineBytes.get(path.relative(root, args.path));
      if (bytes) return { contents: bytes.toString("utf8"), loader: "ts" };
    });
  }
};
const require = createRequire(path.join(compilerApp, "package.json"));
const compiler = require("esbuild");
assert.equal(compiler.version, "0.25.12");
const compilerRequire = createRequire(require.resolve("esbuild/package.json"));
const compilerPaths = [
  require.resolve("esbuild/lib/main.js"),
  require.resolve("esbuild/package.json"),
  compilerRequire.resolve("@esbuild/linux-x64/bin/esbuild")
];
const compilerFiles = compilerPaths.map((file) => ({
  role: file.endsWith("bin/esbuild")
    ? "native"
    : file.endsWith("package.json")
      ? "package"
      : "javascript",
  bytes: readFileSync(file).length,
  sha256: sha(readFileSync(file))
}));
const { dependencies } = JSON.parse(
  readFileSync(path.join(app, "package.json"))
);
assert.deepEqual(
  dependencies,
  JSON.parse(baselineBytes.get("apps/yunipals-indexer/package.json"))
    .dependencies,
  "Retain exact installed dependency declarations"
);
const entryPoints = {
  "generation-prepare": "scripts/prepare-native-generation.ts",
  "generation-refresh": "scripts/refresh-leaderboard.ts",
  "leaderboard-worker": "lib/leaderboard/worker.ts",
  "leaderboard-only": "scripts/refresh-leaderboard-only.ts"
};
const configuration = {
  entryPoints,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(dependencies).filter(
    (name) =>
      ![
        "@protopals/yunipals-market-core",
        "@protopals/yunipals-indexer-server"
      ].includes(name)
  ),
  // The original metadata/rarity modules contain CommonJS require() calls.
  // Preserve their external-package resolution in the relocated ESM bundle.
  banner: {
    js: 'import { createRequire as __runtimeCreateRequire } from "node:module"; const require = __runtimeCreateRequire(import.meta.url);'
  },
  sourcemap: true,
  metafile: true,
  write: false
};
const metadata = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/yunipals-market-api/package.json",
  "apps/yunipals-indexer/package.json",
  "apps/yunipals-indexer/tsconfig.json",
  "packages/yunipals-market-core/package.json",
  "packages/yunipals-indexer-client/package.json",
  "packages/yunipals-indexer-server/package.json"
];
function inventory(meta) {
  const relative = Object.keys(meta.inputs).map((name) => {
    const absolute = realpathSync(path.resolve(app, name));
    const nameInRoot = path.relative(root, absolute);
    assert.ok(!nameInRoot.startsWith("../") && !path.isAbsolute(nameInRoot));
    return nameInRoot;
  });
  const files = [...new Set([...relative, ...metadata])].sort().map((file) => {
    const bytes =
      baselineBytes.get(file) ?? readFileSync(path.join(root, file));
    const digest = sha(bytes);
    const baseline = original.get(file);
    if (allowedChanges.has(file))
      assert.equal(digest, allowedChanges.get(file), file);
    else
      assert.equal(
        digest,
        baseline?.sha256,
        "Unreviewed transitive input delta: " + file
      );
    return {
      path: file,
      bytes: bytes.length,
      sha256: digest,
      predecessorSha256: baseline?.sha256 ?? null,
      previousConsumerSha256:
        priorInputs.get(file)?.sha256 ?? baseline?.sha256 ?? null
    };
  });
  for (const name of allowedChanges.keys())
    assert.ok(files.some((file) => file.path === name));
  return files;
}
const first = await compiler.build({
  ...configuration,
  absWorkingDir: app,
  plugins: [baselinePlugin]
});
const inputs = inventory(first.metafile);
const preparationBytes = readFileSync(
  path.join(
    root,
    "ops/unified-indexer-transition/ypal-generation-snapshot-runtime-v2.manifest.json"
  )
);
assert.equal(
  sha(preparationBytes),
  "85acb526541fe09acbfd17a87a14be494c02123a61501a41b01e91f1d9c01188"
);
const preparation = JSON.parse(preparationBytes);
assert.equal(
  preparation.artifactDigest,
  "f81cdb76ae45794599c723085aebd2b9c5e377975dc16d2e1461236229d4b952"
);
assert.deepEqual(
  inputs.map((row) => row.path),
  preparation.inputs.map((row) => row.path)
);
const preparationInputs = new Map(
  preparation.inputs.map((row) => [row.path, row])
);
const preparationDelta = inputs.filter(
  (row) => row.sha256 !== preparationInputs.get(row.path).sha256
);
assert.deepEqual(
  preparationDelta.map((row) => row.path),
  ["apps/yunipals-indexer/lib/metadata/projection-refresh.ts"]
);
const second = await compiler.build({
  ...configuration,
  absWorkingDir: app,
  plugins: [baselinePlugin]
});
assert.deepEqual(inventory(second.metafile), inputs, "Build inputs changed.");
assert.deepEqual(second.metafile, first.metafile);
const files = first.outputFiles.map((file, index) => {
  assert.equal(second.outputFiles[index].path, file.path);
  assert.ok(
    Buffer.from(second.outputFiles[index].contents).equals(
      Buffer.from(file.contents)
    ),
    "Repeated build differs."
  );
  return {
    path: "dist/" + path.basename(file.path),
    bytes: file.contents.length,
    sha256: sha(file.contents)
  };
});
assert.equal(files.length, 8);
assert.ok(
  !inputs.some((row) =>
    /(?:receipt-worker|rpcBudgetProxy|rpc-preflight|ponder\.config)\./.test(
      row.path
    )
  ),
  "Unrelated runtime must stay outside the metadata artifact."
);
assert.deepEqual(
  inputs
    .filter((row) => row.sha256 !== row.predecessorSha256)
    .map((row) => row.path)
    .sort(),
  [...allowedChanges.keys()].sort()
);
const externalImports = [
  ...new Set(
    Object.values(first.metafile.outputs).flatMap((file) =>
      file.imports.filter((entry) => entry.external).map((entry) => entry.path)
    )
  )
].sort();
assert.ok(
  externalImports.every(
    (name) =>
      name.startsWith("node:") ||
      Object.keys(dependencies).some(
        (dependency) => name === dependency || name.startsWith(dependency + "/")
      )
  ),
  "Unexpected external dependency."
);
const binding = {
  format: "yunipals-generation-snapshot-runtime-v3",
  predecessorSourceDigest: parent.sourceDigest,
  predecessorManifestSha256: sha(parentBytes),
  scope: "native_generation_preparation_snapshot_and_leaderboard_completion",
  preparationEntryNeverPublishes: true,
  predecessorPreparationArtifact: preparation.artifactDigest,
  predecessorPreparationManifestSha256: sha(preparationBytes),
  preparationInputDelta: preparationDelta.map((row) => ({
    path: row.path,
    beforeSha256: preparationInputs.get(row.path).sha256,
    afterSha256: row.sha256,
    purpose: "analyze_new_trait_generation_before_facets"
  })),
  predecessorConsumerArtifact: priorArtifact.artifactDigest,
  preserveGenerationIdsEnvironment: "PROJECTION_PRESERVE_GENERATION_IDS",
  publicApprovalTtlChanged: false,
  nativeWritePrivilegesAdded: false,
  predecessorConsumerManifestSha256: sha(priorArtifactBytes),
  compiler: {
    node: process.versions.node,
    nodeSha256: sha(readFileSync(process.execPath)),
    esbuild: compiler.version,
    files: compilerFiles
  },
  configuration,
  builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  predecessorInputSubstitutions: [...baselineBytes].map(([path, bytes]) => ({
    path,
    sha256: sha(bytes),
    purpose: "preserve_acknowledged_consumer_behavior"
  })),
  externalImports: [...new Set([...externalImports, "node:module"])].sort(),
  metafileSha256: sha(encode(first.metafile)),
  requiredWorkingDirectory:
    "/opt/yunipals-unified/releases/" +
    parent.sourceDigest +
    "/apps/yunipals-indexer",
  commandMapping: Object.entries(entryPoints).map(([name, source]) => ({
    source: "apps/yunipals-indexer/" + source,
    artifact: "dist/" + name + ".mjs",
    nodeArguments: [],
    preserveCallerArguments: name === "leaderboard-only"
  })),
  inputs,
  files,
  requiredRuntimeDependencyTarget:
    "/opt/yunipals-unified/releases/" +
    parent.sourceDigest +
    "/apps/yunipals-indexer/node_modules",
  runtimeDependencyTargetVerifiedHere: false,
  installationRequiresAcknowledgedPredecessorRuntimeVerification: true,
  repeatedBuildByteIdentical: true,
  nodeModulesInstalled: false,
  serviceJobs: 0
};
const digest = sha(encode(binding));
const manifest = { ...binding, artifactDigest: digest };
mkdirSync(output, { mode: 0o755 });
mkdirSync(path.join(output, "dist"), { mode: 0o755 });
for (const file of first.outputFiles)
  writeFileSync(
    path.join(output, "dist", path.basename(file.path)),
    file.contents,
    { flag: "wx", mode: 0o644 }
  );
writeFileSync(path.join(output, "manifest.json"), encode(manifest), {
  flag: "wx",
  mode: 0o644
});
writeFileSync(path.join(output, "metafile.json"), encode(first.metafile), {
  flag: "wx",
  mode: 0o644
});
console.log(
  JSON.stringify({
    built: true,
    artifactDigest: digest,
    manifestSha256: sha(encode(manifest)),
    transitiveInputsAndResolutionMetadata: inputs.length,
    changedInputs: inputs
      .filter((file) => file.sha256 !== file.predecessorSha256)
      .map((file) => file.path),
    outputFiles: files.length,
    outputBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    outputDirectory: output,
    runtimeDependencyTargetVerifiedHere: false,
    serviceJobs: 0
  })
);

// Build only the main API with the reviewed latest-complete readiness fix.
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
  "ops/unified-indexer-transition/ypal-main-api-runtime-v1.manifest.json"
);
const priorArtifactBytes = readFileSync(priorArtifactPath);
assert.equal(
  sha(priorArtifactBytes),
  "986a288dcebe5e7ce910b36d83f97178ce7c47336a0e9910e0d013e3ff3e347a"
);
const priorArtifact = JSON.parse(priorArtifactBytes);
const priorInputs = new Map(priorArtifact.inputs.map((row) => [row.path, row]));
const allowedChanges = new Map([
  [
    "packages/yunipals-indexer-client/src/readiness.ts",
    "06b4f87fa9d1446b32d157d215ab45701152552b1b730d84561f8bce244b6aab"
  ],
  [
    "packages/yunipals-indexer-server/src/status.ts",
    "e3a46cc4add4678d73723ec3d885d825ae4a95bc93d47506c80832bb6d5d460d"
  ],
  [
    "packages/yunipals-indexer-server/src/action-evidence.ts",
    "39ea4712e6a3d1de5a82974439d3bcdb80f4e7f60ad10d6b770a91cd0f75c0fd"
  ],
  [
    "packages/yunipals-indexer-server/src/event-topics.ts",
    "a430efe9b80bded34cdbc8cc115d6c4e7f197d6991b20743e5519427f938960a"
  ],
  [
    "packages/yunipals-market-core/src/indexedAction.ts",
    "14a7548a982d6d1ab6a3a941f44f5e8a4b53e233d7cee79156d05e03ef78ced4"
  ],
  [
    "packages/yunipals-market-core/src/boosterSourceAbi.ts",
    "6e8b457fd73d1667dca35cfc48d46bd095b06352d488554cb78160db58103925"
  ],
  [
    "packages/yunipals-market-core/src/boosterSourceAbi.e8145098.ts",
    "996dec2b07b985763b6e80960b7e36930b5c7976eb9d012ccdee0b7b5493b4fa"
  ],
  [
    "packages/yunipals-market-core/src/boosterAbi.ts",
    "580b38c39dc3e76f92762195f4b6862123775f13d95d092b3fafa39d73adc0ba"
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
    "apps/yunipals-indexer/lib/api/booster-openapi.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/api/booster-openapi.ts"
  ],
  [
    "apps/yunipals-indexer/lib/api/booster-routes.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/api/booster-routes.ts"
  ],
  [
    "apps/yunipals-indexer/lib/leaderboard/refresh.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/leaderboard/refresh.ts"
  ],
  [
    "apps/yunipals-indexer/lib/metadata/projection-refresh.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/apps/yunipals-indexer/lib/metadata/projection-refresh.ts"
  ],
  [
    "packages/yunipals-market-core/src/boosters.ts",
    "ops/unified-indexer-transition/ypal-main-api-baseline-v1/packages/yunipals-market-core/src/boosters.ts"
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
    build.onLoad({ filter: /\.(?:ts|cjs)$/ }, (args) => {
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
const entryPoints = { "main-api": "lib/api/server.ts" };
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
assert.equal(files.length, 2);
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
    .filter((row) => row.sha256 !== row.previousConsumerSha256)
    .map((row) => row.path)
    .sort(),
  [
    "packages/yunipals-indexer-client/src/readiness.ts",
    "packages/yunipals-indexer-server/src/status.ts"
  ].sort()
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
  format: "yunipals-ypal-latest-complete-main-api-runtime-v1",
  predecessorSourceDigest: parent.sourceDigest,
  predecessorManifestSha256: sha(parentBytes),
  scope: "main_api_latest_complete_readiness_only",
  apiOnly: true,
  automaticExecution: false,
  marketplaceReceiptBehaviorChanged: false,
  predecessorConsumerArtifact: priorArtifact.artifactDigest,
  installedConsumerRuntimeUnmodified: true,
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
  commandMapping: [
    {
      source: "apps/yunipals-indexer/lib/api/server.ts",
      artifact: "dist/main-api.mjs",
      nodeArguments: [],
      preserveCallerArguments: false
    }
  ],
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

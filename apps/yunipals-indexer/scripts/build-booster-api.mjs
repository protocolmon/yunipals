import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(project, "package.json"));
const toolRequire = createRequire(require.resolve("tsx/package.json"));
const { build } = toolRequire("esbuild");
const output = path.join(project, "artifacts/booster-api");
await mkdir(output, { recursive: true });
const bundle = path.join(output, "booster-api.mjs");
const result = await build({
  absWorkingDir: project,
  entryPoints: ["lib/api/booster-server.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  metafile: true,
  legalComments: "none",
  logLevel: "warning"
});
const worker = path.join(output, "booster-artwork-sync.mjs");
const workerResult = await build({
  absWorkingDir: project,
  entryPoints: ["lib/boosters/artwork-sync.ts"],
  outfile: worker,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  metafile: true,
  legalComments: "none",
  logLevel: "warning"
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packageJson = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
const sources = {};
for (const name of Object.keys({ ...result.metafile.inputs, ...workerResult.metafile.inputs }).sort())
  sources[name] = sha(await readFile(path.resolve(project, name)));
const bytes = await readFile(bundle);
const workerBytes = await readFile(worker);
if (Object.keys(sources).some((name) => name.endsWith("/offchain/db.ts")))
  throw new Error("Feature artifacts must not import the full API/worker pools");
const manifest = {
  format: "yunipals-feature-booster-api-v1",
  entrypoint: "booster-api.mjs",
  bytes: bytes.length,
  sha256: sha(bytes),
  artworkQueue: { entrypoint: "booster-artwork-sync.mjs", arguments: ["--once"], bytes: workerBytes.length, sha256: sha(workerBytes), poolMaximum: 1, databaseWrites: false, generatedArtwork: false },
  node: ">=24",
  dependencies: Object.fromEntries(["@hono/node-server", "hono", "pg", "viem"].map((name) => [name, packageJson.dependencies[name]])),
  requiredEnvironment: ["DATABASE_URL", "BOOSTER_DATABASE_SCHEMA", "BOOSTER_REGISTRY", "BOOSTER_ENGINE", "BOOSTER_MONSTERS", "BOOSTER_WRAPPER", "BOOSTER_DEPLOYMENT_BLOCK"],
  optionalEnvironment: ["BOOSTER_API_PORT", "BOOSTER_ARTWORK_DIRECTORY", "BOOSTER_ARTWORK_CATALOGS"],
  defaultBind: "127.0.0.1:9030",
  poolMaximum: 2,
  defaultTransactionReadOnly: true,
  indexerProcesses: 0,
  sourceHashes: sources
};
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, sha256: manifest.sha256, bytes: bytes.length, internalSources: Object.keys(sources).length, dependencies: manifest.dependencies, artworkQueue: manifest.artworkQueue }));

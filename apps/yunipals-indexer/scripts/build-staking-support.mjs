import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(project, "package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--outdir" || !args[1])
  throw new Error("Usage: build-staking-support.mjs --outdir DIRECTORY");
const output = path.resolve(args[1]);
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: project,
  entryPoints: ["scripts/staking-support.ts"],
  outfile: path.join(output, "staking-support.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["pg"],
  metafile: true,
  legalComments: "none",
  logLevel: "warning"
});
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const sources = {};
for (const name of Object.keys(result.metafile.inputs).sort()) {
  if (name.endsWith("/offchain/db.ts"))
    throw new Error("Staking support must use its own bounded database pool");
  sources[name] = sha(await readFile(path.resolve(project, name)));
}
const raw = await readFile(path.join(output, "staking-support.mjs"));
const manifest = {
  format: "yunipals-native-staking-runtime-v1",
  entrypoint: "staking-support.mjs",
  sha256: sha(raw),
  bytes: raw.length,
  externalPackages: ["pg"],
  sources
};
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ sha256: manifest.sha256, bytes: manifest.bytes, sourceFiles: Object.keys(sources).length }));

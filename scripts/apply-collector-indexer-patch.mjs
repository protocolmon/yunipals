import { createHash } from "node:crypto";
import { readFile, access, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const [input, mode] = process.argv.slice(2);
if (!input || (mode !== undefined && mode !== "--check")) {
  throw new Error(
    "Usage: node scripts/apply-collector-indexer-patch.mjs /path/to/indexer [--check]"
  );
}
const target = await realpath(input);
const patch = fileURLToPath(
  new URL("../patches/collector-indexer/collector.patch", import.meta.url)
);
const manifest = JSON.parse(
  await readFile(
    new URL("../patches/collector-indexer/manifest.json", import.meta.url),
    "utf8"
  )
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (hash(await readFile(patch)) !== manifest.patchSha256)
  throw new Error("Patch does not match its manifest.");
for (const [path, expected] of Object.entries(manifest.originals)) {
  if (hash(await readFile(resolve(target, path))) !== expected)
    throw new Error(
      `Baseline differs: ${path}. Review and rebase the patch before applying.`
    );
}
for (const path of manifest.added) {
  try {
    await access(resolve(target, path));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Refusing to overwrite an existing file: ${path}`);
}
function apply(check) {
  const result = spawnSync(
    "git",
    ["apply", ...(check ? ["--check"] : []), patch],
    { cwd: target, stdio: "inherit" }
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("The indexer patch could not be applied cleanly.");
}
apply(true);
if (mode === "--check")
  console.log("Indexer baseline matches; patch applies cleanly.");
else {
  apply(false);
  console.log(
    "Indexer source patched. Run checks and staging benchmarks before enabling the feature."
  );
}

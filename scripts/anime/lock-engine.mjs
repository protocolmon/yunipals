/** Explicit release operation. Does not update sampled frames or approve artwork. */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
  new URL("../../apps/yunipals-anime-engine/", import.meta.url)
);
const [version, chromium] = process.argv.slice(2);
if (
  !version ||
  !/^\d+\.\d+\.\d+$/.test(version) ||
  !chromium ||
  !/^\d+\.\d+\.\d+\.\d+$/.test(chromium)
)
  throw new Error(
    "Usage: node scripts/anime/lock-engine.mjs ENGINE_VERSION CHROMIUM_VERSION"
  );
const names = [
  "src/film.js",
  "src/director.ts",
  "src/fighterNames.js",
  "src/kitPolicy.js",
  "render.mjs",
  "mix.py",
  ...(await readdir(join(root, "static/assets"))).map(
    (n) => `static/assets/${n}`
  )
].sort();
const files = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      name,
      createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex")
    ])
  )
);
const sha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
let prior;
try {
  prior = JSON.parse(await readFile(join(root, "engine-lock.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  prior?.version === version &&
  (prior.sha256 !== sha256 || prior.chromium !== chromium)
)
  throw new Error("Bump the engine version before changing a frozen build");
await writeFile(
  join(root, "engine-lock.json"),
  JSON.stringify({ version, chromium, sha256, files }, null, 2) + "\n"
);

// Package the existing collection/booster app for its canonical Vercel project.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "prebuilt" },
    "legacy-proto": { type: "boolean", default: false }
  }
});
if (!["prebuilt", "vercel-cloud"].includes(values.mode))
  throw Error("Use prebuilt or vercel-cloud mode.");

const app = fileURLToPath(new URL("../../", import.meta.url));
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const release = `/tmp/yunipals-collection-booster-live-www-${Date.now()}`;
// Vercel resolves Build Output API artifacts beneath its configured app root;
// local --prebuilt deployment retains the repository-root location.
const output = join(
  values.mode === "vercel-cloud" ? app : repository,
  ".vercel/output"
);
const setupSha =
  "bc1ab30332108dc40db4b3f86b8ac6c1a0efff456555f40af486389afb305d6e";
const standardSha =
  "56ed3b186acc69e38c04f3f7390a55eb267a1e10029f06de05b0450a0b4c8860";
const ypalLaunchSha =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
const child = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import",
    "./scripts/register-typescript.mjs",
    "scripts/boosters/build-collection-live.mjs",
    "--full-app",
    "--setup-sha",
    setupSha,
    "--standard-setup-sha",
    standardSha,
    ...(values["legacy-proto"] ? [] : ["--ypal-launch-sha", ypalLaunchSha]),
    "--output",
    release
  ],
  { cwd: app, env: process.env, stdio: "inherit" }
);
if (child.error) throw child.error;
if (child.status !== 0) process.exit(child.status ?? 1);

// Retain the previous local build instead of overwriting a tested artifact.
try {
  await stat(output);
  await rename(output, `${output}.previous-${Date.now()}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(output, { recursive: true });
await cp(release, join(output, "static"), { recursive: true });
const config = {
  version: 3,
  routes: [
    {
      src: "/assets/(.*)",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true
    },
    {
      src: "/(?!assets/).*",
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
      continue: true
    },
    { handle: "filesystem" },
    { src: "/(?:assets|images|videos)/(.*)", status: 404 },
    { src: "/(.*)", dest: "/index.html" }
  ]
};
await writeFile(
  join(output, "config.json"),
  JSON.stringify(config, null, 2) + "\n"
);
await writeFile(
  join(output, "builds.json"),
  JSON.stringify({ target: "production" }) + "\n"
);
const manifest = await readFile(join(release, "RELEASE-MANIFEST.json"));
console.log(
  JSON.stringify({
    canonicalOrigin: "https://www.yunipals.com",
    frontend: "apps/yunipals-home-web",
    mode: values.mode,
    release,
    output,
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    setupSha256: setupSha,
    standardSetupSha256: standardSha,
    ypalLaunchPackageSha256: values["legacy-proto"] ? null : ypalLaunchSha
  })
);

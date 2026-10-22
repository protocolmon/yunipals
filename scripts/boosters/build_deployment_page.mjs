/** Bundle a self-contained wallet signing page; no remote JavaScript dependencies. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  realpathSync(root + "apps/yunipals-home-web/node_modules/vite/package.json")
);
const { build } = require("esbuild");
const output = root + "sites/yunipals-booster-art-review/dist/deploy/";
const plan = await readFile(
  root + "docs/boosters/mainnet-smoke/deployment.unsigned.json"
);
// Only publish the exact deployment payloads from the final reviewed candidate.
// Refreshed balances/quotes are allowed; changed code or nonce predictions need
// an explicitly reviewed candidate before this signing page can be rebuilt.
const reviewed = JSON.parse(
  await readFile(
    root +
      "docs/boosters/audit/checkpoint-hardening-2026-10-20/deployment.unsigned.json",
    "utf8"
  )
);
assert.deepEqual(
  JSON.parse(plan).transactions,
  reviewed.transactions,
  "Deployment payloads differ from the final R-01 audit candidate"
);
const auditPath =
  root + "docs/boosters/audit/yunipals-boosters-final-r01-2026-10-20.txt";
assert.equal(
  createHash("sha256")
    .update(await readFile(auditPath))
    .digest("hex"),
  "32fae8ad6b15d52c92cdeb7fa18e4452e762ca367a6dd29c427bb65ac3f06756",
  "Final audit package fingerprint changed"
);
const sha = createHash("sha256").update(plan).digest("hex");
await mkdir(output, { recursive: true });
await writeFile(output + "deployment.json", plan);
await copyFile(auditPath, output + "audited-contracts.txt");
await build({
  entryPoints: [
    root + "apps/yunipals-home-web/scripts/boosters/deployment-page.ts"
  ],
  outfile: output + "mainnet.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  define: { PLAN_SHA256: JSON.stringify(sha) }
});
console.log(JSON.stringify({ packageSha256: sha, page: "/deploy/", output }));

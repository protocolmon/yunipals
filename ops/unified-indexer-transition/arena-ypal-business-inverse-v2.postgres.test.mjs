// Execute the complete pinned real-PG control with the actual new child.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(path.join(here, "arena-ypal-business-inverse-v1.postgres.test.mjs"));
assert.equal(createHash("sha256").update(raw).digest("hex"), "8e61dd75cc81e80fd2c1236931363b3081847e5e62e5fc6e271876243d681b1d");
let source = raw.toString();
const replacements = [
  ['import { composition, externalWork, extendLedgerSource } from "./arena-ypal-business-inverse-child-v1.mjs";',
    `import { externalWork, extendLedgerSource } from ${JSON.stringify(pathToFileURL(path.join(here, "arena-ypal-business-inverse-child-v1.mjs")).href)};\nimport { composition } from ${JSON.stringify(pathToFileURL(path.join(here, "arena-ypal-business-inverse-child-v2.mjs")).href)};`],
  ['const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");',
    `const here = ${JSON.stringify(here)}, root = resolve(here, "../..");`],
  ['const child = await composition(readFileSync(join(here, "arena-modern-public-rollback-v1.mjs")));',
    'const child = await composition(readFileSync(join(here, "arena-ypal-business-inverse-child-v1.mjs")), readFileSync(join(here, "arena-modern-public-rollback-v1.mjs")));']
];
for (const [before, after] of replacements) {
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, after);
}
await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

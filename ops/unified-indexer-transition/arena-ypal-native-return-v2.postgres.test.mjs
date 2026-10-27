// Retain the complete genuine transaction/shared-native PG controls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(path.join(here, "arena-ypal-native-return-v1.postgres.test.mjs"));
assert.equal(createHash("sha256").update(raw).digest("hex"), "0d18b69dc2556f73676a33de649726c5c1975e9f5b909f3ad25c173bb8a09a62");
let source = raw.toString();
const replace = (before, after, count = 1) => {
  assert.equal(source.split(before).length, count + 1);
  source = source.split(before).join(after);
};
replace("const here = dirname(fileURLToPath(import.meta.url));", `const here = ${JSON.stringify(here)};`);
replace("arena-ypal-native-return-child-v1.mjs", "arena-ypal-native-return-child-v2.mjs", 2);
replace("const {returnSource}=await import", "const {nativeReturnSource:returnSource}=await import", 2);
replace("Buffer.from(returnSource(", "Buffer.from(await returnSource(", 2);
replace('returnSource(readFileSync(join(here,"arena-ypal-business-inverse-child-v1.mjs")))',
  'returnSource(readFileSync(join(here,"arena-ypal-native-return-child-v1.mjs")),readFileSync(join(here,"arena-ypal-business-inverse-child-v2.mjs")),readFileSync(join(here,"arena-ypal-business-inverse-child-v1.mjs")))');
replace("returnSource(returnFs.readFileSync(join(returnHere,'arena-ypal-business-inverse-child-v1.mjs')))",
  "returnSource(returnFs.readFileSync(join(returnHere,'arena-ypal-native-return-child-v1.mjs')),returnFs.readFileSync(join(returnHere,'arena-ypal-business-inverse-child-v2.mjs')),returnFs.readFileSync(join(returnHere,'arena-ypal-business-inverse-child-v1.mjs')))");
replace("/tmp/arena-native-derived-support-final-v1-20261025", "/tmp/arena-native-derived-support-credentials-v2-20261025");
replace("19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e", "b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443", 2);
await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

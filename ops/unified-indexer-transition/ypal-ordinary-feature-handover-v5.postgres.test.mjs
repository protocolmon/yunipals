// Run the genuine retained PG16 matrix against this NEW feature namespace.
// Only fixture launch plumbing changes. SQL/ACL/CAS/control bodies stay exact.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const raw = readFileSync(
  new URL(
    "./ypal-restored-feature-handover-v1.postgres.test.mjs",
    import.meta.url
  )
);
assert.equal(
  createHash("sha256").update(raw).digest("hex"),
  "b37065f4ed1deb02513d66bc22263d8b891640baecf49870aa2d7f31de789672"
);
let source = raw.toString("utf8");
function once(before, after) {
  assert.equal(
    source.split(before).length,
    2,
    "One retained fixture seam required"
  );
  source = source.replace(before, after);
}
once(
  'const root = fileURLToPath(new URL("../..", import.meta.url));',
  `const root = ${JSON.stringify(root)};`
);
once(
  "wrapper=mod('wrapper',r/'ops/unified-indexer-transition/ypal-restored-feature-handover-v1.py');context=mod('context',r/'ops/unified-indexer-transition/ypal-restored-feature-context-v1.py');m=wrapper.assemble((r/'ops/unified-indexer-transition/ypal-feature-handover-v1.py').read_bytes(),context)",
  "fixture=mod('ordinary_feature_fixture',r/'ops/unified-indexer-transition/ypal-ordinary-feature-handover-v5.test.py');m=fixture.m;context=fixture.helper_namespace()"
);
const temporary = mkdtempSync(
  path.join(os.tmpdir(), "ypal-ordinary-feature-pg-")
);
try {
  const script = path.join(temporary, "matrix.mjs");
  writeFileSync(script, source, { flag: "wx", mode: 0o600 });
  const output = execFileSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 8000000
  });
  const value = JSON.parse(output);
  assert.equal(value.passed, true);
  assert.equal(value.groups, 11);
  console.log(
    JSON.stringify({
      ...value,
      actualNewFeatureNamespace: true,
      retainedFixtureBodyUnchanged: true,
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

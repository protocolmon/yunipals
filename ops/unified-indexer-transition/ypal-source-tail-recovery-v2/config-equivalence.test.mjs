// Parse only. No Ponder, application, database or provider imports.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(
  new URL("../../../apps/yunipals-indexer/package.json", import.meta.url)
);
const ts = require("typescript");
const before = readFileSync(
  new URL(
    "../ypal-combined-source-v1/payload/ponder.config.ts",
    import.meta.url
  ),
  "utf8"
);
const after = readFileSync(
  new URL("pool8.ponder.config.ts", import.meta.url),
  "utf8"
);
function ast(text) {
  const file = ts.createSourceFile(
    "candidate.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert.equal(file.parseDiagnostics.length, 0);
  const visit = (node) => ({
    kind: node.kind,
    text:
      ts.isLiteralExpression(node) || ts.isIdentifier(node)
        ? node.text
        : undefined,
    children: node.getChildren(file).map(visit)
  });
  return visit(file);
}
function exact(old, candidate) {
  assert.equal((candidate.match(/poolConfig: \{ max: 8 \}/g) ?? []).length, 1);
  assert.deepEqual(
    ast(candidate.replace("poolConfig: { max: 8 }", "poolConfig: { max: 5 }")),
    ast(old)
  );
}
exact(before, after);
assert.throws(() => exact(before, after + "\nthrow Error('foreign');\n"));
assert.throws(() =>
  exact(before, after.replace("sourceManifestHash", "foreignSourceHash"))
);
assert.throws(() =>
  exact(
    before,
    after.replace("poolConfig: { max: 8 }", "poolConfig: { max: 9 }")
  )
);
console.log(
  JSON.stringify({
    status: "passed",
    groups: 4,
    change: "database.poolConfig.max_only_plus_formatting",
    applicationImports: 0,
    providerCalls: 0,
    databaseCalls: 0
  })
);

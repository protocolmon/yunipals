// Derive a NEW explicit recovery function from the frozen capsule algorithm.
// No old module/object/global is imported, patched, executed or overwritten.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const predecessorSha256 =
  "b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21";
const sha = (value) => createHash("sha256").update(value).digest("hex");
export function derive(original) {
  assert.equal(sha(original), predecessorSha256);
  let source = original.toString("utf8");
  const once = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after);
  };
  for (const name of [
    "observeGenerationRecovery",
    "verifyGenerationRecovery",
    "captureGenerationRecovery"
  ])
    once(`export async function ${name}(`, `async function ${name}(`);
  once(
    "export async function restoreGenerationRecovery(",
    "export async function restoreGenerationLineageRecovery("
  );
  once(
    "  ownedGenerationId,\n  externalBinding,",
    "  ownedGenerationId,\n  lineageRoot,\n  lineageCycles,\n  externalBinding,"
  );
  once(
    "    const observed = await current(db),\n      before = saved.before;",
    "    const lineage = await validateLineageRecovery(\n" +
      "      db,\n      lineageRoot,\n      lineageCycles,\n      receipt\n    );\n" +
      "    assert.equal(\n      lineage.currentGenerationId,\n      ownedGenerationId,\n" +
      '      "same_actual_owned_lineage_head_required"\n    );\n' +
      "    const observed = await current(db),\n      before = saved.before;"
  );
  once(
    '      observed.active.previous_id,\n      before.active.current_id,\n      "owned_predecessor_required"',
    '      observed.active.previous_id,\n      lineage.predecessorGenerationId,\n      "owned_lineage_predecessor_required"'
  );
  once(
    '      observed.generation.validation?.sourceSnapshot?.predecessor,\n      before.active.current_id,\n      "owned_source_snapshot_required"',
    '      observed.generation.validation?.sourceSnapshot?.predecessor,\n      lineage.predecessorGenerationId,\n      "owned_lineage_source_snapshot_required"'
  );
  once(
    '      format: "yunipals-generation-recovery-inverse-v1",',
    '      format: "yunipals-generation-lineage-recovery-inverse-v1",\n' +
      "      lineageRootSha256: lineage.rootSha256,\n" +
      "      initialNativeGenerationRetained: lineage.initialNativeGenerationId,\n" +
      "      acknowledgedCycles: lineage.acknowledgedCycles,"
  );
  return (
    "// NEW descendant recovery; original capsule/privacy/rows/epoch algorithm retained.\n" +
    'import { validateLineageRecovery } from "./ypal-generation-lineage-v1.mjs";\n' +
    source
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = new URL(
    "./ypal-generation-lineage-recovery-v1.mjs",
    import.meta.url
  );
  const expected = derive(
    readFileSync(new URL("./ypal-generation-recovery-v1.mjs", import.meta.url))
  );
  if (process.argv.length === 2) {
    assert.equal(readFileSync(output, "utf8"), expected);
    console.log(
      JSON.stringify({
        matched: true,
        sourceOnly: true,
        oldModuleModified: false
      })
    );
  } else {
    assert.equal(process.argv.length, 4);
    assert.equal(process.argv[2], "--out");
    assert(process.argv[3].startsWith("/"));
    assert.equal(existsSync(process.argv[3]), false);
    writeFileSync(process.argv[3], expected, { flag: "wx", mode: 0o644 });
  }
}

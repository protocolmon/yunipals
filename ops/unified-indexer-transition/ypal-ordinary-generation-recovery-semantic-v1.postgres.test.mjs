// Reuse the genuine V5 PG controls, adding real allocation-only drift checks.
// Dedicated localhost PG16 only; the shared dependency fixture is read-only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const original = readFileSync(
  path.join(
    directory,
    "ypal-ordinary-generation-recovery-v5.postgres.test.mjs"
  ),
  "utf8"
);
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  "5600dc8c8c6aefdd63c2aeacb17d098c63fb8085d07de6e63f0e09fd8bb38d12"
);
let source = original;
const replaceOnce = (before, after) => {
  assert.equal(source.split(before).length, 2, before);
  source = source.replace(before, after);
};
replaceOnce("127.0.0.1:56967/", "127.0.0.1:56981/");
source = source.replaceAll(
  "ypal-ordinary-generation-recovery-v5.mjs",
  "ypal-ordinary-generation-recovery-semantic-v1.mjs"
);
replaceOnce(
  'const root = new URL("../../", import.meta.url).pathname.replace(/\\/$/, "");',
  "const root = " + JSON.stringify(path.resolve(directory, "../..")) + ";"
);
replaceOnce(
  "  const published = async () => {",
  `
  const strict = await import("./ypal-ordinary-generation-recovery-v5.mjs");
  await db.query("VACUUM (FREEZE, ANALYZE) " + schema + ".wallet_stats, " + schema + ".derived_snapshot");
  await assert.rejects(strict.verifyGenerationRecovery(db, receipt));
  const semantic = await verifyGenerationRecovery(db, receipt);
  assert.equal(semantic.recoverySemantics.format, "yunipals-generation-recovery-semantic-v1");
  assert.equal(semantic.recoverySemantics.predecessorStrictSuccessClaimed, false);
  for (const field of ["walletStats", "derivedStamps"]) {
    const observation = semantic.allocationObservations[field];
    assert(observation.semanticIdentityMatched && observation.allocatedBytesChanged);
    assert.equal(observation.capturedAllocatedBytes, receipt[field].allocated_bytes);
    assert.notEqual(observation.observedAllocatedBytes, observation.capturedAllocatedBytes);
    for (const key of ["count", "sha256", "tuple_bytes"]) {
      const changed = structuredClone(receipt);
      changed[field][key] = key === "sha256" ? "00".repeat(32) :
        (BigInt(changed[field][key]) + 1n).toString();
      await assert.rejects(verifyGenerationRecovery(db, changed));
    }
    for (const allocated_bytes of [undefined, "-1", "1.0"]) {
      const changed = structuredClone(receipt);
      if (allocated_bytes === undefined) delete changed[field].allocated_bytes;
      else changed[field].allocated_bytes = allocated_bytes;
      await assert.rejects(verifyGenerationRecovery(db, changed));
    }
  }
  assert.deepEqual(await observeGenerationRecovery(db), originalRows);
  checks.push("actual_vacuum_fsm_vm_allocation_drift_refuses_frozen_strict_a194_but_new_predicate_preserves_semantic_identity_and_records_allocation");
  checks.push("count_sha_tuple_bytes_and_complete_valid_allocation_fields_stay_required_for_both_capsule_tables");
  for (const sql of [
    "UPDATE " + schema + ".wallet_stats SET monster_count=999",
    "UPDATE " + schema + ".derived_snapshot SET metadata_release_id='foreign'",
    "UPDATE " + schema + ".context SET value=jsonb_set(value,'{externalBinding}',to_jsonb('foreign'::text))",
    "GRANT USAGE ON SCHEMA " + schema + " TO PUBLIC",
    "GRANT SELECT ON " + schema + ".wallet_stats TO PUBLIC"
  ]) {
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await assert.rejects(verifyGenerationRecovery(db, receipt));
    } finally { await db.query("ROLLBACK"); }
  }
  checks.push("actual_changed_wallet_stamp_context_and_schema_table_privacy_refuse_after_allocation_only_acceptance");
  const published = async () => {`
);
replaceOnce(
  "  let owned = await observeGenerationRecovery(db);",
  `
  let owned = await observeGenerationRecovery(db);
  const beforeStrictInverse = await observeGenerationRecovery(db);
  await assert.rejects(strict.restoreGenerationRecovery(db, receipt, "104", external, owned));
  assert.deepEqual(await observeGenerationRecovery(db), beforeStrictInverse);
  checks.push("actual_allocation_drift_refuses_frozen_strict_restore_without_any_inverse_effect");
  for (const field of ["walletStats", "derivedStamps"]) {
    for (const key of ["count", "sha256", "tuple_bytes"]) {
      const changed = structuredClone(receipt);
      changed[field][key] = key === "sha256" ? "00".repeat(32) :
        (BigInt(changed[field][key]) + 1n).toString();
      await assert.rejects(restoreGenerationRecovery(db, changed, "104", external, owned));
      assert.deepEqual(await observeGenerationRecovery(db), beforeStrictInverse);
    }
  }
  checks.push("both_inverse_aggregate_predicates_refuse_count_sha_or_tuple_byte_mismatch_with_full_rollback");`
);
replaceOnce(
  "  assert(result.restored && result.allDerivedIdentityColumnsRestored);",
  `
  assert(result.restored && result.allDerivedIdentityColumnsRestored);
  assert.equal(result.recoverySemantics.format, "yunipals-generation-recovery-semantic-v1");
  for (const field of ["walletStats", "derivedStamps"])
    assert(result.allocationObservations[field].allocatedBytesChanged &&
      result.allocationObservations[field].semanticIdentityMatched);
  checks.push("actual_semantic_inverse_accepts_only_allocation_drift_and_returns_observed_allocation_without_weakening_owned_row_guards");`
);
replaceOnce(
  'format: "yunipals-ordinary-generation-recovery-v5-postgres",',
  'format: "yunipals-ordinary-generation-recovery-semantic-v1-postgres",'
);
const temporary = mkdtempSync(
  path.join(directory, ".semantic-recovery-pg-test-")
);
const filename = path.join(temporary, "run.mjs");
// Resolve only the test's source-relative imports from the temporary driver.
source = source.replaceAll('"./ypal-', '"../ypal-');
source = source.replaceAll(
  '"../../apps/',
  JSON.stringify(path.resolve(directory, "../../apps")).slice(0, -1) + "/"
);
try {
  writeFileSync(filename, source);
  process.stdout.write(
    execFileSync(
      process.execPath,
      ["--import", require.resolve("tsx/esm"), filename],
      {
        cwd: path.resolve(directory, "../.."),
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 4000000,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }
      }
    )
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

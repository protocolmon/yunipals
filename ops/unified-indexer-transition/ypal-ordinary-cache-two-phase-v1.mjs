// Explicit guard preparation followed by fenced READ activation. No service work.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as original from "./ypal-ordinary-cache-transition-v5.mjs";
export const FORMAT = "yunipals-ordinary-cache-two-phase-v1";
export const { binding, relations, catalog, capture, guardSql } = original;
export const APPROVAL = "metadata_source.native_base_metadata_state";
export const RELEASE = binding.sourceRelease;
export const IDENTITY = binding.readIdentity;
export const IMPLEMENTATION = "0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca";
const ORIGINAL_KEYS = ["format", "binding", "before", "after", "addedSelects", "beforeCatalogSha256", "afterCatalogSha256", "committed", "officialRollbackRehearsed"];
const PLAN_KEYS = [...ORIGINAL_KEYS, "phase", "originalPlanJson", "preparationReceiptJson", "verificationFence"].sort();
const phases = new Set(["prepare-guards", "activate-reads"]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const encoded = value => JSON.stringify(canonical(value));
export const digest = value => createHash("sha256").update(encoded(value)).digest("hex");
const pin = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && value !== "0".repeat(64);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const relation = value => { assert(relations.includes(value), "fixed_original_relation_required"); return value.split(".").map(quote).join("."); };
const equal = (left, right, code) => assert.equal(encoded(left), encoded(right), code);
const keys = (value, names, code) => { assert(value && typeof value === "object" && !Array.isArray(value), code); equal(Object.keys(value).sort(), [...names].sort(), code); };
const json = value => JSON.stringify(value);
const key = value => json(value);
const cache = ["read_epoch", "read_guard", "read_set", "read_member"].map(name => "metadata_projection." + name);
function effect(before, after) {
  assert.deepEqual(
    after.tables,
    before.tables,
    "additive_schema_already_present_required"
  );
  assert(
    Array.isArray(before.columnAcl) && Array.isArray(after.columnAcl),
    "complete_column_ACL_capture_required"
  );
  assert.deepEqual(
    after.columnAcl,
    before.columnAcl,
    "original_column_permissions_must_be_preserved"
  );
  assert.deepEqual(
    after.functions.map(({ definition, ...row }) => row),
    before.functions.map(({ definition, ...row }) => row),
    "function_identity_owner_and_ACL_must_be_preserved"
  );
  assert.deepEqual(
    after.epochs.map((e) => ({
      ...e,
      revision: String(BigInt(e.revision) - 1n)
    })),
    before.epochs,
    "official_migration_must_increment_each_existing_epoch_once"
  );
  const old = new Set(before.acl.map(key)),
    next = new Set(after.acl.map(key));
  assert(
    before.acl.every((row) => next.has(key(row))),
    "official_migration_removed_or_changed_existing_ACL"
  );
  const added = after.acl.filter((row) => !old.has(key(row)));
  assert(
    added.every(
      (row) =>
        cache.includes(row.name) &&
        row.privilege === "SELECT" &&
        !row.grantable &&
        row.grantee !== "0"
    ),
    "only_official_finite_cache_SELECT_additions_allowed"
  );
  // PostgreSQL's table-level REVOKE SELECT also revokes column SELECT rights.
  // Refuse this specific pre-existing overlap so an owned inverse preserves it.
  assert(
    added.every(
      (grant) =>
        !before.columnAcl.some(
          (column) =>
            column.name === grant.name &&
            column.grantee === grant.grantee &&
            column.privilege === "SELECT"
        )
    ),
    "preexisting_column_SELECT_requires_separate_inverse"
  );
  return added;
}

function validateOriginal(plan, committed) {
  assert.equal(plan.format, "yunipals-ypal-cache-guard-transition-v1");
  assert.deepEqual(plan.binding, binding, "fresh_source_binding_required");
  assert.equal(plan.committed, committed);
  assert.equal(plan.officialRollbackRehearsed, true);
  assert.equal(original.digest(catalog(plan.before)), plan.beforeCatalogSha256);
  assert.equal(original.digest(catalog(plan.after)), plan.afterCatalogSha256);
  assert.deepEqual(effect(plan.before, plan.after), plan.addedSelects);
}

export function originalPlan(plan) {
  keys(plan, PLAN_KEYS, "exact_two_phase_plan_keys_required");
  assert(phases.has(plan.phase) && typeof plan.originalPlanJson === "string", "fixed_two_phase_and_original_plan_required");
  const value = JSON.parse(plan.originalPlanJson);
  keys(value, ORIGINAL_KEYS, "exact_original_rehearsal_plan_required");
  equal(Object.fromEntries(ORIGINAL_KEYS.map(key => [key, plan[key]])), value, "unchanged_original_plan_fields_required");
  assert.equal(value.format, "yunipals-ypal-cache-guard-transition-v1");
  equal(value.binding, binding, "same_original_dataset_binding_required");
  assert(value.committed === false && value.officialRollbackRehearsed === true, "actual_original_ROLLBACK_plan_required");
  assert.equal(original.digest(catalog(value.before)), value.beforeCatalogSha256);
  assert.equal(original.digest(catalog(value.after)), value.afterCatalogSha256);
  assert(Array.isArray(value.addedSelects) && value.addedSelects.length === 4, "four_original_READ_grants_required");
  const names = ["read_epoch", "read_guard", "read_set", "read_member"].map(name => "metadata_projection." + name).sort();
  equal(value.addedSelects.map(row => row.name).sort(), names, "exact_four_cache_relations_required");
  assert(value.addedSelects.every(row => row.privilege === "SELECT" && row.grantable === false && /^[1-9][0-9]*$/.test(row.grantee) && typeof row.role === "string" && row.role.length > 0), "exact_nongrantable_actual_reader_grants_required");
  assert(new Set(value.addedSelects.map(row => row.grantee)).size === 1, "one_actual_original_cache_reader_required");
  validateOriginal(value, false);
  return value;
}
const epochShape = rows => { assert(Array.isArray(rows) && rows.length === 4, "four_epochs_required"); equal(rows.map(row => row.collection).sort(), ["base", "bnb", "ethereum", "polygon"], "exact_epoch_collections_required"); assert(rows.every(row => typeof row.revision === "string" && /^[0-9]+$/.test(row.revision)), "integer_epoch_revisions_required"); return rows; };
const incremented = (before, after) => { epochShape(before); epochShape(after); equal(after, before.map(row => ({ ...row, revision: String(BigInt(row.revision) + 1n) })), "one_real_preparation_epoch_increment_required"); };
export async function begin(db, activation) {
  assert(typeof activation === "boolean", "typed_explicit_phase_lock_mode_required");
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='60s'");
  if (!activation) await db.query(`LOCK TABLE ${relations.map(relation).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
  else {
    await db.query(`LOCK TABLE ${relations.filter(name => name !== APPROVAL).map(relation).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await db.query(`LOCK TABLE ${relation(APPROVAL)} IN SHARE UPDATE EXCLUSIVE MODE`);
    const rows = (await db.query("SELECT release_id FROM metadata_source.native_base_metadata_state WHERE release_id=$1 FOR KEY SHARE", [RELEASE])).rows;
    assert(rows.length === 1 && rows[0].release_id === RELEASE, "one_key_share_fenced_native_approval_required");
  }
}
async function native(db) { const rows = (await db.query(guardSql())).rows; assert(rows.length === 1 && Object.values(rows[0])[0]?.valid === true, "full_original_native35_guard_graph_required"); }
const rowKey = value => encoded(value);
function actualFour(before, after, plan) {
  const prior = new Set(before.acl.map(rowKey)); const next = new Set(after.acl.map(rowKey));
  assert(before.acl.every(row => next.has(rowKey(row))), "no_original_ACL_removal_required");
  equal(after.acl.filter(row => !prior.has(rowKey(row))), plan.addedSelects, "only_four_original_READ_grants_required");
  equal(before.columnAcl, after.columnAcl, "all_column_ACLs_unchanged_required");
  assert(plan.addedSelects.every(grant => !before.columnAcl.some(row => row.name === grant.name && row.grantee === grant.grantee && row.privilege === "SELECT")), "no_preexisting_column_SELECT_overlap_required");
}
function preparation(plan) {
  assert(typeof plan.preparationReceiptJson === "string", "actual_committed_preparation_receipt_required");
  const value = JSON.parse(plan.preparationReceiptJson);
  assert(value.format === FORMAT && value.phase === "prepare-guards" && value.committed === true && value.readGrantsExternallyActivated === false, "owned_guard_preparation_not_old_cache_success_required");
  assert.equal(value.originalPlanSha256, digest(originalPlan(plan)));
  assert.equal(value.afterCatalogSha256, digest(catalog(value.after)));
  equal(catalog(value.after), { ...catalog(originalPlan(plan).after), acl: originalPlan(plan).before.acl }, "exact_installed_target_without_four_grants_required");
  incremented(value.before.epochs, value.after.epochs);
  return value;
}
export const semantic = value => Object.fromEntries(["release", "identity", "state", "implementation", "errorCode", "frontier"].map(key => [key, value[key]]));
export const APPROVAL_SQL = `WITH stamp AS MATERIALIZED(SELECT clock_timestamp()AS at),
a AS MATERIALIZED(SELECT s.*FROM metadata_source.native_base_metadata_state s WHERE release_id='${RELEASE}'),
f AS MATERIALIZED(SELECT *FROM ${binding.readSchema}.base_metadata_frame(false))
SELECT jsonb_build_object('atUs',(extract(epoch FROM stamp.at)*1000000)::numeric(30,0)::text,
'checkedUs',(SELECT(extract(epoch FROM checked_at)*1000000)::numeric(30,0)::text FROM a),
'release',(SELECT release_id FROM a),'identity',(SELECT read_identity FROM a),'state',(SELECT state FROM a),
'implementation',(SELECT implementation FROM a),'errorCode',(SELECT error_code FROM a),
'frontier',(SELECT frontier FROM a),'frameFrontier',(SELECT frontier FROM f),'checkedBlock',(SELECT checked_block::text FROM a),
'checkedHash',(SELECT checked_hash FROM a),'frameBlock',(SELECT block_number::text FROM f),
'frameHash',(SELECT block_hash FROM f),'probe',${binding.readSchema}.base_metadata_probe(),
'nativeMode',EXISTS(SELECT 1 FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'AND ingestion_mode='native'),
'canonical',EXISTS(SELECT 1 FROM a JOIN unified_ypal_20261023_v1.chain_block b ON b.chain_id=8453 AND b.block_number=a.checked_block AND b.block_hash=a.checked_hash))FROM stamp`;
export async function approval(db) {
  const started = process.hrtime.bigint(); const rows = (await db.query(APPROVAL_SQL)).rows; const ended = process.hrtime.bigint();
  assert(rows.length === 1, "one_complete_genuine_approval_snapshot_required"); const value = Object.values(rows[0])[0];
  assert(value && value.release === RELEASE && value.identity === IDENTITY && value.state === "ready" && value.errorCode === null && value.probe === true && value.nativeMode === true && value.canonical === true && value.frontier === value.frameFrontier && value.implementation === IMPLEMENTATION, "complete_actual_native_readiness_predicates_required");
  assert(["atUs", "checkedUs", "checkedBlock", "frameBlock"].every(key => typeof value[key] === "string" && /^[0-9]+$/.test(value[key])) && BigInt(value.checkedBlock) <= BigInt(value.frameBlock) && ["checkedHash", "frameHash"].every(key => typeof value[key] === "string" && /^0x[a-f0-9]{64}$/.test(value[key])), "actual_canonical_frame_and_checked_block_required");
  const age = (BigInt(value.atUs) - BigInt(value.checkedUs)) * 1000n; const remaining = 120000000000n - age - (ended - started);
  assert(age >= 0n && age < 120000000000n && remaining > 5000000000n, "genuine_producer120_with_five_second_reserve_required");
  return { snapshot: value, ageNanoseconds: String(age), queryNanoseconds: String(ended - started), remainingNanoseconds: String(remaining), capturedMonotonicNanoseconds: String(ended), policyTTLSeconds: 120, literalACKReserveSeconds: 5, producerApprovalWrittenByThisGate: false };
}
function fence(plan, prep, state, gate) {
  const value = plan.verificationFence;
  keys(value, ["format", "preparationReceiptSha256", "catalogSha256", "epochs", "approvalSemantic", "fullVerificationSha256"], "complete_own_full_verification_fence_required");
  assert(value.format === FORMAT + "-verification-fence" && pin(value.fullVerificationSha256), "actual_full_verification_proof_ref_required");
  assert.equal(value.preparationReceiptSha256, digest(prep)); assert.equal(value.catalogSha256, digest(catalog(state)));
  equal(catalog(state), catalog(prep.after), "installed_owned_guard_catalog_must_stay_exact");
  epochShape(value.epochs); equal(state.epochs, value.epochs, "no_semantic_data_change_since_full_verification_required");
  equal(semantic(gate.snapshot), value.approvalSemantic, "same_full_verification_native_semantic_approval_required");
}
const transactions = new WeakMap();
export async function beforeAcknowledgement(db, plan) {
  const live = transactions.get(db); assert(live && live.phase === plan.phase, "same_actual_phase_transaction_required");
  const state = await capture(db);
  equal(state, live.after, "same_actual_phase_catalog_and_epochs_before_ACK_required");
  const proof = { format: FORMAT + "-commit-boundary", phase: plan.phase, originalPlanSha256: digest(originalPlan(plan)), catalogSha256: digest(catalog(state)), epochs: state.epochs, fullHeldCallbackClaimed: false, oldC54CommitClaimed: false };
  if (plan.phase === "activate-reads") {
    const gate = await approval(db); const beforeGrants = { ...state, acl: live.before.acl };
    fence(plan, live.prep, beforeGrants, gate);
    equal(state.epochs, live.before.epochs, "activation_does_not_reinstall_or_increment_epochs");
    actualFour(live.before, state, originalPlan(plan)); proof.approval = gate; proof.verificationFenceSha256 = digest(plan.verificationFence);
    live.approvalDeadline = BigInt(gate.capturedMonotonicNanoseconds) + BigInt(gate.remainingNanoseconds) - 5000000000n;
  }
  live.deadline = process.hrtime.bigint() + 5000000000n;
  return proof;
}
export function afterAcknowledgement(db, plan) {
  const live = transactions.get(db); assert(live && live.phase === plan.phase, "same_phase_after_literal_ACK_required");
  const now = process.hrtime.bigint(); assert(now < live.deadline, "real_five_second_literal_ACK_tail_required");
  if (plan.phase === "activate-reads") assert(now < live.approvalDeadline, "real_current120_approval_reserve_required");
}
export async function apply(db, plan, installer) {
  const old = originalPlan(plan); const activation = plan.phase === "activate-reads";
  assert(activation ? typeof plan.preparationReceiptJson === "string" : plan.preparationReceiptJson === null && plan.verificationFence === null, "explicit_separate_phase_inputs_required");
  let before, after; const prep = activation ? preparation(plan) : null;
  try {
    await begin(db, activation); before = await capture(db);
    if (!activation) {
      equal(catalog(before), catalog(old.before), "same_original_preparation_catalog_required");
      await installer(db); await native(db); const installed = await capture(db);
      equal(catalog(installed), catalog(old.after), "complete_original_installer_target_required"); equal(effect(before, installed), old.addedSelects, "all_original_installer_effect_predicates_required"); actualFour(before, installed, old); incremented(before.epochs, installed.epochs);
      for (const grant of old.addedSelects) await db.query(`REVOKE SELECT ON TABLE ${relation(grant.name)} FROM ${quote(grant.role)}`);
      after = await capture(db); equal(catalog(after), { ...catalog(installed), acl: before.acl }, "no_grants_visible_from_guard_preparation_required");
      equal(after.epochs, installed.epochs, "only_one_preparation_epoch_increment_required");
    } else {
      await native(db); const gate = await approval(db); fence(plan, prep, before, gate);
      for (const grant of old.addedSelects) await db.query(`GRANT SELECT ON TABLE ${relation(grant.name)} TO ${quote(grant.role)}`);
      after = await capture(db); actualFour(before, after, old); equal(catalog(after), catalog(old.after), "exact_original_final_catalog_required"); equal(after.epochs, before.epochs, "no_activation_epoch_increment_required");
    }
    transactions.set(db, { phase: plan.phase, before, after, prep }); await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { transactions.delete(db); }
  return { format: FORMAT, phase: plan.phase, binding, originalPlanSha256: digest(old), before, after, beforeCatalogSha256: digest(catalog(before)), afterCatalogSha256: digest(catalog(after)), committed: true, readGrantsExternallyActivated: activation, epochPolicy: activation ? "prepared_epoch_unchanged" : "increment_current_once", cacheSetsOrMembersWritten: 0, sourceRowsWritten: 0, guardMetadataPrepared: !activation, epochRowsIncremented: activation ? 0 : 4, oldC54CommitClaimed: false };
}

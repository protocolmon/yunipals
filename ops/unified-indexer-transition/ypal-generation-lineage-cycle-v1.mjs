// One recurrent cycle, with an explicit caller-owned authority/ledger boundary.
// The caller owns the singleton, capacity supervisor, exact installed f81/2b
// inventory, private files, source/reader proofs and root-fsynced receipt files.
// This module never loops, starts a service, creates a Pool or retries a command.
import assert from "node:assert/strict";
import {
  FORMAT,
  digest,
  generationRecord,
  inspectGenerationLineage,
  retainedGenerationSelector,
  sealCycle,
  validateLineage
} from "./ypal-generation-lineage-v1.mjs";
import {
  globalPublicationObservation,
  publishPreparedCandidate
} from "./ypal-native-cutover-v1.mjs";
import { observeGenerationRecovery } from "./ypal-generation-recovery-v1.mjs";
import { validateCycleLedgerPrefix } from "./ypal-generation-lineage-ledger-v1.mjs";

const pin = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const required = [
  "currentWriterQualified",
  "nativeMetadataQualified",
  "allFourSourcesQualified",
  "readersAndCacheQualified",
  "capacityQualified",
  "exclusiveGenerationWriterQualified",
  "originalCapsuleQualified",
  "rollbackRehearsalQualified",
  "retainedPrivateInputsQualified"
];

function authority(value) {
  assert(value?.validated === true && value.paidAuthority === false);
  for (const name of required)
    assert.equal(value[name], true, `actual_${name}_prerequisite_required`);
  assert(pin(value.stableBindingSha256));
  assert(
    Number.isSafeInteger(value.observedAtUnixMs) &&
      value.observedAtUnixMs <= Date.now() &&
      Date.now() - value.observedAtUnixMs <= 30_000 &&
      Number.isSafeInteger(value.expiresAtUnixMs) &&
      value.expiresAtUnixMs > Date.now(),
    "fresh_owned_epoch_scope_with_unextended_expiry_required"
  );
  return value.stableBindingSha256;
}

/** The returned cycle is evidence only after the caller durably acknowledges it.
 * The installed generation-prepare CLI is the ONLY permitted build callback;
 * the ordinary sequential worker/generation-refresh entry is never selected.
 */
export async function runGenerationLineageCycle({
  db,
  root,
  cycles,
  official,
  prepare,
  scope,
  ledger,
  boundaryPoints
}) {
  for (const callback of [
    prepare,
    scope,
    ...["begin", "built", "privatePrepared", "beforeCommit", "complete"].map(
      (name) => ledger?.[name]
    )
  ])
    assert.equal(typeof callback, "function");
  const chain = validateLineage(root, cycles);
  assert(cycles.length < 768, "finite_owned_epoch_cycle_limit_required");
  const firstAuthority = structuredClone(await scope("before-build"));
  const binding = authority(firstAuthority);
  const qualified = async (stage) => {
    const current = structuredClone(await scope(stage));
    assert.equal(
      authority(current),
      binding,
      "owned_authority_changed_during_cycle"
    );
    assert.equal(
      current.expiresAtUnixMs,
      firstAuthority.expiresAtUnixMs,
      "cycle_cannot_renew_or_change_admitted_expiry"
    );
    return current;
  };
  await inspectGenerationLineage(db, root, cycles);
  const original = await observeGenerationRecovery(db);
  const intent = {
    format: FORMAT + "-cycle-intent",
    rootSha256: chain.rootSha256,
    operationSha256: root.operationSha256,
    producerSha256: root.recurringProducerSha256,
    ordinal: cycles.length + 1,
    priorReceiptSha256: chain.lastReceiptSha256,
    predecessorGenerationId: chain.head.generationId,
    authorityBindingSha256: binding,
    preservedGenerationIds: retainedGenerationSelector(root, cycles),
    automaticRetry: false
  };
  // Must publish exclusively/fsync BEFORE the single official build invocation.
  assert.equal(await ledger.begin(intent), true);
  const prepared = await prepare(intent);
  assert(
    prepared?.event === "native_generation_prepared" &&
      prepared.prepared === true &&
      prepared.published === false &&
      prepared.predecessor === chain.head.generationId,
    "one_actual_official_unpublished_candidate_required"
  );
  assert.deepEqual(
    await observeGenerationRecovery(db),
    original,
    "preparation_and_cleanup_must_preserve_active_wallets_and_stamps"
  );
  await inspectGenerationLineage(db, root, cycles);
  const row = await generationRecord(db, prepared.generationId);
  assert.equal(row.value.state, "ready");
  assert.equal(row.value.published_at, null);
  assert.deepEqual(row.value.validation, prepared.validation);
  const observation = await globalPublicationObservation(
    db,
    prepared.generationId
  );
  assert.equal(observation.pointer.current, chain.head.generationId);
  assert.equal(observation.archive, root.archiveRelease);
  const plan = {
    generationId: prepared.generationId,
    predecessorGenerationId: chain.head.generationId,
    metadataReleaseId: root.archiveRelease,
    sourceRelease: root.dataIdentity.sourceRelease,
    readIdentity: root.dataIdentity.readIdentity,
    candidateSourceSnapshot: row.value.validation.sourceSnapshot,
    validationSqlSha256: observation.candidate.validationSha256,
    originalObservationSha256: digestPlain(observation),
    boundaryPoints
  };
  await qualified("after-build");
  assert.equal(
    await ledger.built({ intentSha256: digest(intent), prepared, plan }),
    true
  );
  let packet;
  const publication = await publishPreparedCandidate(db, official, plan, {
    privatePrepared: async (value) => {
      await qualified("private-prepared");
      return ledger.privatePrepared(value);
    },
    beforeCommit: async (value) => {
      const finalAuthority = await qualified("before-commit");
      packet = structuredClone(value);
      // The caller authenticates the actual XID/prepared packet and fsyncs it.
      // No further root round trip occurs before the official dual CAS/COMMIT.
      const acknowledged = await ledger.beforeCommit(value);
      authority(finalAuthority); // fsync cannot carry a COMMIT past admitted expiry.
      return acknowledged;
    }
  });
  assert.equal(publication.preparedPacketSha256, digestPlain(packet));
  const actual = await generationRecord(db, prepared.generationId);
  const value = sealCycle({
    format: FORMAT + "-cycle",
    ordinal: intent.ordinal,
    operationSha256: root.operationSha256,
    producerSha256: root.recurringProducerSha256,
    priorReceiptSha256: chain.lastReceiptSha256,
    generationId: prepared.generationId,
    predecessorGenerationId: chain.head.generationId,
    rowSqlSha256: actual.rowSqlSha256,
    immutableSqlSha256: actual.immutableSqlSha256,
    sourceSnapshot: actual.value.validation.sourceSnapshot,
    xid: publication.xid,
    preparedPacketSha256: publication.preparedPacketSha256,
    ownedDerivedObservation: await observeGenerationRecovery(db),
    authorityBindingSha256: binding
  });
  await inspectGenerationLineage(db, root, [...cycles, value]);
  assert.equal(
    await ledger.complete(value),
    true,
    "cycle_commit_ACK_missing_stop_and_reconcile_never_republish"
  );
  return value;
}

// Protocol950b hashes exact wire objects, not the sorted root/cycle encoding.
import { createHash } from "node:crypto";
const digestPlain = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Read-only lost-ACK inspection. Never builds, publishes or writes a receipt.
 * `records` must first be loaded from the same protected pending cycle ledger.
 * An explicit owner can acknowledge this exact result after its own gates;
 * no scheduled next cycle is allowed while the pending directory exists.
 */
export async function reconcileGenerationLineageCycle(
  db,
  root,
  cycles,
  records
) {
  assert.deepEqual(
    Object.keys(records).sort(),
    ["built.json", "intent.json", "prepared.json", "private.json"].sort(),
    "only_complete_prepared_prefix_can_reconcile_without_republication"
  );
  validateCycleLedgerPrefix(root, cycles, records, cycles.length + 1);
  const packet = JSON.parse(records["prepared.json"].wireJson);
  const status = (
    await db.query("SELECT pg_xact_status($1::xid8)AS status", [packet.xid])
  ).rows[0]?.status;
  assert.equal(
    status,
    "committed",
    "prepared_XID_not_committed_do_not_build_or_publish_again"
  );
  const plan = records["built.json"].plan;
  const actual = await globalPublicationObservation(db, plan.generationId);
  assert.deepEqual(
    actual,
    {
      ...packet.staged,
      candidate: { ...packet.staged.candidate, published: true },
      pointer: packet.expectedPointer,
      stamps: packet.expectedStamps
    },
    "lost_ACK_requires_exact_owned_committed_global_tuple"
  );
  const row = await generationRecord(db, plan.generationId);
  const cycle = sealCycle({
    format: FORMAT + "-cycle",
    ordinal: cycles.length + 1,
    operationSha256: root.operationSha256,
    producerSha256: root.recurringProducerSha256,
    priorReceiptSha256: validateLineage(root, cycles).lastReceiptSha256,
    generationId: plan.generationId,
    predecessorGenerationId: plan.predecessorGenerationId,
    rowSqlSha256: row.rowSqlSha256,
    immutableSqlSha256: row.immutableSqlSha256,
    sourceSnapshot: row.value.validation.sourceSnapshot,
    xid: packet.xid,
    preparedPacketSha256: records["prepared.json"].sha256,
    ownedDerivedObservation: await observeGenerationRecovery(db),
    authorityBindingSha256: records["intent.json"].authorityBindingSha256
  });
  validateCycleLedgerPrefix(
    root,
    cycles,
    { ...records, "result.json": cycle },
    cycles.length + 1
  );
  await inspectGenerationLineage(db, root, [...cycles, cycle]);
  return {
    cycle,
    reconciledWithoutBuildOrPublication: true,
    receiptWritten: false,
    sourceReadinessQualified: false,
    workerActivationQualified: false,
    twentyFourHourRefreshQualified: false,
    databaseWrites: 0
  };
}

// Source-only lineage component. Caller authenticates protected root/cycle ACKs,
// owns worker/source/reader/capacity gates and never retries an unknown COMMIT.
// No Pool, service, provider, role or automatic worker is constructed here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { binding } from "./ypal-cache-guard-transition-v1.mjs";
import { observeGenerationRecovery } from "./ypal-generation-recovery-v1.mjs";

export const FORMAT = "yunipals-ypal-generation-lineage-v1";
export const MAX_CYCLES = 768;
const decimal = (value) =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
const pin = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  return value;
};
export const encode = (value) => JSON.stringify(stable(value)) + "\n";
export const digest = (value) =>
  createHash("sha256").update(encode(value)).digest("hex");
const plainDigest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function snapshot(value, root, predecessor) {
  assert(
    value?.version === 1 &&
      value.releaseId === binding.sourceRelease &&
      value.readIdentity === binding.readIdentity &&
      value.physicalSchema === binding.physicalSchema &&
      value.manifestHash === root.manifestHash &&
      value.metadataReleaseId === root.archiveRelease &&
      value.predecessor === predecessor &&
      typeof value.baseMetadataFrontier === "string" &&
      value.baseMetadataFrontier.length > 0 &&
      Number.isFinite(Date.parse(value.capturedAt)),
    "same_owned_generation_snapshot_binding_required"
  );
  assert.equal(value.anchors.length, 4);
  assert.deepEqual(
    [...new Set(value.anchors.map((a) => a.chain_id))].sort((a, b) => a - b),
    [1, 56, 137, 8453]
  );
  for (const anchor of value.anchors)
    assert(
      /^[0-9]+$/.test(anchor.block_number) &&
        /^0x[a-f0-9]{64}$/.test(anchor.block_hash),
      "four_actual_captured_canonical_anchors_required"
    );
}

function derivedObservation(value, generationId, predecessor) {
  assert.deepEqual(value?.pointer, {
    current_id: generationId,
    previous_id: predecessor
  });
  assert(pin(value.generationBindingSha256));
  for (const name of ["walletStats", "derivedStamps"])
    assert(
      value[name] &&
        /^[0-9]+$/.test(value[name].count) &&
        pin(value[name].sha256)
    );
  assert.equal(value.derivedStamps.count, "2");
}

export function validateLineage(root, cycles) {
  assert.equal(root.format, FORMAT + "-root");
  assert.deepEqual(root.dataIdentity, binding);
  assert(/^0x[a-f0-9]{64}$/.test(root.manifestHash));
  assert(
    pin(root.operationSha256) &&
      pin(root.recurringProducerSha256) &&
      pin(root.initialPublicationSha256) &&
      pin(root.capsuleSha256) &&
      pin(root.capsuleContextSha256) &&
      pin(root.legacyGenerationBindingSha256),
    "actual_protected_epoch_and_capsule_references_required"
  );
  assert.equal(root.legacyGenerationId, "103");
  assert(
    root.legacyPreviousGenerationId === null ||
      decimal(root.legacyPreviousGenerationId)
  );
  assert.equal(typeof root.archiveRelease, "string");
  assert(root.archiveRelease.length > 0 && root.archiveRelease.length <= 200);
  assert(Array.isArray(cycles) && cycles.length <= MAX_CYCLES);
  const initial = root.initial;
  assert(decimal(initial.generationId));
  assert.equal(initial.predecessorGenerationId, root.legacyGenerationId);
  assert(BigInt(initial.generationId) > BigInt(root.legacyGenerationId));
  assert(pin(initial.immutableSqlSha256) && pin(initial.rowSqlSha256));
  snapshot(initial.sourceSnapshot, root, initial.predecessorGenerationId);
  derivedObservation(
    initial.ownedDerivedObservation,
    initial.generationId,
    initial.predecessorGenerationId
  );
  const entries = [initial];
  let prior = root.initialPublicationSha256;
  for (const [index, record] of cycles.entries()) {
    assert.deepEqual(Object.keys(record).sort(), ["sha256", "value"]);
    assert(pin(record.sha256) && record.sha256 === digest(record.value));
    const cycle = record.value;
    assert.equal(cycle.format, FORMAT + "-cycle");
    assert.equal(cycle.ordinal, index + 1);
    assert.equal(cycle.operationSha256, root.operationSha256);
    assert.equal(cycle.producerSha256, root.recurringProducerSha256);
    assert.equal(cycle.priorReceiptSha256, prior);
    assert.equal(cycle.predecessorGenerationId, entries.at(-1).generationId);
    assert(
      decimal(cycle.generationId) &&
        BigInt(cycle.generationId) > BigInt(cycle.predecessorGenerationId),
      "strict_acknowledged_predecessor_chain_required"
    );
    assert(pin(cycle.immutableSqlSha256) && pin(cycle.rowSqlSha256));
    assert(
      typeof cycle.xid === "string" &&
        /^[1-9][0-9]{0,19}$/.test(cycle.xid) &&
        BigInt(cycle.xid) <= 18446744073709551615n,
      "bounded_actual_full_transaction_id_required"
    );
    assert(pin(cycle.preparedPacketSha256));
    snapshot(cycle.sourceSnapshot, root, cycle.predecessorGenerationId);
    derivedObservation(
      cycle.ownedDerivedObservation,
      cycle.generationId,
      cycle.predecessorGenerationId
    );
    entries.push(cycle);
    prior = record.sha256;
  }
  assert.equal(
    new Set(entries.map((e) => e.generationId)).size,
    entries.length
  );
  return {
    entries,
    head: entries.at(-1),
    lastReceiptSha256: prior,
    rootSha256: digest(root),
    protectedGenerationIds: [
      root.legacyGenerationId,
      root.legacyPreviousGenerationId,
      initial.generationId
    ].filter(Boolean)
  };
}

export function retainedGenerationSelector(root, cycles) {
  return validateLineage(root, cycles).protectedGenerationIds.join(",");
}

export async function generationRecord(db, generationId) {
  assert(decimal(generationId));
  const result = await db.query(
    `SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)AS value,
      encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex')AS "rowSqlSha256",
      encode(sha256(convert_to((to_jsonb(g)-'state'-'retired_at')::text,'UTF8')),'hex')AS "immutableSqlSha256"
     FROM metadata_projection.generation g WHERE id=$1`,
    [generationId]
  );
  assert.equal(
    result.rows.length,
    1,
    "every_owned_lineage_generation_must_exist"
  );
  return result.rows[0];
}

/** Read-only logical provenance, not writer/serving/canonical/24-hour authority.
 * Metadata frontiers may advance BETWEEN cycles. Only the current publication
 * predicate is allowed to qualify a fresh build; ancestors are historical facts.
 */
export async function inspectGenerationLineage(
  db,
  root,
  cycles,
  share = false
) {
  const chain = validateLineage(root, cycles);
  assert.equal(typeof share, "boolean");
  if (share) {
    // Caller already holds the official trait/leaderboard/recovery locks and
    // active/archive row locks. Keep every acknowledged row fixed to COMMIT.
    await db.query(
      "SELECT id FROM metadata_projection.generation WHERE id=ANY($1::bigint[])ORDER BY id FOR SHARE",
      [
        [
          ...new Set([
            ...chain.entries.map((entry) => entry.generationId),
            ...chain.protectedGenerationIds
          ])
        ]
      ]
    );
  }
  const current = (
    await db.query(
      "SELECT current_id::text,previous_id::text FROM metadata_projection.active WHERE singleton"
    )
  ).rows[0];
  assert.deepEqual(
    current,
    {
      current_id: chain.head.generationId,
      previous_id: chain.head.predecessorGenerationId
    },
    "current_pointer_must_be_exact_acknowledged_lineage_head"
  );
  const archives = (
    await db.query(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
    )
  ).rows;
  assert.deepEqual(
    archives,
    [{ release_id: root.archiveRelease }],
    "archive_rotation_suspends_lineage_epoch_and_original_capsule"
  );
  const legacy = (
    await db.query(
      `SELECT jsonb_build_object(
    'generation',(SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.generation g WHERE id=$1),
    'previous',(SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.generation g WHERE id=$2),
    'archive',(SELECT release_id FROM metadata_source.archive_release WHERE state='active'))AS value`,
      [root.legacyGenerationId, root.legacyPreviousGenerationId]
    )
  ).rows[0].value;
  // The capsule's original hash domain sorts keys WITHOUT a trailing newline.
  assert.equal(
    plainDigest(stable(legacy)),
    root.legacyGenerationBindingSha256,
    "original103_prior_and_archive_must_match_exact_capsule_binding"
  );
  assert.deepEqual(
    await observeGenerationRecovery(db),
    chain.head.ownedDerivedObservation,
    "live_wallets_full_stamps_and_generation_tuple_must_match_acknowledged_head"
  );
  const observed = [];
  for (const entry of chain.entries) {
    const record = await generationRecord(db, entry.generationId);
    const row = record.value;
    assert.equal(record.immutableSqlSha256, entry.immutableSqlSha256);
    assert.equal(row.ownership_release_id, binding.sourceRelease);
    assert.equal(row.ownership_read_identity, binding.readIdentity);
    assert.equal(row.metadata_release_id, root.archiveRelease);
    assert.equal(row.source_mode, "archive");
    assert.equal(row.format_version, 1);
    assert(row.published_at !== null && row.completed_at !== null);
    assert.deepEqual(row.validation.sourceSnapshot, entry.sourceSnapshot);
    const protectedRow =
      chain.protectedGenerationIds.includes(row.id) ||
      row.id === current.current_id ||
      row.id === current.previous_id;
    if (protectedRow || row.state === "ready") {
      assert.equal(row.state, "ready");
      assert.equal(row.retired_at, null);
      assert.equal(record.rowSqlSha256, entry.rowSqlSha256);
    } else {
      // The installed f81 cleanup changes ONLY state/retired_at and payloads.
      // Missing rows, rewritten parents, validation or publication times fail.
      assert.equal(row.state, "retired");
      assert(
        Date.parse(row.retired_at) >=
          Math.max(Date.parse(row.started_at), Date.parse(row.published_at)) +
            15 * 60_000,
        "only_normal_eligible_intermediate_cleanup_is_allowed"
      );
    }
    if (entry.xid) {
      const status = (
        await db.query("SELECT pg_xact_status($1::xid8)AS status", [entry.xid])
      ).rows[0]?.status;
      assert.equal(
        status,
        "committed",
        "each_owned_cycle_COMMIT_must_be_proven"
      );
    }
    observed.push({ generationId: row.id, state: row.state });
  }
  return {
    format: FORMAT + "-current",
    validated: true,
    rootSha256: chain.rootSha256,
    currentGenerationId: chain.head.generationId,
    previousGenerationId: chain.head.predecessorGenerationId,
    initialNativeGenerationId: root.initial.generationId,
    protectedGenerationIds: chain.protectedGenerationIds,
    lastReceiptSha256: chain.lastReceiptSha256,
    acknowledgedCycles: cycles.length,
    observedGenerations: observed,
    sourceReadinessQualified: false,
    currentCanonicalCoverageQualified: false,
    readerServingQualified: false,
    laterGenerationLineageQualified: true,
    twentyFourHourRefreshQualified: false,
    workerActivationQualified: false,
    databaseWrites: 0,
    providerCalls: 0,
    serviceActions: 0
  };
}

/** Exact object consumed by original capsule CAS; caller authenticates the
 * protected root and complete cycle files, not an arbitrary array of ready rows.
 */
export async function validateLineageRecovery(db, root, cycles, receipt) {
  assert.equal(
    root.capsuleSha256,
    digest(receipt),
    "same_canonical_capsule_receipt_required"
  );
  assert.equal(root.capsuleContextSha256, receipt.contextSha256);
  assert.equal(root.archiveRelease, receipt.archiveRelease);
  assert.equal(root.legacyGenerationId, receipt.currentGeneration);
  assert.equal(root.legacyPreviousGenerationId, receipt.previousGeneration);
  assert.equal(
    root.legacyGenerationBindingSha256,
    receipt.generationBindingSha256
  );
  const proof = await inspectGenerationLineage(db, root, cycles, true);
  return {
    ...proof,
    predecessorGenerationId: validateLineage(root, cycles).head
      .predecessorGenerationId
  };
}

export function sealCycle(value) {
  return { sha256: digest(value), value: structuredClone(value) };
}

export const generationIdentity = binding;
export const publicationObservationDigest = plainDigest;

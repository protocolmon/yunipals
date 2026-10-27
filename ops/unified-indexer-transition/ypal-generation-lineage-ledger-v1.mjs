// Root-private append-only files. Filesystem provenance only: no DB, source,
// reader, capacity, activation or 24-hour authority is inferred from this leaf.
import assert from "node:assert/strict";
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";
import { createHash } from "node:crypto";
import {
  digest,
  encode,
  FORMAT,
  validateLineage
} from "./ypal-generation-lineage-v1.mjs";

export const BASE =
  "/var/backups/yunipals-ypal-generation-lineage-v1-20261024/epochs";
const names = [
  "intent.json",
  "built.json",
  "private.json",
  "prepared.json",
  "result.json"
];
const same = (a, b) =>
  [
    "dev",
    "ino",
    "mode",
    "uid",
    "gid",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs"
  ].every((key) => a[key] === b[key]);
const rawDigest = (value) => createHash("sha256").update(value).digest("hex");
const wire = (value) => ({
  value,
  wireJson: JSON.stringify(value),
  sha256: rawDigest(JSON.stringify(value))
});
function wireValue(envelope) {
  assert.deepEqual(Object.keys(envelope).sort(), [
    "sha256",
    "value",
    "wireJson"
  ]);
  assert.equal(envelope.sha256, rawDigest(envelope.wireJson));
  assert.deepEqual(JSON.parse(envelope.wireJson), envelope.value);
  return envelope.value;
}

export function validateCycleLedgerPrefix(root, cycles, records, ordinal) {
  const chain = validateLineage(root, cycles),
    intent = records["intent.json"];
  if (!intent) {
    assert.deepEqual(records, {});
    return;
  }
  assert.equal(intent.format, FORMAT + "-cycle-intent");
  assert.equal(intent.rootSha256, chain.rootSha256);
  assert.equal(intent.operationSha256, root.operationSha256);
  assert.equal(intent.producerSha256, root.recurringProducerSha256);
  assert.equal(intent.ordinal, ordinal);
  assert.equal(intent.priorReceiptSha256, chain.lastReceiptSha256);
  assert.equal(intent.predecessorGenerationId, chain.head.generationId);
  assert.equal(
    intent.preservedGenerationIds,
    chain.protectedGenerationIds.join(",")
  );
  assert.equal(intent.automaticRetry, false);
  assert(/^[a-f0-9]{64}$/.test(intent.authorityBindingSha256));
  const built = records["built.json"],
    priv = records["private.json"] && wireValue(records["private.json"]),
    packet = records["prepared.json"] && wireValue(records["prepared.json"]),
    result = records["result.json"];
  if (built) {
    assert.equal(built.intentSha256, digest(intent));
    assert.equal(built.prepared.event, "native_generation_prepared");
    assert.equal(built.prepared.prepared, true);
    assert.equal(built.prepared.published, false);
    assert.equal(built.prepared.predecessor, intent.predecessorGenerationId);
    assert.equal(built.plan.generationId, built.prepared.generationId);
    assert.equal(
      built.plan.predecessorGenerationId,
      intent.predecessorGenerationId
    );
    assert.equal(built.plan.metadataReleaseId, root.archiveRelease);
    assert.deepEqual(
      built.plan.candidateSourceSnapshot,
      built.prepared.validation.sourceSnapshot
    );
  }
  if (priv) {
    assert.equal(priv.event, "private-prepared");
    assert.equal(priv.generationId, built.plan.generationId);
    assert.equal(priv.predecessorGenerationId, intent.predecessorGenerationId);
    assert.equal(
      priv.originalObservationSha256,
      built.plan.originalObservationSha256
    );
  }
  if (packet) {
    assert.equal(packet.event, "publication-prepared");
    assert.equal(packet.generationId, built.plan.generationId);
    assert.equal(
      packet.predecessorGenerationId,
      intent.predecessorGenerationId
    );
    assert.equal(packet.privatePacketSha256, records["private.json"].sha256);
    assert.equal(
      packet.stagedObservationSha256,
      rawDigest(
        JSON.stringify(JSON.parse(records["prepared.json"].wireJson).staged)
      )
    );
    assert.deepEqual(packet.expectedPointer, {
      current: built.plan.generationId,
      previous: intent.predecessorGenerationId
    });
    assert.deepEqual(packet.staged.walletStats, {
      rows: priv.walletRows,
      sha256: priv.walletRowsSha256
    });
    assert.deepEqual(
      packet.expectedStamps,
      ["leaderboard", "traits"].map((name) => ({
        name,
        metadataRelease: root.archiveRelease,
        sourceRelease: root.dataIdentity.sourceRelease,
        readIdentity: root.dataIdentity.readIdentity
      }))
    );
  }
  if (result) {
    validateLineage(root, [...cycles, result]);
    assert.equal(result.value.xid, packet.xid);
    assert.equal(
      result.value.preparedPacketSha256,
      records["prepared.json"].sha256
    );
    assert.equal(result.value.generationId, built.plan.generationId);
    assert.deepEqual(
      result.value.sourceSnapshot,
      built.plan.candidateSourceSnapshot
    );
    assert.equal(
      result.value.authorityBindingSha256,
      intent.authorityBindingSha256
    );
    assert.deepEqual(result.value.ownedDerivedObservation.pointer, {
      current_id: packet.expectedPointer.current,
      previous_id: packet.expectedPointer.previous
    });
    assert.deepEqual(result.value.ownedDerivedObservation.walletStats, {
      count: packet.staged.walletStats.rows,
      sha256: packet.staged.walletStats.sha256
    });
    assert.equal(result.value.ownedDerivedObservation.derivedStamps.count, "2");
    assert(
      /^[a-f0-9]{64}$/.test(
        result.value.ownedDerivedObservation.derivedStamps.sha256
      )
    );
  }
}

function directory(path, privateOnly = false) {
  assert(isAbsolute(path), "absolute_ledger_directory_required");
  const parts = [];
  let next = path;
  while (next !== parse(next).root) {
    parts.unshift(next);
    next = dirname(next);
  }
  parts.unshift(next);
  for (const part of parts) {
    const st = lstatSync(part);
    assert(
      st.isDirectory() && st.uid === 0 && st.gid === 0 && !(st.mode & 0o022),
      "root_owned_nonwritable_nonsymlink_ledger_ancestors_required"
    );
  }
  if (privateOnly) assert.equal(lstatSync(path).mode & 0o777, 0o700);
}
function read(path) {
  directory(dirname(path), true);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert(
      before.isFile() &&
        before.uid === 0n &&
        before.gid === 0n &&
        before.nlink === 1n &&
        (before.mode & 0o777n) === 0o600n &&
        before.size <= 2_000_000n,
      "private_single_bounded_ledger_file_required"
    );
    const raw = readFileSync(fd);
    assert(
      same(before, fstatSync(fd, { bigint: true })) &&
        same(before, lstatSync(path, { bigint: true })),
      "ledger_file_changed_during_read"
    );
    const value = JSON.parse(raw);
    assert.equal(
      raw.toString(),
      encode(value),
      "exact_canonical_ledger_bytes_required"
    );
    return value;
  } finally {
    closeSync(fd);
  }
}
function syncDir(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function save(path, value) {
  directory(dirname(path), true);
  const raw = Buffer.from(encode(value));
  assert(raw.length <= 2_000_000);
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDir(dirname(path));
}

/** General filesystem primitive for an already-authenticated private directory.
 * Production owners use openLineageLedger's fixed BASE, never a caller path.
 * Creating an epoch/root requires a separate reviewed activation owner.
 */
export function openLedgerDirectory(path, expectedRootSha256) {
  directory(path, true);
  const root = read(join(path, "root.json"));
  assert.equal(
    digest(root),
    expectedRootSha256,
    "same_protected_epoch_root_required"
  );
  let active;
  const observed = () => {
    directory(path, true);
    assert.equal(digest(read(join(path, "root.json"))), expectedRootSha256);
    const entries = readdirSync(path).sort();
    assert(entries.includes("root.json"));
    const ids = entries.filter((v) => v !== "root.json");
    assert(
      ids.length <= 768 && ids.every((v) => /^cycle-[0-9]{4}$/.test(v)),
      "only_finite_named_owned_cycle_directories_allowed"
    );
    const cycles = [];
    let pending = null;
    for (const [i, id] of ids.entries()) {
      assert.equal(id, "cycle-" + String(i + 1).padStart(4, "0"));
      const target = join(path, id);
      directory(target, true);
      const files = readdirSync(target).sort();
      assert(files.every((v) => names.includes(v)));
      const records = Object.fromEntries(
        files.map((name) => [name, read(join(target, name))])
      );
      // A partial durable prefix cannot be skipped or automatically repeated.
      const prefix = names.filter((name) => files.includes(name));
      assert.deepEqual(
        prefix,
        names.slice(0, files.length),
        "exact_owned_phase_prefix_required"
      );
      validateCycleLedgerPrefix(root, cycles, records, i + 1);
      if (records["result.json"]) {
        cycles.push(records["result.json"]);
      } else {
        assert.equal(i, ids.length - 1);
        pending = { id, records };
      }
    }
    validateLineage(root, cycles);
    return { root, cycles, pending };
  };
  const record = (name, value) => {
    assert(active, "one_owned_begin_must_precede_phase_records");
    const files = readdirSync(active);
    assert.deepEqual(
      names.filter((v) => files.includes(v)),
      names.slice(0, names.indexOf(name))
    );
    const state = observed();
    assert.equal(join(path, state.pending.id), active);
    validateCycleLedgerPrefix(
      root,
      state.cycles,
      { ...state.pending.records, [name]: value },
      state.cycles.length + 1
    );
    save(join(active, name), value);
    return true;
  };
  return {
    observe: observed,
    begin: async (intent) => {
      const state = observed();
      assert.equal(
        state.pending,
        null,
        "unknown_cycle_prefix_requires_readonly_reconciliation"
      );
      assert.equal(intent.rootSha256, expectedRootSha256);
      assert.equal(intent.ordinal, state.cycles.length + 1);
      assert.equal(
        intent.priorReceiptSha256,
        state.cycles.at(-1)?.sha256 ?? root.initialPublicationSha256
      );
      assert.equal(intent.automaticRetry, false);
      validateCycleLedgerPrefix(
        root,
        state.cycles,
        { "intent.json": intent },
        intent.ordinal
      );
      active = join(path, "cycle-" + String(intent.ordinal).padStart(4, "0"));
      mkdirSync(active, { mode: 0o700 });
      syncDir(path);
      save(join(active, "intent.json"), intent);
      return true;
    },
    built: async (value) => record("built.json", value),
    privatePrepared: async (value) => record("private.json", wire(value)),
    beforeCommit: async (value) => record("prepared.json", wire(value)),
    complete: async (value) => {
      const state = observed();
      validateLineage(root, [...state.cycles, value]);
      return record("result.json", value);
    }
  };
}

export function openLineageLedger(epochId, expectedRootSha256) {
  assert(typeof epochId === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(epochId));
  assert(/^[a-f0-9]{64}$/.test(expectedRootSha256));
  return openLedgerDirectory(join(BASE, epochId), expectedRootSha256);
}

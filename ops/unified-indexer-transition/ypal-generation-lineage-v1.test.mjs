// Deterministic synthetic root/private filesystem controls; no DB or provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { derive } from "./ypal-generation-lineage-recovery-build-v1.mjs";
import {
  FORMAT,
  digest,
  encode,
  generationIdentity,
  sealCycle,
  validateLineage
} from "./ypal-generation-lineage-v1.mjs";
import {
  openLedgerDirectory,
  openLineageLedger
} from "./ypal-generation-lineage-ledger-v1.mjs";

const checks = [];
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pin = "12".repeat(32),
  archive = "synthetic-archive";
const snapshot = (predecessor) => ({
  version: 1,
  releaseId: generationIdentity.sourceRelease,
  readIdentity: generationIdentity.readIdentity,
  physicalSchema: generationIdentity.physicalSchema,
  manifestHash: "0x" + "23".repeat(32),
  metadataReleaseId: archive,
  predecessor,
  baseMetadataFrontier: "synthetic-frontier",
  capturedAt: new Date().toISOString(),
  anchors: [1, 56, 137, 8453].map((chain_id) => ({
    chain_id,
    block_number: "100",
    block_hash: "0x" + "ab".repeat(32)
  }))
});
const root = {
  format: FORMAT + "-root",
  dataIdentity: generationIdentity,
  manifestHash: "0x" + "23".repeat(32),
  operationSha256: pin,
  recurringProducerSha256: pin,
  initialPublicationSha256: pin,
  capsuleSha256: pin,
  capsuleContextSha256: pin,
  legacyGenerationBindingSha256: pin,
  archiveRelease: archive,
  legacyGenerationId: "103",
  legacyPreviousGenerationId: "102",
  initial: {
    generationId: "104",
    predecessorGenerationId: "103",
    rowSqlSha256: pin,
    immutableSqlSha256: pin,
    sourceSnapshot: snapshot("103"),
    ownedDerivedObservation: {
      pointer: { current_id: "104", previous_id: "103" },
      generationBindingSha256: pin,
      walletStats: { count: "1", sha256: pin },
      derivedStamps: { count: "2", sha256: pin }
    }
  }
};
const intent = {
  format: FORMAT + "-cycle-intent",
  rootSha256: digest(root),
  operationSha256: pin,
  producerSha256: pin,
  ordinal: 1,
  priorReceiptSha256: pin,
  predecessorGenerationId: "104",
  authorityBindingSha256: pin,
  preservedGenerationIds: "103,102,104",
  automaticRetry: false
};
const plan = {
  generationId: "105",
  predecessorGenerationId: "104",
  metadataReleaseId: archive,
  candidateSourceSnapshot: snapshot("104"),
  originalObservationSha256: pin
};
const built = {
  intentSha256: digest(intent),
  prepared: {
    event: "native_generation_prepared",
    prepared: true,
    published: false,
    predecessor: "104",
    generationId: "105",
    validation: { sourceSnapshot: plan.candidateSourceSnapshot }
  },
  plan
};
const priv = {
  event: "private-prepared",
  generationId: "105",
  predecessorGenerationId: "104",
  originalObservationSha256: pin,
  walletRows: "1",
  walletRowsSha256: pin
};
const staged = {
  candidate: { published: false },
  walletStats: { rows: "1", sha256: pin }
};
const packet = {
  event: "publication-prepared",
  generationId: "105",
  predecessorGenerationId: "104",
  xid: "12345",
  privatePacketSha256: hash(priv),
  staged,
  stagedObservationSha256: hash(staged),
  expectedPointer: { current: "105", previous: "104" },
  expectedStamps: ["leaderboard", "traits"].map((name) => ({
    name,
    metadataRelease: archive,
    sourceRelease: generationIdentity.sourceRelease,
    readIdentity: generationIdentity.readIdentity
  }))
};
const result = sealCycle({
  format: FORMAT + "-cycle",
  ordinal: 1,
  operationSha256: pin,
  producerSha256: pin,
  priorReceiptSha256: pin,
  generationId: "105",
  predecessorGenerationId: "104",
  rowSqlSha256: pin,
  immutableSqlSha256: pin,
  sourceSnapshot: plan.candidateSourceSnapshot,
  xid: packet.xid,
  preparedPacketSha256: hash(packet),
  authorityBindingSha256: pin,
  ownedDerivedObservation: {
    generationBindingSha256: pin,
    pointer: { current_id: "105", previous_id: "104" },
    walletStats: { count: "1", sha256: pin },
    derivedStamps: { count: "2", sha256: pin }
  }
});
const original = readFileSync(
  new URL("./ypal-generation-recovery-v1.mjs", import.meta.url)
);
assert.equal(
  derive(original),
  readFileSync(
    new URL("./ypal-generation-lineage-recovery-v1.mjs", import.meta.url),
    "utf8"
  )
);
assert.throws(() => derive(Buffer.concat([original, Buffer.from("\n")])));
checks.push("exact pinned capsule derivation and foreign predecessor refusal");
for (const xid of ["0", "-1", "18446744073709551616", "9".repeat(1000)]) {
  const wrong = structuredClone(result.value);
  wrong.xid = xid;
  assert.throws(
    () => validateLineage(root, [sealCycle(wrong)]),
    /bounded_actual/
  );
}
checks.push("full transaction IDs are bounded before SQL use");

const path = mkdtempSync(
  fileURLToPath(new URL(".lineage-private-test-", import.meta.url))
);
chmodSync(path, 0o700);
const put = (target, value) =>
  writeFileSync(target, encode(value), { mode: 0o600 });
put(join(path, "root.json"), root);
try {
  let ledger = openLedgerDirectory(path, digest(root));
  assert.deepEqual(ledger.observe().cycles, []);
  await ledger.begin(intent);
  const afterIntent = readdirSync(join(path, "cycle-0001"));
  await assert.rejects(ledger.begin(intent), /unknown_cycle/);
  assert.deepEqual(readdirSync(join(path, "cycle-0001")), afterIntent);
  checks.push(
    "exclusive named intent prevents duplicate build and pending-prefix skip"
  );
  await assert.rejects(
    ledger.built({ ...built, intentSha256: "ff".repeat(32) })
  );
  await ledger.built(built);
  await ledger.privatePrepared(priv);
  await assert.rejects(
    ledger.beforeCommit({ ...packet, privatePacketSha256: "ff".repeat(32) })
  );
  assert(!readdirSync(join(path, "cycle-0001")).includes("prepared.json"));
  await ledger.beforeCommit(packet);
  const pending = ledger.observe();
  assert.equal(pending.pending.records["prepared.json"].sha256, hash(packet));
  assert.notEqual(
    hash(pending.pending.records["prepared.json"].value),
    hash(packet)
  );
  checks.push(
    "semantic private/prepared links refuse mutation while exact wire JSON survives canonical file sorting"
  );
  ledger = openLedgerDirectory(path, digest(root));
  assert.equal(ledger.observe().pending.id, "cycle-0001");
  await assert.rejects(ledger.begin(intent), /unknown_cycle/);
  assert(!readdirSync(join(path, "cycle-0001")).includes("result.json"));
  checks.push(
    "fresh process reads unresolved prepared XID without writing or republishing"
  );
  // The original live callback can acknowledge only its own complete prefix.
  // A new process intentionally has no automatic finish/write authority.
  const reopened = ledger;
  ledger = openLedgerDirectory(path, digest(root));
  await assert.rejects(ledger.complete(result), /one_owned_begin/);
  put(join(path, "cycle-0001", "result.json"), result); // explicit synthetic root ACK
  assert.equal(reopened.observe().cycles[0].sha256, result.sha256);
  checks.push(
    "current chain authenticates exact acknowledged result and complete prepared linkage"
  );
  const foreign = structuredClone(result.value);
  foreign.preparedPacketSha256 = "ff".repeat(32);
  put(join(path, "cycle-0001", "result.json"), sealCycle(foreign));
  assert.throws(() => reopened.observe());
  put(join(path, "cycle-0001", "result.json"), result);
  checks.push(
    "even a self-consistent resigned cycle cannot replace its actual prepared packet hash"
  );
  chmodSync(join(path, "root.json"), 0o644);
  assert.throws(
    () => openLedgerDirectory(path, digest(root)),
    /private_single/
  );
  chmodSync(join(path, "root.json"), 0o600);
  linkSync(join(path, "root.json"), join(path, "extra-link"));
  assert.throws(
    () => openLedgerDirectory(path, digest(root)),
    /private_single/
  );
  unlinkSync(join(path, "extra-link"));
  const raw = readFileSync(join(path, "root.json"));
  unlinkSync(join(path, "root.json"));
  writeFileSync(join(path, "foreign-root"), raw, { mode: 0o600 });
  symlinkSync("foreign-root", join(path, "root.json"));
  assert.throws(() => openLedgerDirectory(path, digest(root)));
  unlinkSync(join(path, "root.json"));
  unlinkSync(join(path, "foreign-root"));
  writeFileSync(join(path, "root.json"), raw, { mode: 0o600 });
  checks.push(
    "public modes hardlinks and symlink substitution cannot authenticate root receipts"
  );
  mkdirSync(join(path, "cycle-0003"), { mode: 0o700 });
  assert.throws(() => reopened.observe());
  rmSync(join(path, "cycle-0003"), { recursive: true });
  assert.throws(() => openLineageLedger("../escape", digest(root)));
  assert.throws(
    () => openLedgerDirectory("relative", digest(root)),
    /absolute/
  );
  assert.throws(
    () => openLedgerDirectory(path, "ff".repeat(32)),
    /same_protected/
  );
  checks.push("cycle gaps path escape and foreign epoch pins refuse");
  console.log(
    JSON.stringify({
      format: FORMAT + "-controls",
      passed: true,
      groups: checks.length,
      checks,
      syntheticFixturesOnly: true,
      databaseQueries: 0,
      providerCalls: 0,
      workerActivationQualified: false,
      twentyFourHourRefreshQualified: false
    })
  );
} finally {
  rmSync(path, { recursive: true, force: true });
}

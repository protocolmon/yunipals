import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authenticateArtifact,
  fingerprintMap,
  ARTIFACT_SHA,
  MANIFEST_SHA,
  PREPARE_SHA
} from "./ypal-generation-statistics-v3-phase-fingerprints-v1.mjs";
import {
  authenticateArtifact as predecessorArtifact,
  queryCandidates
} from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const args = process.argv.slice(2);
assert.deepEqual(
  [args.length, args[0], args[2]],
  [4, "--artifact", "--predecessor"]
);
const artifact = path.resolve(args[1]);
const source = authenticateArtifact(artifact);
const predecessor = predecessorArtifact(path.resolve(args[3]));
const value = fingerprintMap(source);
const rows = new Map(value.fingerprints.map((row) => [row.phase, row]));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("authenticate the actual V3 public closure and enumerate native unpublished phases", () => {
  assert.equal(value.artifactSha256, ARTIFACT_SHA);
  assert.equal(value.artifactManifestSha256, MANIFEST_SHA);
  assert.equal(value.preparationSha256, PREPARE_SHA);
  assert.equal(value.fingerprints.length, 44);
  assert.equal(rows.size, 44);
  assert.equal(value.sourceScopeCount, 15);
  assert.equal(value.profile.publish, false);
  for (const phase of [
    "capture-inputs-do-block",
    "candidate-trait",
    "candidate-revision",
    "candidate-analyze-trait-statistics",
    "candidate-facet",
    "candidate-facet-status",
    "candidate-vacuum-analyze",
    "validation-counts-and-revisions",
    "candidate-mark-ready",
    "candidate-rollback"
  ])
    assert(rows.has(phase), phase);
  assert(![...rows.keys()].some((phase) => phase.includes("publication")));
  for (const key of [
    "databaseConnections",
    "databaseWrites",
    "providerCalls",
    "serviceActions"
  ]) {
    assert.equal(value[key], 0);
  }
  assert.equal(value.statementCompletionClaimed, false);
  assert.equal(value.generationSuccessClaimed, false);
});

test("unchanged exact facet, status, trait and revision strings match independent f81 extraction", () => {
  for (const candidate of queryCandidates(predecessor)) {
    const row = rows.get(
      candidate.phase.replace("facet_status", "facet-status")
    );
    const bytes = Buffer.from(candidate.sql);
    assert.equal(row.fullQueryBytes, bytes.length);
    assert.equal(row.fullQuerySha256, sha(bytes));
    assert.equal(row.activityQueryBytesAt1kB, Math.min(bytes.length, 1023));
    assert.equal(row.activityQuerySha256At1kB, sha(bytes.subarray(0, 1023)));
  }
  assert.equal(
    rows.get("candidate-facet").activityQuerySha256At1kB,
    "1bd700db5f79fb3af8a5520f2d69528f0a09339d6a5c285043b3836ea6443c5e"
  );
  assert.equal(rows.get("candidate-facet").fullQueryBytes, 1862);
});

test("new ANALYZE and exact native capture retain their explicit source identity", () => {
  assert.equal(
    rows.get("candidate-analyze-trait-statistics").fullQuerySha256,
    sha("ANALYZE metadata_projection.trait")
  );
  assert.equal(
    rows.get("capture-inputs-do-block").fullQuerySha256,
    "74d2f32dc994c3d7563fce1dab20594dd7a817b4bfeb875ae2dd102cccef6018"
  );
  assert.equal(rows.get("capture-inputs-do-block").fullQueryBytes, 7792);
  assert.equal(
    rows.get("candidate-search-rarity-metadata").condition,
    "RARITY_READ_SOURCE=metadata-or-unset"
  );
  assert.equal(
    rows.get("candidate-search-rarity-local").condition,
    "RARITY_READ_SOURCE=local"
  );
  assert.notEqual(
    rows.get("candidate-search-rarity-local").fullQuerySha256,
    rows.get("candidate-search-rarity-metadata").fullQuerySha256
  );
  assert.equal(
    rows.get("capacity-data-directory").condition,
    "PROJECTION_STORAGE_PATH-unset"
  );
});

test("hash-only output preserves shared transaction ambiguity and excludes query text", () => {
  assert.equal(value.sqlTextIncluded, false);
  assert.deepEqual(
    value.ambiguousActivityHashes.map((row) => row.phases),
    [
      ["cleanup-commit", "candidate-commit"],
      ["cleanup-rollback", "candidate-rollback"]
    ]
  );
  for (const row of value.fingerprints) {
    assert.deepEqual(Object.keys(row), [
      "phase",
      "condition",
      "fullQueryBytes",
      "fullQuerySha256",
      "activityQueryBytesAt1kB",
      "activityQuerySha256At1kB"
    ]);
    assert(/^[a-f0-9]{64}$/.test(row.fullQuerySha256));
    assert(/^[a-f0-9]{64}$/.test(row.activityQuerySha256At1kB));
  }
  const encoded = JSON.stringify(value);
  for (const raw of [
    "INSERT INTO",
    "SELECT ",
    "DO $",
    "DELETE FROM",
    "ANALYZE metadata_projection",
    "VACUUM ("
  ]) {
    assert(!encoded.includes(raw));
  }
});

test("foreign predecessor, changed source and tampered artifact are refused", () => {
  assert.throws(() => authenticateArtifact(path.resolve(args[3])));
  assert.throws(() => fingerprintMap(source + "\n"));
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), "ypal-v3-fingerprints-test-")
  );
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(artifact, "manifest.json"))
    );
    copyFileSync(
      path.join(artifact, "manifest.json"),
      path.join(temporary, "manifest.json")
    );
    mkdirSync(path.join(temporary, "dist"));
    for (const row of manifest.files) {
      copyFileSync(
        path.join(artifact, row.path),
        path.join(temporary, row.path)
      );
    }
    assert.equal(sha(authenticateArtifact(temporary)), PREPARE_SHA);
    copyFileSync(
      path.join(temporary, "manifest.json"),
      path.join(temporary, "dist/generation-prepare.mjs")
    );
    assert.throws(() => authenticateArtifact(temporary));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

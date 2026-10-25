// Exact local public archive, synthetic corruption/refusal; no database access.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authenticateArtifact,
  diagnose,
  queryCandidates,
  sha
} from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const artifact = "/tmp/yunipals-generation-snapshot-runtime-v2-final-20261024";
const observed =
  "1bd700db5f79fb3af8a5520f2d69528f0a09339d6a5c285043b3836ea6443c5e";
const source = authenticateArtifact(artifact);
const report = diagnose(source, observed, 1023);
assert.equal(report.matchingPhase, "candidate-facet");
assert.equal(
  report.candidates.filter((row) => row.exactObservedMatch).length,
  1
);
assert.equal(report.candidates[2].fullQueryBytes, 1862);
assert.equal(
  report.candidates[2].fullQuerySha256,
  "9e7c84c91ce1fe6725a0bc3ed754cbe68864dadfba9763db19b6013b198b48a4"
);
assert.equal(report.activityTruncationSettingVerified, false);
assert.equal(report.statementCompletionClaimed, false);
assert.equal(report.resumabilityClaimed, false);
assert.equal(diagnose(source, observed, 1024).matchingPhase, null);
assert.equal(diagnose(source, observed, 1862).matchingPhase, null);
const facet = queryCandidates(source)[2].sql;
assert.equal(
  diagnose(source, sha(facet), 1862).matchingPhase,
  "candidate-facet"
);
assert.throws(() => diagnose(source, observed, 0));
assert.throws(() => diagnose(source, observed, NaN));
assert.throws(() => diagnose(source, "0".repeat(64), 1023));
assert.throws(() => queryCandidates(source + "\n"));

const temporary = mkdtempSync(path.join(os.tmpdir(), "ypal-f81-diagnostic-"));
try {
  const clone = path.join(temporary, "artifact");
  cpSync(artifact, clone, { recursive: true });
  const file = path.join(clone, "dist/generation-prepare.mjs");
  writeFileSync(file, readFileSync(file, "utf8") + "\n");
  assert.throws(() => authenticateArtifact(clone));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
process.stdout.write(
  JSON.stringify({
    exactArchiveVerified: true,
    uniqueActualPrefixHashMatch: true,
    wrongHashDomainAndArtifactRefused: true,
    databaseConnections: 0
  }) + "\n"
);

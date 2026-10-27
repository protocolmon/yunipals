// Read public frozen artifact bytes only. No application import or SQL execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

export const ARTIFACT_SHA =
  "f81cdb76ae45794599c723085aebd2b9c5e377975dc16d2e1461236229d4b952";
export const MANIFEST_SHA =
  "85acb526541fe09acbfd17a87a14be494c02123a61501a41b01e91f1d9c01188";
export const PREPARE_SHA =
  "5ddfc402e5433bbc7e349186a2707fc5ab1b0b6d15d74d9a434c8a94e8f710ac";
export const sha = (value) => createHash("sha256").update(value).digest("hex");

export function authenticateArtifact(directory) {
  assert(path.isAbsolute(directory));
  const bytes = readFileSync(path.join(directory, "manifest.json"));
  assert.equal(sha(bytes), MANIFEST_SHA);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.artifactDigest, ARTIFACT_SHA);
  assert.equal(manifest.inputs.length, 37);
  assert.equal(manifest.files.length, 8);
  for (const row of manifest.files) {
    assert(row.path.startsWith("dist/") && !row.path.includes(".."));
    const raw = readFileSync(path.join(directory, row.path));
    assert.equal(raw.length, row.bytes);
    assert.equal(sha(raw), row.sha256);
  }
  const source = readFileSync(
    path.join(directory, "dist/generation-prepare.mjs"),
    "utf8"
  );
  assert.equal(sha(source), PREPARE_SHA);
  return source;
}

function template(source, marker) {
  const begin = source.indexOf(marker);
  assert(begin >= 0 && source.indexOf(marker, begin + 1) === -1);
  const end = source.indexOf("`", begin + 1);
  assert(end > begin);
  // Only an expression from authenticated frozen bytes is evaluated, in an
  // empty context containing the two exact private relation names. The actual
  // artifact, its imports, preparation function and database code never run.
  return new vm.Script(source.slice(begin, end + 1)).runInNewContext(
    {
      metadataInput: 'pg_temp."yunipals_projection_metadata_input"',
      tokenInput: 'pg_temp."yunipals_projection_token_input"'
    },
    { timeout: 1000 }
  );
}

export function queryCandidates(source) {
  assert.equal(sha(source), PREPARE_SHA);
  return ["trait", "revision", "facet", "facet_status"].map((name) => ({
    phase: "candidate-" + name,
    sql: template(source, "`INSERT INTO metadata_projection." + name + "\n")
  }));
}

export function diagnose(source, observedSha, observedBytes) {
  assert(/^[a-f0-9]{64}$/.test(observedSha) && observedSha !== "0".repeat(64));
  assert(
    Number.isSafeInteger(observedBytes) &&
      observedBytes > 0 &&
      observedBytes <= 1048576
  );
  const candidates = queryCandidates(source).map(({ phase, sql }) => {
    const bytes = Buffer.from(sql);
    const prefix = bytes.subarray(0, observedBytes);
    return {
      phase,
      fullQueryBytes: bytes.length,
      fullQuerySha256: sha(bytes),
      observedPrefixBytes: prefix.length,
      observedPrefixSha256: sha(prefix),
      exactObservedMatch:
        observedBytes === prefix.length && sha(prefix) === observedSha
    };
  });
  const matches = candidates.filter((row) => row.exactObservedMatch);
  assert(matches.length <= 1);
  return {
    format: "yunipals-generation-f81-phase-diagnostic-v1",
    artifactSha256: ARTIFACT_SHA,
    artifactManifestSha256: MANIFEST_SHA,
    preparationSha256: PREPARE_SHA,
    observedQuerySha256: observedSha,
    observedQueryBytes: observedBytes,
    matchingPhase: matches[0]?.phase ?? null,
    candidates,
    actualDatabaseObservationSuppliedByCaller: true,
    activityTruncationSettingVerified: false,
    statementCompletionClaimed: false,
    resumabilityClaimed: false,
    databaseConnections: 0,
    databaseWrites: 0,
    providerCalls: 0,
    serviceActions: 0
  };
}

function main() {
  const args = process.argv.slice(2);
  assert.deepEqual(
    [args.length, args[0], args[2], args[4]],
    [6, "--artifact", "--query-sha", "--query-bytes"]
  );
  const source = authenticateArtifact(args[1]);
  process.stdout.write(
    JSON.stringify(diagnose(source, args[3], Number(args[5]))) + "\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

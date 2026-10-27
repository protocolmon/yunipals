// Public artifact inspection only. No application import or database execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const ts = require("typescript");
export const ARTIFACT_SHA =
  "a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a";
export const MANIFEST_SHA =
  "4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442";
export const PREPARE_SHA =
  "3d6c7e5246eb9f46af05697638319b66c11a873cfe9086a00f71059c0abffabb";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const PROFILE = {
  ownershipMode: "unified",
  metadataMode: "archive",
  baseMetadataIngestion: "native",
  sourceRelease:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  physicalSchema: "unified_ypal_20261023_v1",
  readSchema: "yunipals_ownership_4e77f52b_v5",
  publish: false,
  rarityReadSourcesEnumerated: ["metadata", "local"]
};

export function authenticateArtifact(directory) {
  assert(path.isAbsolute(directory));
  const raw = readFileSync(path.join(directory, "manifest.json"));
  assert.equal(sha(raw), MANIFEST_SHA);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.artifactDigest, ARTIFACT_SHA);
  assert.equal(manifest.inputs.length, 37);
  assert.equal(manifest.files.length, 8);
  assert.equal(manifest.preparationEntryNeverPublishes, true);
  for (const row of manifest.files) {
    assert(row.path.startsWith("dist/") && !row.path.includes(".."));
    const bytes = readFileSync(path.join(directory, row.path));
    assert.equal(bytes.length, row.bytes);
    assert.equal(sha(bytes), row.sha256);
  }
  const source = readFileSync(
    path.join(directory, "dist/generation-prepare.mjs"),
    "utf8"
  );
  assert.equal(sha(source), PREPARE_SHA);
  return source;
}

function expressions(source) {
  const parsed = ts.createSourceFile(
    "generation-prepare.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  assert.equal(parsed.parseDiagnostics.length, 0);
  const functions = new Map();
  const variables = new Map();
  for (const node of parsed.statements) {
    if (ts.isFunctionDeclaration(node)) functions.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const row of node.declarationList.declarations) {
        if (ts.isIdentifier(row.name)) variables.set(row.name.text, row);
      }
    }
  }
  const text = (node) => node.getText(parsed);
  return {
    functionText(name) {
      assert(functions.has(name), name);
      return text(functions.get(name));
    },
    variableText(name) {
      assert(variables.has(name), name);
      return "var " + text(variables.get(name)) + ";";
    },
    queries(name, expectedCount) {
      const found = [];
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "query" &&
          ts.isIdentifier(node.expression.expression) &&
          ["client", "db", "pool"].includes(node.expression.expression.text)
        ) {
          assert(node.arguments.length > 0);
          found.push(text(node.arguments[0]));
        }
        ts.forEachChild(node, visit);
      };
      assert(functions.has(name), name);
      visit(functions.get(name));
      assert.equal(found.length, expectedCount, name);
      return found;
    }
  };
}

function sqlContext(parts, rarityReadSource) {
  // Evaluate only selected pure SQL-string builders from authenticated bytes.
  // No application module, refresh function, pool or query method is evaluated.
  const context = vm.createContext({
    process: {
      env: {
        BASE_METADATA_INGESTION: "native",
        OWNERSHIP_READ_MODE: "unified",
        METADATA_SOURCE_MODE: "archive",
        RARITY_READ_SOURCE: rarityReadSource
      }
    },
    ownershipReadConfig: {
      mode: "unified",
      releaseId: PROFILE.sourceRelease
    },
    unifiedOwnershipReads: true,
    physicalPonderSchemaName: PROFILE.physicalSchema,
    physicalPonderSchema: '"' + PROFILE.physicalSchema + '"',
    ponderSchema: '"' + PROFILE.readSchema + '"',
    ownershipPonderSchema: '"' + PROFILE.readSchema + '"',
    ownershipBnbSchema: '"' + PROFILE.readSchema + '"',
    bnbSchema: '"bnb_indexer"',
    metadataInput: 'pg_temp."yunipals_projection_metadata_input"',
    tokenInput: 'pg_temp."yunipals_projection_token_input"'
  });
  const run = (value) =>
    new vm.Script(value).runInContext(context, { timeout: 1000 });
  for (const name of [
    "sqlIdentifier",
    "ownershipBnbOnlySchema",
    "metadataSourceMode",
    "publicationAvailableSql",
    "baseMetadataIngestionMode",
    "nativeBaseMetadataReads",
    "archiveRead",
    "projectionInputCaptureSql"
  ]) {
    run(parts.functionText(name));
  }
  for (const name of [
    "indexedChains",
    "collections",
    "collectionSlugs",
    "scopes",
    "rarityFormulaVersion",
    "rarityReadSource",
    "localRarityJoin",
    "upstreamRaw",
    "upstreamCapped",
    "rarityPointsSql",
    "rarityPointsCappedSql",
    "baseMetadataEventsRelation",
    "baseMetadataScanRelation",
    "publicationRows",
    "metadataScanReadRelation",
    "metadataName",
    "tokensName",
    "anchorsName",
    "temporary",
    "literal"
  ]) {
    run(parts.variableText(name));
  }
  assert.deepEqual(JSON.parse(run("JSON.stringify(collectionSlugs)")), [
    "ethereum",
    "base",
    "polygon",
    "bnb"
  ]);
  assert.equal(run("scopes.length"), 15);
  return run;
}

export function fingerprintMap(source) {
  assert.equal(sha(source), PREPARE_SHA);
  const parts = expressions(source);
  const run = sqlContext(parts, "metadata");
  const rows = [];
  const add = (phase, expression, condition = "native-unpublished-profile") => {
    const sql = run(expression);
    assert.equal(typeof sql, "string");
    // All supported exact statements are ASCII, so the 1023-byte boundary is
    // also a valid UTF-8 boundary under PostgreSQL's 1kB activity text setting.
    assert.equal(Buffer.byteLength(sql), sql.length);
    const bytes = Buffer.from(sql);
    const prefix = bytes.subarray(0, 1023);
    rows.push({
      phase,
      condition,
      fullQueryBytes: bytes.length,
      fullQuerySha256: sha(bytes),
      activityQueryBytesAt1kB: prefix.length,
      activityQuerySha256At1kB: sha(prefix)
    });
  };
  const capture = parts.queries("captureProjectionInputs", 2);
  add("capture-inputs-do-block", capture[0]);
  add("capture-source-snapshot-proof", capture[1]);
  const capacity = parts.queries("assertProjectionBuildCapacity", 4);
  add("capacity-data-directory", capacity[0], "PROJECTION_STORAGE_PATH-unset");
  add("capacity-projection-size", capacity[1]);
  add("capacity-native-snapshot-size", capacity[3]);
  const cleanup = parts.queries("cleanupGenerations", 7);
  [
    "cleanup-begin",
    "cleanup-lock-timeout",
    "cleanup-lock-active",
    "cleanup-retire-eligible-generations",
    "cleanup-commit",
    "cleanup-rollback"
  ].forEach((phase, index) =>
    add(phase, cleanup[index], index === 5 ? "cleanup-error-path" : undefined)
  );
  const tables = JSON.parse(
    run(parts.variableText("payloadTables") + "JSON.stringify(payloadTables)")
  );
  assert.deepEqual(tables, [
    "trait",
    "search",
    "revision",
    "facet",
    "facet_status"
  ]);
  for (const table of tables) {
    run("var table=" + JSON.stringify(table));
    add("cleanup-delete-" + table, cleanup[6], "eligible-retired-generation");
  }
  add(
    "candidate-ownership-identity",
    parts.queries("ownershipReadIdentity", 1)[0]
  );
  const refresh = parts.queries("refreshProjectionGeneration", 24);
  const labels = [
    "lock-trait-refresh",
    "lock-chain-recovery-shared",
    "candidate-begin-repeatable-read",
    "candidate-work-mem-64MB",
    "candidate-lock-active-archive-release",
    "candidate-create-building-generation",
    "candidate-record-ownership-identity",
    "candidate-read-predecessor",
    "candidate-record-source-snapshot",
    "candidate-search-rarity-metadata",
    "candidate-trait",
    "candidate-revision",
    "candidate-analyze-trait-statistics",
    "candidate-work-mem-256MB",
    "candidate-facet",
    "candidate-facet-status",
    "candidate-commit",
    "candidate-vacuum-analyze",
    "candidate-mark-ready",
    null,
    "candidate-rollback",
    "candidate-mark-failed-after-commit",
    "unlock-chain-recovery-shared",
    "unlock-trait-refresh"
  ];
  labels.forEach((phase, index) => {
    if (!phase) return;
    const condition =
      index === 9
        ? "RARITY_READ_SOURCE=metadata-or-unset"
        : index === 20
          ? "candidate-error-before-commit"
          : index === 21
            ? "candidate-error-after-commit-before-ready"
            : undefined;
    add(phase, refresh[index], condition);
  });
  const localRun = sqlContext(parts, "local");
  const localSql = localRun(refresh[9]);
  // Pass the selected pure alternate expression as a literal to the same
  // fingerprint path; no environment-derived or runtime SQL is invented.
  add(
    "candidate-search-rarity-local",
    JSON.stringify(localSql),
    "RARITY_READ_SOURCE=local"
  );
  parts
    .queries("validateGeneration", 3)
    .forEach((expression, index) =>
      add(
        [
          "validation-counts-and-revisions",
          "validation-collection-coverage",
          "validation-source-snapshot"
        ][index],
        expression
      )
    );
  const groups = new Map();
  for (const row of rows) {
    const same = groups.get(row.activityQuerySha256At1kB) ?? [];
    same.push(row.phase);
    groups.set(row.activityQuerySha256At1kB, same);
  }
  return {
    format: "yunipals-generation-statistics-v3-phase-fingerprints-v1",
    artifactSha256: ARTIFACT_SHA,
    artifactManifestSha256: MANIFEST_SHA,
    preparationSha256: PREPARE_SHA,
    generatorSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    profile: PROFILE,
    activityTextSetting: "1kB",
    activityTextMaximumBytes: 1023,
    sourceScopeCount: 15,
    sqlTextIncluded: false,
    fingerprints: rows,
    ambiguousActivityHashes: [...groups.entries()]
      .filter(([, phases]) => phases.length > 1)
      .map(([activityQuerySha256At1kB, phases]) => ({
        activityQuerySha256At1kB,
        phases
      })),
    limitations: [
      "Match only the exact worker APP and verified 1kB activity setting; activity text is a sampled current or most-recent statement, not a completion receipt.",
      "The capture DO hash identifies the outer capture block; its internal copy, guard, index and temporary ANALYZE substatements cannot be distinguished from that activity hash.",
      "SQL bind values including generation IDs and timestamps are not interpolated into the activity query text; no future generation ID is asserted.",
      "Metadata and local rarity search variants are enumerated; this map does not assert the worker's actual rarity environment.",
      "Cleanup BEGIN/COMMIT/ROLLBACK may share hashes with build transaction statements; use the ambiguity groups and observed sequence, not a unique phase claim.",
      "Unpublished native preparation returns before publishGeneration and the publication-retry branch; those unreachable queries and leaderboard-only capacity SQL are excluded.",
      "Other profiles or SQL changed outside this exact authenticated artifact are unsupported; an unknown hash is not attributed."
    ],
    statementCompletionClaimed: false,
    generationSuccessClaimed: false,
    databaseConnections: 0,
    databaseWrites: 0,
    providerCalls: 0,
    serviceActions: 0
  };
}

function main() {
  const args = process.argv.slice(2);
  assert.deepEqual([args.length, args[0]], [2, "--artifact"]);
  process.stdout.write(
    JSON.stringify(fingerprintMap(authenticateArtifact(args[1])), null, 2) +
      "\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

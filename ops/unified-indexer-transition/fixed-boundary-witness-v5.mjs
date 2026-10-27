#!/usr/bin/env node
// New V5 evidence domain; the fixed-point/header/equality business is unchanged.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORMAT = "yunipals-ypal-fixed-boundary-witness-v5";
export const ROOT =
  "/var/backups/yunipals-ypal-ordinary-v5-fixed-boundary-witness-v1-20261025";
const HERE = dirname(fileURLToPath(import.meta.url));
export const PROGRAMS = {
  "fixed-boundary-witness-v3.mjs":
    "bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c",
  "ownership-parity-peer-v4.mjs":
    "b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e",
  "ownership-parity-peer-v2.mjs":
    "d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920",
  "ypal-v5-witness-official-v1.mjs":
    "347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc",
  "ypal-v5-witness-official-v1.sources.json":
    "ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3"
};
export const V5 = Object.freeze({
  readSchema: "yunipals_ownership_4e77f52b_v5",
  readIdentity:
    "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab"
});
export const CREATOR = Object.freeze({
  file: "ypal-ordinary-readview-v5.py",
  sha256: "1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2",
  result:
    "/var/backups/yunipals-ypal-ordinary-readview-v5-20261025/created.json"
});
const PARITY =
  "/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json";
const PARITY_SHA =
  "b04ff03dadbc8fa8f167fdec862b071ee4dc6e89268bed84a5260c77c2290aa4";
export const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const need = (value, code) => {
  if (!value) throw Error(code);
};
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function protectedFile(path, expected, maximum = 4000000) {
  need(isAbsolute(path), "absolute_V5_witness_input_required");
  for (let parent = path; ; parent = dirname(parent)) {
    const row = lstatSync(parent);
    need(
      !row.isSymbolicLink() && row.uid === 0 && !(row.mode & 0o022),
      "protected_V5_witness_input_required"
    );
    if (dirname(parent) === parent) break;
  }
  const before = lstatSync(path);
  need(
    before.isFile() && before.nlink === 1 && before.size <= maximum,
    "bounded_single_V5_witness_input_required"
  );
  const raw = readFileSync(path);
  const after = lstatSync(path);
  const identity = (row) => [
    row.dev,
    row.ino,
    row.mode,
    row.uid,
    row.gid,
    row.nlink,
    row.size,
    row.mtimeMs,
    row.ctimeMs
  ];
  need(
    before.isFile() &&
      before.nlink === 1 &&
      raw.length <= maximum &&
      raw.length === before.size &&
      stable(identity(before)) === stable(identity(after)) &&
      (!expected || sha(raw) === expected),
    "exact_V5_witness_input_bytes_required"
  );
  return raw;
}
export function programInputs() {
  const values = Object.fromEntries(
    Object.entries(PROGRAMS).map(([name, digest]) => [
      name,
      protectedFile(join(HERE, name), digest, 200000)
    ])
  );
  protectedFile(join(HERE, CREATOR.file), CREATOR.sha256, 200000);
  const descriptor = JSON.parse(
    values["ypal-v5-witness-official-v1.sources.json"]
  );
  need(
    descriptor.format === "yunipals-v5-witness-official-closure-v1" &&
      descriptor.readSchema === V5.readSchema &&
      descriptor.readIdentity === V5.readIdentity &&
      descriptor.artifact.sha256 ===
        PROGRAMS["ypal-v5-witness-official-v1.mjs"] &&
      descriptor.repeatBuildEqual === true &&
      descriptor.sourcePlanSha256 ===
        "d968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7" &&
      descriptor.runtimeImports.length === 1 &&
      descriptor.runtimeImports[0].path === "node:crypto" &&
      Object.keys(descriptor.sourcePins).length === 10,
    "exact_actual_V5_official_readonly_closure_required"
  );
  return {
    descriptor,
    oldBody: values["fixed-boundary-witness-v3.mjs"].toString("utf8")
  };
}
export async function historical() {
  programInputs();
  const value = await import("./fixed-boundary-witness-v3.mjs");
  programInputs();
  return value;
}
export async function official() {
  programInputs();
  const value = await import("./ypal-v5-witness-official-v1.mjs");
  programInputs();
  need(
    stable(Object.keys(value).sort()) ===
      stable(
        [
          "loadIndexerRelease",
          "readBoundRuntime",
          "readIndexerSourceStatus"
        ].sort()
      ),
    "only_official_readonly_exports_required"
  );
  return value;
}
export function snapshotFunction(raw, old) {
  need(
    sha(raw) === PROGRAMS["fixed-boundary-witness-v3.mjs"],
    "exact_old_business_body_before_extraction_required"
  );
  const text = raw.toString("utf8");
  const start = "export async function databaseWitnessSnapshot(db, context) {";
  const end =
    "\nexport function qualifyAcceptance(baseline, candidate, database, canonical) {";
  need(
    text.split(start).length === 2 && text.split(end).length === 2,
    "one_exact_snapshot_business_region_required"
  );
  const body = text
    .slice(text.indexOf(start), text.indexOf(end))
    .trim()
    .slice("export ".length);
  // Authenticated source, a NEW lexical pins object, no old module/global patch.
  const factory = new Function(
    "pins",
    "validateCacheLayout",
    "stable",
    "fail",
    "decimal",
    "hashPattern",
    `"use strict";return (${body});`
  );
  return factory(
    Object.freeze({ ...old.pins, ...V5 }),
    old.validateCacheLayout,
    stable,
    (message) => {
      throw Error(message);
    },
    /^(0|[1-9][0-9]*)$/,
    /^0x[0-9a-f]{64}$/
  );
}
export function checkedPlan(value, path) {
  need(
    stable(Object.keys(value).sort()) ===
      stable(
        [
          "format",
          "retainedRuntimePlanFile",
          "retainedRuntimePlanSha256",
          "createdReceiptSha256",
          "output"
        ].sort()
      ) &&
      value.format === FORMAT + "-plan" &&
      /^[a-f0-9]{64}$/.test(value.createdReceiptSha256) &&
      /^[a-f0-9]{64}$/.test(value.retainedRuntimePlanSha256) &&
      path === join(dirname(value.output), "plan.json") &&
      value.retainedRuntimePlanFile ===
        join(dirname(value.output), "retained-runtime-plan.json") &&
      new RegExp(`^${ROOT}/captures/[a-z][a-z0-9-]{0,47}/witness\\.json$`).test(
        value.output
      ) &&
      !existsSync(value.output),
    "exact_new_V5_witness_plan_and_fresh_output_required"
  );
  return value;
}
export async function reviewPlan(path) {
  const program = programInputs();
  const old = await historical();
  const raw = protectedFile(path);
  const plan = checkedPlan(JSON.parse(raw), path);
  protectedFile(plan.retainedRuntimePlanFile, plan.retainedRuntimePlanSha256);
  const retained = old.reviewPlan(plan.retainedRuntimePlanFile);
  need(
    retained.review.binding.plan.output === plan.output &&
      retained.review.binding.plan.candidateReportFile === PARITY &&
      retained.review.binding.plan.candidateReportSha256 === PARITY_SHA,
    "same_retained_runtime_and_historical_parity_inputs_required"
  );
  const created = JSON.parse(
    protectedFile(CREATOR.result, plan.createdReceiptSha256)
  );
  need(
    created.format === "yunipals-ypal-ordinary-readview-v5" &&
      created.created === true &&
      created.selected === false &&
      created.readSchema === V5.readSchema &&
      created.readIdentity === V5.readIdentity &&
      created.sourceRelease === old.pins.release,
    "actual_created_V5_receipt_required_not_old_context_alias"
  );
  const binding = {
    format: FORMAT + "-review",
    helperSha256: sha(readFileSync(new URL(import.meta.url))),
    plan,
    planSha256: sha(raw),
    pins: { ...old.pins, ...V5 },
    points: retained.review.binding.points,
    maximumRpcCalls: 21,
    maximumHttpCalls: 12,
    replayPermits: [],
    retainedRuntimeReviewHash: retained.review.reviewHash,
    retainedRuntimeScope:
      "immutable_008_Ponder_PG_runtime_and_historical_parity_only",
    officialPrograms: PROGRAMS,
    officialSourcePins: program.descriptor.sourcePins,
    createdReceiptSha256: plan.createdReceiptSha256,
    createdProducerSha256: CREATOR.sha256,
    historicalParityReceiptSha256: PARITY_SHA,
    historicalParityReadIdentity: old.pins.readIdentity,
    historicalParityRelabelled: false,
    readOnlyDatabase: true,
    sourceSelectionChanged: false,
    writesOnlyNewEvidenceFile: true
  };
  return {
    ...retained,
    plan,
    review: { reviewHash: sha(json(binding)), binding }
  };
}
export async function captureWitness(inputs, dependencies) {
  const old = dependencies.old ?? (await historical());
  const api = dependencies.official ?? (await official());
  const snapshot = snapshotFunction(
    protectedFile(
      join(HERE, "fixed-boundary-witness-v3.mjs"),
      PROGRAMS["fixed-boundary-witness-v3.mjs"]
    ),
    old
  );
  const onPhase = dependencies.onPhase ?? (() => {});
  let db;
  try {
    onPhase("peer_identity");
    (dependencies.dropPeer ?? old.dropToPostgresPeer)();
    onPhase("database_connect");
    db = dependencies.createDatabase();
    await db.connect();
    const database = await snapshot(db, {
      ...inputs,
      points: inputs.review.binding.points,
      official: api,
      onPhase
    });
    onPhase("canonical_witnesses");
    const canonical = await (
      dependencies.captureCanonical ?? old.canonicalWitnesses
    )(inputs.profile, inputs.review.binding.points, {
      onCounters: dependencies.onCounters ?? (() => {})
    });
    onPhase("witness_comparison");
    return {
      database,
      canonical,
      acceptance: old.qualifyAcceptance(
        inputs.baseline,
        inputs.candidate,
        database,
        canonical
      )
    };
  } finally {
    await db?.end().catch(() => {});
  }
}
export async function validateWitnessReceipt(
  value,
  candidateBytes,
  baselineBytes
) {
  const old = await historical();
  const programs = programInputs();
  const parity = await import("./ownership-parity-peer-v4.mjs");
  need(
    sha(baselineBytes) === old.pins.baseline &&
      sha(candidateBytes) === PARITY_SHA &&
      value?.format === FORMAT &&
      value.completed === true &&
      value.binding.helperSha256 ===
        sha(readFileSync(new URL(import.meta.url))) &&
      stable(value.binding.pins) === stable({ ...old.pins, ...V5 }) &&
      stable(value.binding.officialPrograms) === stable(PROGRAMS) &&
      stable(value.binding.officialSourcePins) ===
        stable(programs.descriptor.sourcePins) &&
      value.reviewHash === sha(json(value.binding)) &&
      stable(value.binding.points) === stable(old.fixedPoints) &&
      value.binding.historicalParityReceiptSha256 === PARITY_SHA &&
      value.binding.historicalParityReadIdentity === old.pins.readIdentity &&
      value.binding.historicalParityRelabelled === false &&
      /^[a-f0-9]{64}$/.test(value.binding.createdReceiptSha256) &&
      value.binding.createdProducerSha256 === CREATOR.sha256 &&
      stable(value.database.readContext) ===
        stable({ schema: V5.readSchema, identity: V5.readIdentity }),
    "exact_new_V5_witness_capture_chain_required"
  );
  parity.validateParityReceipt(JSON.parse(candidateBytes), baselineBytes);
  const acceptance = old.qualifyAcceptance(
    JSON.parse(baselineBytes),
    JSON.parse(candidateBytes).parity,
    value.database,
    value.canonical
  );
  need(
    acceptance.qualified && stable(acceptance) === stable(value.acceptance),
    "all_six_V5_capture_canonical_acceptance_required"
  );
  return {
    validated: true,
    allSixCollections: true,
    sourceRelease: old.pins.release,
    readSchema: V5.readSchema,
    readIdentity: V5.readIdentity,
    historicalDataParityReadIdentity: old.pins.readIdentity,
    exactDataParity: true,
    canonicalWitnessQualifiedAtCapture: true,
    currentReadinessQualified: false,
    historicalParityRelabelled: false
  };
}
async function main() {
  const { values } = parseArgs({
    options: { plan: { type: "string" }, apply: { type: "string" } }
  });
  need(
    process.versions.node === "24.18.1" &&
      values.plan &&
      isAbsolute(values.plan),
    "pinned_Node_and_explicit_V5_plan_required"
  );
  const inputs = await reviewPlan(values.plan);
  if (!values.apply) {
    console.log(
      json({
        ...inputs.review,
        providerCallsPerformed: 0,
        databaseConnectionsPerformed: 0
      })
    );
    return;
  }
  need(
    values.apply === inputs.review.reviewHash &&
      process.getuid() === 0 &&
      hostname() === "yunipals-main",
    "exact_V5_review_and_fixed_root_host_required"
  );
  const old = await historical();
  const api = await official();
  // PG and source definitions use the separately authenticated retained runtime.
  const retainedPlan = JSON.parse(
    protectedFile(
      inputs.plan.retainedRuntimePlanFile,
      inputs.plan.retainedRuntimePlanSha256
    )
  );
  const require = createRequire(
    join(retainedPlan.sourceRoot, "apps/yunipals-indexer/package.json")
  );
  const { Client } = require("pg");
  const ownership = await import(
    pathToFileURL(
      join(retainedPlan.sourceRoot, "ops/unified-indexer/ownership-parity.mjs")
    )
  );
  ownership.validateBaseline(inputs.baseline);
  const output = openSync(inputs.plan.output, "wx", 0o600);
  let phase = "peer_identity";
  let counters = { rpcCalls: 0, httpCalls: 0, permitHeaders: 0, retries: 0 };
  try {
    const result = await captureWitness(
      { ...inputs, ownershipSources: ownership.ownershipSources },
      {
        old,
        official: api,
        createDatabase: () =>
          new Client({
            host: "/var/run/postgresql",
            port: 5432,
            database: "yunipals_backfill",
            user: "postgres",
            application_name: "yunipals_V5_fixed_boundary_witness_readonly",
            connectionTimeoutMillis: 3000
          }),
        onPhase: (value) => {
          phase = value;
        },
        onCounters: (value) => {
          counters = { ...value };
        }
      }
    );
    const report = {
      format: FORMAT,
      completed: true,
      capturedAt: new Date().toISOString(),
      reviewHash: inputs.review.reviewHash,
      binding: inputs.review.binding,
      ...result,
      legacyBaselineUnchanged: true,
      productionChanged: false,
      secretOrOwnershipRowsExported: false
    };
    writeFileSync(output, json(report));
    console.log(
      json({
        completed: true,
        qualified: result.acceptance.qualified,
        rpcCalls: 21,
        httpCalls: 12,
        replayPermits: []
      })
    );
    if (!result.acceptance.qualified) process.exitCode = 2;
  } catch (error) {
    writeFileSync(
      output,
      json({
        format: FORMAT,
        completed: false,
        reviewHash: inputs.review.reviewHash,
        phase,
        attempts: counters,
        errorClass: error?.constructor?.name ?? "Error",
        privateDriverDiagnosticsWithheld: true
      })
    );
    throw error;
  } finally {
    closeSync(output);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error("V5 witness refused; private diagnostics withheld.");
    process.exitCode = 1;
  });
}

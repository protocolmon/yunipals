#!/usr/bin/env node
// Fixed combined-source wrapper. Frozen peer-v2 owns all six normalized queries.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  captureOwnershipParity,
  completedCheckpoint,
  dropToPostgresPeer,
  ownershipSources,
  validateBaseline
} from "./ownership-parity-peer-v2.mjs";

export const combinedParity = Object.freeze({
  format: "yunipals-ypal-ownership-parity-v1",
  originalToolSha256:
    "d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920",
  baselineSha256:
    "69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540",
  releaseId:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  schema: "unified_ypal_20261023_v1",
  schemaOid: "75963410",
  buildId: "71e2a7f3b7",
  manifestHash:
    "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  readSchema: "yunipals_ownership_4e77f52b_v4",
  readSchemaOid: "75994954",
  readIdentity:
    "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67"
});
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
const need = (ok, code) => {
  if (!ok) throw Error(code);
};
const loadedProducer = sha(readFileSync(new URL(import.meta.url)));
const loadedOriginal = readFileSync(
  new URL("./ownership-parity-peer-v2.mjs", import.meta.url)
);
const producer = () => loadedProducer;
const baselineFrom = (bytes) => {
  need(
    sha(bytes) === combinedParity.baselineSha256,
    "exact_unchanged_six_collection_baseline_required"
  );
  return validateBaseline(JSON.parse(bytes));
};
function original() {
  need(
    sha(loadedOriginal) === combinedParity.originalToolSha256,
    "exact_frozen_six_collection_query_tool_required"
  );
}

export const combinedFrameSql = `SELECT jsonb_build_object(
 'database',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'role',current_user,'sessionRole',session_user,'unix',inet_client_addr()IS NULL,
 'schemaOid','unified_ypal_20261023_v1'::regnamespace::oid::text,
 'readSchemaOid','yunipals_ownership_4e77f52b_v4'::regnamespace::oid::text,
 'runtime',(SELECT value FROM unified_ypal_20261023_v1._ponder_meta WHERE key='app'),
 'release',(SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash)
 FROM yunipals_indexer_control.release WHERE id='${combinedParity.releaseId}'),
 'marker',(SELECT jsonb_build_object('releaseId',release_id,'identity',identity,'manifestHash',manifest_hash)
 FROM yunipals_ownership_4e77f52b_v4._unified_read_release WHERE singleton),
 'checkpoints',(SELECT jsonb_agg(jsonb_build_object('chainId',chain_id,'checkpoint',latest_checkpoint)ORDER BY chain_id)
 FROM unified_ypal_20261023_v1._ponder_checkpoint))AS value`;

export function qualifyCombinedFrame(value, baseline) {
  validateBaseline(baseline);
  need(
    value.database === "17584" &&
      value.role === "postgres" &&
      value.sessionRole === "postgres" &&
      value.unix === true,
    "fixed_postgres_peer_database_required"
  );
  need(
    value.schemaOid === combinedParity.schemaOid &&
      value.readSchemaOid === combinedParity.readSchemaOid &&
      stable(value.release) ===
        stable({
          id: combinedParity.releaseId,
          schema: combinedParity.schema,
          build: combinedParity.buildId,
          manifestHash: combinedParity.manifestHash
        }) &&
      stable(value.marker) ===
        stable({
          releaseId: combinedParity.releaseId,
          identity: combinedParity.readIdentity,
          manifestHash: combinedParity.manifestHash
        }) &&
      value.runtime?.version === "6" &&
      value.runtime.build_id === combinedParity.buildId &&
      value.runtime.is_dev === 0,
    "exact_combined_source_and_read_context_required"
  );
  need(
    Array.isArray(value.checkpoints) &&
      value.checkpoints.length === 4 &&
      new Set(value.checkpoints.map((r) => Number(r.chainId))).size === 4,
    "exact_four_native_complete_checkpoints_required"
  );
  const complete = new Map(
    value.checkpoints.map((r) => [
      Number(r.chainId),
      completedCheckpoint(r.checkpoint, r.chainId)
    ])
  );
  need(
    [1, 56, 137, 8453].every((chain) => complete.has(chain)),
    "exact_four_native_chains_required"
  );
  const collections = ownershipSources.map((source) => {
    const boundary = baseline.collections.find(
      (r) => r.collection === source.collection
    ).boundary.number;
    const indexed = complete.get(source.chainId),
      delta = BigInt(boundary) - BigInt(indexed);
    return {
      collection: source.collection,
      chainId: source.chainId,
      boundary,
      completeThrough: indexed,
      deficit: delta > 0n ? String(delta) : "0"
    };
  });
  return {
    eligible: collections.every((r) => r.deficit === "0"),
    collections,
    sourceReadinessQualified: false,
    canonicalWitnessQualified: false,
    runtime: {
      buildId: value.runtime.build_id,
      frameworkReady: value.runtime.is_ready === 1,
      running: value.runtime.is_locked === 1
    }
  };
}

export async function inspectCombinedCoverage(db, baseline) {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await db.query(
      "SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='15s'; SET LOCAL work_mem='8MB'; SET LOCAL temp_file_limit='512MB'"
    );
    return qualifyCombinedFrame(
      (await db.query(combinedFrameSql)).rows[0].value,
      baseline
    );
  } finally {
    await db.query("ROLLBACK");
  }
}

export async function captureCombinedParity(
  db,
  baselineBytes,
  { now = Date.now, maximumMilliseconds = 900000 } = {}
) {
  original();
  const baseline = baselineFrom(baselineBytes),
    started = now();
  let frame;
  // Inject only the fixed identity/coverage preflight after peer-v2's existing
  // SET LOCAL caps, in the SAME RR snapshot before its first dataset query.
  const guarded = {
    query: async (sql, args) => {
      need(
        now() - started <= maximumMilliseconds,
        "combined_parity_wall_deadline_exceeded"
      );
      const result = await db.query(sql, args);
      if (
        typeof sql === "string" &&
        sql.includes("transaction_timestamp()::text AS at")
      ) {
        frame = qualifyCombinedFrame(
          (await db.query(combinedFrameSql)).rows[0].value,
          baseline
        );
        need(
          frame.eligible,
          "all_six_fixed_boundaries_must_be_complete_before_dataset_scan"
        );
      }
      return result;
    }
  };
  const parity = await captureOwnershipParity(guarded, {
    source: "unified",
    schema: combinedParity.schema,
    releaseId: combinedParity.releaseId,
    baseline
  });
  need(
    frame && now() - started <= maximumMilliseconds,
    "combined_parity_wall_deadline_exceeded"
  );
  return {
    format: combinedParity.format,
    completed: true,
    producerSha256: producer(),
    originalToolSha256: combinedParity.originalToolSha256,
    baselineSha256: combinedParity.baselineSha256,
    sourceRelease: combinedParity.releaseId,
    sourceSchema: combinedParity.schema,
    sourceSchemaOid: combinedParity.schemaOid,
    buildId: combinedParity.buildId,
    manifestHash: combinedParity.manifestHash,
    readSchema: combinedParity.readSchema,
    readSchemaOid: combinedParity.readSchemaOid,
    readIdentity: combinedParity.readIdentity,
    allSixCollections: true,
    sourceReadinessQualified: false,
    canonicalWitnessQualified: false,
    coverage: frame,
    parity
  };
}

/** Static receipt proof only. Current source/canonical readiness is separate. */
export function validateParityReceipt(
  value,
  baselineBytes,
  { requireEqual = true } = {}
) {
  original();
  const baseline = baselineFrom(baselineBytes),
    p = value?.parity;
  need(
    value?.format === combinedParity.format &&
      value.completed === true &&
      value.producerSha256 === producer() &&
      value.originalToolSha256 === combinedParity.originalToolSha256 &&
      value.baselineSha256 === combinedParity.baselineSha256 &&
      value.sourceRelease === combinedParity.releaseId &&
      value.sourceSchema === combinedParity.schema &&
      value.sourceSchemaOid === combinedParity.schemaOid &&
      value.buildId === combinedParity.buildId &&
      value.manifestHash === combinedParity.manifestHash &&
      value.readSchema === combinedParity.readSchema &&
      value.readSchemaOid === combinedParity.readSchemaOid &&
      value.readIdentity === combinedParity.readIdentity &&
      value.allSixCollections === true &&
      value.sourceReadinessQualified === false &&
      value.canonicalWitnessQualified === false &&
      p?.format === "yunipals-ownership-parity-v1" &&
      p.completed === true &&
      p.source === "unified" &&
      p.observation?.read_only === "on" &&
      p.observation.isolation === "repeatable read" &&
      stable(p.release) ===
        stable({
          id: combinedParity.releaseId,
          physical_schema: combinedParity.schema,
          build_id: combinedParity.buildId,
          manifest_hash: combinedParity.manifestHash
        }) &&
      p.collections?.length === 6,
    "exact_new_all_six_parity_receipt_required"
  );
  need(
    value.coverage?.eligible === true &&
      value.coverage.collections?.length === 6 &&
      value.coverage.sourceReadinessQualified === false &&
      value.coverage.canonicalWitnessQualified === false,
    "complete_nonready_coverage_observation_required"
  );
  let equal = true,
    allHashes = true;
  const used = new Set();
  for (const before of baseline.collections) {
    const rows = p.collections.filter(
      (r) => r.collection === before.collection
    );
    need(
      rows.length === 1 && !used.has(before.collection),
      "all_six_parity_collections_required"
    );
    used.add(before.collection);
    const after = rows[0];
    const coverage = value.coverage.collections.filter(
      (r) => r.collection === before.collection
    );
    need(
      coverage.length === 1 &&
        coverage[0].chainId === before.chainId &&
        coverage[0].boundary === before.boundary.number &&
        coverage[0].completeThrough === after.boundary?.availableThrough &&
        coverage[0].deficit === "0",
      "same_all_six_complete_snapshot_coverage_required"
    );
    need(
      after.chainId === before.chainId &&
        after.address === before.address &&
        after.startBlock === before.startBlock &&
        after.physicalSchema === combinedParity.schema &&
        after.boundary?.number === before.boundary.number &&
        after.boundary.runtime?.buildId === combinedParity.buildId &&
        /^(0|[1-9][0-9]*)$/.test(after.boundary.availableThrough) &&
        BigInt(after.boundary.availableThrough) >=
          BigInt(before.boundary.number),
      "exact_parity_collection_boundary_required"
    );
    equal &&= stable(after.datasets) === stable(before.datasets);
    allHashes &&=
      Boolean(before.boundary.hash) &&
      before.boundary.hash === after.boundary.hash;
  }
  need(
    p.exactDataParity === equal && p.allBoundaryHashesMatch === allHashes,
    "original_parity_comparison_flags_required"
  );
  if (requireEqual)
    need(
      equal,
      "all_six_exact_dataset_count_digest_and_bucket_parity_required"
    );
  return {
    validated: true,
    allSixCollections: true,
    exactDataParity: equal,
    sourceRelease: combinedParity.releaseId,
    readIdentity: combinedParity.readIdentity,
    sourceReadinessQualified: false,
    canonicalWitnessQualified: false
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      apply: { type: "string" },
      preflight: { type: "string" }
    }
  });
  need(
    process.versions.node === "24.18.1" &&
      values.plan &&
      !(values.apply && values.preflight),
    "node24_and_one_explicit_parity_phase_required"
  );
  original();
  const witness = await import("./fixed-boundary-witness-v3.mjs");
  const inputs = witness.reviewPlan(resolve(values.plan));
  need(
    inputs.plan.candidateReportFile === null,
    "parity_capture_plan_cannot_select_prior_candidate_report"
  );
  const binding = {
    format: "yunipals-ypal-ownership-parity-review-v1",
    producerSha256: producer(),
    originalToolSha256: combinedParity.originalToolSha256,
    context: combinedParity,
    witnessInputReview: inputs.review.binding,
    queryStatementLimitSeconds: 90,
    tempFileLimitMB: 512,
    maximumMilliseconds: 900000,
    allSixCollections: true
  };
  const reviewHash = sha(stable(binding));
  if (!values.apply && !values.preflight) {
    console.log(
      JSON.stringify({
        reviewHash,
        binding,
        providerCalls: 0,
        databaseConnections: 0
      })
    );
    return;
  }
  need(
    (values.apply ?? values.preflight) === reviewHash &&
      process.getuid() === 0 &&
      hostname() === "yunipals-main",
    "exact_review_root_host_required"
  );
  const require = createRequire(
    inputs.plan.sourceRoot + "/apps/yunipals-indexer/package.json"
  );
  const { Client } = require("pg");
  const baselineBytes = readFileSync(inputs.plan.baselineFile);
  const output = values.apply
    ? openSync(
        inputs.plan.output,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
    : null;
  let db;
  try {
    dropToPostgresPeer();
    db = new Client({
      host: "/var/run/postgresql",
      port: 5432,
      database: "yunipals_backfill",
      user: "postgres",
      connectionTimeoutMillis: 5000,
      application_name: "yunipals_combined_ownership_parity_readonly"
    });
    await db.connect();
    if (values.preflight) {
      console.log(
        JSON.stringify(await inspectCombinedCoverage(db, inputs.baseline))
      );
      return;
    }
    const result = await captureCombinedParity(db, baselineBytes);
    validateParityReceipt(result, baselineBytes, { requireEqual: false });
    const resultBytes = Buffer.from(
      JSON.stringify({ ...result, reviewHash }, null, 2) + "\n"
    );
    writeFileSync(output, resultBytes);
    fsyncSync(output);
    console.log(
      JSON.stringify({
        format: combinedParity.format,
        completed: true,
        allSixCollections: true,
        reportSha256: sha(resultBytes),
        exactDataParity: result.parity.exactDataParity,
        allBoundaryHashesMatch: result.parity.allBoundaryHashesMatch,
        collections: result.parity.collections.map((r) => ({
          collection: r.collection,
          counts: Object.fromEntries(
            Object.entries(r.datasets).map(([k, v]) => [k, v.rows])
          )
        })),
        sourceReadinessQualified: false,
        canonicalWitnessQualified: false,
        providerCalls: 0
      })
    );
    if (!result.parity.exactDataParity) process.exitCode = 2;
    else if (!result.parity.allBoundaryHashesMatch) process.exitCode = 3;
  } finally {
    await db?.end();
    if (output !== null) closeSync(output);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        completed: false,
        stage: error.parityStage ?? "fixed_context_or_connection",
        code: /^[a-z_]+$/.test(error.message ?? "")
          ? error.message
          : "combined_parity_failed_private_diagnostics_withheld",
        automaticRetryAllowed: false
      })
    );
    process.exitCode = 1;
  });

#!/usr/bin/env node
// External operational evidence only. Does not modify either frozen release.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const pins = {
  source: "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78",
  sourceManifest:
    "55017c503920ddf2d4083bee2425d4daed656cafd0d36e4f88a6352d5903d15d",
  inventory: "ebeb5a3f1ab9a2152500ff7bf859b81e62101fe8b15b9c0e4d5bb51d5b40da40",
  baseline: "69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540",
  profile: "0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e",
  profileId:
    "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728",
  manifest:
    "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029",
  build: "bf4939b3ff",
  release: "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c",
  schema: "unified_shadow_20261020_7e7375b0"
};
export const fixedPoints = [
  { chainId: 1, number: "26236452" },
  { chainId: 56, number: "128816538" },
  { chainId: 137, number: "95883932" },
  { chainId: 8453, number: "52870956" },
  { chainId: 8453, number: "52870977" }
];
const ports = new Map([
  [1, 19201],
  [8453, 19202],
  [137, 19203],
  [56, 19204]
]);
const hashPattern = /^0x[0-9a-f]{64}$/;
const decimal = /^(0|[1-9][0-9]*)$/;
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
class WitnessValidationError extends Error {}
function fail(message) {
  throw new WitnessValidationError(message);
}
const capturePhases = new Set([
  "peer_identity",
  "database_connect",
  "database_snapshot",
  "database_release",
  "database_cache_layout",
  "database_source_tables",
  "database_headers",
  "database_readiness",
  "database_selector",
  "database_commit",
  "canonical_witnesses",
  "witness_comparison",
  "write_output"
]);
export function failureDiagnostics(error, progress) {
  return {
    phase: capturePhases.has(progress.phase) ? progress.phase : "validation",
    errorClass:
      error instanceof WitnessValidationError ? "validation" : "external",
    ...(error instanceof WitnessValidationError
      ? { validationReason: error.message }
      : {}),
    // Driver messages, names, stack traces, URLs and arbitrary codes are private.
    ...(typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
      ? { sqlState: error.code }
      : {}),
    attempts: Object.fromEntries(
      ["rpcCalls", "httpCalls", "permitHeaders", "retries"].map((name) => [
        name,
        Number.isSafeInteger(progress[name]) && progress[name] >= 0
          ? progress[name]
          : 0
      ])
    )
  };
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const id = (value) => `0x${sha256(stable(value))}`;
const pointKey = (point) => `${point.chainId}:${point.number}`;

export function boundaryPoints(baseline) {
  const unique = new Map();
  for (const row of baseline.collections ?? []) {
    if (
      !Number.isSafeInteger(row.chainId) ||
      !decimal.test(row.boundary?.number ?? "")
    )
      fail("Invalid recorded boundary.");
    const point = { chainId: row.chainId, number: row.boundary.number };
    unique.set(pointKey(point), point);
  }
  const points = [...unique.values()].sort(
    (a, b) =>
      a.chainId - b.chainId || (BigInt(a.number) < BigInt(b.number) ? -1 : 1)
  );
  if (stable(points) !== stable(fixedPoints))
    fail("Only the five checksum-reviewed fixed boundary points are allowed.");
  return points;
}

export function blockHeader(value, expectedNumber) {
  if (
    !value ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value.number ?? "") ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value.timestamp ?? "") ||
    !hashPattern.test(value.hash ?? "") ||
    /^0x0{64}$/.test(value.hash) ||
    !hashPattern.test(value.parentHash ?? "")
  )
    fail("Invalid canonical block header.");
  const result = {
    number: String(BigInt(value.number)),
    hash: value.hash,
    parentHash: value.parentHash,
    timestamp: String(BigInt(value.timestamp))
  };
  if (expectedNumber !== undefined && result.number !== expectedNumber)
    fail("RPC returned a different boundary number.");
  return result;
}

async function boundedJson(response) {
  if (
    !response.ok ||
    Number(response.headers.get("content-length") ?? 0) > 2000000
  )
    fail("Bounded loopback RPC request failed.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2000000) fail("Oversized loopback RPC response.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function canonicalWitnesses(profile, points, options = {}) {
  if (stable(points) !== stable(fixedPoints)) fail("Unreviewed witness range.");
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const counters = { rpcCalls: 0, httpCalls: 0, permitHeaders: 0, retries: 0 };
  const settled = await Promise.allSettled(
    [...ports].map(async ([chainId, port]) => {
      const headers = {
        "content-type": "application/json",
        "x-yunipals-unified-rpc-profile": pins.profileId,
        "x-yunipals-rpc-workload": "unified_evidence"
      };
      const request = async (path, calls) => {
        counters.httpCalls++;
        if (calls) counters.rpcCalls += calls.length;
        options.onCounters?.({ ...counters });
        return boundedJson(
          await fetcher(`http://127.0.0.1:${port}${path}`, {
            method: calls ? "POST" : "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            ...(calls ? { body: JSON.stringify(calls) } : {})
          })
        );
      };
      const preflight = await request("/unified/preflight");
      if (
        preflight.profileId !== pins.profileId ||
        preflight.manifestHash !== pins.manifest ||
        preflight.chainId !== chainId ||
        preflight.workload !== "unified_evidence" ||
        preflight.scope !== profile.scope ||
        preflight.coordinatorId !== profile.coordinatorId ||
        preflight.paid !== "explicit_bounded_permit_only" ||
        stable(preflight.replay) !== stable({ mode: "free_only" })
      )
        fail("Exact permit-free RPC preflight failed.");
      const selected = points.filter((point) => point.chainId === chainId);
      const calls = [
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getBlockByNumber",
          params: ["finalized", false]
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "eth_getBlockByNumber",
          params: ["latest", false]
        },
        ...selected.map((point, index) => ({
          jsonrpc: "2.0",
          id: index + 4,
          method: "eth_getBlockByNumber",
          params: [`0x${BigInt(point.number).toString(16)}`, false]
        }))
      ];
      if (calls.length > Math.min(10, profile.limits.batchCalls))
        fail("Reviewed batch cap is too small.");
      const batch = async (input) => {
        const response = await request("/unified", input);
        if (!Array.isArray(response) || response.length !== input.length)
          fail("Incomplete RPC batch.");
        const values = new Map();
        for (const row of response) {
          if (
            row.jsonrpc !== "2.0" ||
            !input.some((call) => call.id === row.id) ||
            values.has(row.id) ||
            row.error ||
            !("result" in row)
          )
            fail("RPC batch identity/error mismatch.");
          values.set(row.id, row.result);
        }
        return values;
      };
      const values = await batch(calls);
      if (values.get(1) !== `0x${chainId.toString(16)}`)
        fail("RPC chain identity differs.");
      const finalized = blockHeader(values.get(2));
      const head = blockHeader(values.get(3));
      if (
        BigInt(finalized.number) > BigInt(head.number) ||
        BigInt(finalized.timestamp) > BigInt(head.timestamp) ||
        (finalized.number === head.number && finalized.hash !== head.hash)
      )
        fail("RPC finality is inconsistent.");
      const fresh = () =>
        BigInt(head.timestamp) * 1000n <= BigInt(now() + 30000) &&
        BigInt(now()) - BigInt(head.timestamp) * 1000n <= 180000n;
      if (!fresh()) fail("RPC head is stale.");
      const boundaries = selected.map((point, index) => {
        const header = blockHeader(values.get(index + 4), point.number);
        if (
          BigInt(header.number) > BigInt(finalized.number) ||
          BigInt(header.timestamp) > BigInt(finalized.timestamp) ||
          (header.number === finalized.number && header.hash !== finalized.hash)
        )
          fail("Boundary is not currently finalized.");
        return { ...point, ...header };
      });
      const repeated = await batch([
        {
          jsonrpc: "2.0",
          id: 100,
          method: "eth_getBlockByNumber",
          params: [`0x${BigInt(head.number).toString(16)}`, false]
        }
      ]);
      if (
        stable(blockHeader(repeated.get(100), head.number)) !== stable(head) ||
        !fresh()
      )
        fail("RPC branch changed during witness capture.");
      return {
        chainId,
        finalized,
        head,
        boundaries,
        profileId: preflight.profileId,
        replay: preflight.replay
      };
    })
  );
  // Await all four bounded chains before recording failure counts; no retry.
  const rejected = settled.find((entry) => entry.status === "rejected");
  if (rejected) throw rejected.reason;
  const result = settled.map((entry) => entry.value);
  if (counters.rpcCalls !== 21 || counters.httpCalls !== 12)
    fail("Unexpected witness request count.");
  return {
    chains: result.sort((a, b) => a.chainId - b.chainId),
    ...counters,
    paidDispatchPossibleWithoutPermit: false
  };
}

export async function validateCacheLayout(db, migrationNames) {
  const relations = (
    await db.query(`SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ponder_sync' AND c.relname IN('blocks','kysely_migration')`)
  ).rows;
  if (relations.length !== 2 || relations.some((row) => row.relkind !== "r"))
    fail("Original physical Ponder cache tables are required.");
  const migrations = (
    await db.query(
      "SELECT name FROM ponder_sync.kysely_migration ORDER BY name"
    )
  ).rows.map((row) => row.name);
  if (migrations.length !== 27 || stable(migrations) !== stable(migrationNames))
    fail("Ponder cache migration identity differs from the installed release.");
  const columns = (
    await db.query(
      `SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required
    FROM pg_attribute a WHERE a.attrelid='ponder_sync.blocks'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND a.attname=ANY($1::text[]) ORDER BY a.attname`,
      [["chain_id", "number", "hash", "parent_hash", "timestamp"]]
    )
  ).rows;
  const expected = [
    { attname: "chain_id", type: "bigint", required: true },
    { attname: "hash", type: "character varying(66)", required: true },
    { attname: "number", type: "bigint", required: true },
    { attname: "parent_hash", type: "character varying(66)", required: true },
    { attname: "timestamp", type: "bigint", required: true }
  ];
  if (stable(columns) !== stable(expected))
    fail("Unsupported physical Ponder cache header columns.");
  const primary = (
    await db.query(`SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid='ponder_sync.blocks'::regclass AND i.indisprimary`)
  ).rows[0]?.columns;
  if (stable(primary) !== stable(["chain_id", "number"]))
    fail("Unsupported Ponder cache key.");
  return {
    physicalTables: true,
    migrationCount: migrations.length,
    migrationNamesSha256: sha256(json(migrations)),
    physicalHeaderColumns: columns,
    primaryKey: primary,
    headerColumnsAndKeyValidated: true
  };
}

export async function databaseWitnessSnapshot(db, context) {
  const {
    baseline,
    points,
    profile,
    official,
    migrationNames,
    now = Date.now,
    onPhase = () => {}
  } = context;
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await db.query(
      "SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='15s'; SET LOCAL work_mem='8MB'"
    );
    const observation = (
      await db.query(
        "SELECT current_database() AS database,pg_current_snapshot()::text AS snapshot,transaction_timestamp()::text AS at,current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation"
      )
    ).rows[0];
    if (
      observation?.read_only !== "on" ||
      observation?.isolation !== "repeatable read"
    )
      fail("Read-only snapshot is unavailable.");
    onPhase("database_release");
    const release = await official.loadIndexerRelease(db, pins.release);
    if (
      release.schema !== pins.schema ||
      release.buildId !== pins.build ||
      release.manifestHash !== pins.manifest ||
      stable({
        ...release.manifest,
        sources: [...release.manifest.sources].sort((a, b) =>
          a.id.localeCompare(b.id)
        )
      }) !==
        stable({
          ...profile.manifest,
          sources: [...profile.manifest.sources].sort((a, b) =>
            a.id.localeCompare(b.id)
          )
        })
    )
      fail("Registered source differs from the reviewed release/profile.");
    const runtime = await official.readBoundRuntime(db, release);
    onPhase("database_cache_layout");
    const cache = await validateCacheLayout(db, migrationNames);
    onPhase("database_source_tables");
    const sourceRelations = (
      await db.query(
        `SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
        [pins.schema, ["chain_block", "chain_checkpoint", "indexer_source"]]
      )
    ).rows;
    if (
      sourceRelations.length !== 3 ||
      sourceRelations.some((row) => row.relkind !== "r")
    )
      fail("Original physical candidate witness tables are required.");
    const witnesses = [];
    onPhase("database_headers");
    for (const point of points) {
      const framework = (
        await db.query(
          `SELECT number::text AS number,hash,parent_hash AS "parentHash",timestamp::text AS timestamp
        FROM ponder_sync.blocks WHERE chain_id=$1::bigint AND number=$2::bigint`,
          [point.chainId, point.number]
        )
      ).rows;
      const callback = (
        await db.query(
          `SELECT block_number::text AS number,block_hash AS hash,parent_hash AS "parentHash",timestamp::text AS timestamp
        FROM "${pins.schema}".chain_block WHERE chain_id=$1 AND block_number=$2::bigint`,
          [point.chainId, point.number]
        )
      ).rows;
      for (const rows of [framework, callback]) {
        if (
          rows.length > 1 ||
          rows.some(
            (row) =>
              !decimal.test(row.number) ||
              !decimal.test(row.timestamp) ||
              !hashPattern.test(row.hash) ||
              !hashPattern.test(row.parentHash)
          )
        )
          fail("Malformed stored boundary witness.");
      }
      witnesses.push({
        ...point,
        frameworkCacheHeader: framework[0] ?? null,
        callbackHeader: callback[0] ?? null,
        frameworkCacheIsReleasePinned: false
      });
    }
    const readiness = [];
    onPhase("database_readiness");
    for (const row of baseline.collections) {
      const source = context.ownershipSources.find(
        (source) => source.collection === row.collection
      );
      const definition = release.manifest.sources.find(
        (entry) => entry.id === source?.sourceId
      );
      if (
        !definition?.enabled ||
        definition.chainId !== row.chainId ||
        definition.address !== row.address ||
        definition.startBlock !== row.startBlock
      )
        fail("Ownership source identity differs.");
      const policy = definition.policies[0];
      const value = await official.readIndexerSourceStatus(
        db,
        release,
        source.sourceId,
        policy,
        { nowMs: now(), maxObservationAgeMs: 180000 }
      );
      readiness.push({
        collection: row.collection,
        sourceId: source.sourceId,
        policy,
        ready: value.readiness.ready,
        reason: value.readiness.reason,
        availableThrough:
          value.readiness.availableThroughBlock === null
            ? null
            : String(value.readiness.availableThroughBlock),
        completeThrough:
          runtime.chains
            .find((chain) => chain.chainId === row.chainId)
            ?.completeThroughBlock?.toString() ?? null,
        errorCode: value.errorCode
      });
    }
    onPhase("database_selector");
    const selector = (
      await db.query(
        "SELECT name,release_id,epoch::text FROM yunipals_indexer_control.active_release ORDER BY name"
      )
    ).rows;
    onPhase("database_commit");
    await db.query("COMMIT");
    return {
      observation,
      release: {
        id: release.id,
        schema: release.schema,
        buildId: release.buildId,
        manifestHash: release.manifestHash
      },
      runtime: {
        buildId: runtime.buildId,
        observedAtMs: runtime.observedAtMs,
        running: runtime.running,
        frameworkReady: runtime.frameworkReady
      },
      cache,
      witnesses,
      readiness,
      activeSelector: selector
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function qualifyAcceptance(baseline, candidate, database, canonical) {
  const canonicalPoints = canonical.chains
    .flatMap((chain) =>
      chain.boundaries.map((point) => ({
        chainId: point.chainId,
        number: point.number
      }))
    )
    .sort(
      (a, b) =>
        a.chainId - b.chainId || (BigInt(a.number) < BigInt(b.number) ? -1 : 1)
    );
  if (
    stable(canonicalPoints) !== stable(fixedPoints) ||
    canonical.rpcCalls !== 21 ||
    canonical.httpCalls !== 12 ||
    canonical.permitHeaders !== 0 ||
    canonical.retries !== 0 ||
    canonical.paidDispatchPossibleWithoutPermit !== false
  )
    fail(
      "Canonical witness protocol differs from its bounded free-only scope."
    );
  const boundaryHeaders = new Map(
    canonical.chains.flatMap((chain) =>
      chain.boundaries.map((point) => [pointKey(point), point])
    )
  );
  const missingLegacy = [];
  const boundaryResults = baseline.collections.map((row) => {
    const header = boundaryHeaders.get(`${row.chainId}:${row.boundary.number}`);
    if (!header) fail("Missing canonical fixed boundary.");
    if (row.boundary.hash && row.boundary.hash !== header.hash)
      fail("Saved legacy boundary contradicts current canonical history.");
    if (!row.boundary.hash) missingLegacy.push(row.collection);
    const stored = database.witnesses.find(
      (point) => pointKey(point) === `${row.chainId}:${row.boundary.number}`
    );
    if (!stored) fail("Missing explicit candidate witness result.");
    for (const value of [stored.frameworkCacheHeader, stored.callbackHeader]) {
      if (
        value &&
        ["number", "hash", "parentHash", "timestamp"].some(
          (key) => value[key] !== header[key]
        )
      )
        fail("Candidate/cache boundary contradicts current canonical history.");
    }
    return {
      collection: row.collection,
      chainId: row.chainId,
      number: row.boundary.number,
      savedLegacyHash: row.boundary.hash,
      savedLegacyHashStatus: row.boundary.hash
        ? "matched_recorded_hash"
        : "not_recorded_in_legacy_baseline",
      canonicalHash: header.hash,
      callbackWitnessPresent: stored.callbackHeader !== null,
      frameworkCacheWitnessPresent: stored.frameworkCacheHeader !== null
    };
  });
  const reasons = [];
  if (!candidate) reasons.push("candidate_parity_report_not_supplied");
  let dataEqual = false;
  if (candidate) {
    if (
      candidate.format !== "yunipals-ownership-parity-v1" ||
      candidate.source !== "unified" ||
      candidate.completed !== true ||
      candidate.observation?.read_only !== "on" ||
      candidate.observation?.isolation !== "repeatable read" ||
      candidate.release?.id !== database.release.id ||
      candidate.release.physical_schema !== database.release.schema ||
      candidate.release.build_id !== database.release.buildId ||
      candidate.release.manifest_hash !== database.release.manifestHash ||
      candidate.collections?.length !== baseline.collections.length
    )
      fail(
        "Candidate parity report lacks the exact completed registered read-only source."
      );
    const seen = new Set();
    dataEqual = baseline.collections.every((before) => {
      const rows = candidate.collections.filter(
        (row) => row.collection === before.collection
      );
      if (rows.length !== 1 || seen.has(before.collection))
        fail("Candidate parity collection identity differs.");
      seen.add(before.collection);
      const after = rows[0];
      const header = boundaryHeaders.get(
        `${before.chainId}:${before.boundary.number}`
      );
      if (
        after.chainId !== before.chainId ||
        after.address !== before.address ||
        after.startBlock !== before.startBlock ||
        after.physicalSchema !== database.release.schema ||
        after.boundary?.number !== before.boundary.number ||
        after.boundary.runtime?.buildId !== database.release.buildId ||
        !decimal.test(after.boundary.availableThrough ?? "") ||
        BigInt(after.boundary.availableThrough) <
          BigInt(before.boundary.number) ||
        (after.boundary.hash !== null && after.boundary.hash !== header.hash) ||
        stable(Object.keys(after.datasets ?? {}).sort()) !==
          stable(Object.keys(before.datasets).sort())
      )
        fail("Candidate report boundary/dataset identity differs.");
      return Object.entries(before.datasets).every(
        ([name, value]) => stable(after.datasets[name]) === stable(value)
      );
    });
    if (!dataEqual) reasons.push("ownership_dataset_digest_difference");
    if (candidate.exactDataParity !== true)
      reasons.push("candidate_report_did_not_assert_exact_data_parity");
    const originalFlag = baseline.collections.every(
      (before) =>
        !!before.boundary.hash &&
        before.boundary.hash ===
          candidate.collections.find(
            (row) => row.collection === before.collection
          )?.boundary.hash
    );
    if (candidate.allBoundaryHashesMatch !== originalFlag)
      fail("Original allBoundaryHashesMatch semantics were changed.");
  }
  for (const row of baseline.collections) {
    const status = database.readiness.find(
      (entry) => entry.collection === row.collection
    );
    if (
      !status?.ready ||
      status.errorCode ||
      !decimal.test(status.availableThrough ?? "") ||
      !decimal.test(status.completeThrough ?? "") ||
      BigInt(status.availableThrough) < BigInt(row.boundary.number) ||
      BigInt(status.completeThrough) < BigInt(row.boundary.number)
    )
      reasons.push(`candidate_not_ready_at_boundary:${row.collection}`);
  }
  if (database.activeSelector.length)
    reasons.push("unexpected_existing_active_selector");
  return {
    qualified: reasons.length === 0,
    qualification:
      "recorded_height_data_parity_with_independent_current_finalized_canonical_anchors",
    exactDataParityRecomputed: candidate ? dataEqual : null,
    originalAllBoundaryHashesMatch: candidate?.allBoundaryHashesMatch ?? null,
    allSavedLegacyHashesMatched: true,
    legacyHashesNotRecorded: missingLegacy,
    allLegacyBoundaryHashesRecorded: missingLegacy.length === 0,
    canonicalBoundaryPoints: boundaryHeaders.size,
    reasons,
    boundaries: boundaryResults,
    prominentQualification:
      "Four legacy Ponder boundary hashes were not recorded. This accepts equal indexed data at the recorded block heights with independently checked current canonical headers; it does not establish equality with four historically saved legacy block hashes.",
    otherFeatureAcceptanceClaimed: false
  };
}

function protectedAncestors(path) {
  if (!isAbsolute(path)) fail("Absolute protected input path required.");
  let parent = path;
  for (;;) {
    const info = lstatSync(parent);
    if (
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      (info.mode & 0o022 && !(info.isDirectory() && info.mode & 0o1000))
    )
      fail("Input ancestry is redirected or writable.");
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}
function protectedFile(path, maximum = 25000000) {
  protectedAncestors(path);
  const info = lstatSync(path);
  if (!info.isFile() || info.size > maximum)
    fail("Bounded regular input file required.");
  return readFileSync(path);
}

export function validateInstalledRuntime(root, inventory) {
  protectedAncestors(root);
  let bytes = 0;
  for (const entry of inventory.entries) {
    if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
      fail("Runtime inventory escapes its source root.");
    const path = join(root, entry.path),
      info = lstatSync(path);
    if (
      info.uid !== 0 ||
      (info.mode & 0o777) !== entry.mode ||
      relative(root, realpathSync(path)).startsWith("..")
    )
      fail("Installed runtime ownership/mode/root differs.");
    if (entry.type === "symlink") {
      if (!info.isSymbolicLink() || readlinkSync(path) !== entry.target)
        fail("Installed runtime link differs.");
    } else if (entry.type === "directory") {
      if (!info.isDirectory() || realpathSync(path) !== path)
        fail("Installed runtime directory is redirected.");
    } else if (entry.type === "file") {
      if (
        !info.isFile() ||
        realpathSync(path) !== path ||
        info.size !== entry.bytes ||
        info.size > 16000000 ||
        sha256(readFileSync(path)) !== entry.sha256
      )
        fail("Installed runtime file bytes differ.");
      bytes += info.size;
    } else fail("Unknown installed runtime entry type.");
  }
  return {
    entriesVerified: inventory.entries.length,
    regularBytesVerified: bytes,
    sourceUnchanged: true
  };
}

export function reviewPlan(planFile) {
  const planBytes = protectedFile(planFile, 20000);
  const plan = JSON.parse(planBytes);
  const keys = [
    "format",
    "sourceRoot",
    "baselineFile",
    "profileFile",
    "runtimeInventoryFile",
    "candidateReportFile",
    "candidateReportSha256",
    "output"
  ];
  if (
    stable(Object.keys(plan).sort()) !== stable(keys.sort()) ||
    plan.format !== "yunipals-fixed-boundary-witness-plan-v1" ||
    plan.sourceRoot !== `/opt/yunipals-unified/releases/${pins.source}` ||
    !isAbsolute(plan.output) ||
    existsSync(plan.output) ||
    (plan.candidateReportFile === null) !==
      (plan.candidateReportSha256 === null) ||
    (plan.candidateReportSha256 !== null &&
      (!/^[0-9a-f]{64}$/.test(plan.candidateReportSha256) ||
        typeof plan.candidateReportFile !== "string" ||
        !isAbsolute(plan.candidateReportFile)))
  )
    fail("Use an exact new-output fixed-boundary witness plan.");
  protectedAncestors(dirname(plan.output));
  if (!lstatSync(dirname(plan.output)).isDirectory())
    fail("Protected output directory required.");
  const baselineBytes = protectedFile(plan.baselineFile);
  const profileBytes = protectedFile(plan.profileFile, 2000000);
  const inventoryBytes = protectedFile(plan.runtimeInventoryFile);
  const manifestBytes = protectedFile(
    join(plan.sourceRoot, "RELEASE-MANIFEST.json")
  );
  if (
    sha256(baselineBytes) !== pins.baseline ||
    sha256(profileBytes) !== pins.profile ||
    sha256(inventoryBytes) !== pins.inventory ||
    sha256(manifestBytes) !== pins.sourceManifest
  )
    fail("Fixed source/baseline/profile/runtime pins differ.");
  const manifest = JSON.parse(manifestBytes);
  const inventory = JSON.parse(inventoryBytes);
  if (
    manifest.sourceDigest !== pins.source ||
    sha256(json(manifest.files)) !== pins.source ||
    inventory.sourceDigest !== pins.source ||
    inventory.sourceManifestSha256 !== pins.sourceManifest ||
    inventory.runtime.node !== "24.18.1"
  )
    fail("Source/runtime identity differs.");
  const installedRuntime = validateInstalledRuntime(plan.sourceRoot, inventory);
  for (const entry of manifest.files) {
    if (
      entry.path.startsWith("/") ||
      entry.path.split("/").includes("..") ||
      sha256(protectedFile(join(plan.sourceRoot, entry.path))) !== entry.sha256
    )
      fail("Installed source bytes changed.");
  }
  const runtimeFile = (path) => {
    const actual = realpathSync(join(plan.sourceRoot, path));
    const name = relative(plan.sourceRoot, actual);
    const expected = inventory.entries.find(
      (entry) => entry.path === name && entry.type === "file"
    );
    if (
      !expected ||
      name.startsWith("..") ||
      sha256(protectedFile(actual)) !== expected.sha256
    )
      fail("Installed Ponder runtime file changed.");
    return readFileSync(actual, "utf8");
  };
  if (
    JSON.parse(
      runtimeFile("apps/yunipals-indexer/node_modules/ponder/package.json")
    ).version !== "0.17.5"
  )
    fail("Unsupported Ponder version.");
  const migrations = runtimeFile(
    "apps/yunipals-indexer/node_modules/ponder/src/sync-store/migrations.ts"
  );
  const migrationNames = [
    ...migrations.matchAll(/^\s*["'](\d{4}_\d{1,2}_\d{1,2}_[^"']+)["']\s*:/gm)
  ]
    .map((row) => row[1])
    .sort();
  if (migrationNames.length !== 27)
    fail("Unsupported installed cache migration identity.");
  const baseline = JSON.parse(baselineBytes);
  const profile = JSON.parse(profileBytes);
  if (
    id(profile) !== pins.profileId ||
    id({
      ...profile.manifest,
      sources: [...profile.manifest.sources].sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    }) !== pins.manifest
  )
    fail("RPC logical identity differs.");
  const candidateBytes = plan.candidateReportFile
    ? protectedFile(plan.candidateReportFile, 4000000)
    : null;
  if (candidateBytes && sha256(candidateBytes) !== plan.candidateReportSha256)
    fail("Candidate report checksum differs.");
  const binding = {
    format: "yunipals-fixed-boundary-witness-review-v1",
    helperSha256: sha256(readFileSync(new URL(import.meta.url))),
    planSha256: sha256(planBytes),
    plan,
    pins,
    points: boundaryPoints(baseline),
    cacheMigrationNamesSha256: sha256(json(migrationNames)),
    installedRuntime,
    maximumRpcCalls: 21,
    maximumHttpCalls: 12,
    replayPermits: [],
    readOnlyDatabase: true,
    sourceSelectionChanged: false,
    writesOnlyNewEvidenceFile: true,
    legacyMissingHashesRemainMissing: true
  };
  return {
    review: {
      reviewHash: sha256(stable(binding)),
      binding,
      providerCallsPerformed: 0,
      databaseConnectionsPerformed: 0
    },
    plan,
    baseline,
    profile,
    migrationNames,
    candidate: candidateBytes ? JSON.parse(candidateBytes) : null
  };
}

export function dropToPostgresPeer(api = process) {
  api.setgroups([]);
  api.setgid("postgres");
  api.setuid("postgres");
  if (
    api.getuid() === 0 ||
    api.getgid() === 0 ||
    api.getgroups().some((group) => group !== api.getgid())
  )
    fail("Unexpected retained peer-process group privilege.");
}

export async function captureWitness(inputs, dependencies) {
  const {
    createDatabase,
    official,
    ownershipSources,
    dropPeer = dropToPostgresPeer,
    captureCanonical = canonicalWitnesses,
    onProgress = () => {}
  } = dependencies;
  const progress = {
    phase: "peer_identity",
    rpcCalls: 0,
    httpCalls: 0,
    permitHeaders: 0,
    retries: 0
  };
  const onPhase = (phase) => {
    if (!capturePhases.has(phase)) fail("Unreviewed witness phase.");
    progress.phase = phase;
    onProgress({ ...progress });
  };
  let db;
  try {
    onPhase("peer_identity");
    dropPeer();
    onPhase("database_connect");
    db = createDatabase();
    await db.connect();
    // Validate the actual physical cache and source before any provider attempt.
    onPhase("database_snapshot");
    const database = await databaseWitnessSnapshot(db, {
      ...inputs,
      official,
      ownershipSources,
      points: inputs.review.binding.points,
      onPhase
    });
    onPhase("canonical_witnesses");
    const canonical = await captureCanonical(
      inputs.profile,
      inputs.review.binding.points,
      {
        onCounters: (counters) => {
          Object.assign(progress, counters);
          onProgress({ ...progress });
        }
      }
    );
    onPhase("witness_comparison");
    const acceptance = qualifyAcceptance(
      inputs.baseline,
      inputs.candidate,
      database,
      canonical
    );
    return { canonical, database, acceptance };
  } finally {
    await db?.end().catch(() => undefined);
  }
}

async function main() {
  const { values } = parseArgs({
    options: { plan: { type: "string" }, apply: { type: "string" } }
  });
  if (process.versions.node !== "24.18.1" || !values.plan)
    fail("Use Node24.18.1 and an absolute reviewed plan.");
  const inputs = reviewPlan(resolve(values.plan));
  if (!values.apply) {
    console.log(json(inputs.review));
    return;
  }
  if (
    values.apply !== inputs.review.reviewHash ||
    process.getuid?.() !== 0 ||
    hostname() !== "yunipals-main"
  )
    fail("Exact reviewed host/root approval is required.");
  const require = createRequire(
    join(inputs.plan.sourceRoot, "apps/yunipals-indexer/package.json")
  );
  const { Client } = require("pg");
  const parity = await import(
    pathToFileURL(
      join(inputs.plan.sourceRoot, "ops/unified-indexer/ownership-parity.mjs")
    )
  );
  parity.validateBaseline(inputs.baseline);
  const official = {
    ...(await import(
      pathToFileURL(
        join(
          inputs.plan.sourceRoot,
          "packages/yunipals-indexer-server/src/releases.ts"
        )
      )
    )),
    ...(await import(
      pathToFileURL(
        join(
          inputs.plan.sourceRoot,
          "packages/yunipals-indexer-server/src/status.ts"
        )
      )
    ))
  };
  const output = openSync(inputs.plan.output, "wx", 0o600);
  let progress = { phase: "peer_identity" };
  try {
    // Load reviewed public modules first, then drop to peer-authenticated postgres.
    const { canonical, database, acceptance } = await captureWitness(inputs, {
      createDatabase: () =>
        new Client({
          host: "/var/run/postgresql",
          port: 5432,
          database: "yunipals_backfill",
          user: "postgres",
          application_name: "yunipals_fixed_boundary_witness_readonly",
          connectionTimeoutMillis: 3000
        }),
      official,
      ownershipSources: parity.ownershipSources,
      onProgress: (value) => {
        progress = value;
      }
    });
    const result = {
      format: "yunipals-fixed-boundary-witness-v1",
      completed: true,
      capturedAt: new Date().toISOString(),
      reviewHash: inputs.review.reviewHash,
      binding: inputs.review.binding,
      canonical,
      database,
      acceptance,
      legacyBaselineUnchanged: true,
      productionChanged: false,
      secretOrOwnershipRowsExported: false
    };
    progress.phase = "write_output";
    writeFileSync(output, json(result));
    console.log(
      json({
        completed: true,
        output: inputs.plan.output,
        qualified: acceptance.qualified,
        qualification: acceptance.qualification,
        absentLegacyBoundaryHashes: acceptance.legacyHashesNotRecorded.length,
        rpcCalls: canonical.rpcCalls,
        replayPermits: []
      })
    );
    if (inputs.candidate && !acceptance.qualified) process.exitCode = 2;
  } catch (error) {
    writeFileSync(
      output,
      json({
        format: "yunipals-fixed-boundary-witness-v1",
        completed: false,
        reason:
          "Fixed-boundary validation failed; private driver diagnostics withheld.",
        reviewHash: inputs.review.reviewHash,
        diagnostics: failureDiagnostics(error, progress)
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
    console.error(
      json({
        completed: false,
        reason:
          "Fixed-boundary validation failed. No source/selector/header table was modified."
      })
    );
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as previous from "./fixed-boundary-witness-v3.mjs";
import { ownershipSources } from "../unified-indexer/ownership-parity.mjs";
import {
  FORMAT,
  V5,
  PROGRAMS,
  official,
  snapshotFunction,
  captureWitness,
  checkedPlan,
  sha
} from "./fixed-boundary-witness-v5.mjs";

const raw = readFileSync(
  new URL("./fixed-boundary-witness-v3.mjs", import.meta.url)
);
const profile = JSON.parse(
  readFileSync(new URL("./ypal-combined-rpc-profile-v1.json", import.meta.url))
);
const now = Date.parse("2026-10-25T00:00:00Z");
const point = 200000000n;
const hash = (value) => `0x${sha(String(value))}`;
const cp = (chain, number) =>
  `${String(now / 1000).padStart(10, "0")}${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
function database({
  marker = V5.readIdentity,
  framework = 1,
  error = null
} = {}) {
  const release = {
    id: previous.pins.release,
    schema: previous.pins.schema,
    buildId: previous.pins.build,
    manifestHash: previous.pins.manifest,
    manifest: profile.manifest
  };
  const rows = profile.manifest.sources.map((source) => ({
    id: source.id,
    chain_id: source.chainId,
    manifest_hash: previous.pins.manifest,
    definition: JSON.stringify(source)
  }));
  const queries = [];
  const query = async (sql, params = []) => {
    queries.push(sql);
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql))
      return { rows: [], rowCount: 0 };
    if (sql.includes("current_database()"))
      return { rows: [{ read_only: "on", isolation: "repeatable read" }] };
    if (sql.startsWith("SELECT * FROM yunipals_indexer_control.release"))
      return {
        rows: [
          {
            id: release.id,
            physical_schema: release.schema,
            build_id: release.buildId,
            manifest_hash: release.manifestHash,
            manifest: release.manifest
          }
        ]
      };
    if (sql.includes("SELECT value AS app"))
      return {
        rows: [
          {
            app: {
              version: "6",
              build_id: previous.pins.build,
              heartbeat_at: now - 100,
              is_ready: framework,
              is_locked: 1,
              is_dev: 0
            },
            checkpoints: [1, 56, 137, 8453].map((chain) => ({
              chain_id: String(chain),
              chain_name: "fixture",
              latest_checkpoint: cp(chain, point),
              safe_checkpoint: cp(chain, point),
              finalized_checkpoint: cp(chain, point)
            })),
            witnesses: [1, 56, 137, 8453].map((chain) => ({
              chain_id: chain,
              block_number: String(point),
              block_hash: hash(point),
              parent_hash: hash(point - 1n),
              timestamp: String(now / 1000 - 1)
            }))
          }
        ]
      };
    if (sql.includes("SELECT id,chain_id,manifest_hash,definition FROM"))
      return { rows };
    if (sql.includes("_unified_read_release")) {
      assert(sql.includes(`"${V5.readSchema}"`));
      return {
        rows: [
          {
            identity: marker,
            release_id: release.id,
            manifest_hash: release.manifestHash
          }
        ]
      };
    }
    if (sql.includes("SELECT revision::text"))
      return {
        rows: [
          {
            revision: "1",
            head_number: String(point + 3n),
            head_hash: hash(point + 3n),
            head_timestamp: String(now / 1000 - 1),
            finalized_number: String(point - 100n),
            finalized_hash: hash(point - 100n),
            witness_number: String(point),
            witness_hash: hash(point),
            observed_at_ms: String(now - 100),
            halted: false,
            error_code: error,
            finality_error_code: null,
            anchors: Object.fromEntries(
              [point, point - 17n, point - 100n].map((number) => [
                String(number),
                {
                  number: String(number),
                  hash: hash(number),
                  timestamp: String(now / 1000 - 1)
                }
              ])
            )
          }
        ]
      };
    if (sql.startsWith("SELECT 1 FROM")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("SELECT c.relname,c.relkind"))
      return {
        rows: ["chain_block", "chain_checkpoint", "indexer_source"].map(
          (relname) => ({ relname, relkind: "r" })
        )
      };
    if (
      sql.includes("FROM ponder_sync.blocks") ||
      sql.includes(
        'FROM "unified_ypal_20261023_v1".chain_block WHERE chain_id=$1 AND block_number=$2'
      )
    )
      return { rows: [] };
    if (sql.includes("FROM yunipals_indexer_control.active_release"))
      return { rows: [] };
    throw Error("unexpected fixture SQL");
  };
  return { release, query, queries };
}
const baseline = {
  collections: ownershipSources.map((source) => ({
    ...source,
    boundary: {
      number: previous.fixedPoints.filter((p) => p.chainId === source.chainId)[
        source.collection === "base-islands-v2"
          ? 0
          : previous.fixedPoints.filter((p) => p.chainId === source.chainId)
              .length - 1
      ].number,
      hash: null
    },
    datasets: { owners: { count: 1, digest: "fixture" } }
  }))
};

test("official bundle has exact reviewed V5 closure and readonly exports", async () => {
  const api = await official();
  assert.deepEqual(
    Object.keys(api).sort(),
    ["loadIndexerRelease", "readBoundRuntime", "readIndexerSourceStatus"].sort()
  );
  const descriptor = JSON.parse(
    readFileSync(
      new URL("./ypal-v5-witness-official-v1.sources.json", import.meta.url)
    )
  );
  assert.equal(Object.keys(descriptor.sourcePins).length, 10);
  assert.equal(
    descriptor.sourcePins["packages/yunipals-indexer-client/src/readiness.ts"],
    "06b4f87fa9d1446b32d157d215ab45701152552b1b730d84561f8bce244b6aab"
  );
  assert.equal(descriptor.artifact.sha256, PROGRAMS[descriptor.artifact.file]);
  assert.deepEqual(descriptor.runtimeImports, [
    { path: "node:crypto", kind: "import-statement", external: true }
  ]);
});
test("snapshot body is unchanged in new lexical V5 pins, old pins untouched", () => {
  const snapshot = snapshotFunction(raw, previous);
  assert.equal(
    snapshot.toString(),
    previous.databaseWitnessSnapshot.toString()
  );
  assert.equal(previous.pins.readSchema, "yunipals_ownership_4e77f52b_v4");
  assert.throws(() =>
    snapshotFunction(Buffer.concat([raw, Buffer.from("\n")]), previous)
  );
});
test("actual official V5 status accepts latest prefix behindhead and retains strict gates", async () => {
  const api = await official();
  const value = database();
  const ready = await api.readIndexerSourceStatus(
    value,
    value.release,
    "ownership:ethereum",
    { kind: "latest" },
    { nowMs: now }
  );
  assert.equal(ready.readiness.ready, true);
  assert.equal(ready.readiness.availableThroughBlock, point);
  const explicit = await api.readIndexerSourceStatus(
    value,
    value.release,
    "ownership:ethereum",
    { kind: "latest" },
    { nowMs: now, requiredThroughBlock: point + 3n }
  );
  assert.equal(explicit.readiness.ready, false);
  for (const fixture of [
    database({ framework: 0 }),
    database({ error: "provider_lag" })
  ]) {
    const result = await api.readIndexerSourceStatus(
      fixture,
      fixture.release,
      "ownership:ethereum",
      { kind: "latest" },
      { nowMs: now }
    );
    assert.equal(result.readiness.ready, false);
  }
});
test("real snapshot function uses new V5 marker and official allsix status", async () => {
  const api = await official();
  const db = database();
  const snapshot = snapshotFunction(raw, {
    ...previous,
    validateCacheLayout: async () => ({ fixture: true })
  });
  const value = await snapshot(db, {
    baseline,
    points: previous.fixedPoints,
    profile,
    official: api,
    ownershipSources,
    migrationNames: [],
    now: () => now
  });
  assert.deepEqual(value.readContext, {
    schema: V5.readSchema,
    identity: V5.readIdentity
  });
  assert.equal(value.readiness.length, 6);
  assert(value.readiness.every((row) => row.ready));
  assert(db.queries.some((sql) => sql === "COMMIT"));
  assert(
    db.queries.every(
      (sql) => !/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT)\b/.test(sql)
    )
  );
  await assert.rejects(
    snapshot(database({ marker: previous.pins.readIdentity }), {
      baseline,
      points: previous.fixedPoints,
      profile,
      official: api,
      ownershipSources,
      migrationNames: [],
      now: () => now
    }),
    /registered read context/
  );
});
test("own V5 domain rejects old plan/output and no receipt namespace is relabelled", () => {
  assert.notEqual(FORMAT, "yunipals-ypal-fixed-boundary-witness-v3");
  assert.throws(() =>
    checkedPlan(
      { format: "yunipals-ypal-fixed-boundary-witness-plan-v3" },
      "/old/plan.json"
    )
  );
});

test("complete new capture flow keeps allsix parity and unchanged21/12 protocol", async () => {
  const api = await official();
  const db = database();
  let closed = false;
  let dropped = false;
  db.connect = async () => {};
  db.end = async () => {
    closed = true;
  };
  const baselineWithSaved = structuredClone(baseline);
  for (const row of baselineWithSaved.collections)
    if (row.kind === "manual")
      row.boundary.hash = hash(`${row.chainId}:${row.boundary.number}`);
  const candidate = {
    format: "yunipals-ownership-parity-v1",
    source: "unified",
    completed: true,
    observation: { read_only: "on", isolation: "repeatable read" },
    release: {
      id: previous.pins.release,
      physical_schema: previous.pins.schema,
      build_id: previous.pins.build,
      manifest_hash: previous.pins.manifest
    },
    exactDataParity: true,
    allBoundaryHashesMatch: false,
    collections: baselineWithSaved.collections.map((row) => ({
      ...structuredClone(row),
      physicalSchema: previous.pins.schema,
      boundary: {
        ...row.boundary,
        hash: hash(`${row.chainId}:${row.boundary.number}`),
        availableThrough: String(point),
        runtime: { buildId: previous.pins.build }
      }
    }))
  };
  const canonical = {
    rpcCalls: 21,
    httpCalls: 12,
    permitHeaders: 0,
    retries: 0,
    paidDispatchPossibleWithoutPermit: false,
    chains: [1, 56, 137, 8453].map((chainId) => ({
      chainId,
      boundaries: previous.fixedPoints
        .filter((p) => p.chainId === chainId)
        .map((p) => ({
          ...p,
          hash: hash(`${p.chainId}:${p.number}`),
          parentHash: hash(`${p.chainId}:${BigInt(p.number) - 1n}`),
          timestamp: "1000"
        }))
    }))
  };
  let counters;
  const value = await captureWitness(
    {
      baseline: baselineWithSaved,
      candidate,
      profile,
      ownershipSources,
      migrationNames: [],
      now: () => now,
      review: { binding: { points: previous.fixedPoints } }
    },
    {
      old: {
        ...previous,
        validateCacheLayout: async () => ({ fixture: true })
      },
      official: api,
      createDatabase: () => db,
      dropPeer: () => {
        dropped = true;
      },
      captureCanonical: async (selected, points, options) => {
        assert.deepEqual(points, previous.fixedPoints);
        options.onCounters(canonical);
        return canonical;
      },
      onCounters: (value) => {
        counters = value;
      }
    }
  );
  assert(dropped && closed);
  assert.equal(value.acceptance.qualified, true);
  assert.equal(value.acceptance.exactDataParityRecomputed, true);
  assert.equal(value.acceptance.legacyHashesNotRecorded.length, 4);
  assert.equal(value.acceptance.allLegacyBoundaryHashesRecorded, false);
  assert.equal(value.canonical.rpcCalls, 21);
  assert.equal(value.canonical.httpCalls, 12);
  assert.equal(counters.permitHeaders, 0);
  assert.deepEqual(value.database.readContext, {
    schema: V5.readSchema,
    identity: V5.readIdentity
  });
});

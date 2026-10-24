import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  combinedParity as c,
  combinedFrameSql,
  qualifyCombinedFrame,
  inspectCombinedCoverage,
  captureCombinedParity,
  validateParityReceipt
} from "./ownership-parity-peer-v4.mjs";
import {
  captureOwnershipParity,
  ownershipSources,
  datasetSql,
  digestAccumulator,
  validateBaseline
} from "./ownership-parity-peer-v2.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
// Public fixtures contain no retained production rows or dataset digests.
const boundaries = {
  ethereum: "26236452",
  base: "52870956",
  polygon: "95883932",
  bnb: "128816538",
  "ethereum-islands": "26236452",
  "base-islands-v2": "52870977"
};
const baseline = validateBaseline({
  format: "yunipals-ownership-parity-v1",
  source: "legacy",
  completed: true,
  collections: ownershipSources.map((source) => ({
    ...source,
    boundary: { number: boundaries[source.collection], hash: null },
    datasets: Object.fromEntries(
      [
        "token",
        "token_lifecycle",
        "transfer_event",
        ...(source.collection === "base-islands-v2"
          ? []
          : ["admin_role_event"]),
        ...(source.collection === "ethereum-islands"
          ? ["contract_owner_event"]
          : [])
      ].map((name) => [name, digestAccumulator().finish()])
    )
  }))
});
const syntheticBytes = Buffer.from(JSON.stringify(baseline));
// This optional protected input is never part of the public source closure.
const privateBytes = process.env.YPAL_PARITY_PRIVATE_BASELINE
  ? readFileSync(process.env.YPAL_PARITY_PRIVATE_BASELINE)
  : null;
if (privateBytes) assert.equal(sha(privateBytes), c.baselineSha256);
const privateBaseline = privateBytes
  ? validateBaseline(JSON.parse(privateBytes))
  : null;
const privateOnly = {
  skip: privateBytes
    ? false
    : "requires explicit YPAL_PARITY_PRIVATE_BASELINE with exact protected SHA69f9"
};
const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const cp = (chain, n, full = true) =>
  `0000001000${String(chain).padStart(16, "0")}${String(n).padStart(16, "0")}${(full ? "9" : "0").repeat(33)}`;
function frame() {
  return {
    database: "17584",
    role: "postgres",
    sessionRole: "postgres",
    unix: true,
    schemaOid: c.schemaOid,
    readSchemaOid: c.readSchemaOid,
    runtime: {
      version: "6",
      build_id: c.buildId,
      is_dev: 0,
      is_ready: 0,
      is_locked: 1,
      heartbeat_at: 123
    },
    release: {
      id: c.releaseId,
      schema: c.schema,
      build: c.buildId,
      manifestHash: c.manifestHash
    },
    marker: {
      releaseId: c.releaseId,
      identity: c.readIdentity,
      manifestHash: c.manifestHash
    },
    checkpoints: [1, 56, 137, 8453].map((chainId) => ({
      chainId,
      checkpoint: cp(
        chainId,
        baseline.collections
          .filter((r) => r.chainId === chainId)
          .reduce(
            (n, r) =>
              BigInt(r.boundary.number) > n ? BigInt(r.boundary.number) : n,
            0n
          ) + 10n
      )
    }))
  };
}
function fixture(context = frame(), selectedBaseline = baseline) {
  const calls = [];
  return {
    calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql === combinedFrameSql) return { rows: [{ value: context }] };
      if (sql.includes("transaction_timestamp()::text AS at"))
        return {
          rows: [
            {
              database: "fixture",
              snapshot: "1:1:",
              at: "synthetic",
              read_only: "on",
              isolation: "repeatable read"
            }
          ]
        };
      if (sql.includes("FROM yunipals_indexer_control.release"))
        return {
          rows: [
            {
              id: c.releaseId,
              physical_schema: c.schema,
              build_id: c.buildId,
              manifest_hash: c.manifestHash
            }
          ]
        };
      if (sql.includes("pg_catalog.pg_class"))
        return { rows: args[1].map((relname) => ({ relname, relkind: "r" })) };
      if (sql.includes("SELECT c.latest_checkpoint"))
        return {
          rows: [
            {
              latest_checkpoint: context.checkpoints.find(
                (r) => r.chainId === args[0]
              ).checkpoint,
              runtime: context.runtime
            }
          ]
        };
      if (sql.includes("SELECT block_hash")) {
        const b = selectedBaseline.collections.find(
          (r) => r.chainId === args[0] && r.boundary.number === args[1]
        );
        return {
          rows: [
            {
              block_hash:
                b.boundary.hash ?? hash(BigInt(args[1]) + BigInt(args[0]))
            }
          ]
        };
      }
      if (sql.includes("SELECT manifest_hash")) {
        const source = ownershipSources.find((r) => r.sourceId === args[0]);
        return {
          rows: [
            {
              manifest_hash: c.manifestHash,
              definition: {
                enabled: true,
                chainId: source.chainId,
                address: source.address,
                startBlock: source.startBlock,
                events: ["Transfer"]
              }
            }
          ]
        };
      }
      if (sql.startsWith("FETCH")) return { rows: [] };
      if (/^(BEGIN|SET LOCAL|DECLARE|CLOSE|COMMIT|ROLLBACK)/.test(sql))
        return { rows: [] };
      throw Error("unexpected_fixture_query");
    }
  };
}
function exactReceipt(selectedBaseline = baseline) {
  const f = frame();
  return {
    format: c.format,
    completed: true,
    producerSha256: sha(
      readFileSync(new URL("./ownership-parity-peer-v4.mjs", import.meta.url))
    ),
    originalToolSha256: c.originalToolSha256,
    baselineSha256: c.baselineSha256,
    sourceRelease: c.releaseId,
    sourceSchema: c.schema,
    sourceSchemaOid: c.schemaOid,
    buildId: c.buildId,
    manifestHash: c.manifestHash,
    readSchema: c.readSchema,
    readSchemaOid: c.readSchemaOid,
    readIdentity: c.readIdentity,
    allSixCollections: true,
    sourceReadinessQualified: false,
    canonicalWitnessQualified: false,
    coverage: qualifyCombinedFrame(f, selectedBaseline),
    parity: {
      format: "yunipals-ownership-parity-v1",
      completed: true,
      source: "unified",
      observation: { read_only: "on", isolation: "repeatable read" },
      release: {
        id: c.releaseId,
        physical_schema: c.schema,
        build_id: c.buildId,
        manifest_hash: c.manifestHash
      },
      exactDataParity: true,
      allBoundaryHashesMatch: false,
      collections: selectedBaseline.collections.map((r) => ({
        ...structuredClone(r),
        physicalSchema: c.schema,
        boundary: {
          ...r.boundary,
          availableThrough: qualifyCombinedFrame(
            f,
            selectedBaseline
          ).collections.find((v) => v.collection === r.collection)
            .completeThrough,
          runtime: { buildId: c.buildId }
        }
      }))
    }
  };
}

test("public synthetic baseline retains all six shapes and frozen normalized query/digest producer", () => {
  assert.notEqual(sha(syntheticBytes), c.baselineSha256);
  assert.equal(
    sha(
      readFileSync(new URL("./ownership-parity-peer-v2.mjs", import.meta.url))
    ),
    c.originalToolSha256
  );
  assert.equal(ownershipSources.length, 6);
  assert(ownershipSources.some((r) => r.collection === "bnb"));
  const sql = datasetSql(
    ownershipSources.find((r) => r.collection === "base"),
    c.schema,
    "token"
  );
  assert(!/NFB|metadata|origin|family/.test(sql));
});
test("supplied BNB point is below immutable128816538 and preflight reports exact deficit", async () => {
  const f = frame();
  f.checkpoints.find((r) => r.chainId === 56).checkpoint = cp(56, 124776371);
  const db = fixture(f);
  const out = await inspectCombinedCoverage(db, baseline);
  assert.equal(out.eligible, false);
  assert.equal(
    out.collections.find((r) => r.collection === "bnb").deficit,
    "4040167"
  );
  assert.equal(out.sourceReadinessQualified, false);
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  assert(!db.calls.some((r) => r.sql.startsWith("DECLARE")));
});
test("partial checkpoints are reported incomplete by the public coverage adapter", async () => {
  for (const chain of [1, 56, 137, 8453]) {
    const f = frame();
    const minimum = baseline.collections
      .filter((r) => r.chainId === chain)
      .reduce(
        (n, r) =>
          BigInt(r.boundary.number) > n ? BigInt(r.boundary.number) : n,
        0n
      );
    f.checkpoints.find((r) => r.chainId === chain).checkpoint = cp(
      chain,
      minimum,
      false
    );
    const db = fixture(f);
    const out = await inspectCombinedCoverage(db, baseline);
    assert.equal(out.eligible, false);
    assert(!db.calls.some((r) => r.sql.startsWith("DECLARE")));
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  }
});
test("unchanged query tool exercises all six collections with public synthetic input", async () => {
  const db = fixture();
  const out = await captureOwnershipParity(db, {
    source: "unified",
    schema: c.schema,
    releaseId: c.releaseId,
    baseline
  });
  assert.equal(out.collections.length, 6);
  assert.equal(out.exactDataParity, true);
  assert.equal(out.allBoundaryHashesMatch, false);
  assert.equal(db.calls.at(-1).sql, "COMMIT");
  assert(db.calls.some((r) => r.sql.includes("statement_timeout='90s'")));
  assert(db.calls.some((r) => r.sql.includes("FETCH FORWARD 2048")));
});
test("wrong database peer/build/physical/read/source markers reject before scanning", async () => {
  for (const edit of [
    (f) => (f.database = "1"),
    (f) => (f.role = "root"),
    (f) => (f.sessionRole = "root"),
    (f) => (f.unix = false),
    (f) => (f.schemaOid = "1"),
    (f) => (f.readSchemaOid = "1"),
    (f) => (f.runtime.build_id = "old"),
    (f) => (f.marker.identity = hash(1)),
    (f) => (f.release.id = hash(1)),
    (f) => (f.release.manifestHash = hash(1))
  ]) {
    const f = frame();
    edit(f);
    const db = fixture(f);
    await assert.rejects(inspectCombinedCoverage(db, baseline));
    assert(!db.calls.some((r) => r.sql.startsWith("DECLARE")));
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  }
});
test("synthetic or altered baseline cannot mint a strict production-format receipt", async () => {
  for (const bytes of [
    syntheticBytes,
    Buffer.concat([syntheticBytes, Buffer.from("\n")])
  ]) {
    const db = fixture();
    await assert.rejects(
      captureCombinedParity(db, bytes),
      /exact_unchanged_six_collection_baseline_required/
    );
    assert.equal(db.calls.length, 0);
    assert.throws(
      () => validateParityReceipt(exactReceipt(), bytes),
      /exact_unchanged_six_collection_baseline_required/
    );
  }
});
test(
  "PRIVATE opt-in: strict capture refuses incomplete boundaries before all dataset scans",
  privateOnly,
  async () => {
    for (const chain of [1, 56, 137, 8453]) {
      const f = frame();
      const minimum = privateBaseline.collections
        .filter((r) => r.chainId === chain)
        .reduce(
          (n, r) =>
            BigInt(r.boundary.number) > n ? BigInt(r.boundary.number) : n,
          0n
        );
      f.checkpoints.find((r) => r.chainId === chain).checkpoint = cp(
        chain,
        minimum,
        false
      );
      const db = fixture(f, privateBaseline);
      await assert.rejects(
        captureCombinedParity(db, privateBytes),
        /all_six_fixed_boundaries/
      );
      assert(!db.calls.some((r) => r.sql.startsWith("DECLARE")));
      assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    }
  }
);
test(
  "PRIVATE opt-in: all original query sequences/limits unchanged after fixed preflight",
  privateOnly,
  async () => {
    const original = fixture(frame(), privateBaseline),
      next = fixture(frame(), privateBaseline);
    const a = await captureOwnershipParity(original, {
      source: "unified",
      schema: c.schema,
      releaseId: c.releaseId,
      baseline: privateBaseline
    });
    const b = await captureCombinedParity(next, privateBytes);
    assert.equal(b.parity.collections.length, 6);
    assert.deepEqual(b.parity.collections, a.collections);
    assert.deepEqual(
      next.calls.filter((r) => r.sql !== combinedFrameSql),
      original.calls
    );
    assert.equal(b.sourceReadinessQualified, false);
    assert.equal(b.canonicalWitnessQualified, false);
    assert.equal(
      validateParityReceipt(b, privateBytes, { requireEqual: false })
        .exactDataParity,
      false
    );
    assert.throws(
      () => validateParityReceipt(b, privateBytes),
      /all_six_exact/
    );
  }
);
test(
  "PRIVATE opt-in: wall deadline and tampered protected baseline remain bounded",
  privateOnly,
  async () => {
    const db = fixture(frame(), privateBaseline);
    await assert.rejects(
      captureCombinedParity(
        db,
        Buffer.concat([privateBytes, Buffer.from("\n")])
      )
    );
    assert.equal(db.calls.length, 0);
    let time = 0;
    await assert.rejects(
      captureCombinedParity(db, privateBytes, {
        now: () => (time += 1000),
        maximumMilliseconds: 1
      }),
      /wall_deadline/
    );
  }
);
test(
  "PRIVATE opt-in: strict exact receipt requires all datasets/buckets and missing legacy hashes",
  privateOnly,
  () => {
    const receipt = exactReceipt(privateBaseline);
    const proof = validateParityReceipt(receipt, privateBytes);
    assert.equal(proof.exactDataParity, true);
    assert.equal(proof.sourceReadinessQualified, false);
    assert.equal(proof.canonicalWitnessQualified, false);
    for (const edit of [
      (r) => r.parity.collections.pop(),
      (r) => r.parity.collections[3].datasets.token.rows++,
      (r) =>
        (r.parity.collections[0].datasets.token.buckets[0].sha256 = "0".repeat(
          64
        )),
      (r) => (r.sourceRelease = hash(2)),
      (r) => (r.parity.release.build_id = "bf4939b3ff"),
      (r) => (r.parity.allBoundaryHashesMatch = true),
      (r) => (r.sourceReadinessQualified = true)
    ]) {
      const bad = structuredClone(receipt);
      edit(bad);
      assert.throws(() => validateParityReceipt(bad, privateBytes));
    }
  }
);

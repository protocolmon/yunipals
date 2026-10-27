import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  pins,
  fixedPoints,
  canonicalWitnesses,
  sha256,
  qualifyAcceptance,
  validateWitnessReceipt
} from "./fixed-boundary-witness-v3.mjs";
import {
  pins as previousPins,
  fixedPoints as previousPoints
} from "../marketplace-acceptance/fixed-boundary-witness-v2.mjs";

const profileBytes = readFileSync(
  new URL("./ypal-combined-rpc-profile-v1.json", import.meta.url)
);
const profile = JSON.parse(profileBytes);
const observedAt = Date.parse("2026-10-22T06:00:00.000Z");

test("fixed five points and every canonical gate are byte-identical to accepted v2", async () => {
  const previous = await import(
    "../marketplace-acceptance/fixed-boundary-witness-v2.mjs"
  );
  const next = await import("./fixed-boundary-witness-v3.mjs");
  for (const name of [
    "canonicalWitnesses",
    "qualifyAcceptance",
    "blockHeader",
    "boundaryPoints",
    "validateCacheLayout",
    "validateInstalledRuntime",
    "captureWitness",
    "dropToPostgresPeer",
    "failureDiagnostics"
  ])
    assert.equal(next[name].toString(), previous[name].toString(), name);
  assert.deepEqual(fixedPoints, previousPoints);
  assert.equal(sha256(profileBytes), pins.profile);
  assert.equal(pins.baseline, previousPins.baseline);
  assert.equal(
    pins.release,
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
  );
  assert.equal(
    pins.readIdentity,
    "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67"
  );
});

function fixture(selectedProfile = pins.profileId) {
  const observations = [];
  const chains = new Map([
    [19221, 1],
    [19222, 8453],
    [19223, 137],
    [19224, 56]
  ]);
  const head = (chain) =>
    BigInt(fixedPoints.filter((p) => p.chainId === chain).at(-1).number) + 20n;
  const header = (chain, number) => ({
    number: `0x${number.toString(16)}`,
    hash: `0x${sha256(`${chain}:${number}`)}`,
    parentHash: `0x${sha256(`${chain}:${number - 1n}`)}`,
    timestamp: `0x${(BigInt(observedAt / 1000) - (number >= head(chain) - 1n ? 1n : 1000n)).toString(16)}`
  });
  return {
    observations,
    fetch: async (url, options) => {
      const target = new URL(url),
        chain = chains.get(Number(target.port));
      assert.equal(target.hostname, "127.0.0.1");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers["x-yunipals-unified-rpc-profile"],
        pins.profileId
      );
      assert.equal(
        options.headers["x-yunipals-rpc-workload"],
        "unified_evidence"
      );
      assert.equal(
        Object.keys(options.headers).some((key) =>
          /permit|authorization|key/i.test(key)
        ),
        false
      );
      observations.push({ chain, path: target.pathname });
      if (target.pathname === "/unified/preflight")
        return Response.json({
          profileId: selectedProfile,
          manifestHash: pins.manifest,
          chainId: chain,
          scope: profile.scope,
          coordinatorId: profile.coordinatorId,
          workload: "unified_evidence",
          paid: "explicit_bounded_permit_only",
          replay: { mode: "free_only" }
        });
      assert.equal(target.pathname, "/unified");
      const calls = JSON.parse(options.body);
      assert.ok(calls.length <= profile.limits.batchCalls);
      return Response.json(
        calls
          .map((call) => {
            if (call.method === "eth_chainId")
              return {
                jsonrpc: "2.0",
                id: call.id,
                result: `0x${chain.toString(16)}`
              };
            assert.equal(call.method, "eth_getBlockByNumber");
            assert.equal(call.params[1], false);
            const number =
              call.params[0] === "latest"
                ? head(chain)
                : call.params[0] === "finalized"
                  ? head(chain) - 1n
                  : BigInt(call.params[0]);
            return {
              jsonrpc: "2.0",
              id: call.id,
              result: header(chain, number)
            };
          })
          .reverse()
      );
    }
  };
}

test("actual canonical capture uses the normal profile without permits and rejects the old selector", async () => {
  const rpc = fixture();
  const result = await canonicalWitnesses(profile, fixedPoints, {
    fetch: rpc.fetch,
    now: () => observedAt
  });
  assert.equal(result.rpcCalls, 21);
  assert.equal(result.httpCalls, 12);
  assert.equal(result.permitHeaders, 0);
  assert.equal(result.retries, 0);
  assert.equal(result.paidDispatchPossibleWithoutPermit, false);
  assert.equal(result.chains.length, 4);
  assert.equal(result.chains.flatMap((chain) => chain.boundaries).length, 5);
  assert.ok(result.chains.every((chain) => chain.profileId === pins.profileId));
  const stale = fixture(previousPins.profileId);
  await assert.rejects(
    canonicalWitnesses(profile, fixedPoints, {
      fetch: stale.fetch,
      now: () => observedAt
    }),
    /Exact permit-free RPC preflight/
  );
  assert.equal(stale.observations.length, 4);
  assert.ok(
    stale.observations.every((row) => row.path === "/unified/preflight")
  );
});

const privateBaselineBytes = process.env.YPAL_PARITY_PRIVATE_BASELINE
  ? readFileSync(process.env.YPAL_PARITY_PRIVATE_BASELINE)
  : null;
if (privateBaselineBytes)
  assert.equal(sha256(privateBaselineBytes), pins.baseline);

test("strict witness receipt refuses synthetic baseline bytes", () => {
  assert.throws(() =>
    validateWitnessReceipt({}, Buffer.from("{}"), Buffer.from("{}"))
  );
});

test(
  "PRIVATE opt-in: strict all-six receipt/canonical composition does not claim current readiness",
  {
    skip: privateBaselineBytes
      ? false
      : "requires explicit YPAL_PARITY_PRIVATE_BASELINE with exact protected SHA69f9"
  },
  async () => {
    const { combinedParity: c } = await import(
      "./ownership-parity-peer-v4.mjs"
    );
    const baselineBytes = privateBaselineBytes;
    const baseline = JSON.parse(baselineBytes);
    const receipt = {
      format: c.format,
      completed: true,
      producerSha256: sha256(
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
      coverage: {
        eligible: true,
        sourceReadinessQualified: false,
        canonicalWitnessQualified: false,
        collections: baseline.collections.map((r) => ({
          collection: r.collection,
          chainId: r.chainId,
          boundary: r.boundary.number,
          completeThrough: r.boundary.number,
          deficit: "0"
        }))
      },
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
        collections: baseline.collections.map((r) => ({
          ...structuredClone(r),
          physicalSchema: c.schema,
          boundary: {
            ...r.boundary,
            availableThrough: r.boundary.number,
            runtime: { buildId: c.buildId }
          }
        }))
      }
    };
    const candidateBytes = Buffer.from(JSON.stringify(receipt));
    const rpc = fixture();
    const canonical = await canonicalWitnesses(profile, fixedPoints, {
      fetch: rpc.fetch,
      now: () => observedAt
    });
    // Two historical manual hashes were saved; the fake canonical provider must
    // agree with those exact public hashes, rather than overwrite their evidence.
    for (const chain of canonical.chains)
      for (const point of chain.boundaries) {
        const old = baseline.collections.find(
          (r) =>
            r.chainId === point.chainId &&
            r.boundary.number === point.number &&
            r.boundary.hash
        );
        if (old) point.hash = old.boundary.hash;
      }
    const database = {
      release: {
        id: pins.release,
        schema: pins.schema,
        buildId: pins.build,
        manifestHash: pins.manifest
      },
      readContext: { schema: pins.readSchema, identity: pins.readIdentity },
      witnesses: canonical.chains.flatMap((chain) =>
        chain.boundaries.map((p) => ({
          ...p,
          frameworkCacheHeader: {
            number: p.number,
            hash: p.hash,
            parentHash: p.parentHash,
            timestamp: p.timestamp
          },
          callbackHeader: null
        }))
      ),
      readiness: baseline.collections.map((r) => ({
        collection: r.collection,
        ready: true,
        errorCode: null,
        availableThrough: r.boundary.number,
        completeThrough: r.boundary.number
      })),
      activeSelector: []
    };
    const witness = {
      format: "yunipals-ypal-fixed-boundary-witness-v3",
      completed: true,
      binding: {
        helperSha256: sha256(
          readFileSync(
            new URL("./fixed-boundary-witness-v3.mjs", import.meta.url)
          )
        ),
        pins,
        points: fixedPoints,
        plan: { candidateReportSha256: sha256(candidateBytes) }
      },
      database,
      canonical,
      acceptance: qualifyAcceptance(
        baseline,
        receipt.parity,
        database,
        canonical
      )
    };
    assert.equal(
      validateWitnessReceipt(witness, candidateBytes, baselineBytes)
        .currentReadinessQualified,
      false
    );
    for (const edit of [
      (v) => v.canonical.rpcCalls--,
      (v) => (v.database.readContext.identity = "0x" + "0".repeat(64)),
      (v) => (v.acceptance.qualified = false),
      (v) => (v.binding.plan.candidateReportSha256 = "0".repeat(64))
    ]) {
      const bad = structuredClone(witness);
      edit(bad);
      assert.throws(() =>
        validateWitnessReceipt(bad, candidateBytes, baselineBytes)
      );
    }
  }
);

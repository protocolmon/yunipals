import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  encodeEventTopics,
  encodeAbiParameters
} from "../../apps/yunipals-indexer/node_modules/viem/_esm/index.js";
import { boosterPacksAbi } from "../../packages/yunipals-market-core/src/boosterAbi.ts";
import { boosterIdentity } from "../../packages/yunipals-market-core/src/boosters.ts";
import { manifestDigest } from "../../packages/yunipals-indexer-server/src/identity.ts";
import {
  ypalActionIdentity,
  ypalActionSourceAbiHash,
  openingFixtureFromSnapshot,
  selectOpeningFixture,
  positiveYpalAction
} from "./consumer-ypal-action-v1.mjs";

const checks = [];
const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const engine = "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e";
const monsters = "0x7d62628806e7eef76a354c7c48787879e3440b16";
const tx = "0x62e4c5d0792f1dc955b28601debabaa9240d9aeb596479a9e1f297adcb03e8a7";
const payer = "0x" + "a".repeat(40);
function snapshot() {
  const args = {
    requestId: "11",
    originalId: "1",
    packTypeId: "1",
    payer,
    quantity: 1,
    opening: true,
    paid: "1000000000000000000",
    ruleHash: hash(23),
    callbackGas: 500000
  };
  const topics = encodeEventTopics({
    abi: boosterPacksAbi,
    eventName: "RequestCreated",
    args: { requestId: 11n, originalId: 1n, packTypeId: 1n }
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint32" },
      { type: "bool" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint32" }
    ],
    [payer, 1, true, 10n ** 18n, hash(23), 500000]
  );
  return {
    marker: { ...ypalActionIdentity },
    eventCount: 1,
    pointBytes: 1000,
    events: [
      {
        id: `8453:${engine}:${tx}:17`,
        source_id: "boosters:boosterengine",
        chain_id: 8453,
        address: engine,
        abi_hash: ypalActionSourceAbiHash,
        name: "RequestCreated",
        block_number: "53000660",
        block_hash: hash(99),
        transaction_hash: tx,
        transaction_index: 5,
        log_index: 17,
        args: JSON.stringify(args),
        topics: JSON.stringify(topics),
        data
      }
    ],
    witnesses: [{ blockNumber: "53000660", blockHash: hash(99) }],
    requests: [
      {
        id: boosterIdentity(engine, "11"),
        engine,
        requestId: "11",
        originalKey: boosterIdentity(monsters, "1"),
        payer,
        quantity: 1,
        opening: true,
        paid: args.paid,
        ruleHash: args.ruleHash,
        callbackGas: args.callbackGas,
        transactionHash: tx
      }
    ]
  };
}
function check(name, fn) {
  fn();
  checks.push(name);
}
const selected = {
  version: 1,
  identity: ypalActionIdentity,
  supportedActions: ["bnb-cancel", "bnb-validate", "booster-request-created"]
};
function response(request) {
  return {
    version: 1,
    expectationHash: manifestDigest(request),
    state: "indexed",
    reason: "action_indexed",
    transaction: {
      chainId: 8453,
      hash: tx,
      blockNumber: request.blockNumber,
      blockHash: request.blockHash
    },
    identity: { ...ypalActionIdentity },
    coverage: {
      sourceId: "boosters:boosterengine",
      policy: "latest",
      completeThroughBlock: "53000665",
      availableThroughBlock: "53000665",
      anchor: { number: "53000665", hash: hash(101) }
    },
    proof: {
      kind: "canonical_event",
      receiptRequirement: "none",
      receiptPayloadHash: null,
      events: [
        { id: `8453:${engine}:${tx}:17`, name: "RequestCreated", logIndex: 17 }
      ]
    },
    application: { state: "applied", component: "booster_request" }
  };
}
const request = openingFixtureFromSnapshot(snapshot()).request;
check("compiled_abi_and_projection_match_selects_actual_shape", () =>
  assert.equal(request.action.requestId, "11")
);
check("absence_never_synthesizes_an_opening", () => {
  const v = snapshot();
  Object.assign(v, {
    eventCount: 0,
    pointBytes: 0,
    events: [],
    requests: [],
    witnesses: []
  });
  assert.equal(openingFixtureFromSnapshot(v).actualFixtureAvailable, false);
});
for (const [name, mutate] of [
  ["foreign_release", (v) => (v.marker.releaseId = hash(1))],
  ["foreign_build", (v) => (v.marker.buildId = "old-build")],
  [
    "raw_decode_differs_from_args",
    (v) => (v.events[0].data = v.events[0].data.slice(0, -2) + "01")
  ],
  ["projection_differs_from_log", (v) => (v.requests[0].paid = "0")],
  [
    "unqualified_request_key_refuses",
    (v) => (v.requests[0].id = `${engine}:11`)
  ],
  [
    "unqualified_original_key_refuses",
    (v) => (v.requests[0].originalKey = `${monsters}:1`)
  ],
  ["canonical_hash_conflict", (v) => (v.witnesses[0].blockHash = hash(100))],
  [
    "duplicate_event",
    (v) => {
      v.events.push(v.events[0]);
      v.eventCount++;
    }
  ],
  ["oversized_point", (v) => (v.pointBytes = 524289)],
  ["foreign_proto_contract", (v) => (v.events[0].address = payer)],
  [
    "new_abi_does_not_relabel_retained_journal",
    (v) => (v.events[0].abi_hash = manifestDigest(boosterPacksAbi))
  ],
  [
    "malformed_topics",
    (v) => (v.events[0].topics = '[null,"' + hash(8) + '"]')
  ],
  ["predeployment_block", (v) => (v.events[0].block_number = "1")]
])
  check(name, () => {
    const v = snapshot();
    mutate(v);
    assert.throws(() => openingFixtureFromSnapshot(v));
  });
check("positive_api_action_requires_applied_projection", () => {
  assert.equal(positiveYpalAction(response(request), request, selected), true);
  const v = response(request);
  v.application.state = "not_evaluated";
  assert.equal(positiveYpalAction(v, request, selected), false);
});
check("canonical_digest_has_no_newline_or_wrong_release", () => {
  const v = response(request);
  v.expectationHash = hash(300);
  assert.equal(positiveYpalAction(v, request, selected), false);
  v.expectationHash = manifestDigest(request);
  v.identity.releaseId = hash(2);
  assert.equal(positiveYpalAction(v, request, selected), false);
});
check("marketplace_and_pending_evidence_cannot_pass", () => {
  const v = response(request);
  v.proof.kind = "canonical_event_and_full_receipt";
  assert.equal(positiveYpalAction(v, request, selected), false);
  const pending = response(request);
  pending.state = "awaiting_indexing";
  assert.equal(positiveYpalAction(pending, request, selected), false);
});
check("insufficient_coverage_or_wrong_proof_identity_refuses", () => {
  const v = response(request);
  v.coverage.availableThroughBlock = "52995174";
  assert.equal(positiveYpalAction(v, request, selected), false);
  const wrong = response(request);
  wrong.proof.events[0].id = "foreign";
  assert.equal(positiveYpalAction(wrong, request, selected), false);
});
check("request_identity_must_match_actual_selected_identity", () => {
  for (const key of ["releaseId", "readIdentity"]) {
    const changed = { ...request, [key]: hash(400) };
    assert.equal(
      positiveYpalAction(response(changed), changed, selected),
      false
    );
  }
});
check("anchor_is_exact_available_boundary", () => {
  const v = response(request);
  v.coverage.anchor.number = "0";
  assert.equal(positiveYpalAction(v, request, selected), false);
});

// Dedicated database in the already running disposable PG16 instance only.
const info = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "inspect",
      "yunipals-unified-indexer-test-20261020"
    ],
    { encoding: "utf8", timeout: 15000 }
  )
)[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const { Client } = require("pg");
const connection = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const database = "ypal_action_" + randomBytes(5).toString("hex");
const admin = new Client({ connectionString: connection("postgres") });
let db,
  created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  db = new Client({ connectionString: connection(database) });
  await db.connect();
  await db.query(`CREATE SCHEMA unified_ypal_20261023_v1; CREATE SCHEMA yunipals_ownership_4e77f52b_v4;
    CREATE TABLE unified_ypal_20261023_v1._ponder_meta(key text,value jsonb);
    CREATE TABLE yunipals_ownership_4e77f52b_v4._unified_read_release(singleton bool,release_id text,identity text,manifest_hash text);
    CREATE TABLE unified_ypal_20261023_v1.canonical_event(id text,source_id text,chain_id int,address text,abi_hash text,name text,
      block_number bigint,block_hash text,transaction_hash text,transaction_index int,log_index int,args text,topics text,data text);
    CREATE TABLE unified_ypal_20261023_v1.chain_block(chain_id int,block_number bigint,block_hash text);
    CREATE TABLE unified_ypal_20261023_v1.booster_request(id text PRIMARY KEY,engine text,request_id text,original_key text,payer text,quantity int,
      opening bool,paid text,rule_hash text,callback_gas int,transaction_hash text)`);
  await db.query(
    "INSERT INTO unified_ypal_20261023_v1._ponder_meta VALUES('app',$1)",
    [{ build_id: ypalActionIdentity.buildId }]
  );
  await db.query(
    "INSERT INTO yunipals_ownership_4e77f52b_v4._unified_read_release VALUES(true,$1,$2,$3)",
    [
      ypalActionIdentity.releaseId,
      ypalActionIdentity.readIdentity,
      ypalActionIdentity.manifestHash
    ]
  );
  assert.equal((await selectOpeningFixture(db)).actualFixtureAvailable, false);
  checks.push("actual_postgres_empty_point_is_unavailable");
  const fixture = snapshot(),
    r = fixture.events[0],
    p = fixture.requests[0];
  await db.query(
    "INSERT INTO unified_ypal_20261023_v1.canonical_event VALUES(" +
      Array.from({ length: 14 }, (_v, i) => "$" + (i + 1)).join(",") +
      ")",
    Object.values(r)
  );
  await db.query(
    "INSERT INTO unified_ypal_20261023_v1.chain_block VALUES(8453,$1,$2)",
    [r.block_number, r.block_hash]
  );
  await db.query(
    "INSERT INTO unified_ypal_20261023_v1.booster_request VALUES(" +
      Array.from({ length: 11 }, (_v, i) => "$" + (i + 1)).join(",") +
      ")",
    Object.values(p)
  );
  assert.deepEqual((await selectOpeningFixture(db)).request, request);
  assert.equal(
    (await db.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only,
    "off"
  );
  checks.push(
    "actual_postgres_fixed_sql_decodes_compiled_event_and_rolls_back"
  );
  await db.query(
    "UPDATE unified_ypal_20261023_v1.booster_request SET quantity=2"
  );
  await assert.rejects(
    selectOpeningFixture(db),
    /actual_ypal_projection_required/
  );
  assert.equal(
    (await db.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only,
    "off"
  );
  checks.push("actual_postgres_mismatch_refuses_and_clears_transaction");
} finally {
  if (db) await db.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}
console.log(
  JSON.stringify({
    passed: true,
    checks,
    syntheticLocalDatabase: true,
    productionCalls: 0,
    providerCalls: 0
  })
);

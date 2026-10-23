import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { officialProgram } from "./ypal-rpc-official-v1.mjs";
import {
  validateUnifiedRpcProfile,
  unifiedRpcProfileId,
  unifiedRpcManifestId,
  validateUnifiedRpcCalls
} from "../../packages/yunipals-indexer-server/src/rpc-policy.ts";
const root = resolve(import.meta.dirname, "../..");
const retainedRoot = process.env.YPAL_RPC_TEST_RETAINED_ROOT ?? root;
const source = readFileSync(
  root + "/apps/yunipals-market-api/scripts/review-unified-rpc-policy.ts"
);
const input = JSON.parse(
  readFileSync(root + "/ops/booster-launch/ypal-rpc-approval-v1.json")
);
const p = validateUnifiedRpcProfile(input.profile);
test("official identity and exact three-contract source scope", () => {
  assert.equal(
    unifiedRpcProfileId(p),
    "0x25308afec8bf9d4992afb5dbf52675d958ee1c619533e7917ae3fe08dbd29c86"
  );
  assert.equal(
    unifiedRpcManifestId(p),
    "0x83262c45a53f94ed561c6116fc9efeccf69bd55839e7296f7f5276bc7c89e9ac"
  );
  assert.equal(p.manifest.sources.length, 3);
  assert.deepEqual(input.permits, []);
});
test("all actual sources accept deployment-range logs and reject a predeployment range", () => {
  for (const s of p.manifest.sources) {
    const start = "0x" + BigInt(s.startBlock).toString(16);
    validateUnifiedRpcCalls(p, 8453, [
      {
        method: "eth_getLogs",
        params: [{ address: s.address, fromBlock: start, toBlock: start }]
      }
    ]);
    assert.throws(() =>
      validateUnifiedRpcCalls(p, 8453, [
        {
          method: "eth_getLogs",
          params: [{ address: s.address, fromBlock: "0x1", toBlock: start }]
        }
      ])
    );
  }
});
test("old addresses, other chains and mutable/contract calls remain refused", () => {
  for (const call of [
    {
      method: "eth_getLogs",
      params: [
        {
          address: "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609",
          fromBlock: "0x328a000",
          toBlock: "0x328a000"
        }
      ]
    },
    {
      method: "eth_call",
      params: [{ to: p.manifest.sources[0].address, data: "0x" }, "latest"]
    },
    {
      method: "eth_getStorageAt",
      params: [p.manifest.sources[0].address, "0x0", "latest"]
    },
    { method: "eth_sendRawTransaction", params: ["0x"] }
  ])
    assert.throws(() => validateUnifiedRpcCalls(p, 8453, [call]));
  assert.throws(() =>
    validateUnifiedRpcCalls(p, 56, [{ method: "eth_blockNumber", params: [] }])
  );
});
test("rehearsal changes exactly the official transaction terminal and event", () => {
  const commit = officialProgram(source, "commit", root),
    review = officialProgram(source, "review", root),
    rehearse = officialProgram(source, "rehearse", root);
  assert.equal(review, commit);
  assert.equal(
    rehearse,
    commit
      .replace(
        'await client.query("COMMIT");',
        'await client.query("ROLLBACK");'
      )
      .replace(
        'event: "unified_rpc_policy_approved"',
        'event: "unified_rpc_policy_rehearsed"'
      )
  );
  assert.equal(
    (commit.match(/INSERT INTO yunipals_market.unified_rpc_profile/g) || [])
      .length,
    1
  );
  assert.match(commit, /ON CONFLICT DO NOTHING/);
});
test("changed CLI bytes and unknown phase refuse before evaluation", () => {
  assert.throws(() =>
    officialProgram(Buffer.concat([source, Buffer.from("\n")]), "commit", root)
  );
  assert.throws(() => officialProgram(source, "unknown", root));
});
test(
  "actual PostgreSQL official review, rollback and insert-only commit",
  { skip: !process.env.YPAL_RPC_TEST_DATABASE_URL },
  async () => {
    const pg = (
      await import(
        root + "/apps/yunipals-market-api/node_modules/pg/lib/index.js"
      )
    ).default;
    const admin = new pg.Client({
      connectionString: process.env.YPAL_RPC_TEST_DATABASE_URL
    });
    await admin.connect();
    const name = "ypal_rpc_policy_test_" + process.pid;
    const dir = mkdtempSync(tmpdir() + "/ypal-rpc-policy-");
    let client;
    try {
      await admin.query("CREATE DATABASE " + name);
      const url = new URL(process.env.YPAL_RPC_TEST_DATABASE_URL);
      url.pathname = "/" + name;
      client = new pg.Client({ connectionString: url.href });
      await client.connect();
      await client.query(`CREATE SCHEMA yunipals_market;
 CREATE TABLE yunipals_market.opensea_request_budget(scope text PRIMARY KEY,coordinator_id uuid,enabled boolean);
 CREATE TABLE yunipals_market.rpc_compute_budget(scope text PRIMARY KEY,enabled boolean,daily_cu bigint,foreground_reserve_cu bigint);
 CREATE TABLE yunipals_market.rpc_compute_allocation(scope text,workload text,priority text,daily_cu bigint);
 CREATE TABLE yunipals_market.unified_rpc_profile(profile_id text PRIMARY KEY,scope text,manifest_hash text,policy jsonb,enabled boolean,expires_at timestamptz);
 CREATE TABLE yunipals_market.unified_rpc_replay_permit(permit_id text PRIMARY KEY,profile_id text,chain_id int,from_block bigint,through_block bigint,maximum_cu bigint,enabled boolean,expires_at timestamptz);
 INSERT INTO yunipals_market.opensea_request_budget VALUES('yunipals-opensea','faf1bb8c-4306-4c43-b55e-6ac5fa038567',true);
 INSERT INTO yunipals_market.rpc_compute_budget VALUES('yunipals-opensea',true,1000000,200000);
 INSERT INTO yunipals_market.rpc_compute_allocation VALUES('yunipals-opensea','unified_source','background',25000),('yunipals-opensea','unified_evidence','background',5000);`);
      const path = dir + "/approval.json";
      writeFileSync(path, JSON.stringify(input));
      const execute = (phase, hash) => {
        const args = ["--file", path, ...(hash ? ["--apply", hash] : [])];
        const code =
          "process.argv=" +
          JSON.stringify([process.execPath, "official", ...args]) +
          ";\n" +
          officialProgram(source, phase, retainedRoot);
        const executionFile = dir + "/execute-" + phase + ".mjs";
        writeFileSync(executionFile, code);
        const r = spawnSync(
          process.execPath,
          [
            "--import",
            root + "/apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs",
            executionFile
          ],
          {
            env: {
              ...process.env,
              NODE_NO_WARNINGS: "1",
              UNIFIED_RPC_REVIEW_DATABASE_URL: url.href
            },
            encoding: "utf8",
            timeout: 20000
          }
        );
        assert.equal(r.error, undefined);
        return r;
      };
      const review = execute("review");
      assert.equal(review.status, 0, review.stderr);
      const rows = review.stdout.trim().split("\n").map(JSON.parse);
      assert.equal(rows.length, 1);
      const hash = rows[0].reviewHash;
      const rehearsal = execute("rehearse", hash);
      assert.equal(rehearsal.status, 0, rehearsal.stderr);
      assert.match(rehearsal.stdout, /unified_rpc_policy_rehearsed/);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM yunipals_market.unified_rpc_profile"
          )
        ).rows[0].n,
        0
      );
      const commit = execute("commit", hash);
      assert.equal(commit.status, 0, commit.stderr);
      assert.match(commit.stdout, /unified_rpc_policy_approved/);
      assert.deepEqual(
        (
          await client.query(
            "SELECT policy FROM yunipals_market.unified_rpc_profile"
          )
        ).rows.map((x) => x.policy),
        [input.profile]
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM yunipals_market.unified_rpc_replay_permit"
          )
        ).rows[0].n,
        0
      );
      assert.equal(
        (
          await client.query(
            "SELECT daily_cu::text cu FROM yunipals_market.rpc_compute_budget"
          )
        ).rows[0].cu,
        "1000000"
      );
      await client.query(
        "UPDATE yunipals_market.rpc_compute_budget SET daily_cu=1000001"
      );
      const stale = execute("commit", hash);
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /Unified RPC review failed/);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM yunipals_market.unified_rpc_profile"
          )
        ).rows[0].n,
        1
      );
    } finally {
      if (client) await client.end();
      await admin.query("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

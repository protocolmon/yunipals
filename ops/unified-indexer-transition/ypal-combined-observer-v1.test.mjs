import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as runner from "./ypal-combined-observer-v1.mjs";
import * as releases from "../../apps/yunipals-indexer/lib/unified/releases.ts";
import * as observer from "../../apps/yunipals-indexer/lib/unified/observer.ts";
import * as identity from "../../packages/yunipals-indexer-server/src/identity.ts";
import * as policy from "../../packages/yunipals-indexer-server/src/rpc-policy.ts";
import { evidenceRpc } from "../../apps/yunipals-indexer/lib/unified/rpc.ts";
const profile = JSON.parse(
  readFileSync(new URL("./ypal-combined-rpc-profile-v1.json", import.meta.url))
);
assert.equal(
  createHash("sha256")
    .update(
      readFileSync(
        new URL(
          "../../apps/yunipals-indexer/lib/unified/observer.ts",
          import.meta.url
        )
      )
    )
    .digest("hex"),
  runner.SOURCE_PINS["apps/yunipals-indexer/lib/unified/observer.ts"]
);
const checks = [],
  config = { chains: [8453], readAdmissionSha256: "ab".repeat(32) },
  now = 2_000_000,
  indexed = 53_100_000n,
  head = indexed + 20n;
const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const checkpoint = (n) =>
  "0000002000" +
  "8453".padStart(16, "0") +
  n.toString().padStart(16, "0") +
  "9".repeat(33);
const jsonResponse = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
const preflight = {
  profileId: runner.PROFILE_ID,
  manifestHash: runner.MANIFEST,
  chainId: 8453,
  workload: "unified_evidence",
  scope: profile.scope,
  coordinatorId: profile.coordinatorId,
  paid: "explicit_bounded_permit_only",
  replay: { mode: "free_only" }
};
async function check(name, fn) {
  await fn();
  checks.push(name);
}
function fixture(options = {}) {
  const state = {
    app: {
      version: "6",
      build_id: runner.BUILD,
      heartbeat_at: now,
      is_ready: 0,
      is_locked: 1,
      is_dev: 0
    },
    status: null,
    sql: [],
    rpc: [],
    fetches: 0,
    roleOid: runner.ROLE_OID,
    schemaOid: "75963410",
    ...options
  };
  const block = (n) => ({
    number: n,
    hash: hash(n),
    parentHash: hash(n - 1n),
    timestamp: 2000n
  });
  const query = async (text, params = []) => {
    state.sql.push({ text, params });
    if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(text))
      return { rows: [], rowCount: 0 };
    if (text.includes("SELECT current_user"))
      return {
        rows: [
          {
            current_user: runner.ROLE,
            session_user: runner.ROLE,
            role_oid: state.roleOid,
            database_oid: "17584",
            schema_oid: state.schemaOid,
            unix_peer: true
          }
        ],
        rowCount: 1
      };
    if (text.includes("SELECT * FROM yunipals_indexer_control.release"))
      return {
        rows: [
          {
            id: runner.RELEASE,
            physical_schema: runner.SCHEMA,
            build_id: runner.BUILD,
            manifest_hash: runner.MANIFEST,
            manifest: state.foreignManifest ?? profile.manifest
          }
        ],
        rowCount: 1
      };
    if (text.includes("SELECT value AS app"))
      return {
        rows: [
          {
            app: structuredClone(state.app),
            checkpoints: [
              {
                chain_id: "8453",
                chain_name: "base",
                latest_checkpoint: checkpoint(indexed),
                safe_checkpoint: checkpoint(indexed),
                finalized_checkpoint: checkpoint(indexed)
              }
            ],
            witnesses: state.missingWitness
              ? []
              : [
                  {
                    chain_id: 8453,
                    block_number: indexed.toString(),
                    block_hash: hash(indexed),
                    parent_hash: hash(indexed - 1n),
                    timestamp: "2000"
                  }
                ]
          }
        ],
        rowCount: 1
      };
    if (text.includes("SELECT id,chain_id,manifest_hash,definition"))
      return {
        rows: [...profile.manifest.sources]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((v) => ({
            id: v.id,
            chain_id: v.chainId,
            manifest_hash: runner.MANIFEST,
            definition: JSON.stringify(v)
          })),
        rowCount: 12
      };
    if (text.includes("SELECT revision::text"))
      return {
        rows: state.status ? [structuredClone(state.status)] : [],
        rowCount: state.status ? 1 : 0
      };
    if (text.includes("SELECT 1 FROM") && text.includes(".chain_block"))
      return {
        rows: state.lostCanonicalRow ? [] : [{ "?column?": 1 }],
        rowCount: state.lostCanonicalRow ? 0 : 1
      };
    if (
      text
        .trim()
        .startsWith("INSERT INTO yunipals_indexer_control.chain_status")
    ) {
      if (state.revisionRace) return { rows: [], rowCount: 0 };
      if (params.length === 5)
        state.status = {
          revision: "1",
          halted: params[3],
          error_code: params[4],
          finalized_number: null
        };
      else
        state.status = {
          revision: "1",
          halted: false,
          error_code: null,
          head_number: params[3],
          head_hash: params[4],
          head_timestamp: params[5],
          finalized_number: params[6],
          finalized_hash: params[7],
          witness_number: params[8],
          witness_hash: params[9],
          observed_at_ms: String(params[10]),
          provider_id: params[11],
          anchors: JSON.parse(params[12]),
          finality_error_code: params[13]
        };
      return { rows: [], rowCount: 1 };
    }
    if (
      /^\s*(?:INSERT INTO|DELETE FROM) yunipals_indexer_control.chain_anchor/.test(
        text
      )
    )
      return { rows: [], rowCount: 1 };
    throw Error("unhandled_synthetic_official_query");
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const rpc = {
    providerId: "synthetic-canonical-base",
    chainId: async () => {
      state.rpc.push("chainId");
      return 8453;
    },
    block: async (tag) => {
      state.rpc.push(String(tag));
      const n =
        tag === "latest" ? head : tag === "finalized" ? head - 10n : tag;
      const b = block(n);
      if (state.branchMismatch && n === indexed) b.hash = hash(n + 500n);
      if (state.previousFinalizedMismatch && n === head - 30n)
        b.hash = hash(n + 500n);
      if (state.headChanged && typeof tag === "bigint" && n === head)
        b.hash = hash(n + 500n);
      return b;
    },
    receipt: async () => {
      throw Error("receipts_forbidden");
    },
    code: async () => {
      throw Error("contract_reads_forbidden");
    }
  };
  const dependencies = {
    pool,
    releases,
    observer,
    rpcFactory: () => rpc,
    identity: { ...identity, ...policy },
    profile,
    now: () => now,
    fetch: async () => {
      state.fetches++;
      return jsonResponse(preflight);
    }
  };
  return { state, pool, rpc, dependencies };
}
await check(
  "official_pinned_observer_ready0_valid_prefix_updates_control_only",
  async () => {
    const { state, dependencies } = fixture();
    const before = structuredClone(state.app),
      result = await runner.runOnce("observe-once", config, dependencies);
    assert.equal(result.successful, true);
    assert.equal(result.results[0].observed, "observed");
    assert.equal(result.native.frameworkReady, false);
    assert.deepEqual(state.app, before);
    assert.equal(result.canonicalNativeWitnessCreated, false);
    assert.equal(result.sourceReadinessQualified, false);
    assert.equal(state.status.witness_number, indexed.toString());
    assert.ok(result.writeStatements >= 2);
    assert.equal(state.fetches, 1);
    assert.ok(
      state.sql
        .filter((v) => /^\s*(?:INSERT|UPDATE|DELETE)/.test(v.text))
        .every(
          (v) =>
            /^\s*(?:INSERT INTO yunipals_indexer_control\.(?:chain_status|chain_anchor)|DELETE FROM yunipals_indexer_control.chain_anchor)/.test(
              v.text
            ) &&
            v.params[0] === runner.RELEASE &&
            v.params[1] === 8453
        )
    );
  }
);
await check(
  "default_inspect_zero_fetch_zero_sql_writes_and_restores_fetch",
  async () => {
    const { state, dependencies } = fixture();
    const old = globalThis.fetch,
      result = await runner.runOnce("inspect", config, dependencies);
    assert.equal(result.inspected, true);
    assert.equal(result.rpcCalls, 0);
    assert.equal(result.writeStatements, 0);
    assert.equal(state.fetches, 0);
    assert.deepEqual(state.rpc, []);
    assert.equal(globalThis.fetch, old);
    assert.equal(result.native.frameworkReady, false);
  }
);
await check(
  "missing_native_witness_or_stale_locked_runtime_never_calls_provider",
  async () => {
    for (const change of [
      { missingWitness: true },
      {
        app: {
          version: "6",
          build_id: runner.BUILD,
          heartbeat_at: now - 180001,
          is_ready: 0,
          is_locked: 1,
          is_dev: 0
        }
      },
      {
        app: {
          version: "6",
          build_id: runner.BUILD,
          heartbeat_at: now,
          is_ready: 0,
          is_locked: 0,
          is_dev: 0
        }
      }
    ]) {
      const { state, dependencies } = fixture(change),
        result = await runner.runOnce("observe-once", config, dependencies);
      assert.equal(result.successful, false);
      assert.equal(result.results[0].executed, false);
      assert.equal(state.fetches, 0);
      assert.equal(result.writeStatements, 0);
    }
  }
);
await check(
  "foreign_registered_manifest_or_native_oid_refuses_before_provider",
  async () => {
    for (const change of [
      { roleOid: "1" },
      { schemaOid: "1" },
      {
        foreignManifest: {
          ...profile.manifest,
          sources: profile.manifest.sources.slice(1)
        }
      }
    ]) {
      const { state, dependencies } = fixture(change),
        result = await runner.runOnce("observe-once", config, dependencies);
      assert.equal(result.completed, false);
      assert.equal(state.fetches, 0);
      assert.equal(result.writeStatements, 0);
    }
  }
);
await check(
  "official_branch_mismatch_records_error_never_anchors",
  async () => {
    const { state, dependencies } = fixture({ branchMismatch: true }),
      result = await runner.runOnce("observe-once", config, dependencies);
    assert.equal(result.successful, false);
    assert.equal(result.results[0].observed, "waiting");
    assert.equal(state.status.error_code, "indexer_branch_mismatch");
    assert.equal(
      state.sql.filter((v) =>
        v.text
          .trim()
          .startsWith("INSERT INTO yunipals_indexer_control.chain_anchor")
      ).length,
      0
    );
  }
);
await check(
  "official_prior_finalized_reorg_halts_and_preserves_native",
  async () => {
    const { state, dependencies } = fixture({
        previousFinalizedMismatch: true,
        status: {
          revision: "2",
          halted: false,
          head_number: (head - 1n).toString(),
          finalized_number: (head - 30n).toString(),
          finalized_hash: hash(head - 30n)
        }
      }),
      result = await runner.runOnce("observe-once", config, dependencies);
    assert.equal(result.results[0].observed, "halted");
    assert.equal(state.status.error_code, "finalized_history_changed");
    assert.equal(state.status.halted, true);
    assert.equal(state.app.is_ready, 0);
  }
);
await check(
  "official_revision_race_or_lost_canonical_row_is_superseded",
  async () => {
    for (const change of [{ revisionRace: true }, { lostCanonicalRow: true }]) {
      const { state, dependencies } = fixture(change),
        result = await runner.runOnce("observe-once", config, dependencies);
      assert.equal(result.results[0].observed, "superseded");
      assert.equal(result.successful, false);
      assert.equal(
        state.sql.filter((v) =>
          v.text
            .trim()
            .startsWith("INSERT INTO yunipals_indexer_control.chain_anchor")
        ).length,
        0
      );
    }
  }
);
await check(
  "official_final_head_recheck_detects_changed_observation",
  async () => {
    const { state, dependencies } = fixture({ headChanged: true }),
      result = await runner.runOnce("observe-once", config, dependencies);
    assert.equal(result.results[0].observed, "waiting");
    assert.equal(state.status.error_code, "observation_changed");
  }
);
await check("wrong_free_preflight_fails_before_rpc_or_sql_write", async () => {
  const { state, dependencies } = fixture();
  dependencies.fetch = async () =>
    jsonResponse({ ...preflight, replay: { mode: "paid_permit" } });
  const result = await runner.runOnce("observe-once", config, dependencies);
  assert.equal(result.completed, false);
  assert.equal(result.writeStatements, 0);
  assert.deepEqual(state.rpc, []);
});
await check(
  "sql_wrapper_refuses_receipts_native_mutation_foreign_scope_and_inspect_write",
  async () => {
    const f = fixture();
    let dispatched = 0;
    const pool = {
      query: async () => {
        dispatched++;
        return { rows: [] };
      },
      connect: async () => ({
        query: async () => {
          dispatched++;
          return { rows: [] };
        },
        release() {}
      })
    };
    const guarded = runner.guardedPool(pool, "observe-once", config);
    for (const [sql, p] of [
      ["SELECT * FROM yunipals_indexer_control.receipt_job", []],
      [`SELECT * FROM ${runner.SCHEMA}.transaction_candidate`, []],
      [`UPDATE ${runner.SCHEMA}._ponder_meta SET value='x'`, []],
      [
        "INSERT INTO yunipals_indexer_control.chain_status VALUES($1,$2)",
        ["foreign", 8453]
      ],
      [
        "INSERT INTO yunipals_indexer_control.chain_status VALUES($1,$2)",
        [runner.RELEASE, 1]
      ],
      ["SELECT 1; DELETE FROM yunipals_indexer_control.chain_status", []]
    ])
      await assert.rejects(guarded.query(sql, p));
    await assert.rejects(
      runner
        .guardedPool(pool, "inspect", config)
        .query(
          "INSERT INTO yunipals_indexer_control.chain_status VALUES($1,$2)",
          [runner.RELEASE, 8453]
        )
    );
    assert.equal(dispatched, 0);
  }
);
const call = (method = "eth_chainId", params = []) => ({
  method: "POST",
  headers: { ...runner.headers(), "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
});
await check("transport_only_fixed_new_routes_and_headers", async () => {
  for (const edit of [
    (b) =>
      b.fetch("http://127.0.0.1:19202/unified/preflight", {
        headers: runner.headers()
      }),
    (b) =>
      b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
        headers: { ...runner.headers(), authorization: "forbidden" }
      }),
    (b) =>
      b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
        headers: {
          ...runner.headers(),
          "x-yunipals-unified-rpc-permit": "ab".repeat(32)
        }
      })
  ]) {
    let sent = 0;
    const b = runner.createBoundedFetch(config, async () => {
      sent++;
      return jsonResponse(preflight);
    });
    await assert.rejects(edit(b));
    assert.equal(sent, 0);
  }
});
await check(
  "transport_denies_logs_receipts_contract_signing_and_full_transaction_blocks",
  async () => {
    for (const [method, params] of [
      ["eth_getLogs", [{}]],
      ["eth_getTransactionReceipt", [hash(1n)]],
      ["eth_call", [{}, "latest"]],
      ["eth_getCode", ["0x" + "11".repeat(20), "latest"]],
      ["eth_sendRawTransaction", ["0x00"]],
      ["eth_getBlockByNumber", ["latest", true]]
    ]) {
      let sent = 0;
      const b = runner.createBoundedFetch(config, async () => {
        sent++;
        return jsonResponse(preflight);
      });
      await b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
        headers: runner.headers()
      });
      await assert.rejects(
        b.fetch(runner.ENDPOINTS[8453], call(method, params))
      );
      assert.equal(sent, 1);
    }
  }
);
await check("transport_64calls_and_deadline_and_response_caps", async () => {
  let sent = 0;
  const b = runner.createBoundedFetch(config, async (_url, options) => {
    sent++;
    return jsonResponse(
      options.method === "POST"
        ? { jsonrpc: "2.0", id: 1, result: "0x2105" }
        : preflight
    );
  });
  await b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
    headers: runner.headers()
  });
  for (let i = 0; i < 64; i++) await b.fetch(runner.ENDPOINTS[8453], call());
  await assert.rejects(b.fetch(runner.ENDPOINTS[8453], call()));
  assert.equal(sent, 65);
  assert.equal(b.state.rpcCalls, 64);
  let time = 0;
  const d = runner.createBoundedFetch(
    config,
    async () => {
      throw Error("must_not_dispatch");
    },
    () => time
  );
  time = 120000;
  await assert.rejects(
    d.fetch(runner.ENDPOINTS[8453] + "/preflight", {
      headers: runner.headers()
    })
  );
  const huge = runner.createBoundedFetch(
    config,
    async () => new Response("x".repeat(runner.LIMITS.responseBytes + 1))
  );
  await assert.rejects(
    huge.fetch(runner.ENDPOINTS[8453] + "/preflight", {
      headers: runner.headers()
    })
  );
});
await check(
  "configuration_rejects_duplicate_foreign_chains_and_missing_ack_reference",
  async () => {
    for (const value of [
      { chains: [8453, 8453], readAdmissionSha256: config.readAdmissionSha256 },
      { chains: [10], readAdmissionSha256: config.readAdmissionSha256 },
      { chains: [8453], readAdmissionSha256: "" },
      { ...config, task: "receipts-once" }
    ])
      assert.throws(() => runner.configuration(value));
  }
);
await check("exact_total_response_budget_refuses_next_dispatch", async () => {
  const empty = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "" });
  const raw = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: "x".repeat(runner.LIMITS.responseBytes - Buffer.byteLength(empty))
  });
  assert.equal(Buffer.byteLength(raw), runner.LIMITS.responseBytes);
  let sent = 0;
  const b = runner.createBoundedFetch(config, async () => {
    sent++;
    return new Response(raw);
  });
  await b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
    headers: runner.headers()
  });
  for (let i = 0; i < 7; i++) await b.fetch(runner.ENDPOINTS[8453], call());
  assert.equal(b.state.responseBytes, runner.LIMITS.totalResponseBytes);
  await assert.rejects(
    b.fetch(runner.ENDPOINTS[8453], call()),
    /observer_total_response_budget_exhausted/
  );
  assert.equal(sent, 8);
});
await check(
  "actual_official_rpc_optional_finalized_error_keeps_latest_observation",
  async () => {
    const { state, dependencies } = fixture();
    const dispatched = [];
    const env = {
      UNIFIED_RPC_POLICY_REQUIRED: "true",
      UNIFIED_RPC_FREE_ONLY: "true",
      UNIFIED_RPC_PROFILE_ID: runner.PROFILE_ID,
      UNIFIED_RPC_PROFILE_FILE: new URL(
        "./ypal-combined-rpc-profile-v1.json",
        import.meta.url
      ).pathname,
      ...Object.fromEntries(
        Object.entries(runner.ENDPOINTS).map(([chain, url]) => [
          "PONDER_RPC_URL_" + chain,
          url
        ])
      )
    };
    dependencies.rpcFactory = (chain) => evidenceRpc(chain, env);
    dependencies.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/preflight")) return jsonResponse(preflight);
      const body = JSON.parse(options.body),
        calls = Array.isArray(body) ? body : [body];
      const replies = calls.map((c) => {
        dispatched.push(c);
        if (c.method === "eth_chainId")
          return { jsonrpc: "2.0", id: c.id, result: "0x2105" };
        const tag = c.params[0];
        if (tag === "finalized")
          return {
            jsonrpc: "2.0",
            id: c.id,
            error: { code: -32602, message: "finalized unavailable" }
          };
        const n = tag === "latest" ? head : BigInt(tag),
          q = (v) => "0x" + v.toString(16);
        return {
          jsonrpc: "2.0",
          id: c.id,
          result: {
            number: q(n),
            hash: hash(n),
            parentHash: hash(n - 1n),
            timestamp: "0x7d0",
            gasLimit: "0x100000",
            gasUsed: "0x0",
            size: "0x100",
            difficulty: "0x0",
            totalDifficulty: "0x0",
            nonce: "0x0000000000000000",
            miner: "0x" + "11".repeat(20),
            extraData: "0x",
            transactions: [],
            uncles: [],
            sha3Uncles: hash(0n),
            stateRoot: hash(0n),
            receiptsRoot: hash(0n),
            transactionsRoot: hash(0n),
            logsBloom: "0x" + "00".repeat(256)
          }
        };
      });
      return jsonResponse(Array.isArray(body) ? replies : replies[0]);
    };
    const result = await runner.runOnce("observe-once", config, dependencies);
    assert.equal(result.successful, true);
    assert.equal(state.status.finality_error_code, "finality_unavailable");
    assert.equal(result.native.frameworkReady, false);
    assert.equal(
      result.results[0].observation.witness_number,
      indexed.toString()
    );
    assert.equal(
      dispatched.filter(
        (c) =>
          c.method === "eth_getBlockByNumber" && c.params[0] === "finalized"
      ).length,
      1
    );
    assert.ok(result.requests.rpcCalls > 0);
    assert.equal(result.requests.failed, false);
  }
);
await check("malformed_rpc_or_http_error_remains_terminal", async () => {
  for (const response of [
    () => new Response("unavailable", { status: 503 }),
    () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "missing-code" }
      })
  ]) {
    let sent = 0;
    const b = runner.createBoundedFetch(config, async (_url, options = {}) => {
      sent++;
      return options.method === "POST" ? response() : jsonResponse(preflight);
    });
    await b.fetch(runner.ENDPOINTS[8453] + "/preflight", {
      headers: runner.headers()
    });
    await assert.rejects(b.fetch(runner.ENDPOINTS[8453], call()));
    await assert.rejects(b.fetch(runner.ENDPOINTS[8453], call()));
    assert.equal(sent, 2);
    assert.equal(b.state.failed, true);
  }
});

console.log(
  JSON.stringify({
    passed: true,
    checks,
    actualOfficialObserverSourceSha256:
      runner.SOURCE_PINS["apps/yunipals-indexer/lib/unified/observer.ts"],
    database: "mocked_only",
    providerDispatch: "synthetic_only",
    productionCalls: 0,
    realDatabaseWrites: 0,
    realProviderCalls: 0
  })
);

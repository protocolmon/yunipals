// Disposable local PG16 only. Official observer/release code and exact combined
// manifest, synthetic blocks, a real least-privilege role, no provider requests.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { sourceManifestHash } from "../lib/unified/sources.ts";
import {
  combinedObserver as c,
  runCombinedObserver
} from "./unified-observer.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import { indexerSourceStatus } from "../lib/unified/status.ts";
import { createOwnershipReadViews } from "../lib/unified/ownership-views.ts";
const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const suffix = randomBytes(5).toString("hex"),
  name = `lag_retention_${suffix}_test`,
  role = `observer_${suffix}`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
let db,
  pool,
  created = false,
  roleCreated = false;
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../ops/unified-indexer-transition/ypal-combined-source-manifest-v1.json",
      import.meta.url
    )
  )
);
const env = {
  UNIFIED_INDEXER_RELEASE_ID: c.releaseId,
  UNIFIED_RPC_PROFILE_ID: c.profileId,
  UNIFIED_RPC_PROFILE_FILE: c.profileFile,
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_FREE_ONLY: "true",
  ...Object.fromEntries(
    Object.entries(c.endpoints).map(([id, url]) => [
      `PONDER_RPC_URL_${id}`,
      url
    ])
  )
};
const tables = [
  "_ponder_meta",
  "_ponder_checkpoint",
  "indexer_source",
  "chain_checkpoint",
  "chain_block"
];
let now = Date.now();
const initialNow = now,
  blockTime = BigInt(Math.floor(now / 1000));
const head = 60_000_000n,
  hash = (n) => "0x" + n.toString(16).padStart(64, "0");
const cp = (chain, n) =>
  `0000001000${String(chain).padStart(16, "0")}${String(n).padStart(16, "0")}${"9".repeat(33)}`;
const checks = [];
let rpcCalls = 0,
  rpcHead = head,
  rpcFinalized = head - 20n,
  badWitness = false,
  noFinality = false;
const rpc = {
  providerId: "synthetic",
  chainId: async () => {
    rpcCalls++;
    return 8453;
  },
  block: async (tag) => {
    rpcCalls++;
    if (tag === "finalized" && noFinality)
      throw Error("synthetic finality unavailable");
    const n =
      tag === "latest" ? rpcHead : tag === "finalized" ? rpcFinalized : tag;
    return {
      number: n,
      hash: hash(n + (badWitness ? 1n : 0n)),
      parentHash: hash(n - 1n),
      timestamp: blockTime
    };
  },
  receipt: async () => {
    throw Error("receipt forbidden");
  },
  code: async () => {
    throw Error("code forbidden");
  }
};
const snapshot = async () => {
  const out = {};
  for (const table of tables)
    out[table] = (
      await db.query(
        `SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${c.schema}.${table} t`
      )
    ).rows[0].hash;
  return out;
};
const originalNow = Date.now;
Date.now = () => now;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new pg.Pool({ connectionString: base + name, max: 1 });
  const dump = execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "yunipals-unified-indexer-test-20261020",
      "pg_dump",
      "-U",
      "unified_test",
      "-d",
      "yunipals_ponder_dependency_test",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--schema",
      "dependency_check"
    ],
    {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 4000000
    }
  );
  await db.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", c.schema)
  );
  await db.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  await db.query(`INSERT INTO ${c.schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: c.buildId,
      heartbeat_at: now,
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  for (const [id, label] of [
    [1, "mainnet"],
    [56, "bnb"],
    [137, "polygon"],
    [8453, "base"]
  ]) {
    await db.query(
      `INSERT INTO ${c.schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$4)`,
      [label, id, cp(id, head), cp(id, head - 30n)]
    );
    await db.query(
      `INSERT INTO ${c.schema}.chain_checkpoint VALUES($1,$2,$3,$4,$5,1000)`,
      [String(id), id, String(head), hash(head), hash(head - 1n)]
    );
    await db.query(
      `INSERT INTO ${c.schema}.chain_block VALUES($1,$2,$3,$4,$5,1000)`,
      [`${id}:${head}`, id, String(head), hash(head), hash(head - 1n)]
    );
  }
  for (const source of manifest.sources)
    await db.query(
      `INSERT INTO ${c.schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        source.id,
        source.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(source)
      ]
    );
  await migrateIndexerControl(db);
  const release = await registerIndexerRelease(db, {
    schema: c.schema,
    buildId: c.buildId,
    manifest
  });
  assert.equal(release.id, c.releaseId);
  await db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
  roleCreated = true;
  await db.query(
    `GRANT USAGE ON SCHEMA ${c.schema},yunipals_indexer_control TO "${role}"`
  );
  await db.query(
    `GRANT SELECT ON ${tables.map((t) => `${c.schema}.${t}`).join(",")},yunipals_indexer_control.release TO "${role}"`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE ON yunipals_indexer_control.chain_status TO "${role}"`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_indexer_control.chain_anchor TO "${role}"`
  );
  pool = new pg.Pool({
    connectionString: base + name,
    max: 2,
    options: `-c role=${role}`,
    statement_timeout: 8000
  });
  const observe = (p = pool) =>
    observeIndexerChain(p, release, 8453, rpc, { now: () => now });
  const status = async () =>
    (
      await db.query(
        "SELECT * FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=8453",
        [release.id]
      )
    ).rows[0];
  const controlAnchors = async () =>
    (
      await db.query(
        "SELECT * FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1 AND chain_id=8453 ORDER BY block_number",
        [release.id]
      )
    ).rows;
  const native = await snapshot();
  const aclBefore = (
    await db.query(
      "SELECT oid,relacl::text FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN($1,'yunipals_indexer_control')) ORDER BY oid",
      [c.schema]
    )
  ).rows;
  assert.equal(await observe(), "observed");
  const good = await status(),
    anchors = await controlAnchors();
  assert.ok(Object.keys(good.anchors).length > 1);
  assert.equal(
    (
      await db.query(
        `SELECT count(*) FROM ${c.schema}.chain_block WHERE chain_id=8453`
      )
    ).rows[0].count,
    "1"
  );
  await createOwnershipReadViews(db, release, "lag_latest", [
    {
      collection: "base",
      sourceId: "ownership:base",
      policy: { kind: "latest" }
    }
  ]);
  const probe = async () =>
    (await db.query("SELECT lag_latest.source_probe('base') AS value")).rows[0]
      .value;
  assert.equal((await probe()).ready, true);
  const immutable = (row) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([k]) => !["revision", "checked_at", "error_code"].includes(k)
      )
    );
  async function reset() {
    now = initialNow;
    rpcHead = head;
    rpcFinalized = head - 20n;
    badWitness = false;
    noFinality = false;
    await db.query(
      `UPDATE ${c.schema}._ponder_meta SET value=$1 WHERE key='app'`,
      [
        JSON.stringify({
          version: "6",
          build_id: c.buildId,
          heartbeat_at: now,
          is_ready: 1,
          is_locked: 1,
          is_dev: 0
        })
      ]
    );
    await db.query(
      `UPDATE ${c.schema}._ponder_checkpoint SET safe_checkpoint=$1,latest_checkpoint=$1 WHERE chain_id=8453`,
      [cp(8453, head)]
    );
    await db.query(
      `UPDATE ${c.schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=$2`,
      [hash(head), String(head)]
    );
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET halted=false,error_code=NULL WHERE release_id=$1 AND chain_id=8453",
      [release.id]
    );
    assert.equal(await observe(), "observed");
  }
  const retained = async () => {
    const old = await status(),
      oldAnchors = await controlAnchors(),
      calls = rpcCalls;
    assert.equal(await observe(), "waiting_retained");
    const after = await status();
    assert.deepEqual(immutable(after), immutable(old));
    assert.equal(after.error_code, null);
    assert.equal(BigInt(after.revision), BigInt(old.revision) + 1n);
    assert.deepEqual(await controlAnchors(), oldAnchors);
    assert.ok(
      rpcCalls - calls <= 4,
      "No extra header requests for retained proof"
    );
    return after;
  };
  rpcHead = head - 1n;
  await retained();
  assert.equal((await probe()).ready, true);
  const readiness = await indexerSourceStatus(
    pool,
    release,
    "ownership:base",
    { kind: "latest" },
    { nowMs: now }
  );
  assert.equal(readiness.readiness.ready, true);
  assert.equal(readiness.anchor.number, String(head));
  checks.push(
    "fresh original proof remains usable in actual V5 SQL and official status with sparse native anchors"
  );
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='provider_lag' WHERE release_id=$1 AND chain_id=8453",
    [release.id]
  );
  now += 1000;
  await retained();
  assert.equal((await status()).observed_at_ms, good.observed_at_ms);
  checks.push(
    "prior provider_lag requalified without timestamp or anchor refresh"
  );
  rpcHead = head;
  rpcFinalized = head - 21n;
  await retained();
  checks.push(
    "finalized provider regression retains original finality and observation fields"
  );
  await reset();
  await db.query(
    `UPDATE ${c.schema}._ponder_checkpoint SET safe_checkpoint=$1,latest_checkpoint=$1 WHERE chain_id=8453`,
    [cp(8453, head + 1n)]
  );
  await db.query(
    `UPDATE ${c.schema}.chain_checkpoint SET block_number=$1,block_hash=$2,parent_hash=$3 WHERE chain_id=8453`,
    [String(head + 1n), hash(head + 1n), hash(head)]
  );
  await db.query(
    `INSERT INTO ${c.schema}.chain_block VALUES($1,8453,$2,$3,$4,1000)`,
    [`8453:${head + 1n}`, String(head + 1n), hash(head + 1n), hash(head)]
  );
  await retained();
  checks.push(
    "native witness ahead of provider retains prior branch proof without synthetic advancement"
  );
  await db.query(
    `UPDATE ${c.schema}.chain_checkpoint SET block_number=$1,block_hash=$2,parent_hash=$3 WHERE chain_id=8453`,
    [String(head), hash(head), hash(head - 1n)]
  );
  await db.query(
    `DELETE FROM ${c.schema}.chain_block WHERE chain_id=8453 AND block_number>$1`,
    [String(head)]
  );
  for (const error of [
    "rpc_unavailable",
    "indexer_branch_mismatch",
    "provider_inconsistent",
    "head_stale",
    "observation_changed"
  ]) {
    await reset();
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET error_code=$2 WHERE release_id=$1 AND chain_id=8453",
      [release.id, error]
    );
    rpcHead = head - 1n;
    assert.equal(await observe(), "waiting");
    assert.equal(await observe(), "waiting");
    assert.equal((await status()).error_code, error);
    assert.equal((await probe()).ready, false);
  }
  checks.push(
    "repeated lag cannot clear or launder any other unresolved error"
  );
  await reset();
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET halted=true WHERE release_id=$1 AND chain_id=8453",
    [release.id]
  );
  rpcHead = head - 1n;
  const haltBefore = await status(),
    haltCalls = rpcCalls;
  assert.equal(await observe(), "halted");
  assert.deepEqual(await status(), haltBefore);
  assert.equal(rpcCalls, haltCalls);
  checks.push("halt remains sticky with no new RPC");
  await reset();
  rpcHead = head - 1n;
  now += 179000;
  await retained();
  now += 1001;
  await db.query(
    `UPDATE ${c.schema}._ponder_meta SET value=jsonb_set(value::jsonb,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
    [String(now)]
  );
  assert.equal(await observe(), "waiting");
  assert.equal((await status()).observed_at_ms, good.observed_at_ms);
  assert.equal((await probe()).ready, false);
  checks.push(
    "retention expires on original proof age despite fresh native heartbeat"
  );
  for (const mutation of [
    `observed_at_ms=${initialNow + 1}`,
    "observed_at_ms=NULL",
    "witness_number=NULL",
    "anchors='{}'::jsonb",
    `anchors=jsonb_set(anchors,ARRAY['${head}','timestamp'],'\"invalid\"'::jsonb)`
  ]) {
    await reset();
    await db.query(
      `UPDATE yunipals_indexer_control.chain_status SET ${mutation} WHERE release_id=$1 AND chain_id=8453`,
      [release.id]
    );
    rpcHead = head - 1n;
    assert.equal(await observe(), "waiting");
    assert.equal((await status()).error_code, "provider_lag");
  }
  checks.push("missing future or malformed retained fields refuse");
  await reset();
  await db.query(
    `UPDATE ${c.schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=$2`,
    [hash(head + 99n), String(head)]
  );
  rpcHead = head - 1n;
  assert.equal(await observe(), "waiting");
  assert.equal((await probe()).ready, false);
  checks.push("old native witness replacement invalidates retained proof");
  await reset();
  await db.query(
    "UPDATE yunipals_indexer_control.chain_anchor SET witness_hash=$2 WHERE release_id=$1 AND chain_id=8453",
    [release.id, hash(head + 99n)]
  );
  rpcHead = head - 1n;
  assert.equal(await observe(), "waiting");
  checks.push(
    "every retained anchor must still have the exact old witness association"
  );
  await reset();
  await db.query(
    `UPDATE ${c.schema}._ponder_meta SET value=jsonb_set(value::jsonb,'{is_ready}','0'::jsonb) WHERE key='app'`
  );
  rpcHead = head - 1n;
  assert.equal(await observe(), "waiting");
  checks.push("framework readiness remains mandatory for requalification");
  await reset();
  await db.query(
    `UPDATE ${c.schema}._ponder_checkpoint SET safe_checkpoint=$1,latest_checkpoint=$1 WHERE chain_id=8453`,
    [cp(8453, head - 1n)]
  );
  rpcHead = head - 1n;
  assert.equal(await observe(), "waiting");
  checks.push("native complete-prefix regression refuses");
  await reset();
  rpcHead = head - 1n;
  let connections = 0;
  const raced = {
    query: pool.query.bind(pool),
    connect: async () => {
      connections++;
      if (connections === 2)
        await db.query(
          "UPDATE yunipals_indexer_control.chain_status SET revision=revision+1,error_code='rpc_unavailable' WHERE release_id=$1 AND chain_id=8453",
          [release.id]
        );
      return pool.connect();
    }
  };
  assert.equal(await observe(raced), "superseded");
  assert.equal((await status()).error_code, "rpc_unavailable");
  checks.push("concurrent control revision/error cannot be overwritten");
  await reset();
  rpcHead = head - 1n;
  connections = 0;
  const branchRace = {
    query: pool.query.bind(pool),
    connect: async () => {
      connections++;
      if (connections === 2)
        await db.query(
          `UPDATE ${c.schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=$2`,
          [hash(head + 99n), String(head)]
        );
      return pool.connect();
    }
  };
  assert.equal(await observe(branchRace), "waiting");
  checks.push(
    "native branch changed between initial read and retaining transaction refuses"
  );
  await reset();
  rpcHead = head - 1n;
  connections = 0;
  const buildRace = {
    query: pool.query.bind(pool),
    connect: async () => {
      connections++;
      if (connections === 2)
        await db.query(
          `UPDATE ${c.schema}._ponder_meta SET value=jsonb_set(value::jsonb,'{build_id}','\"foreign\"'::jsonb) WHERE key='app'`
        );
      return pool.connect();
    }
  };
  await assert.rejects(observe(buildRace), /build changed/);
  checks.push("bound native build change cannot requalify retained data");
  await reset();
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='rpc_unavailable' WHERE release_id=$1 AND chain_id=8453",
    [release.id]
  );
  assert.equal(await observe(), "observed");
  assert.equal((await status()).error_code, null);
  checks.push("ordinary new full observation still clears recoverable errors");
  rpcHead = head - 1n;
  const diagnostics = [];
  await runCombinedObserver(pool, "observe-once", env, {
    log: (value) => diagnostics.push(value),
    dependencies: {
      preflight: async () => {},
      rpc: () => rpc,
      observe: async (p, r, chain, transport) =>
        chain === 8453
          ? observeIndexerChain(p, r, chain, transport, { now: () => now })
          : "waiting"
    }
  });
  assert.deepEqual(
    diagnostics.find((row) => row.chainId === 8453),
    {
      event: "combined_chain_observation",
      chainId: 8453,
      result: "waiting_retained",
      reason: "provider_lag",
      retainedLastGoodProof: true,
      observationTimestampAdvanced: false
    }
  );
  checks.push(
    "real ordinary loop reports waiting and retained proof without claiming a new observation"
  );
  assert.deepEqual(await snapshot(), native);
  assert.deepEqual(
    (
      await db.query(
        "SELECT oid,relacl::text FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN($1,'yunipals_indexer_control')) ORDER BY oid",
        [c.schema]
      )
    ).rows,
    aclBefore
  );
  await assert.rejects(
    pool.query(`UPDATE ${c.schema}.chain_block SET block_hash=block_hash`),
    { code: "42501" }
  );
  checks.push(
    "existing support privileges unchanged and native data remains SELECT-only"
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      actualPostgres: true,
      providerCalls: 0,
      nativeWritePrivilegesAdded: false
    })
  );
} finally {
  Date.now = originalNow;
  await pool?.end();
  await db?.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
}

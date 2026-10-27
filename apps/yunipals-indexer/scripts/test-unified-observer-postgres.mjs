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
const artifact = process.env.OBSERVER_TEST_ARTIFACT;
if (artifact)
  assert.match(
    artifact,
    /^\/tmp\/[a-zA-Z0-9_/-]+\/dist\/unified-observer\.mjs$/
  );
const { combinedObserver: c, runCombinedObserver } = await import(
  artifact ?? "./unified-observer.ts"
);
const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const suffix = randomBytes(5).toString("hex"),
  name = `observer_${suffix}_test`,
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
const head = 60_000_000n,
  now = 1_000_000,
  hash = (n) => "0x" + n.toString(16).padStart(64, "0");
const cp = (chain, n) =>
  `0000001000${String(chain).padStart(16, "0")}${String(n).padStart(16, "0")}${"9".repeat(33)}`;
const checks = [];
let rpcCalls = 0,
  badWitness = false,
  noFinality = false;
const rpc = (id) => ({
  providerId: "synthetic",
  chainId: async () => {
    rpcCalls++;
    return id;
  },
  block: async (tag) => {
    rpcCalls++;
    if (tag === "finalized" && noFinality) throw Error("private failure");
    const n = tag === "latest" ? head : tag === "finalized" ? head - 20n : tag;
    return {
      number: n,
      hash: hash(n + (badWitness && n === head ? 1n : 0n)),
      parentHash: hash(n - 1n),
      timestamp: 1000n
    };
  },
  receipt: async () => {
    throw Error("receipt forbidden");
  },
  code: async () => {
    throw Error("code forbidden");
  }
});
const deps = {
  preflight: async (m, e, o) => {
    assert.equal(sourceManifestHash(m), c.manifestHash);
    assert.deepEqual(o.endpoints, c.endpoints);
    assert.equal(e.UNIFIED_RPC_FREE_ONLY, "true");
  },
  rpc
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
  const original = await snapshot();
  const acls = async () =>
    (
      await db.query(
        `SELECT n.nspname,c.relname,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ($1,'yunipals_indexer_control') ORDER BY 1,2`,
        [c.schema]
      )
    ).rows;
  const beforeAcl = await acls();
  await runCombinedObserver(pool, "inspect", env, { dependencies: deps });
  assert.equal(rpcCalls, 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM yunipals_indexer_control.chain_status"
      )
    ).rows[0].count,
    "0"
  );
  checks.push("inspect performs no RPC or writes");
  await assert.rejects(
    pool.query(`UPDATE ${c.schema}._ponder_meta SET value=value`),
    { code: "42501" }
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO yunipals_indexer_control.receipt_job(chain_id,block_hash,transaction_hash,block_number) VALUES(1,'x','y',1)"
    ),
    { code: "42501" }
  );
  checks.push("native writes and receipt work denied by real role");
  const logs = [];
  await runCombinedObserver(pool, "observe-once", env, {
    dependencies: deps,
    log: (v) => logs.push(v)
  });
  assert.equal(logs.filter((v) => v.result === "observed").length, 4);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM yunipals_indexer_control.chain_status"
      )
    ).rows[0].count,
    "4"
  );
  assert.ok(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM yunipals_indexer_control.chain_anchor"
        )
      ).rows[0].count
    ) > 0
  );
  checks.push(
    "four official observations persist status and canonical anchors"
  );
  assert.deepEqual(await snapshot(), original);
  assert.deepEqual(await acls(), beforeAcl);
  for (const table of [
    "active_release",
    "receipt_job",
    "receipt_discovery",
    "transaction_evidence",
    "consumer_cursor"
  ])
    assert.equal(
      (await db.query(`SELECT count(*) FROM yunipals_indexer_control.${table}`))
        .rows[0].count,
      "0"
    );
  checks.push("native rows, ACLs, selectors and receipt tables unchanged");
  const lock = await db.connect();
  await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
    `yunipals:combined-observer:${c.releaseId}`
  ]);
  const calls = rpcCalls;
  await assert.rejects(
    runCombinedObserver(pool, "observe-once", env, { dependencies: deps }),
    /already_running/
  );
  assert.equal(rpcCalls, calls);
  await lock.query("SELECT pg_advisory_unlock_all()");
  lock.release();
  checks.push("real session singleton refuses second observer before RPC");
  noFinality = true;
  await runCombinedObserver(pool, "observe-once", env, { dependencies: deps });
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM yunipals_indexer_control.chain_status WHERE finality_error_code='finality_unavailable' AND error_code IS NULL"
      )
    ).rows[0].count,
    "4"
  );
  noFinality = false;
  checks.push("official missing finality semantics retained");
  badWitness = true;
  await runCombinedObserver(pool, "observe-once", env, { dependencies: deps });
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM yunipals_indexer_control.chain_status WHERE error_code='indexer_branch_mismatch'"
      )
    ).rows[0].count,
    "4"
  );
  badWitness = false;
  checks.push("canonical witness mismatch refuses observations");
  await db.query(
    `UPDATE ${c.schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}','0')`
  );
  const staleCalls = rpcCalls;
  await runCombinedObserver(pool, "observe-once", env, {
    dependencies: deps
  });
  assert.equal(rpcCalls, staleCalls);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM yunipals_indexer_control.chain_status WHERE error_code='indexer_not_ready'"
      )
    ).rows[0].count,
    "4"
  );
  checks.push("stale heartbeat writes waiting status without RPC");
  assert.deepEqual(await acls(), beforeAcl);
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      actualPostgres: true,
      providerCalls: 0,
      nativeWritePrivileges: false,
      fixtureDigest: createHash("sha256")
        .update(JSON.stringify(original))
        .digest("hex")
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

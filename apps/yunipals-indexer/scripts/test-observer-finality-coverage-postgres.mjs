// Disposable local PG16 only. Official observer and readiness code, the exact
// combined manifest and synthetic blocks, with provider requests forbidden.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.ts";
import { readIndexerSourceStatus } from "../../../packages/yunipals-indexer-server/src/status.ts";

// A built observer can be tested in place of the source.
const { observeIndexerChain } = await import(
  process.env.OBSERVER_TEST_ARTIFACT ?? "../lib/unified/observer.ts"
);

const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const database = `finality_coverage_${randomBytes(5).toString("hex")}_test`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
const schema = "unified_finality_coverage";
const policy = { kind: "finalized" };
const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const checkpoint = (number) =>
  `0000001000${"56".padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;

// BNB's finalized tag sits about 5 blocks behind head in production.
const finalityDepth = 5n;
let head = 60_000_000n;
let finalityFails = false;
const finalizedBlock = () => head - finalityDepth;
const rpc = {
  providerId: "synthetic-local-only",
  chainId: async () => 56,
  block: async (tag) => {
    if (tag === "finalized" && finalityFails) throw Error("private failure");
    const number =
      tag === "latest" ? head : tag === "finalized" ? finalizedBlock() : tag;
    return {
      number,
      hash: hash(number),
      parentHash: hash(number - 1n),
      timestamp: BigInt(Math.floor(Date.now() / 1000))
    };
  }
};

const checks = [];
let created = false,
  pool,
  db;
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Provider requests forbidden");
};
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pool = new pg.Pool({ connectionString: base + database, max: 3 });
  db = await pool.connect();
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
      .replaceAll("dependency_check", schema)
  );
  await db.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  const setMeta = (locked) =>
    db.query(
      `INSERT INTO ${schema}._ponder_meta VALUES('app',$1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [
        JSON.stringify({
          version: "6",
          build_id: "71e2a7f3b7",
          heartbeat_at: Date.now(),
          is_dev: 0,
          is_locked: locked,
          is_ready: 1
        })
      ]
    );
  await setMeta(1);
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../ops/unified-indexer-transition/ypal-combined-source-manifest-v1.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const source of manifest.sources)
    await db.query(`INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`, [
      source.id,
      source.chainId,
      manifestDigest(manifest),
      JSON.stringify(source)
    ]);
  const timestamp = () => String(Math.floor(Date.now() / 1000));
  const setIndexed = async (number) => {
    await db.query(`DELETE FROM ${schema}._ponder_checkpoint`);
    await db.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES('bnb',56,$1,$1,$1)`,
      [checkpoint(number)]
    );
    await db.query(`DELETE FROM ${schema}.chain_checkpoint`);
    await db.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES('56',56,$1,$2,$3,$4)`,
      [String(number), hash(number), hash(number - 1n), timestamp()]
    );
    await db.query(
      `INSERT INTO ${schema}.chain_block VALUES($1,56,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [
        `56:${number}`,
        String(number),
        hash(number),
        hash(number - 1n),
        timestamp()
      ]
    );
  };
  await setIndexed(head - 8n);
  await migrateIndexerControl(pool);
  const release = await registerIndexerRelease(pool, {
    schema,
    buildId: "71e2a7f3b7",
    manifest
  });
  const status = () =>
    readIndexerSourceStatus(db, release, "ownership:bnb", policy);
  const stored = async () =>
    (
      await db.query(
        `SELECT finalized_number,witness_number,anchors,finality_error_code
         FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=56`,
        [release.id]
      )
    ).rows[0];
  // Each case starts a new observation against a later head.
  const nextCase = async (indexed) => {
    head += 100n;
    await setIndexed(indexed(head));
  };
  const counted = (onSleep = async () => {}) => {
    const sleeps = { count: 0 };
    return {
      sleeps,
      sleep: async () => {
        sleeps.count++;
        await onSleep(sleeps.count);
      }
    };
  };

  {
    // Control: the current production order. The position read before the
    // finality request is below the finalized answer, and readiness refuses it.
    const { sleeps, sleep } = counted();
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, {
        finalityCoveragePolls: 0,
        sleep
      }),
      "observed"
    );
    const row = await stored();
    assert.equal(row.finalized_number, String(finalizedBlock()));
    assert.equal(row.witness_number, String(head - 8n));
    const result = await status();
    assert.equal(result.readiness.ready, false);
    assert.equal(result.readiness.reason, "catching_up");
    assert.equal(
      result.readiness.availableThroughBlock,
      BigInt(row.witness_number)
    );
    assert.equal(result.readiness.requiredThroughBlock, finalizedBlock());
    assert.equal(sleeps.count, 0);
    checks.push(
      "without waiting, a witness below finality stays catching_up at every observation"
    );
  }

  {
    // The indexer reaches the finalized block during the wait.
    await nextCase((current) => current - 8n);
    const { sleeps, sleep } = counted(async (count) => {
      if (count === 2) await setIndexed(finalizedBlock() + 2n);
    });
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, { sleep }),
      "observed"
    );
    assert.equal(sleeps.count, 2);
    const row = await stored();
    assert.equal(row.witness_number, String(finalizedBlock() + 2n));
    const result = await status();
    assert.equal(result.readiness.ready, true);
    assert.equal(result.readiness.reason, "ready");
    assert.equal(result.readiness.availableThroughBlock, finalizedBlock());
    assert.equal(result.anchor.number, String(finalizedBlock()));
    assert.equal(result.anchor.hash, hash(finalizedBlock()));
    checks.push(
      "coverage reached during the wait makes the source ready at the exact finalized anchor"
    );
  }

  {
    // Readiness stays honest when coverage never reaches the finalized block.
    await nextCase((current) => current - 8n);
    const { sleeps, sleep } = counted();
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, { sleep }),
      "observed"
    );
    assert.equal(sleeps.count, 24);
    const result = await status();
    assert.equal(result.readiness.ready, false);
    assert.equal(result.readiness.reason, "catching_up");
    assert.equal(result.readiness.requiredThroughBlock, finalizedBlock());
    checks.push(
      "the wait is bounded and missing coverage still reports catching_up"
    );
  }

  {
    // Chains with deeper finality never wait.
    await nextCase((current) => current - 1n);
    const { sleeps, sleep } = counted();
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, { sleep }),
      "observed"
    );
    assert.equal(sleeps.count, 0);
    assert.equal((await status()).readiness.ready, true);
    checks.push("an indexer already past finality does not wait");
  }

  {
    // Unknown finality has nothing to wait for and stays unavailable.
    await nextCase((current) => current - 8n);
    finalityFails = true;
    const { sleeps, sleep } = counted();
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, { sleep }),
      "observed"
    );
    finalityFails = false;
    assert.equal(sleeps.count, 0);
    assert.equal((await stored()).finality_error_code, "finality_unavailable");
    assert.equal((await status()).readiness.reason, "finality_unavailable");
    checks.push("unavailable finality does not wait or report ready");
  }

  {
    // The runtime stopping during the wait ends it, and the commit refuses.
    await nextCase((current) => current - 8n);
    const before = await stored();
    const { sleeps, sleep } = counted(async () => setMeta(0));
    assert.equal(
      await observeIndexerChain(pool, release, 56, rpc, { sleep }),
      "superseded"
    );
    assert.equal(sleeps.count, 1);
    assert.deepEqual(await stored(), before);
    await setMeta(1);
    checks.push(
      "a runtime stopping during the wait commits nothing and ends the wait"
    );
  }

  console.log(
    JSON.stringify({
      event: "observer_finality_coverage_postgres_verified",
      checks
    })
  );
} finally {
  globalThis.fetch = fetchBefore;
  db?.release();
  await pool?.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}

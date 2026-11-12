import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PortalStore } from "../lib/portals/store.js";
import {
  PortalLedgerStore,
  type PortalLedgerEvent
} from "../lib/portals/ledger-store.js";
import {
  createPortalSchema,
  grantPortalRoles,
  portalDatabaseOptions,
  portalSqlIdentifier
} from "../lib/portals/database.js";
import {
  PgPortalTransactionJournal,
  portalTransactionIntentHash
} from "../lib/portals/transactions.js";

const raw = process.env.PORTALS_TEST_DATABASE_URL;
if (!raw) throw new Error("PORTALS_TEST_DATABASE_URL is required.");
const url = new URL(raw);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/portal_test" ||
  url.search
)
  throw new Error("Use the isolated localhost portal_test database only.");
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const schema = `portal_test_${suffix}`;
const roles = {
  api: `portal_api_${suffix}`,
  worker: `portal_worker_${suffix}`,
  ledger: `portal_ledger_${suffix}`
};
const restoreDatabase = `portal_restore_${suffix}`;
const owner = new pg.Pool({ connectionString: raw });
const pool = new pg.Pool(
  portalDatabaseOptions({
    PORTALS_DATABASE_URL: raw,
    PORTALS_DATABASE_SCHEMA: schema
  })
);
const runtimePools: pg.Pool[] = [];
const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const digest = `0x${"a".repeat(64)}` as Hex;
const deployment = "disposable-portal-test";

function runtime(role: string) {
  const connection = new URL(url);
  connection.username = role;
  connection.password = "local-runtime-test-only";
  const db = new pg.Pool(
    portalDatabaseOptions({
      PORTALS_DATABASE_URL: connection.href,
      PORTALS_DATABASE_SCHEMA: schema
    })
  );
  runtimePools.push(db);
  return db;
}
function pgTool(
  command: "pg_dump" | "pg_restore",
  target: URL,
  args: string[],
  input?: Buffer
) {
  const container = process.env.PORTALS_TEST_PG_CONTAINER;
  const connection = new URL(target);
  const password = decodeURIComponent(connection.password);
  connection.password = "";
  if (container) {
    if (!/^yunipals-portals-[a-z0-9-]+$/.test(container))
      throw new Error("Invalid disposable container name.");
    connection.port = "5432";
  }
  const result = container
    ? spawnSync(
        "docker",
        [
          "exec",
          "-i",
          "-e",
          "PGPASSWORD",
          container,
          command,
          "--dbname",
          connection.href,
          ...args
        ],
        {
          input,
          env: { ...process.env, PGPASSWORD: password },
          maxBuffer: 32 * 1024 * 1024
        }
      )
    : spawnSync(command, ["--dbname", connection.href, ...args], {
        input,
        env: { ...process.env, PGPASSWORD: password },
        maxBuffer: 32 * 1024 * 1024
      });
  assert.equal(
    result.status,
    0,
    `${command} failed; ensure matching PostgreSQL client tools are installed.`
  );
  return result.stdout;
}

try {
  for (const role of Object.values(roles))
    await owner.query(
      `CREATE ROLE ${portalSqlIdentifier(role)} LOGIN PASSWORD 'local-runtime-test-only'`
    );
  await createPortalSchema(owner, schema);
  const store = new PortalStore(pool, deployment);
  const ledger = new PortalLedgerStore(pool, deployment);
  await store.migrate();
  await ledger.migrate();
  await store.migrate();
  await ledger.migrate();
  await grantPortalRoles(owner, schema, roles);
  const api = runtime(roles.api),
    worker = runtime(roles.worker),
    indexer = runtime(roles.ledger);
  const apiStore = new PortalStore(api, deployment);
  const workerStore = new PortalStore(worker, deployment);
  const indexerStore = new PortalLedgerStore(indexer, deployment);
  assert.equal(
    (await api.query("SELECT current_schema() AS schema")).rows[0].schema,
    schema
  );
  await apiStore.saveSpell({
    commitment: digest,
    submitter: account.address,
    tokenId: "1",
    artVersion: "0",
    nonce: "0",
    spell: "Keep the lantern glowing.",
    salt: digest
  });
  await workerStore.enqueue({
    requestId: "1",
    commitment: digest,
    binding: digest,
    acceptedBlock: "20",
    acceptedAt: 100
  });
  const claims = await Promise.all([
    workerStore.claim(),
    new PortalStore(worker, deployment).claim()
  ]);
  assert.equal(
    claims.filter(Boolean).length,
    1,
    "exactly one connection may lease a job"
  );
  const job = claims.find((value) => value !== null)!;
  job.progress.image = {
    hash: digest,
    uri: "https://portal.test/saved.png",
    model: "mock",
    usage: {}
  };
  await workerStore.save(job);
  await assert.rejects(
    api.query("SELECT * FROM portal_v5_transaction"),
    /permission denied/
  );
  await assert.rejects(
    api.query("UPDATE portal_v1_job SET attempts=100"),
    /permission denied/
  );
  await assert.rejects(
    api.query("CREATE TABLE unauthorized(id integer)"),
    /permission denied/
  );
  await assert.rejects(
    indexer.query("SELECT spell FROM portal_v1_spell"),
    /permission denied/
  );
  await assert.rejects(
    worker.query(
      "INSERT INTO portal_v2_token(deployment,token_id,owner) VALUES('test',1,'test')"
    ),
    /permission denied/
  );

  const journal = new PgPortalTransactionJournal(worker);
  let entered!: () => void, release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = journal.withSigner(31337, account.address, async () => {
    entered();
    await held;
  });
  await acquired;
  await assert.rejects(
    new PgPortalTransactionJournal(worker).withSigner(
      31337,
      account.address,
      async () => {}
    ),
    /signer is busy/
  );
  release();
  await first;
  const to = "0x2222222222222222222222222222222222222222" as Address;
  const signed = await account.signTransaction({
    chainId: 31337,
    type: "eip1559",
    to,
    nonce: 0,
    gas: 21000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    value: 0n
  });
  await assert.rejects(
    journal.withSigner(31337, account.address, async (session) => {
      await session.insert({
        operation: "grade:test:1",
        attempt: 0,
        nonce: 0,
        intentHash: portalTransactionIntentHash({ to, data: "0x" }),
        hash: keccak256(signed),
        raw: signed as `0x02${string}`,
        state: "prepared"
      });
      throw new Error("simulated interruption before broadcast");
    }),
    /interruption/
  );
  await new PgPortalTransactionJournal(worker).withSigner(
    31337,
    account.address,
    async (session) => {
      assert.equal(
        (await session.latest("grade:test:1"))?.raw,
        signed,
        "committed signed bytes survive an interrupted caller"
      );
    }
  );

  const event: PortalLedgerEvent = {
    type: "Transfer",
    tokenId: "1",
    block: "20",
    blockHash: digest,
    transactionHash: digest,
    transactionIndex: 0,
    logIndex: 0,
    source: to,
    args: { from: `0x${"0".repeat(40)}`, to: account.address, tokenId: "1" }
  };
  await indexerStore.apply([event], "20", digest, null);
  const cursor = await indexerStore.cursor();
  assert.ok(cursor);
  await assert.rejects(
    indexerStore.apply(
      [
        {
          ...event,
          logIndex: 1,
          type: "PortalFeeAccrued",
          args: { amount: "1", newBalance: "9" }
        }
      ],
      "21",
      digest,
      cursor
    ),
    /does not reconcile/
  );
  assert.deepEqual(
    await indexerStore.cursor(),
    cursor,
    "failed projection must not advance cursor"
  );
  assert.equal(
    (
      await api.query(
        "SELECT count(*)::int AS count FROM portal_v2_ledger_event"
      )
    ).rows[0].count,
    1
  );

  // Real dump/restore, including unpublished spells, saved AI work and signed attempts.
  const archive = pgTool("pg_dump", url, [
    "--format=custom",
    "--schema",
    schema
  ]);
  await owner.query(`CREATE DATABASE ${portalSqlIdentifier(restoreDatabase)}`);
  const restoredUrl = new URL(url);
  restoredUrl.pathname = `/${restoreDatabase}`;
  pgTool(
    "pg_restore",
    restoredUrl,
    ["--no-owner", "--no-privileges", "--exit-on-error"],
    archive
  );
  const restored = new pg.Pool(
    portalDatabaseOptions({
      PORTALS_DATABASE_URL: restoredUrl.href,
      PORTALS_DATABASE_SCHEMA: schema
    })
  );
  try {
    const restoredStore = new PortalStore(restored, deployment);
    assert.equal(
      (await restoredStore.spell(digest))?.spell,
      "Keep the lantern glowing."
    );
    assert.deepEqual(
      (await restored.query("SELECT progress FROM portal_v1_job")).rows[0]
        .progress,
      job.progress
    );
    assert.equal(
      (
        await restored.query(
          "SELECT signed_transaction FROM portal_v5_transaction"
        )
      ).rows[0].signed_transaction,
      signed
    );
    assert.deepEqual(
      await new PortalLedgerStore(restored, deployment).cursor(),
      cursor
    );
  } finally {
    await restored.end();
  }
  console.log(
    "Portal PostgreSQL: repeat migrations, restricted roles, concurrent leases, signer locks, durable attempts, atomic ledger and dump/restore passed."
  );
} finally {
  await Promise.all(runtimePools.map((db) => db.end()));
  await pool.end();
  await owner.query(
    `DROP DATABASE IF EXISTS ${portalSqlIdentifier(restoreDatabase)} WITH (FORCE)`
  );
  await owner.query(
    `DROP SCHEMA IF EXISTS ${portalSqlIdentifier(schema)} CASCADE`
  );
  for (const role of Object.values(roles))
    await owner.query(`DROP ROLE IF EXISTS ${portalSqlIdentifier(role)}`);
  await owner.end();
}

import assert from "node:assert/strict";
import pg from "pg";
import { hashCanonicalHistory } from "../lib/unified/shared-parity.ts";

const connectionString = process.env.PONDER_DEPENDENCY_TEST_DATABASE_URL;
assert.ok(connectionString, "Explicit disposable Ponder database required.");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const db = new pg.Client({ connectionString, statement_timeout: 5000 });
try {
  await db.connect();
  await db.query("BEGIN");
  // Use Ponder's installed DDL, only in a connection-local temporary table.
  await db.query(`CREATE TEMP TABLE canonical_event
    (LIKE dependency_check.canonical_event INCLUDING ALL) ON COMMIT DROP`);
  await db.query(`INSERT INTO pg_temp.canonical_event
    (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,
     transaction_hash,transaction_index,log_index,topics,data)
    SELECT lpad(n::text,6,'0'),'ownership:base',8453,'0x'||repeat('12',20),'Transfer',
      jsonb_build_object('tokenId',n::text)::text,'0x'||repeat('23',32),
      CASE WHEN n=0 THEN 9 WHEN n=2000 THEN 100 ELSE 50 END,'0x'||repeat('34',32),12345,
      '0x'||lpad(to_hex(n+1),64,'0'),n/32,n%32,'[]','0x00'
    FROM generate_series(0,2000)n`);
  const before = await hashCanonicalHistory(
    db,
    "pg_temp",
    "ownership:base",
    100n
  );
  assert.equal(before.events, 2001);
  await db.query(
    "UPDATE pg_temp.canonical_event SET topics='[null,null,null,null]'"
  );
  assert.deepEqual(
    await hashCanonicalHistory(db, "pg_temp", "ownership:base", 100n),
    before
  );
  // The mutation is after the first page and changes raw evidence only.
  await db.query(
    "UPDATE pg_temp.canonical_event SET data='0x01' WHERE id='002000'"
  );
  const changed = await hashCanonicalHistory(
    db,
    "pg_temp",
    "ownership:base",
    100n
  );
  assert.equal(changed.events, before.events);
  assert.notEqual(changed.sha256, before.sha256);
  assert.equal(
    (await hashCanonicalHistory(db, "pg_temp", "ownership:base", 49n)).events,
    1
  );
  await db.query("ROLLBACK");
  console.log(
    JSON.stringify({
      event: "shared_journal_parity_postgres_verified",
      checks: [
        "native DDL",
        "dense-block pagination",
        "numeric block ordering across digit boundaries",
        "complete raw evidence",
        "validated historical topic padding",
        "block ceiling"
      ],
      productionWrites: 0,
      providerCalls: 0
    })
  );
} finally {
  await db.query("ROLLBACK").catch(() => undefined);
  await db.end();
}

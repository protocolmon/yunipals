import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  ownershipSources,
  completedCheckpoint,
  digestAccumulator,
  identifier,
  datasetSql,
  captureOwnershipParity,
  validateBaseline
} from "./ownership-parity.mjs";

const checkpoint = (chain, number, complete = true) =>
  `0000001000${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${(complete ? "9" : "0").repeat(33)}`;
test("complete coverage does not mistake a partial event checkpoint for a full block", () => {
  assert.equal(
    completedCheckpoint(checkpoint(8453, 60000000), 8453),
    "60000000"
  );
  assert.equal(
    completedCheckpoint(checkpoint(8453, 60000000, false), 8453),
    "59999999"
  );
  assert.throws(() => completedCheckpoint(checkpoint(56, 60000000), 8453));
  assert.throws(() => completedCheckpoint("0".repeat(75), 8453));
  assert.throws(() => identifier("source;DROP SCHEMA public"));
});
test("digest framing distinguishes nullable and large integer rows and localizes changes", () => {
  const make = (rows) => {
    const acc = digestAccumulator();
    for (const [key, value] of rows) acc.add(key, value);
    return acc.finish();
  };
  const rows = [
    ["token:1", ["9007199254740993123", null, false]],
    ["token:2", ["a\nb", "c"]]
  ];
  const first = make(rows);
  assert.deepEqual(first, make(rows));
  const changed = make([
    ["token:1", ["9007199254740993124", null, false]],
    rows[1]
  ]);
  assert.notEqual(first.sha256, changed.sha256);
  assert.equal(first.rows, 2);
  assert.equal(
    first.buckets.reduce((count, item) => count + item.rows, 0),
    2
  );
  assert.equal(
    first.buckets.filter((item, i) => item.sha256 !== changed.buckets[i].sha256)
      .length,
    1
  );
});
test("baseline requires all six exact collections and complete digest evidence", () => {
  assert.throws(() => validateBaseline({ source: "legacy", collections: [] }));
  assert.throws(() =>
    datasetSql({ ...ownershipSources[0], address: "0x" }, "test", "token")
  );
  assert.throws(() => datasetSql(ownershipSources[0], "test", "provider_task"));
});

const database = process.env.OWNERSHIP_PARITY_TEST_DATABASE_URL;
test(
  "read-only fixed-boundary parity reconstructs transfers, burns and remints across all six sources",
  { skip: !database },
  async () => {
    const url = new URL(database);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/yunipals_ownership_parity_test");
    assert.equal(url.search, "");
    const require = createRequire(
      new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
    );
    const { Client } = require("pg");
    const db = new Client({ connectionString: database });
    await db.connect();
    const h = (n) => `0x${String(n).padStart(64, "0")}`;
    const alice = `0x${"12".repeat(20)}`,
      bob = `0x${"34".repeat(20)}`,
      zero = `0x${"00".repeat(20)}`;
    const schema = "parity_candidate_test";
    const releaseId = h(987);
    const max = "130000000";
    const tokenColumns =
      "collection text,chain_id integer,contract_address text,token_id text,owner text,burned boolean,lifecycle integer,mint_block bigint,mint_timestamp bigint,last_transfer_block bigint,last_transfer_timestamp bigint,last_transaction_hash text";
    try {
      // This database is dedicated to this integration test; no shared source/control state is touched.
      await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      const schemas = [
        ...new Set(ownershipSources.map((row) => row.schema)),
        schema
      ];
      for (const name of schemas) {
        const q = identifier(name);
        await db.query(`DROP SCHEMA IF EXISTS ${q} CASCADE; CREATE SCHEMA ${q};
        CREATE TABLE ${q}.token(${tokenColumns});
        CREATE TABLE ${q}.token_lifecycle(collection text,token_id text,lifecycle integer,minted_to text,mint_block bigint,mint_timestamp bigint,mint_transaction_hash text,burned_at_block bigint,burned_at_timestamp bigint,burn_transaction_hash text);
        CREATE TABLE ${q}.transfer_event(id text,collection text,chain_id integer,contract_address text,token_id text,lifecycle integer,"from" text,"to" text,block_number bigint,block_timestamp bigint,transaction_hash text,transaction_index integer,log_index integer);
        CREATE TABLE ${q}.admin_role_event(id text,collection text,chain_id integer,contract_address text,role text,account text,sender text,granted boolean,block_number bigint,transaction_hash text,log_index integer);
        CREATE TABLE ${q}.contract_owner_event(id text,collection text,chain_id integer,contract_address text,previous_owner text,new_owner text,block_number bigint,transaction_hash text,log_index integer);
        CREATE TABLE ${q}._ponder_checkpoint(chain_id integer,latest_checkpoint text);
        CREATE TABLE ${q}._ponder_meta(key text,value jsonb);
        CREATE TABLE ${q}.sync_state(singleton boolean,next_block bigint,last_scanned_block bigint,last_scanned_hash text,last_error text,ready boolean);
        INSERT INTO ${q}._ponder_meta VALUES('app','{"version":"6","is_dev":0,"build_id":"parity-fixture","is_ready":1,"is_locked":1,"heartbeat_at":1}');
        INSERT INTO ${q}.sync_state VALUES(true,130000001,130000000,'${h(max)}',null,true)`);
        for (const chain of [1, 56, 137, 8453])
          await db.query(`INSERT INTO ${q}._ponder_checkpoint VALUES($1,$2)`, [
            chain,
            checkpoint(chain, max)
          ]);
      }
      await db.query(`DROP SCHEMA IF EXISTS yunipals_indexer_control CASCADE;
      CREATE SCHEMA yunipals_indexer_control;
      CREATE TABLE yunipals_indexer_control.release(id text,physical_schema text,build_id text,manifest_hash text);
      INSERT INTO yunipals_indexer_control.release VALUES('${releaseId}','${schema}','parity-fixture','${h(988)}');
      CREATE TABLE ${schema}.chain_block(chain_id integer,block_number bigint,block_hash text);
      CREATE TABLE ${schema}.indexer_source(id text,manifest_hash text,definition text)`);
      for (const source of ownershipSources) {
        const args = [source.collection, source.chainId, source.address];
        for (const name of [source.schema, schema]) {
          const q = identifier(name);
          await db.query(
            `INSERT INTO ${q}.token VALUES($1,$2,$3,'1',$4,false,1,$5,100,$5,100,$6)`,
            [...args, alice, source.startBlock, h(1)]
          );
          await db.query(
            `INSERT INTO ${q}.token_lifecycle VALUES($1,'1',1,$2,$3,100,$4,null,null,null)`,
            [source.collection, alice, source.startBlock, h(1)]
          );
          await db.query(
            `INSERT INTO ${q}.transfer_event VALUES('mint',$1,$2,$3,'1',1,$4,$5,$6,100,$7,0,0)`,
            [...args, zero, alice, source.startBlock, h(1)]
          );
        }
        await db.query(
          `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3)`,
          [
            source.sourceId,
            h(988),
            JSON.stringify({
              enabled: true,
              chainId: source.chainId,
              address: source.address,
              startBlock: source.startBlock,
              events: ["Transfer"]
            })
          ]
        );
      }
      for (const chain of [1, 56, 137, 8453])
        await db.query(`INSERT INTO ${schema}.chain_block VALUES($1,$2,$3)`, [
          chain,
          max,
          h(max)
        ]);
      const baseline = await captureOwnershipParity(db, { source: "legacy" });
      validateBaseline(baseline);
      assert.equal(baseline.collections.length, 6);
      assert.equal(baseline.collections[0].datasets.token.rows, 1);
      // Source has moved on. Reconstruct the old owner/lifecycle, not current Bob or remint.
      await db.query(
        `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=8453`,
        [checkpoint(8453, "130000003")]
      );
      await db.query(
        `UPDATE ${schema}.token SET owner=$1,lifecycle=2,mint_block=130000003,last_transfer_block=130000003,last_transaction_hash=$2 WHERE collection='base'`,
        [bob, h(3)]
      );
      await db.query(
        `UPDATE ${schema}.token_lifecycle SET burned_at_block=130000002,burned_at_timestamp=102,burn_transaction_hash=$1 WHERE collection='base'`,
        [h(2)]
      );
      await db.query(
        `INSERT INTO ${schema}.token_lifecycle VALUES('base','1',2,$1,130000003,103,$2,null,null,null)`,
        [bob, h(3)]
      );
      await db.query(
        `INSERT INTO ${schema}.transfer_event VALUES('burn','base',8453,$1,'1',1,$2,$3,130000002,102,$4,0,0),('remint','base',8453,$1,'1',2,$3,$5,130000003,103,$6,0,0)`,
        [ownershipSources[1].address, alice, zero, h(2), bob, h(3)]
      );
      const candidate = await captureOwnershipParity(db, {
        source: "unified",
        schema,
        releaseId,
        baseline
      });
      assert.equal(candidate.exactDataParity, true);
      assert.equal(candidate.allBoundaryHashesMatch, false); // Legacy Ponder has no independently captured hash.
      assert.equal(candidate.observation.read_only, "on");
      assert.equal(candidate.observation.isolation, "repeatable read");
      await db.query(
        `UPDATE ${schema}.token SET owner=$1 WHERE collection='ethereum'`,
        [bob]
      );
      const mismatch = await captureOwnershipParity(db, {
        source: "unified",
        schema,
        releaseId,
        baseline
      });
      assert.equal(mismatch.exactDataParity, false);
      assert.equal(mismatch.collections[0].comparisons.token.equal, false);
      assert.equal(
        mismatch.collections[0].comparisons.token.differingBuckets.length,
        1
      );
      const wrongHash = structuredClone(baseline);
      wrongHash.collections.find(
        (row) => row.collection === "bnb"
      ).boundary.hash = h(999);
      await assert.rejects(
        captureOwnershipParity(db, {
          source: "unified",
          schema,
          releaseId,
          baseline: wrongHash
        }),
        /block witness/
      );
      const tx = (await db.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only;
      assert.equal(tx, "off"); // Failure rolled back; no leaked transaction.
    } finally {
      await db.end();
    }
  }
);

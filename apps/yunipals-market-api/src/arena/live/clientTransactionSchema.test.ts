import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { migrateArena } from "./schema";

test("client tracking migration retains legacy rows and enforces native origins and immutable receipt history", async () => {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const address = () => `0x${randomBytes(20).toString("hex")}`,
    hash = () => `0x${randomBytes(32).toString("hex")}`;
  const contract = address(),
    deployment = `8453:${contract}`,
    wallet = address(),
    incarnation = hash(),
    blockHash = hash();
  const transactionHash = hash();
  const baseAction = {
    kind: "entry",
    tournamentId: "1",
    nftChainId: 8453,
    collection: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    tokenId: "1"
  };
  const action = { ...baseAction, incarnation };
  const pgError = (code: string) => (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code;
  try {
    await migrateArena(pool);
    await migrateArena(pool);
    await pool.query(
      "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
      [deployment, contract]
    );
    // Owner-seeded history tests DDL invariants, not canonical chain evidence.
    await pool.query(
      `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
      VALUES($1,1,$2,$3,$4,$5,now(),$6)`,
      [
        deployment,
        incarnation,
        `${deployment}:${hash()}:0`,
        blockHash,
        hash(),
        `${deployment}/1/${incarnation}`
      ]
    );
    const insert = (body: unknown, origin: string | null = incarnation) =>
      pool.query(
        `INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,reader_mode,tournament_id,incarnation)
      VALUES($1,$2,$3,$4,'unified',1,$5)`,
        [deployment, hash(), wallet, body, origin]
      );
    await assert.rejects(insert(baseAction), pgError("23514"));
    await assert.rejects(insert({}), pgError("23514"));
    await assert.rejects(insert({ kind: "claim" }), pgError("23514"));
    await assert.rejects(insert(action, null), pgError("23514"));
    await assert.rejects(
      insert({ ...action, incarnation: hash() }),
      pgError("23514")
    );
    const missingOrigin = hash();
    await assert.rejects(
      insert({ ...action, incarnation: missingOrigin }, missingOrigin),
      pgError("23503")
    );
    // Original requests remain readable and can receive the explicit adopted
    // parent binding without changing wallet, hash or action semantics.
    await pool.query(
      "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action) VALUES($1,$2,$3,$4)",
      [deployment, transactionHash, wallet, baseAction]
    );
    assert.equal(
      (
        await pool.query(
          "SELECT reader_mode FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2",
          [deployment, transactionHash]
        )
      ).rows[0].reader_mode,
      "legacy"
    );
    await pool.query(
      "UPDATE yunipals_arena.client_transaction SET reader_mode='unified',tournament_id=1,incarnation=$3,action=$4 WHERE deployment=$1 AND hash=$2",
      [deployment, transactionHash, incarnation, action]
    );
    await assert.rejects(
      pool.query(
        "UPDATE yunipals_arena.client_transaction SET wallet=$3 WHERE deployment=$1 AND hash=$2",
        [deployment, transactionHash, address()]
      ),
      /binding is immutable/
    );
    await assert.rejects(
      pool.query(
        "UPDATE yunipals_arena.client_transaction SET reader_mode='legacy' WHERE deployment=$1 AND hash=$2",
        [deployment, transactionHash]
      ),
      /binding is immutable/
    );
    await assert.rejects(
      pool.query(
        "UPDATE yunipals_arena.client_transaction SET receipt_block_number=1 WHERE deployment=$1 AND hash=$2",
        [deployment, transactionHash]
      ),
      pgError("23514")
    );
    await pool.query(
      "UPDATE yunipals_arena.client_transaction SET state='indexing',receipt_block_number=1,receipt_block_hash=$3 WHERE deployment=$1 AND hash=$2",
      [deployment, transactionHash, blockHash]
    );
    await pool.query(
      `INSERT INTO yunipals_arena.client_receipt_history(deployment,transaction_hash,block_hash,block_number,receipt,canonical)
      VALUES($1,$2,$3,1,'{"status":"success"}',true)`,
      [deployment, transactionHash, blockHash]
    );
    await assert.rejects(
      pool.query(
        "UPDATE yunipals_arena.client_receipt_history SET receipt='{}' WHERE deployment=$1",
        [deployment]
      ),
      /receipt history is immutable/
    );
    await pool.query(
      "UPDATE yunipals_arena.client_receipt_history SET canonical=false,checked_at=now() WHERE deployment=$1",
      [deployment]
    );
    await assert.rejects(
      pool.query(
        "DELETE FROM yunipals_arena.client_transaction WHERE deployment=$1",
        [deployment]
      ),
      pgError("23503")
    );
  } finally {
    await pool.query(
      "DELETE FROM yunipals_arena.client_receipt_history WHERE deployment=$1",
      [deployment]
    );
    await pool.query(
      "DELETE FROM yunipals_arena.client_transaction WHERE deployment=$1",
      [deployment]
    );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
    await pool.end();
  }
});

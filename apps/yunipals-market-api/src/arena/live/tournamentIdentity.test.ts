import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import type { Address, Hex, PublicClient } from "viem";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { transaction } from "@/db/pool";
import { migrateArena } from "./schema";
import { arenaPrivateTables } from "./identitySchema";
import { projectEvent } from "./projection";
import { projectFinalizedArena } from "./projector";
import { StrategyCipher } from "./crypto";
import {
  adoptLegacyTournamentIdentity,
  registerTournamentIdentity
} from "./tournamentIdentity";
import type { NativeArenaObservation } from "./nativeSource";

test("durable Arena identity migration retains private history through public deletion and reused IDs", async () => {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const contract = `0x${randomBytes(20).toString("hex")}` as Address,
    deployment = `8453:${contract}`;
  const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex,
    owner = `0x${"2".repeat(40)}`;
  const cipher = new StrategyCipher(randomBytes(32)),
    originalCiphertext = cipher.seal(`${deployment}/1/seat/0`, {
      text: "Retained private strategy"
    });
  const tx = hash("b"),
    block = hash("a"),
    rules = hash("c"),
    catalog = hash("d"),
    releaseId = hash("e");
  try {
    await migrateArena(pool);
    await migrateArena(pool);
    await pool.query(
      "INSERT INTO yunipals_arena.deployment(id,contract,start_block,finalized_at) VALUES($1,$2,1,now())",
      [deployment, contract]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,cipher_context)
      VALUES($1,1,$2,'invalid-half-bound')`,
        [deployment, hash("4")]
      ),
      (e: unknown) =>
        !!e && typeof e === "object" && "code" in e && e.code === "23514"
    );
    await transaction(pool, (db) =>
      projectEvent(db, deployment, {
        blockNumber: 1n,
        blockHash: block,
        transactionHash: tx,
        logIndex: 0,
        eventName: "TournamentOpened",
        args: { id: 1n, deadline: 0n, rulesHash: rules, poolHash: catalog }
      })
    );
    const state = (
      await pool.query(
        "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1",
        [deployment]
      )
    ).rows[0].state;
    const records = {
      submission: {
        seat: 0,
        wallet: owner,
        commitment: hash("1"),
        signature: "0x12",
        ciphertext: originalCiphertext
      },
      fighter_snapshot: {
        nft_chain_id: 8453,
        collection: contract,
        token_id: "1",
        snapshot: { name: "Fighter" },
        snapshot_hash: "snapshot"
      },
      frozen_input: {
        input_hash: hash("1"),
        ciphertext: cipher.seal(`${deployment}/1/input`, { strategies: [] })
      },
      admission: {
        wallet: owner,
        nft_chain_id: 8453,
        collection: contract,
        token_id: "1",
        ownership_block: "1",
        ownership_hash: block,
        expiry: "100",
        signature: "0x12"
      },
      provider_task: {
        kind: "referee",
        asset: "candidate-1",
        request_id: randomUUID(),
        request: {},
        reserved_microusd: "700000"
      },
      transaction_intent: {
        purpose: "freeze-input",
        signer: owner,
        nonce: "1",
        raw_transaction: "0x1234",
        tx_hash: hash("2")
      },
      adjudication: {
        input_hash: hash("1"),
        outcome_hash: hash("2"),
        candidate: {},
        validation: {},
        state: "valid"
      },
      media_job: {}
    };
    for (const table of arenaPrivateTables) {
      const row = { deployment, tournament_id: "1", ...records[table] };
      const columns = Object.keys(row);
      await pool.query(
        `INSERT INTO yunipals_arena.${table}(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row)
      );
    }
    await pool.query(
      "DELETE FROM yunipals_arena.tournament WHERE deployment=$1",
      [deployment]
    );
    for (const table of arenaPrivateTables)
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM yunipals_arena.${table} WHERE deployment=$1`,
            [deployment]
          )
        ).rows[0].n,
        1
      );
    await assert.rejects(
      pool.query(
        "DELETE FROM yunipals_arena.tournament_identity WHERE deployment=$1",
        [deployment]
      ),
      (e: unknown) =>
        !!e && typeof e === "object" && "code" in e && e.code === "23503"
    );
    const opened = {
      id: `${deployment}:${tx}:0`,
      blockNumber: "1",
      blockHash: block,
      transactionHash: tx,
      logIndex: 0
    };
    function observation(blockHash: Hex): NativeArenaObservation & {
      tournament: NonNullable<NativeArenaObservation["tournament"]>;
    } {
      const origin = { ...opened, blockHash };
      return {
        releaseId,
        sourceId: `arena:${deployment}`,
        indexedThroughBlock: "1",
        observedThroughBlock: "1",
        tournament: {
          deployment,
          id: "1",
          state,
          opened: origin,
          last: origin,
          inputFrozen: null,
          incarnation: manifestDigest({
            deployment,
            tournamentId: "1",
            openedEventId: origin.id,
            openedBlockHash: blockHash
          })
        }
      };
    }
    const observed = observation(block);
    await assert.rejects(
      transaction(pool, (db) => adoptLegacyTournamentIdentity(db, observed)),
      /fenced native/
    );
    await pool.query(
      "UPDATE yunipals_arena.deployment SET indexer_mode='unified',halted=true WHERE id=$1",
      [deployment]
    );
    await assert.rejects(
      transaction(pool, (db) => registerTournamentIdentity(db, observed)),
      /explicit origin adoption/
    );
    await assert.rejects(
      transaction(pool, (db) =>
        adoptLegacyTournamentIdentity(db, observation(hash("f")))
      ),
      /does not match/
    );
    const projector = await pool.connect();
    try {
      await projector.query("SELECT pg_advisory_lock(hashtext($1))", [
        `arena/project/${deployment}`
      ]);
      await assert.rejects(
        transaction(pool, async (db) => {
          await db.query("SET LOCAL lock_timeout='50ms'");
          return adoptLegacyTournamentIdentity(db, observed);
        }),
        (e: unknown) =>
          !!e && typeof e === "object" && "code" in e && e.code === "55P03"
      );
    } finally {
      await projector.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `arena/project/${deployment}`
      ]);
      projector.release();
    }
    const adopted = await transaction(pool, (db) =>
      adoptLegacyTournamentIdentity(db, observed)
    );
    assert.equal(
      (
        await transaction(pool, (db) =>
          adoptLegacyTournamentIdentity(db, observed)
        )
      ).incarnation,
      adopted.incarnation
    );
    assert.equal(adopted.cipher_context, `${deployment}/1`);
    for (const table of arenaPrivateTables)
      assert.equal(
        (
          await pool.query(
            `SELECT incarnation FROM yunipals_arena.${table} WHERE deployment=$1`,
            [deployment]
          )
        ).rows[0].incarnation,
        observed.tournament.incarnation
      );
    const stored = (
      await pool.query(
        "SELECT ciphertext FROM yunipals_arena.submission WHERE deployment=$1",
        [deployment]
      )
    ).rows[0].ciphertext;
    assert.equal(stored, originalCiphertext);
    assert.deepEqual(cipher.open(`${adopted.cipher_context}/seat/0`, stored), {
      text: "Retained private strategy"
    });
    const replacement = observation(hash("f"));
    const next = await transaction(pool, (db) =>
      registerTournamentIdentity(db, replacement)
    );
    assert.notEqual(next.incarnation, adopted.incarnation);
    assert.notEqual(next.cipher_context, adopted.cipher_context);
    await pool.query(
      "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation) VALUES($1,1,0,$2,$3,'0x12',$4,$5)",
      [
        deployment,
        owner,
        hash("3"),
        cipher.seal(`${next.cipher_context}/seat/0`, {
          text: "New incarnation"
        }),
        next.incarnation
      ]
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.submission WHERE deployment=$1",
          [deployment]
        )
      ).rows[0].n,
      2
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO yunipals_arena.media_job(deployment,tournament_id) VALUES($1,2)",
        [deployment]
      ),
      /Legacy Arena writes are fenced/
    );
    await assert.rejects(
      pool.query(
        "UPDATE yunipals_arena.tournament_identity SET opened_block_hash=$2 WHERE deployment=$1 AND incarnation=$3",
        [deployment, hash("0"), adopted.incarnation]
      ),
      /immutable/
    );
    let calls = 0;
    await assert.rejects(
      projectFinalizedArena(
        pool,
        {
          getBlock: async () => {
            calls++;
            throw new Error("Unexpected RPC");
          }
        } as unknown as PublicClient,
        { id: deployment, contract, startBlock: 1n }
      ),
      /projection is fenced/
    );
    assert.equal(calls, 0);
    const checksum = (
      await pool.query(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=1"
      )
    ).rows[0].checksum;
    try {
      await pool.query(
        "UPDATE yunipals_arena.operational_migration SET checksum=repeat('f',64) WHERE version=1"
      );
      await assert.rejects(migrateArena(pool), /checksum changed/);
    } finally {
      await pool.query(
        "UPDATE yunipals_arena.operational_migration SET checksum=$1 WHERE version=1",
        [checksum]
      );
    }
  } finally {
    for (const table of arenaPrivateTables)
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    await pool.query(
      "DELETE FROM yunipals_arena.chain_event WHERE deployment=$1",
      [deployment]
    );
    await pool.query(
      "DELETE FROM yunipals_arena.tournament WHERE deployment=$1",
      [deployment]
    );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
    await pool.end();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { migrateArena } from "./schema";
import { json, projectEvent, type ArenaEvent } from "./projection";
import { planArenaRecovery, applyArenaRecovery } from "./recovery";
import { projectConfirmedArena } from "./projector";

const pool = new pg.Pool({
  connectionString:
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena",
  max: 2,
  connectionTimeoutMillis: 2000
});
const contract = "0x1111111111111111111111111111111111111111" as Address;
const player = "0x2222222222222222222222222222222222222222" as Address;
const h = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const deployments: string[] = [];
const directories: string[] = [];
before(async () => {
  await migrateArena(pool);
});
after(async () => {
  for (const id of deployments) {
    for (const table of [
      "client_transaction",
      "capacity",
      "media_job",
      "adjudication",
      "transaction_intent",
      "provider_task",
      "fighter_snapshot",
      "frozen_input",
      "submission",
      "admission",
      "credit",
      "tournament",
      "chain_event"
    ])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [id]
      );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [id]);
  }
  await pool.end();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const id = `recovery-${randomUUID()}`;
  deployments.push(id);
  const directory = await mkdtemp("/tmp/yunipals-recovery-test-");
  directories.push(directory);
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,cursor,cursor_hash,halted,halt_reason,finalized_at) VALUES($1,$2,10,12,$3,true,'confirmed_history_changed',now())",
    [id, contract, h("b")]
  );
  let logIndex = 0;
  const event = async (
    name: string,
    block: bigint,
    args: Record<string, unknown>
  ) => {
    const db = await pool.connect();
    try {
      await projectEvent(db, id, {
        eventName: name,
        blockNumber: block,
        blockHash: h("b"),
        transactionHash: h("c"),
        logIndex: logIndex++,
        args
      });
    } finally {
      db.release();
    }
  };
  const opening = { id: 1n, rulesHash: h("1"), poolHash: h("2"), deadline: 0n };
  await event("TournamentOpened", 10n, opening);
  await event("TournamentTreasuryAssigned", 10n, {
    id: 1n,
    beneficiary: contract
  });
  await event("Entered", 11n, {
    id: 1n,
    seat: 0,
    player,
    nftChainId: 8453n,
    collection: contract,
    tokenId: 11n
  });
  await event("TournamentExpired", 12n, { id: 1n });
  await pool.query(
    "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,state) VALUES($1,$2,$3,$4,'indexed')",
    [
      id,
      h("d"),
      player,
      json({ kind: "entry", tournamentId: "1", tokenId: "11" })
    ]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.capacity VALUES($1,'{}',now())",
    [id]
  );
  let headHash = h("a"),
    logsRead = 0;
  const canonicalLog = {
    address: contract,
    blockNumber: 10n,
    blockHash: h("a"),
    transactionHash: h("e"),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: arenaAbi,
      eventName: "TournamentOpened",
      args: { id: 1n }
    }),
    data: encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
      [opening.rulesHash, opening.poolHash, 0n]
    )
  };
  const rpc = {
    async getChainId() {
      return 8453;
    },
    async getBlock(options: { blockNumber?: bigint; blockTag?: string }) {
      return {
        number: options.blockNumber ?? 17n,
        hash: options.blockNumber === 14n ? headHash : h("a"),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    },
    async getLogs(options: { fromBlock: bigint; toBlock: bigint }) {
      assert.ok(options.toBlock - options.fromBlock < 500n);
      logsRead++;
      return options.fromBlock <= 10n && options.toBlock >= 10n
        ? [canonicalLog]
        : [];
    },
    async getTransactionReceipt() {
      throw new Error("orphaned transaction");
    }
  } as unknown as PublicClient;
  return {
    id,
    rpc,
    directory,
    event,
    deployment: { id, contract, startBlock: 10n },
    changeHead() {
      headHash = h("f");
    },
    logsRead: () => logsRead
  };
}

test("reviewed recovery rolls back orphaned seats/refund credits, rechecks client effects and resumes only after catchup", async () => {
  const f = await fixture();
  const plan = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.summary.rpcLogRanges, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT state->>'phase' AS phase FROM yunipals_arena.tournament WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].phase,
    "expired"
  );
  await assert.rejects(
    applyArenaRecovery(pool, f.rpc, plan, "wrong", f.directory + "/wrong.json"),
    /reviewed plan/
  );
  const result = await applyArenaRecovery(
    pool,
    f.rpc,
    plan,
    plan.hash,
    f.directory + "/archive.json"
  );
  assert.equal(result.status, "recovered-awaiting-catchup");
  const state = (
    await pool.query(
      "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1",
      [f.id]
    )
  ).rows[0].state;
  assert.equal(state.phase, "open");
  assert.deepEqual(state.seats, []);
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM yunipals_arena.credit WHERE deployment=$1",
        [f.id]
      )
    ).rowCount,
    0
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM yunipals_arena.client_transaction WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].state,
    "submitted"
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM yunipals_arena.capacity WHERE deployment=$1",
        [f.id]
      )
    ).rowCount,
    0
  );
  const before = (
    await pool.query(
      "SELECT halted,finalized_at FROM yunipals_arena.deployment WHERE id=$1",
      [f.id]
    )
  ).rows[0];
  assert.equal(before.halted, false);
  assert.equal(before.finalized_at, null);
  const archive = JSON.parse(
    await readFile(f.directory + "/archive.json", "utf8")
  );
  assert.equal(archive.source.credit[0].amount, "2000000");
  assert.equal((await stat(f.directory + "/archive.json")).mode & 0o777, 0o600);
  assert.equal(
    (await projectConfirmedArena(pool, f.rpc, f.deployment)).status,
    "caught-up"
  );
  assert.ok(
    (
      await pool.query(
        "SELECT finalized_at FROM yunipals_arena.deployment WHERE id=$1",
        [f.id]
      )
    ).rows[0].finalized_at
  );
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      plan,
      plan.hash,
      f.directory + "/again.json"
    ),
    /halted deployment/
  );
});

test("locked orphaned strategies stay encrypted and fenced instead of being erased or silently reassigned", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext) VALUES($1,1,0,$2,$3,'0x','encrypted-retained')",
    [f.id, player, h("3")]
  );
  const plan = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  assert.ok(plan.issues.includes("locked-strategy-context-changed:1:0"));
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      plan,
      plan.hash,
      f.directory + "/archive.json"
    ),
    /unreconciled work/
  );
  assert.equal(
    (
      await pool.query(
        "SELECT ciphertext FROM yunipals_arena.submission WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].ciphertext,
    "encrypted-retained"
  );
  assert.equal(
    (
      await pool.query(
        "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
        [f.id]
      )
    ).rows[0].halted,
    true
  );
});

test("already revealed input and paid film dependencies must remain exactly canonical", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE yunipals_arena.tournament SET state=state||$2::jsonb WHERE deployment=$1",
    [
      f.id,
      json({
        inputHash: h("4"),
        resultHash: h("5"),
        commitments: [h("6"), h("6"), h("6"), h("6")]
      })
    ]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.frozen_input VALUES($1,1,$2,'retained-ciphertext',now())",
    [f.id, h("4")]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,request,reserved_microusd) VALUES($1,1,'video','sf1',$2,'completed','{}',100000)",
    [f.id, randomUUID()]
  );
  const plan = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  assert.ok(plan.issues.includes("revealed-input-orphaned:1"));
  assert.ok(plan.issues.includes("paid-input-context-changed:1"));
  assert.ok(plan.issues.includes("paid-film-result-changed:1"));
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      plan,
      plan.hash,
      f.directory + "/archive.json"
    ),
    /unreconciled/
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].state,
    "completed"
  );
});

test("signed transaction disappearance requires reconciliation and never triggers a new broadcast", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,state) VALUES($1,'expire',1,$2,0,'0x',$3,'confirmed')",
    [f.id, contract, h("7")]
  );
  const plan = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  assert.ok(
    plan.issues.includes("signed-transaction-needs-reconciliation:expire:1")
  );
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      plan,
      plan.hash,
      f.directory + "/archive.json"
    ),
    /unreconciled/
  );
});

test("changed source or canonical head refuses a stale plan without unfencing", async () => {
  const f = await fixture();
  const plan = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  await pool.query(
    "UPDATE yunipals_arena.client_transaction SET state='delayed' WHERE deployment=$1",
    [f.id]
  );
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      plan,
      plan.hash,
      f.directory + "/archive.json"
    ),
    /records changed/
  );
  const updated = await planArenaRecovery(pool, f.rpc, f.deployment, 100);
  f.changeHead();
  await assert.rejects(
    applyArenaRecovery(
      pool,
      f.rpc,
      updated,
      updated.hash,
      f.directory + "/archive.json"
    ),
    /head changed/
  );
  assert.equal(
    (
      await pool.query(
        "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
        [f.id]
      )
    ).rows[0].halted,
    true
  );
});

test("explicit RPC scan bounds and the existing halt are mandatory", async () => {
  const f = await fixture();
  await assert.rejects(
    planArenaRecovery(pool, f.rpc, f.deployment, 2),
    /RPC bound/
  );
  assert.equal(f.logsRead(), 0);
  await pool.query(
    "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
    [f.id]
  );
  await assert.rejects(
    planArenaRecovery(pool, f.rpc, f.deployment, 100),
    /already halted/
  );
  assert.equal(f.logsRead(), 0);
});

test("canonical revealed strategies, paid tasks, payout/claim credits and large NFT IDs survive a checkpoint recovery", async () => {
  const f = await fixture();
  for (const table of ["credit", "tournament", "chain_event"])
    await pool.query(
      `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
      [f.id]
    );
  const commitment = h("6"),
    inputHash = h("4"),
    resultHash = h("5"),
    videoHash = h("9");
  const raw: { eventName: string; args: Record<string, unknown> }[] = [
    {
      eventName: "TournamentOpened",
      args: { id: 1n, rulesHash: h("1"), poolHash: h("2"), deadline: 0n }
    },
    {
      eventName: "TournamentTreasuryAssigned",
      args: { id: 1n, beneficiary: contract }
    },
    ...[0, 1, 2, 3].map((seat) => ({
      eventName: "Entered",
      args: {
        id: 1n,
        seat,
        player,
        nftChainId: 8453n,
        collection: contract,
        tokenId: BigInt(11 + seat)
      }
    })),
    { eventName: "IslandRequested", args: { id: 1n, requestId: 1n, cost: 1n } },
    {
      eventName: "RandomnessReceived",
      args: { id: 1n, requestId: 1n, word: 123n }
    },
    {
      eventName: "IslandSelected",
      args: { id: 1n, islandId: 1122, ticket: 1696, beneficiary: player }
    },
    {
      eventName: "StrategiesOpened",
      args: { id: 1n, deadline: BigInt(Math.floor(Date.now() / 1000) + 86400) }
    },
    {
      eventName: "InputFrozen",
      args: {
        id: 1n,
        inputHash,
        strategyCommitments: [commitment, commitment, commitment, commitment],
        deadline: BigInt(Math.floor(Date.now() / 1000) + 86400)
      }
    },
    {
      eventName: "ResultSettled",
      args: {
        id: 1n,
        resultHash,
        semifinalOneWinner: 0,
        semifinalTwoWinner: 2,
        champion: 0
      }
    },
    { eventName: "PayoutsReleased", args: { id: 1n, videoHash } },
    {
      eventName: "Claimed",
      args: { player, recipient: player, amount: 6400000n }
    }
  ];
  const events: ArenaEvent[] = raw.map((event, index) => ({
    ...event,
    blockNumber: 10n,
    blockHash: h("a"),
    transactionHash: h("e"),
    logIndex: index
  }));
  const db = await pool.connect();
  try {
    for (const event of events) {
      await projectEvent(db, f.id, event);
      if (event.eventName === "StrategiesOpened") {
        for (let seat = 0; seat < 4; seat++)
          await db.query(
            "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext) VALUES($1,1,$2,$3,$4,'0x','retained-encrypted-strategy')",
            [f.id, seat, player, commitment]
          );
        await db.query(
          "INSERT INTO yunipals_arena.frozen_input VALUES($1,1,$2,'retained-encrypted-input',NULL)",
          [f.id, inputHash]
        );
      }
    }
  } finally {
    db.release();
  }
  await pool.query(
    "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,request,reserved_microusd,actual_microusd) VALUES($1,1,'video','sf1',$2,'completed','{}',100000,80000)",
    [f.id, randomUUID()]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,state,film_sha256) VALUES($1,1,'published',$2)",
    [f.id, videoHash]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,input_hash,outcome_hash,candidate,validation,state,winners) VALUES($1,1,$2,$3,'{}','{}','valid','[0,2,0]')",
    [f.id, inputHash, resultHash]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,state,receipt) VALUES($1,'release-payouts',1,$2,0,'0x',$3,'confirmed','{\"status\":\"success\"}')",
    [f.id, contract, h("e")]
  );
  const largeToken = (2n ** 200n + 17n).toString();
  await pool.query(
    "INSERT INTO yunipals_arena.admission VALUES($1,1,$2,8453,$3,$4,10,$5,999999999999999999,'0x')",
    [f.id, player, contract, largeToken, h("a")]
  );
  const canonical = events.map((event) => {
    const definition = arenaAbi.find(
      (item) => item.type === "event" && item.name === event.eventName
    ) as AbiEvent;
    const fields = definition.inputs.filter((input) => !input.indexed);
    return {
      address: contract,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      removed: false,
      topics: encodeEventTopics({
        abi: [definition],
        eventName: definition.name,
        args: event.args
      }),
      data: encodeAbiParameters(
        fields,
        fields.map((input) => event.args[input.name!])
      )
    };
  });
  const rpc = {
    getChainId: f.rpc.getChainId,
    getBlock: f.rpc.getBlock,
    getLogs: async () => canonical,
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 10n,
      blockHash: h("a")
    })
  } as unknown as PublicClient;
  const before = (
    await pool.query(
      "SELECT revealed_at FROM yunipals_arena.frozen_input WHERE deployment=$1",
      [f.id]
    )
  ).rows[0].revealed_at;
  const plan = await planArenaRecovery(pool, rpc, f.deployment, 100);
  assert.deepEqual(plan.issues, []);
  await applyArenaRecovery(
    pool,
    rpc,
    plan,
    plan.hash,
    f.directory + "/archive.json"
  );
  const state = (
    await pool.query(
      "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1",
      [f.id]
    )
  ).rows[0].state;
  assert.equal(state.inputHash, inputHash);
  assert.equal(state.resultHash, resultHash);
  assert.equal(state.videoHash, videoHash);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT wallet,amount::text FROM yunipals_arena.credit WHERE deployment=$1 ORDER BY wallet",
        [f.id]
      )
    ).rows,
    [
      { wallet: contract, amount: "1600000" },
      { wallet: player, amount: "0" }
    ]
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state,actual_microusd::text FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].actual_microusd,
    "80000"
  );
  assert.equal(
    (
      await pool.query(
        "SELECT revealed_at FROM yunipals_arena.frozen_input WHERE deployment=$1",
        [f.id]
      )
    ).rows[0].revealed_at.getTime(),
    before.getTime()
  );
  assert.equal(
    (
      await pool.query(
        "SELECT ciphertext FROM yunipals_arena.submission WHERE deployment=$1",
        [f.id]
      )
    ).rowCount,
    4
  );
  const archive = JSON.parse(
    await readFile(f.directory + "/archive.json", "utf8")
  );
  assert.equal(archive.source.admission[0].token_id, largeToken);
  assert.equal(archive.source.admission[0].expiry, "999999999999999999");
});

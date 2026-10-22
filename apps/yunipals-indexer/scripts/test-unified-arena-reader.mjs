import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  toHex
} from "viem";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import { readArenaTournament } from "../../../packages/yunipals-indexer-server/src/arena.ts";
import {
  readArenaCredit,
  readArenaTournamentIds
} from "../../../packages/yunipals-indexer-server/src/arena.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import { applyArenaEvent } from "../lib/arena/state.ts";
import { arenaAbi } from "../../../packages/yunipals-market-core/src/arenaAbi.ts";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString);
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const pool = new pg.Pool({ connectionString, max: 3 });
const schema = "unified_ownership_test",
  rebuildSchema = "unified_arena_reader_rebuild_test";
const hash = (number, branch = false) =>
  toHex(8453n * 10n ** 18n + number + (branch ? 10n ** 15n : 0n), { size: 32 });
const checkpoint = (number) =>
  `0000001000${"8453".padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const stringify = (value) =>
  JSON.stringify(value, (_, value) =>
    typeof value === "bigint" ? String(value) : value
  );

try {
  const releaseId = (
    await pool.query(
      "SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1",
      [schema]
    )
  ).rows[0]?.id;
  assert.ok(
    releaseId,
    "Run the ownership fixture with UNIFIED_TEST_ARENA_ENABLED=true."
  );
  const reader = await createIndexerReader(pool, { releaseId });
  const source = reader.release.manifest.sources.find(
    (source) => source.feature === "arena" && source.enabled
  );
  assert.ok(
    source,
    "Run the ownership fixture with UNIFIED_TEST_ARENA_ENABLED=true."
  );
  const definition = {
    contract: source.address,
    startBlock: source.startBlock,
    abiHash: source.abiHash
  };
  const deployment = `8453:${source.address}`;
  let head = BigInt(
    (
      await pool.query(
        "SELECT head_number FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=8453",
        [releaseId]
      )
    ).rows[0].head_number
  );
  const openingBlock = head;
  let fork = null;
  const blockHash = (number) => hash(number, fork !== null && number >= fork);
  const rpc = {
    providerId: "local-native-arena-test",
    chainId: async () => 8453,
    block: async (tag) => {
      const number =
        tag === "latest" ? head : tag === "finalized" ? head - 30n : tag;
      return {
        number,
        hash: blockHash(number),
        parentHash: blockHash(number - 1n),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    }
  };
  async function advance(observe = true) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    await pool.query(
      `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
      [String(Date.now())]
    );
    await pool.query(
      `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1 WHERE chain_id=8453`,
      [checkpoint(head)]
    );
    for (let number = head - 50n; number <= head; number++)
      await pool.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,8453,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET block_hash=$3,parent_hash=$4,timestamp=$5`,
        [
          `8453:${number}`,
          String(number),
          blockHash(number),
          blockHash(number - 1n),
          timestamp
        ]
      );
    await pool.query(
      `UPDATE ${schema}.chain_checkpoint SET block_number=$1,block_hash=$2,parent_hash=$3,timestamp=$4 WHERE chain_id=8453`,
      [String(head), blockHash(head), blockHash(head - 1n), timestamp]
    );
    if (observe)
      assert.equal(
        await observeIndexerChain(pool, reader.release, 8453, rpc),
        "observed"
      );
  }
  async function event(name, args, number, transactionHash, logIndex) {
    const item = arenaAbi.find(
      (item) => item.type === "event" && item.name === name
    );
    assert.ok(item);
    const nonIndexed = item.inputs.filter((input) => !input.indexed);
    const topics = encodeEventTopics({ abi: arenaAbi, eventName: name, args });
    const data = encodeAbiParameters(
      nonIndexed,
      nonIndexed.map((input) => args[input.name])
    );
    const decoded = decodeEventLog({
      abi: arenaAbi,
      topics,
      data,
      strict: true
    });
    assert.equal(decoded.eventName, name);
    assert.deepEqual(
      JSON.parse(stringify(decoded.args)),
      JSON.parse(stringify(args))
    );
    const id = `8453:${source.address}:${transactionHash}:${logIndex}`;
    await pool.query(
      `INSERT INTO ${schema}.canonical_event
      (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data)
      VALUES($1,$2,8453,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13)`,
      [
        id,
        source.id,
        source.address,
        name,
        stringify(args),
        source.abiHash,
        String(number),
        blockHash(number),
        "1000",
        transactionHash,
        logIndex,
        JSON.stringify(topics),
        data
      ]
    );
    return { id, blockHash: blockHash(number), number };
  }
  const openingArgs = {
    id: 1n,
    deadline: 0n,
    rulesHash: hash(1n),
    poolHash: hash(2n)
  };
  let state = applyArenaEvent(null, "TournamentOpened", openingArgs).state;
  const openTx = hash(1001n),
    entryTx = hash(1002n),
    player = `0x${"34".repeat(20)}`;
  let opened = await event("TournamentOpened", openingArgs, head, openTx, 0);
  let last = await event(
    "TournamentTreasuryAssigned",
    { id: 1n, beneficiary: player },
    head,
    openTx,
    1
  );
  state = applyArenaEvent(state, "TournamentTreasuryAssigned", {
    id: 1n,
    beneficiary: player
  }).state;
  async function store() {
    await pool.query(
      `INSERT INTO ${schema}.arena_tournament
      (id,deployment,tournament_id,state,opened_event_id,opened_block_hash,last_event_id,block_number,block_hash)
      VALUES($1,$2,'1',$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET state=$3,opened_event_id=$4,
      opened_block_hash=$5,last_event_id=$6,block_number=$7,block_hash=$8`,
      [
        `${deployment}:1`,
        deployment,
        JSON.stringify(state),
        opened.id,
        opened.blockHash,
        last.id,
        String(last.number),
        last.blockHash
      ]
    );
  }
  await store();
  let result = await readArenaTournament(reader, definition, "1");
  assert.equal(result.tournament.state.phase, "open");
  assert.equal(result.tournament.last.blockNumber, String(head));
  const originalIncarnation = result.tournament.incarnation;
  const { NativeArenaSource } = await import(
    "../../yunipals-market-api/src/arena/live/nativeSource.ts"
  );
  const appSource = new NativeArenaSource(
    pool,
    releaseId,
    source.address,
    BigInt(source.startBlock)
  );
  assert.equal(
    (await appSource.read("1")).tournament.incarnation,
    originalIncarnation
  );
  assert.deepEqual((await appSource.work()).ids, ["1"]);
  const transaction = await appSource.transaction(openTx, {
    tournamentId: "1",
    blockNumber: head,
    blockHash: blockHash(head)
  });
  assert.equal(transaction.inclusion, "canonical");
  assert.equal(transaction.origin.incarnation, originalIncarnation);
  assert.ok(
    transaction.events.some((event) => event.name === "TournamentOpened")
  );
  const quietNumber = head - 1n,
    quietHash = blockHash(quietNumber),
    quietTx = hash(90000n);
  assert.equal(
    (
      await appSource.transaction(quietTx, {
        blockNumber: quietNumber,
        blockHash: quietHash
      })
    ).inclusion,
    "canonical"
  );
  const quietWitness = (
    await pool.query(
      `DELETE FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 RETURNING *`,
      [String(quietNumber)]
    )
  ).rows[0];
  assert.equal(
    (
      await appSource.transaction(quietTx, {
        blockNumber: quietNumber,
        blockHash: quietHash
      })
    ).inclusion,
    "expired"
  );
  await pool.query(
    `INSERT INTO ${schema}.chain_block SELECT * FROM json_populate_record(NULL::${schema}.chain_block,$1::json)`,
    [JSON.stringify(quietWitness)]
  );
  let builtApplicationInspector = "not requested";
  if (process.env.UNIFIED_TEST_ARENA_APP_BUILD === "true") {
    const run = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../yunipals-market-api/dist/arena-native-inspect.mjs",
            import.meta.url
          )
        ),
        "1"
      ],
      {
        env: {
          ...process.env,
          ARENA_INDEXER_MODE: "unified",
          ARENA_INDEXER_DATABASE_URL: connectionString,
          ARENA_INDEXER_RELEASE_ID: releaseId,
          ARENA_CONTRACT: source.address,
          ARENA_DEPLOYMENT_BLOCK: source.startBlock
        },
        timeout: 15000
      }
    );
    const inspection = JSON.parse(run.stdout);
    assert.equal(inspection.event, "native_arena_public_observation");
    assert.equal(inspection.tournament.incarnation, originalIncarnation);
    builtApplicationInspector = "passed";
  }
  await pool.query(
    `UPDATE ${schema}.arena_tournament SET state=jsonb_set(state,'{deadline}','"0"'::jsonb) WHERE deployment=$1`,
    [deployment]
  );
  await assert.rejects(appSource.read("1"), /unsupported shape/);
  await store();
  await assert.rejects(
    readArenaTournament(reader, definition, "1", {
      requiredThroughBlock: head + 1n
    }),
    /still indexing/
  );
  await assert.rejects(
    readArenaTournament(reader, { ...definition, abiHash: hash(999n) }, "1"),
    /differs/
  );

  // Full-block Ponder state is available immediately, including before the next
  // bounded observer poll. There is no extra three/five-block Arena mirror.
  head++;
  await advance(false);
  const entered = {
    id: 1n,
    seat: 0,
    player,
    nftChainId: 8453n,
    collection: player,
    tokenId: 1n
  };
  await event("Entered", entered, head, entryTx, 0);
  state = applyArenaEvent(state, "Entered", entered).state;
  const started = { id: 1n, deadline: 1234n };
  last = await event("JoinWindowStarted", started, head, entryTx, 1);
  state = applyArenaEvent(state, "JoinWindowStarted", started).state;
  await store();
  result = await readArenaTournament(reader, definition, "1", {
    requiredThroughBlock: head,
    expectedIncarnation: originalIncarnation
  });
  assert.equal(result.indexedThroughBlock, String(head));
  assert.equal(result.observedThroughBlock, String(head - 1n));
  assert.equal(result.tournament.state.seats.length, 1);

  const saved = (
    await pool.query(`SELECT * FROM ${schema}.canonical_event WHERE id=$1`, [
      last.id
    ])
  ).rows[0];
  await pool.query(`DELETE FROM ${schema}.canonical_event WHERE id=$1`, [
    last.id
  ]);
  await assert.rejects(
    readArenaTournament(reader, definition, "1"),
    /evidence is incomplete/
  );
  await pool.query(
    `INSERT INTO ${schema}.canonical_event SELECT * FROM json_populate_record(NULL::${schema}.canonical_event,$1::json)`,
    [JSON.stringify(saved)]
  );

  // Simulate the source tables after native rollback; no private records or
  // second Arena projection participate in this reader.
  await pool.query(
    `DELETE FROM ${schema}.arena_tournament WHERE deployment=$1`,
    [deployment]
  );
  await pool.query(`DELETE FROM ${schema}.canonical_event WHERE source_id=$1`, [
    source.id
  ]);
  fork = openingBlock;
  await advance();
  assert.equal(
    (await readArenaTournament(reader, definition, "1")).tournament,
    null
  );
  await assert.rejects(
    readArenaTournament(reader, definition, "1", {
      expectedIncarnation: originalIncarnation
    }),
    /no longer canonical/
  );
  head++;
  await advance();
  opened = await event("TournamentOpened", openingArgs, head, openTx, 0);
  last = await event(
    "TournamentTreasuryAssigned",
    { id: 1n, beneficiary: player },
    head,
    openTx,
    1
  );
  state = applyArenaEvent(
    applyArenaEvent(null, "TournamentOpened", openingArgs).state,
    "TournamentTreasuryAssigned",
    { id: 1n, beneficiary: player }
  ).state;
  await store();
  result = await readArenaTournament(reader, definition, "1");
  assert.notEqual(result.tournament.incarnation, originalIncarnation);
  await assert.rejects(
    appSource.read("1", { expectedIncarnation: originalIncarnation }),
    /incarnation changed/
  );
  assert.equal(
    (await appSource.read("1")).tournament.incarnation,
    result.tournament.incarnation
  );
  await assert.rejects(
    readArenaTournament(reader, definition, "1", {
      expectedIncarnation: originalIncarnation
    }),
    /incarnation changed/
  );

  // Rebuilding a release over the same canonical opening preserves identity.
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [rebuildSchema]
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [rebuildSchema]
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.release WHERE physical_schema=$1",
    [rebuildSchema]
  );
  await pool.query(`DROP SCHEMA IF EXISTS ${rebuildSchema} CASCADE`);
  await pool.query(`CREATE SCHEMA ${rebuildSchema}`);
  for (const table of [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "canonical_event",
    "chain_checkpoint",
    "chain_block",
    "arena_tournament",
    "arena_seat",
    "arena_credit"
  ]) {
    await pool.query(
      `CREATE TABLE ${rebuildSchema}.${table}(LIKE ${schema}.${table} INCLUDING ALL)`
    );
    await pool.query(
      `INSERT INTO ${rebuildSchema}.${table} SELECT * FROM ${schema}.${table}`
    );
  }
  const rebuilt = await registerIndexerRelease(pool, {
    schema: rebuildSchema,
    buildId: reader.release.buildId,
    manifest: reader.release.manifest
  });
  const statuses = (
    await pool.query(
      "SELECT * FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
      [releaseId]
    )
  ).rows;
  for (const status of statuses)
    await pool.query(
      `INSERT INTO yunipals_indexer_control.chain_status
    SELECT * FROM json_populate_record(NULL::yunipals_indexer_control.chain_status,$1::json)`,
      [JSON.stringify({ ...status, release_id: rebuilt.id })]
    );
  const newReader = await createIndexerReader(pool, { releaseId: rebuilt.id });
  assert.notEqual(newReader.release.id, reader.release.id);
  assert.equal(
    (await readArenaTournament(newReader, definition, "1")).tournament
      .incarnation,
    result.tournament.incarnation
  );
  const phaseTx = hash(3000n);
  let phaseLog = 2;
  async function transition(name, args) {
    last = await event(name, args, head, phaseTx, phaseLog++);
    state = applyArenaEvent(state, name, args).state;
  }
  for (let seat = 0; seat < 4; seat++)
    await transition("Entered", {
      id: 1n,
      seat,
      player,
      nftChainId: 8453n,
      collection: player,
      tokenId: BigInt(seat + 1)
    });
  await transition("IslandRequested", { id: 1n, requestId: 1n, cost: 0n });
  await transition("RandomnessReceived", { id: 1n, requestId: 1n, word: 42n });
  await transition("IslandSelected", {
    id: 1n,
    islandId: 17,
    ticket: 42,
    beneficiary: player
  });
  await transition("StrategiesOpened", { id: 1n, deadline: 1234n });
  const frozenArgs = {
    id: 1n,
    inputHash: hash(4000n),
    strategyCommitments: [hash(4001n), hash(4002n), hash(4003n), hash(4004n)],
    deadline: 2345n
  };
  await transition("InputFrozen", frozenArgs);
  await store();
  assert.equal(
    (await readArenaTournament(reader, definition, "1")).tournament.inputFrozen
      .id,
    last.id
  );
  const frozenRecord = (
    await pool.query(`SELECT * FROM ${schema}.canonical_event WHERE id=$1`, [
      last.id
    ])
  ).rows[0];
  await pool.query(`UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`, [
    last.id,
    stringify({ ...frozenArgs, inputHash: hash(9999n) })
  ]);
  await assert.rejects(
    readArenaTournament(reader, definition, "1"),
    /frozen input evidence disagrees/
  );
  await pool.query(`UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`, [
    last.id,
    frozenRecord.args
  ]);
  await transition("TournamentExpired", { id: 1n });
  await store();
  assert.deepEqual((await appSource.work()).ids, []);
  await pool.query(
    `INSERT INTO ${schema}.arena_credit(id,deployment,wallet,amount,last_event_id,block_number,block_hash)
    VALUES($1,$2,$3,8000000,$4,$5,$6)`,
    [
      `${deployment}:${player}`,
      deployment,
      player,
      last.id,
      String(head),
      last.blockHash
    ]
  );
  assert.equal(
    (await readArenaCredit(reader, definition, player)).amount,
    "8000000"
  );
  assert.equal((await appSource.credit(player)).amount, "8000000");
  assert.equal(
    (await readArenaCredit(reader, definition, `0x${"56".repeat(20)}`)).amount,
    "0"
  );
  assert.deepEqual(
    (await readArenaTournamentIds(reader, definition, { wallet: player })).ids,
    ["1"]
  );
  assert.deepEqual((await appSource.list(`0x${"56".repeat(20)}`)).ids, []);
  await pool.query(`UPDATE ${schema}.arena_credit SET block_hash=$1`, [
    hash(9999n)
  ]);
  await assert.rejects(
    readArenaCredit(reader, definition, player),
    /inclusion disagree/
  );
  await pool.query(`UPDATE ${schema}.arena_credit SET block_hash=$1`, [
    last.blockHash
  ]);
  const expired = (
    await pool.query(
      `DELETE FROM ${schema}.canonical_event WHERE id=$1 RETURNING *`,
      [last.id]
    )
  ).rows[0];
  await assert.rejects(
    readArenaCredit(reader, definition, player),
    /proof is incomplete/
  );
  await pool.query(
    `INSERT INTO ${schema}.canonical_event SELECT * FROM json_populate_record(NULL::${schema}.canonical_event,$1::json)`,
    [JSON.stringify(expired)]
  );
  for (const args of ["{", "[]", "null"]) {
    await pool.query(
      `UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`,
      [last.id, args]
    );
    await assert.rejects(
      readArenaCredit(reader, definition, player),
      (error) =>
        error.name !== "SyntaxError" && /payload is invalid/.test(error.message)
    );
  }
  await pool.query(`UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`, [
    last.id,
    expired.args
  ]);
  const claim = await event(
    "Claimed",
    { player, recipient: player, amount: 500000n },
    head,
    hash(5000n),
    phaseLog++
  );
  await pool.query(
    `UPDATE ${schema}.arena_credit SET amount=7500000,last_event_id=$1,block_number=$2,block_hash=$3`,
    [claim.id, String(head), claim.blockHash]
  );
  assert.equal(
    (await readArenaCredit(reader, definition, player)).amount,
    "7500000"
  );
  assert.equal(
    (
      await appSource.transaction(claim.id.split(":")[2], {
        blockNumber: head,
        blockHash: hash(99999n)
      })
    ).inclusion,
    "changed"
  );
  const future = await event(
    "Claimed",
    { player, recipient: player, amount: 1n },
    head + 1n,
    hash(5001n),
    0
  );
  await pool.query(
    `UPDATE ${schema}.arena_credit SET amount=7499999,last_event_id=$1,block_number=$2,block_hash=$3`,
    [future.id, String(head + 1n), future.blockHash]
  );
  await assert.rejects(
    readArenaCredit(reader, definition, player),
    /complete indexing coverage/
  );
  const partial = await appSource.transaction(hash(5001n), {
    blockNumber: head + 1n,
    blockHash: future.blockHash
  });
  assert.equal(partial.inclusion, "not_indexed");
  assert.deepEqual(partial.events, []);
  head++;
  await advance(false);
  assert.equal(
    (await readArenaCredit(reader, definition, player)).amount,
    "7499999"
  );
  const emptied = await event(
    "Claimed",
    { player, recipient: player, amount: 7499999n },
    head,
    hash(5002n),
    1
  );
  await pool.query(
    `UPDATE ${schema}.arena_credit SET amount=0,last_event_id=$1,block_number=$2,block_hash=$3`,
    [emptied.id, String(head), emptied.blockHash]
  );
  assert.equal((await readArenaCredit(reader, definition, player)).amount, "0");
  console.log(
    JSON.stringify({
      event: "unified_native_arena_reader_verified",
      builtApplicationInspector,
      checks: [
        "latest complete state without added block delay",
        "next full block before observer poll; explicit required-block coverage",
        "missing event proof rejected",
        "orphaned origin and changed incarnation rejected",
        "canonical identity survives source release rebuild",
        "market application adapter uses native public state and rejects malformed shapes",
        "native freeze proof, canonical credit anchors, list scopes and partial-block rejection",
        "no second Arena projector or private record access"
      ]
    })
  );
} finally {
  await pool.end();
}

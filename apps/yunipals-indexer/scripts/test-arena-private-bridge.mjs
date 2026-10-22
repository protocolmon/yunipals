import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { Socket } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  verifyMessage,
  verifyTypedData
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// This is a handler/private-worker bridge, NOT a Ponder RPC synchronization test.
// No provider config, HTTP client, wallet transport, process or persistent DB.
const root = new URL("../../../", import.meta.url);
const registry = new URL(
  "./fixtures/arena-private-registry.mjs",
  import.meta.url
);
registerHooks({
  resolve(specifier, context, next) {
    if (["ponder:schema", "ponder:registry"].includes(specifier))
      return { url: registry.href, shortCircuit: true };
    if (
      specifier.startsWith("@/") &&
      context.parentURL?.includes("yunipals-market-api/")
    )
      return next(
        new URL("apps/yunipals-market-api/src/" + specifier.slice(2), root)
          .href,
        context
      );
    return next(specifier, context);
  }
});
const fetchBefore = globalThis.fetch;
let forbiddenNetworkCalls = 0;
globalThis.fetch = async () => {
  forbiddenNetworkCalls++;
  throw new Error("Network forbidden in Arena bridge.");
};
const envBefore = { ...process.env };
for (const key of Object.keys(process.env))
  if (
    /^(ARENA_|UNIFIED_|PONDER_ISLANDS_ONLY$|PONDER_BOOSTERS_ONLY$|BOOSTER_|MARKET_BNB_DISCOVERY_)/.test(
      key
    )
  )
    delete process.env[key];
Object.assign(process.env, {
  ARENA_CONTRACT: `0x${"12".repeat(20)}`,
  ARENA_DEPLOYMENT_BLOCK: "100",
  UNIFIED_BASE_ISLANDS_V2_ENABLED: "false"
});

const { callbacks, default: schema } = await import(
  "./fixtures/arena-private-registry.mjs"
);
await import("../src/arena.ts");
const { seedChainSources, sourceManifest } = await import(
  "../lib/unified/handlers.ts"
);
const { migrateIndexerControl } = await import(
  "../lib/unified/control-schema.ts"
);
const { registerIndexerRelease } = await import("../lib/unified/releases.ts");
const { observeIndexerChain } = await import("../lib/unified/observer.ts");
const { migrateArena } = await import(
  "../../yunipals-market-api/src/arena/live/schema.ts"
);
const { ArenaIntake } = await import(
  "../../yunipals-market-api/src/arena/live/intake.ts"
);
const { StrategyCipher } = await import(
  "../../yunipals-market-api/src/arena/live/crypto.ts"
);
const { NativeArenaSource } = await import(
  "../../yunipals-market-api/src/arena/live/nativeSource.ts"
);
const { NativeArenaDisclosure } = await import(
  "../../yunipals-market-api/src/arena/live/nativeDisclosure.ts"
);
const { createAdmission } = await import(
  "../../yunipals-market-api/src/arena/live/admission.ts"
);
const { verifyNativeArenaAction } = await import(
  "../../yunipals-market-api/src/arena/live/nativeAction.ts"
);
const { arenaAbi } = await import(
  "../../../packages/yunipals-market-core/src/arenaAbi.ts"
);
const { arenaDomain, ARENA_STRATEGY_TYPES, strategyCommitment } = await import(
  "../../../packages/yunipals-market-core/src/arena.ts"
);
const entry = import.meta.resolve("ponder");
const { encodeCheckpoint, blockToCheckpoint } = await import(
  new URL("./utils/checkpoint.js", entry)
);
const connectBefore = Socket.prototype.connect;
Socket.prototype.connect = function () {
  forbiddenNetworkCalls++;
  throw new Error("Socket transport forbidden in Arena bridge.");
};
const sourceDb = new PGlite(),
  privateDb = new PGlite();
function poolFor(db) {
  const query = async (text, values) => {
    const result = values?.length
      ? await db.query(text, values)
      : (await db.exec(text)).at(-1);
    return {
      ...result,
      rowCount: result.rows.length || result.affectedRows || 0
    };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}
const sourcePool = poolFor(sourceDb),
  privatePool = poolFor(privateDb);
const orm = drizzle(sourceDb);
const adapter = {
  find: async (table, key) =>
    (
      await orm
        .select()
        .from(table)
        .where(and(...Object.entries(key).map(([k, v]) => eq(table[k], v))))
        .limit(1)
    )[0] ?? null,
  insert: (table) => ({
    values: (row) => ({
      then: (resolve, reject) =>
        orm.insert(table).values(row).then(resolve, reject),
      onConflictDoNothing: () =>
        orm.insert(table).values(row).onConflictDoNothing(),
      onConflictDoUpdate: (values) =>
        orm
          .insert(table)
          .values(row)
          .onConflictDoUpdate({ target: table.id, set: values })
    })
  })
};
const contract = process.env.ARENA_CONTRACT,
  deployment = `8453:${contract}`;
const physical = "arena_private_bridge",
  buildId = "handler-private-fixture-v1";
const accounts = [1, 2, 3, 4, 5].map((n) =>
  privateKeyToAccount(`0x${String(n).repeat(64)}`)
);
const collection = "0x98433df878e8c898cb907345c3a7756e5f72240f";
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const zero = hash(0),
  zeroAddress = `0x${"0".repeat(40)}`;
const now = Math.floor(Date.now() / 1000),
  deadline = now + 3600;
let branch = 0,
  pointMismatch = false,
  dispatches = 0,
  pointVerifications = 0,
  signatures = 0;
const blockHash = (n) =>
  hash(BigInt(n) + (branch && BigInt(n) >= 101n ? 100000n : 0n));
const block = (n) => ({
  number: n,
  hash: blockHash(n),
  parentHash: blockHash(n - 1n),
  timestamp: BigInt(now)
});
const checkpoint = (n) =>
  encodeCheckpoint(
    blockToCheckpoint(
      { number: `0x${n.toString(16)}`, timestamp: `0x${now.toString(16)}` },
      8453,
      "up"
    )
  );
let release, source, service, report;
const checks = [];
async function coverage(n = 200n) {
  await sourcePool.query(
    `UPDATE ${physical}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
    [String(Date.now())]
  );
  await sourcePool.query(
    `UPDATE ${physical}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1 WHERE chain_id=8453`,
    [checkpoint(n)]
  );
  await orm
    .insert(schema.chainCheckpoint)
    .values({
      id: "8453",
      chainId: 8453,
      blockNumber: n,
      blockHash: blockHash(n),
      parentHash: blockHash(n - 1n),
      timestamp: BigInt(now)
    })
    .onConflictDoUpdate({
      target: schema.chainCheckpoint.id,
      set: {
        blockNumber: n,
        blockHash: blockHash(n),
        parentHash: blockHash(n - 1n)
      }
    });
  assert.equal(
    await observeIndexerChain(sourcePool, release, 8453, {
      providerId: "in-memory-points",
      chainId: async () => 8453,
      block: async (tag) =>
        block(tag === "latest" ? 200n : tag === "finalized" ? 100n : tag)
    }),
    "observed"
  );
}
async function dispatch(name, args, number, tx = number) {
  const abiItem = arenaAbi.find(
    (item) => item.type === "event" && item.name === name
  );
  assert.ok(abiItem, name);
  const topics = encodeEventTopics({ abi: arenaAbi, eventName: name, args });
  const parameters = abiItem.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(
    parameters,
    parameters.map((input) => args[input.name])
  );
  const decoded = decodeEventLog({ abi: arenaAbi, topics, data, strict: true });
  const handler = callbacks.get(`YunipalsArena:${name}`);
  assert.ok(handler, name);
  await sourceDb.exec("BEGIN");
  try {
    await handler({
      event: {
        args: decoded.args,
        block: block(number),
        transaction: { hash: hash(tx), transactionIndex: 0 },
        log: { address: contract, logIndex: 0, topics, data }
      },
      context: { db: adapter, chain: { id: 8453 } }
    });
    await sourceDb.exec("COMMIT");
    dispatches++;
  } catch (error) {
    await sourceDb.exec("ROLLBACK");
    throw error;
  }
}
async function opening() {
  await dispatch(
    "TournamentOpened",
    { id: 1n, deadline: 0n, rulesHash: hash(999), poolHash: hash(998) },
    101n
  );
  await dispatch(
    "TournamentTreasuryAssigned",
    { id: 1n, beneficiary: accounts[4].address },
    102n
  );
  await dispatch(
    "JoinWindowStarted",
    { id: 1n, deadline: BigInt(deadline) },
    103n
  );
}
async function roster() {
  for (let seat = 0; seat < 4; seat++)
    await dispatch(
      "Entered",
      {
        id: 1n,
        seat,
        player: accounts[seat].address,
        nftChainId: 8453n,
        collection,
        tokenId: BigInt(seat + 1)
      },
      104n + BigInt(seat)
    );
  await dispatch("IslandRequested", { id: 1n, requestId: 7n, cost: 0n }, 108n);
  await dispatch(
    "RandomnessReceived",
    { id: 1n, requestId: 7n, word: 42n },
    109n
  );
  await dispatch(
    "IslandSelected",
    { id: 1n, islandId: 17n, ticket: 42n, beneficiary: accounts[4].address },
    110n
  );
  await dispatch(
    "StrategiesOpened",
    { id: 1n, deadline: BigInt(deadline) },
    111n
  );
}
async function liveState() {
  return (await source.read("1")).tournament.state;
}
const pointCalls = [];
const client = {
  getChainId: async () => 8453,
  getBlock: async (request) => {
    pointCalls.push(request);
    const n = request.blockNumber ?? 200n;
    return {
      ...block(n),
      hash: pointMismatch && n === 115n ? hash(987654) : blockHash(n)
    };
  },
  readContract: async (request) => {
    if (request.functionName === "ownerOf") return accounts[0].address;
    if (request.functionName === "entriesPaused") return false;
    const state = await liveState();
    if (request.functionName === "automaticStrategyMask")
      return state.automaticStrategyMask ?? 0;
    assert.equal(request.functionName, "tournament");
    return {
      phase: { open: 1, strategies: 2, resolving: 3, settled: 4, expired: 5 }[
        state.phase
      ],
      count: state.seats.length,
      deadline: BigInt(state.deadline),
      inputHash: state.inputHash ?? zero,
      resultHash: state.resultHash ?? zero,
      requestId: BigInt(state.requestId ?? 0),
      randomnessReceived: state.randomWord !== null,
      randomWord: BigInt(state.randomWord ?? 0),
      islandId: Number(state.islandId ?? 0),
      islandBeneficiary: state.islandBeneficiary ?? zeroAddress,
      treasuryBeneficiary: state.treasury ?? zeroAddress
    };
  }
};
const forceDue = () =>
  privatePool.query(
    "UPDATE yunipals_arena.frozen_input SET native_check_at='epoch' WHERE deployment=$1",
    [deployment]
  );
const privateRows = async () =>
  (
    await privatePool.query(
      "SELECT incarnation,input_hash,ciphertext,revealed_event_id,revealed_block_hash,revealed_at FROM yunipals_arena.frozen_input WHERE deployment=$1 ORDER BY incarnation",
      [deployment]
    )
  ).rows;

try {
  // Only columns/PKs needed by this handler are generated from the actual schema.
  await sourceDb.exec(
    `CREATE SCHEMA ${physical}; SET search_path=${physical},public`
  );
  for (const table of [
    schema.indexerSource,
    schema.canonicalEvent,
    schema.arenaTournament,
    schema.arenaSeat,
    schema.arenaCredit,
    schema.chainBlock,
    schema.chainCheckpoint
  ]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(
      (column) =>
        `"${column.name}" ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${column.primary ? " PRIMARY KEY" : ""}`
    );
    await sourceDb.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
  }
  await sourceDb.exec(
    `CREATE TABLE _ponder_meta(key text PRIMARY KEY,value jsonb NOT NULL); CREATE TABLE _ponder_checkpoint(chain_id bigint PRIMARY KEY,chain_name text,latest_checkpoint varchar(75),safe_checkpoint varchar(75),finalized_checkpoint varchar(75))`
  );
  await sourcePool.query("INSERT INTO _ponder_meta VALUES('app',$1)", [
    {
      version: "6",
      build_id: buildId,
      heartbeat_at: Date.now(),
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    }
  ]);
  await sourcePool.query(
    "INSERT INTO _ponder_checkpoint VALUES(8453,'base',$1,$1,$1)",
    [checkpoint(200n)]
  );
  for (let n = 100n; n <= 200n; n++)
    await orm
      .insert(schema.chainBlock)
      .values({
        id: `8453:${n}`,
        chainId: 8453,
        blockNumber: n,
        blockHash: blockHash(n),
        parentHash: blockHash(n - 1n),
        timestamp: BigInt(now)
      });
  for (const id of [1, 56, 137, 8453])
    await seedChainSources({ db: adapter, chain: { id } });
  await migrateIndexerControl(sourcePool);
  release = await registerIndexerRelease(sourcePool, {
    schema: physical,
    buildId,
    manifest: sourceManifest
  });
  await coverage();
  await migrateArena(privatePool);
  await privatePool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,100,'unified')",
    [deployment, contract]
  );
  source = new NativeArenaSource(sourcePool, release.id, contract, 100n);
  service = new ArenaIntake(
    privatePool,
    deployment,
    contract,
    "https://fixture.invalid",
    new StrategyCipher(randomBytes(32)),
    { message: verifyMessage, strategy: verifyTypedData },
    source
  );
  const worker = new NativeArenaDisclosure(service, async (observed) => {
    pointVerifications++;
    await verifyNativeArenaAction(client, observed);
  });
  const signer = {
    ...accounts[4],
    signTypedData: async (input) => {
      signatures++;
      return accounts[4].signTypedData(input);
    }
  };
  const admit = createAdmission(
    service,
    signer,
    new Map([[8453, client]]),
    async () => ({ fixtureOnlyIdentity: true })
  );
  const nft = { nftChainId: 8453, collection, tokenId: "1" };
  await opening();
  const first = await source.read("1");
  assert.equal(first.tournament.state.phase, "open");
  const incarnation = first.tournament.incarnation;
  const permit = await admit("1", accounts[0].address, { ...nft, incarnation });
  await admit("1", accounts[0].address, { ...nft, incarnation });
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.admission"
      )
    ).rows[0].n,
    1
  );
  assert.equal(
    await verifyTypedData({
      address: accounts[4].address,
      domain: arenaDomain(contract),
      types: (
        await import("../../../packages/yunipals-market-core/src/arena.ts")
      ).ARENA_ENTRY_TYPES,
      primaryType: "EntryPermit",
      message: {
        tournamentId: 1n,
        player: accounts[0].address,
        nftChainId: 8453n,
        collection,
        tokenId: 1n,
        expiry: BigInt(permit.expiry)
      },
      signature: permit.signature
    }),
    true
  );
  assert.ok(
    pointCalls
      .filter((call) => call.blockTag)
      .every((call) => call.blockTag === "latest")
  );
  checks.push(
    "ABI-decoded canonical handler data passes actual shared/native readers and signed admission; replay retains one permit row"
  );
  await roster();
  const submissions = [];
  for (let seat = 0; seat < 4; seat++) {
    const text = `Private fixture strategy ${seat}`,
      salt = hash(seat + 11),
      commitment = strategyCommitment(contract, 1n, seat, text, salt);
    const signature = await accounts[seat].signTypedData({
      domain: arenaDomain(contract),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 1n, seat, commitment }
    });
    submissions.push({ seat, text, salt, signature, incarnation });
    await service.submit("1", accounts[seat].address, submissions[seat]);
    await service.submit("1", accounts[seat].address, submissions[seat]);
  }
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.submission"
      )
    ).rows[0].n,
    4
  );
  const buildInput = (state, strategies) => ({
    fixtureOnly: true,
    id: state.id,
    strategies
  });
  const prepared = await service.prepareInput("1", buildInput, incarnation);
  await service.prepareInput("1", buildInput, incarnation);
  const encrypted = (await privateRows())[0].ciphertext;
  assert.equal((await service.publicView("1")).strategies, null);
  await forceDue();
  assert.deepEqual(await worker.tick(), {
    checked: 1,
    revealed: 0,
    waiting: 1,
    unavailable: 0
  });
  assert.equal((await privateRows())[0].revealed_at, null);
  assert.equal(pointVerifications, 0);
  checks.push(
    "Repeated signed submissions/input preparation retain one encrypted bundle; disclosure waits for exact canonical InputFrozen"
  );
  await dispatch(
    "InputFrozen",
    {
      id: 1n,
      inputHash: prepared.inputHash,
      strategyCommitments: prepared.commitments,
      deadline: BigInt(deadline)
    },
    115n
  );
  await coverage(114n);
  await forceDue();
  assert.deepEqual(await worker.tick(), {
    checked: 1,
    revealed: 0,
    waiting: 0,
    unavailable: 1
  });
  assert.equal((await privateRows())[0].revealed_at, null);
  await coverage();
  pointMismatch = true;
  await forceDue();
  assert.deepEqual(await worker.tick(), {
    checked: 1,
    revealed: 0,
    waiting: 0,
    unavailable: 1
  });
  assert.equal((await privateRows())[0].revealed_at, null);
  pointMismatch = false;
  await forceDue();
  assert.deepEqual(await worker.tick(), {
    checked: 1,
    revealed: 1,
    waiting: 0,
    unavailable: 0
  });
  const revealed = (await privateRows())[0];
  assert.equal(revealed.ciphertext, encrypted);
  assert.equal(revealed.revealed_block_hash, blockHash(115n));
  assert.equal((await service.publicView("1")).strategies.length, 4);
  const verifies = pointVerifications;
  await forceDue();
  assert.deepEqual(await worker.tick(), {
    checked: 1,
    revealed: 1,
    waiting: 0,
    unavailable: 0
  });
  assert.equal(pointVerifications, verifies);
  assert.deepEqual((await privateRows())[0], revealed);
  checks.push(
    "Incomplete coverage and changed point inclusion refuse disclosure; matching proof reveals once without replacing ciphertext or duplicate verification"
  );
  // Model replacement source rows, NOT the actual Ponder rollback engine.
  await sourceDb.exec(
    "DELETE FROM arena_seat; DELETE FROM arena_tournament; DELETE FROM canonical_event"
  );
  branch = 1;
  await sourcePool.query(
    "UPDATE chain_block SET block_hash=$1,parent_hash=$2 WHERE block_number=200",
    [blockHash(200n), blockHash(199n)]
  );
  await coverage();
  await opening();
  const replacement = (await source.read("1")).tournament.incarnation;
  assert.notEqual(replacement, incarnation);
  const signedBefore = signatures;
  await assert.rejects(
    admit("1", accounts[0].address, { ...nft, incarnation }),
    /opening changed/
  );
  assert.equal(signatures, signedBefore);
  await admit("1", accounts[0].address, { ...nft, incarnation: replacement });
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.admission"
      )
    ).rows[0].n,
    2
  );
  await roster();
  assert.equal((await service.publicView("1")).strategies, null);
  await assert.rejects(
    service.submit("1", accounts[0].address, {
      ...submissions[0],
      incarnation: replacement
    }),
    /fresh strategy/
  );
  assert.deepEqual((await privateRows())[0], revealed);
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.tournament_identity"
      )
    ).rows[0].n,
    2
  );
  checks.push(
    "Replacement opening refuses stale admission/signature reuse and old disclosure while retaining immutable private origin and ciphertext history"
  );
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.provider_task"
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await privatePool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.transaction_intent"
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await sourcePool.query(
        "SELECT count(*)::int AS n FROM yunipals_indexer_control.active_release"
      )
    ).rows[0].n,
    0
  );
  assert.equal(forbiddenNetworkCalls, 0);
  report = {
    format: "yunipals-arena-handler-private-bridge-v1",
    passed: true,
    checks,
    dispatches,
    registeredCallbacks: callbacks.size,
    admissionSignatures: signatures,
    pointVerifications,
    providerCalls: 0,
    persistentDatabasesCreated: 0,
    actualPonderRpcSynchronization: false,
    actualPonderReorg: false,
    fixtureBuildId: buildId
  };
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      error: error.message,
      code: error.code ?? null
    })
  );
} finally {
  await sourceDb.close();
  await privateDb.close();
  globalThis.fetch = fetchBefore;
  Socket.prototype.connect = connectBefore;
  for (const key of Object.keys(process.env))
    if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
}
if (!report) process.exit(1);
console.log(JSON.stringify(report, null, 2));

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  arenaDomain,
  ARENA_ENTRY_TYPES,
  ARENA_STRATEGY_TYPES,
  strategyCommitment
} from "@protopals/yunipals-market-core/arena";
import { createArenaRpcFixture } from "../../yunipals-indexer/scripts/fixtures/arena-rpc-postgres-current-local.mjs";
import { migrateArena } from "../src/arena/live/schema.ts";
import { ArenaIntake } from "../src/arena/live/intake.ts";
import { createAdmission } from "../src/arena/live/admission.ts";
import { StrategyCipher } from "../src/arena/live/crypto.ts";
import { ArenaClientTransactions } from "../src/arena/live/clientTransactions.ts";
import { NativeArenaSource } from "../src/arena/live/nativeSource.ts";
import { selectedArenaRuntimeSource } from "../src/arena/live/selectedSourceRuntime.ts";
import { NativeArenaControl } from "../src/arena/live/nativeControl.ts";
import { NativeArenaSettlement } from "../src/arena/live/nativeSettlement.ts";
import { NativeArenaDisclosure } from "../src/arena/live/nativeDisclosure.ts";
import { verifyNativeArenaAction } from "../src/arena/live/nativeAction.ts";
import { ArenaCapacity } from "../src/arena/live/capacity.ts";
import {
  ArenaIdentities,
  loadIdentityProfiles
} from "../src/arena/live/identity.ts";
import {
  ArenaInputCompiler,
  onchainIslandDraw
} from "../src/arena/live/input.ts";
import { loadLiveArenaCatalog } from "../src/arena/live/catalog.ts";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "../src/arena/live/adjudication.ts";
import { NativeArenaProvider } from "../src/arena/live/nativeProvider.ts";
import { NativeArenaReferee } from "../src/arena/live/nativeReferee.ts";
import { ArenaRefereeApi } from "../src/arena/live/refereeApi.ts";
import { verifyMediaLifecycle } from "../src/arena/live/mediaVerification.ts";
import { verifyNativeArenaFilm } from "../src/arena/live/mediaAdoption.ts";
import { mediaFolder, mediaIncarnation } from "../src/arena/live/mediaPaths.ts";
import { canonicalJson, sha256 } from "../src/arena/draw.ts";
import { transaction } from "../src/db/pool.ts";
import { arenaPrivateTables } from "../src/arena/live/identitySchema.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpc = "http://127.0.0.1:55446";
const sourceUrl = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(sourceUrl, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const sourceGuard = new URL(sourceUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(sourceGuard.hostname));
assert.equal(sourceGuard.pathname, "/yunipals_ponder_dependency_test");
assert.equal(sourceGuard.search, "");
const operationalUrl =
  process.env.ARENA_TEST_DATABASE_URL ??
  "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
const operationalGuard = new URL(operationalUrl);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(operationalGuard.hostname)
);
assert.equal(operationalGuard.pathname, "/arena");
assert.equal(operationalGuard.search, "");
const pool = new pg.Pool({ connectionString: operationalUrl, max: 6 });
const client = createPublicClient({
  chain: { ...base, fees: { maxPriorityFeePerGas: 1000000n } },
  cacheTime: 0,
  transport: http(rpc, { retryCount: 0, timeout: 15000 })
});
const accounts = Array.from({ length: 6 }, (_, addressIndex) =>
  mnemonicToAccount(
    process.env.ARENA_FIXTURE_MNEMONIC,
    { addressIndex }
  )
);
const wallets = accounts.map((account) =>
  createWalletClient({
    account,
    chain: base,
    cacheTime: 0,
    transport: http(rpc, { retryCount: 0, timeout: 15000 })
  })
);
const catalog = loadLiveArenaCatalog(root),
  profiles = loadIdentityProfiles(root),
  cipher = new StrategyCipher(randomBytes(32));
const fixture = JSON.parse(
  await readFile(
    join(
      root,
      "apps/yunipals-market-api/src/arena/live/fixtures/pilot-input.json"
    ),
    "utf8"
  )
);
let candidate = JSON.parse(
  await readFile(
    join(
      root,
      "apps/yunipals-market-api/src/arena/live/fixtures/pilot-outcome.json"
    ),
    "utf8"
  )
);
let source, deployment;
const storage = await mkdtemp(join(process.env.TMPDIR, "arena-storage-"));
let minedTransactions = 0;
let compilerVersion;
const verifiedSources = new Set();
async function localRpc(method, params = []) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const value = await response.json();
  assert.equal(value.error, undefined, JSON.stringify(value.error));
  return value.result;
}
async function receipt(hash) {
  const value = await client.waitForTransactionReceipt({
    hash,
    pollingInterval: 20
  });
  assert.equal(value.status, "success");
  minedTransactions++;
  return value;
}
async function deploy(file, name, args = []) {
  const artifact = JSON.parse(
    await readFile(
      join(root, `contracts/arena/out/${file}/${name}.json`),
      "utf8"
    )
  );
  assert.ok(artifact.metadata?.compiler?.version);
  compilerVersion = artifact.metadata.compiler.version;
  for (const [name, info] of Object.entries(artifact.metadata.sources)) {
    assert.ok(
      name.endsWith(".sol") &&
        !name.startsWith("/") &&
        !name.split("/").includes("..")
    );
    assert.equal(
      keccak256(await readFile(join(root, "contracts/arena", name))),
      info.keccak256,
      `Stale Solidity artifact: ${name}`
    );
    verifiedSources.add(name);
  }
  const value = await receipt(
    await wallets[0].deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args
    })
  );
  return {
    address: value.contractAddress,
    abi: artifact.abi,
    block: value.blockNumber
  };
}
async function write(target, functionName, args = [], wallet = 0) {
  return receipt(
    await wallets[wallet].writeContract({ ...target, functionName, args })
  );
}
try {
  assert.match(String(await localRpc("web3_clientVersion")), /anvil/i);
  assert.equal(await client.getChainId(), 8453);
  await localRpc("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]);
  await migrateArena(pool);
  const wrapper = await deploy("YunipalsArena.t.sol", "MockWrapper"),
    islands = await deploy("YunipalsArena.t.sol", "MockNft"),
    currency = await deploy("YunipalsArena.t.sol", "MockCurrency");
  const arena = await deploy("YunipalsArena.sol", "YunipalsArena", [
    {
      admin: accounts[0].address,
      lobbyOperator: accounts[0].address,
      admissionSigner: accounts[4].address,
      referee: accounts[4].address,
      treasury: accounts[0].address,
      islands: islands.address,
      vrfWrapper: wrapper.address,
      paymentToken: currency.address,
      entryFee: 2000000n,
      winnerBps: 7500,
      islandBps: 500,
      joinWindow: 604800,
      strategyWindow: 86400,
      resolutionWindow: 86400,
      maxVrfCost: 100000000000000n,
      rulesHash: catalog.rulesHash
    }
  ]);
  const chainArena = { address: arena.address, abi: arenaAbi };
  deployment = `8453:${arena.address.toLowerCase()}`;
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,$3,'unified')",
    [deployment, arena.address.toLowerCase(), String(arena.block)]
  );
  source = await createArenaRpcFixture({
    connectionString: sourceUrl,
    client,
    contract: arena.address,
    startBlock: arena.block
  });
  const initialEpoch = randomUUID(), initialReview = "0x" + sha256("current-genuine-initial-selected-source"), initialHead = await client.getBlock({blockTag:"latest"});
  await transaction(pool,async db=>{
    await db.query("UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",[deployment]);
    const review={previous:null,target:{kind:"unified",sourceId:source.release.id},accepted:{block:String(initialHead.number),hash:initialHead.hash}};
    await db.query("INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review) VALUES($1,$2,$3,$4)",[initialEpoch,deployment,initialReview,JSON.stringify(review)]);
    await db.query("INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash) VALUES($1,$2,'unified',$3,$4,$5,$6)",[deployment,initialEpoch,source.release.id,String(initialHead.number),initialHead.hash,initialReview]);
    await db.query("UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",[deployment]);
  });
  const initialBinding={epoch:initialEpoch,kind:"unified",sourceId:source.release.id};
  const nativeSource = new NativeArenaSource(
    source.readPool,
    source.release.id,
    arena.address,
    arena.block
  );
  const service = new ArenaIntake(
    pool,
    deployment,
    arena.address,
    "https://www.yunipals.com",
    cipher,
    {
      message: (input) => client.verifyMessage(input),
      strategy: (input) => client.verifyTypedData(input)
    },
    nativeSource,
    initialBinding
  );
  let metadataCalls = 0;
  const identities = new ArenaIdentities(
    pool,
    deployment,
    profiles,
    async (nft) => {
      metadataCalls++;
      const fighter = fixture.roster.find((f) => f.tokenId === nft.tokenId),
        profile = profiles.find((p) => p.image === fighter.image);
      assert.ok(profile);
      return {
        token: {
          chain: "ethereum",
          chain_id: nft.nftChainId,
          contract_address: nft.collection,
          token_id: nft.tokenId,
          image: profile.image,
          attributes: [
            { trait_type: "Type", value: profile.species },
            { trait_type: "Color", value: profile.color },
            { trait_type: "Horn", value: profile.horn }
          ]
        }
      };
    },
    (id) => transaction(pool, (db) => service.tournamentContext(id, db, true))
  );
  const compiler = new ArenaInputCompiler(service, catalog, identities),
    capacity = new ArenaCapacity(pool, deployment, service);
  await capacity.save({
    runwareMicrousd: 10000000,
    openaiBudgetMicrousd: 10000000,
    openaiBudgetExpiresAt: Date.now() + 86400000,
    vrfAvailableWei: "1000000000000000",
    vrfQuoteWei: "1000000000000",
    vrfMaxWei: "10000000000000",
    refereeGasWei: "1000000000000000",
    operatorGasWei: "1000000000000000",
    diskFreeBytes: 10000000000
  });
  const lobby = new NativeArenaControl(
    service,
    compiler,
    client,
    accounts[0],
    100000000000000n,
    capacity
  );
  const control = new NativeArenaControl(
    service,
    compiler,
    client,
    accounts[4],
    100000000000000n,
    capacity,
    storage
  );
  const settlement = new NativeArenaSettlement(
    service,
    client,
    accounts[4],
    100000000000000n
  );
  const disclosure = new NativeArenaDisclosure(service, (observed) =>
    verifyNativeArenaAction(client, observed)
  );
  await receipt(
    await wallets[0].sendTransaction({
      to: arena.address,
      value: 10000000000000000n
    })
  );
  await write(arena, "setEntriesPaused", [false]);
  await source.sync();
  await service.ready();
  const openingSnapshot = await localRpc("evm_snapshot"),
    beforeOpening = await client.getBlock();
  const opening = await lobby.prepare("open-lobby", "1");
  assert.equal(opening.incarnation, null);
  await lobby.advanceIntent(opening);
  const firstOpening = await receipt(opening.tx_hash);
  const firstOpeningBlock = await client.getBlock({
    blockNumber: firstOpening.blockNumber
  });
  await source.sync();
  const firstAccepted = await lobby.advanceIntent(opening);
  assert.equal(firstAccepted.state, "confirmed");
  assert.equal(firstAccepted.receipt_finalized, false);
  assert.equal(
    await client.getBlockNumber({ cacheTime: 0 }),
    firstOpening.blockNumber,
    "Acceptance must not mine additional confirmation blocks"
  );
  const firstOrigin = (await service.tournamentContext("1")).incarnation;
  await source.pauseForReorg();
  assert.equal(await localRpc("evm_revert", [openingSnapshot]), true);
  await source.rewind(beforeOpening.number, { expectedObservation: "waiting" });
  await assert.rejects(nativeSource.read("1"), /source unavailable/);
  await localRpc("evm_setNextBlockTimestamp", [
    Number(firstOpeningBlock.timestamp) + 1
  ]);
  await localRpc("anvil_mine", ["0x1", "0x0"]);
  await source.sync();
  assert.equal((await nativeSource.read("1")).tournament, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.transaction_intent WHERE action_id=$1",
        [opening.action_id]
      )
    ).rows[0].n,
    1
  );
  await lobby.advanceIntent(opening);
  const secondOpening = await receipt(opening.tx_hash);
  await source.sync();
  assert.notEqual(secondOpening.blockHash, firstOpening.blockHash);
  assert.equal((await lobby.advanceIntent(opening)).state, "confirmed");
  const context = await service.tournamentContext("1");
  assert.notEqual(context.incarnation, firstOrigin);
  assert.equal(
    (
      await nativeSource.transaction(opening.tx_hash, {
        tournamentId: "1",
        blockNumber: firstOpening.blockNumber,
        blockHash: firstOpening.blockHash
      })
    ).inclusion,
    "changed"
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.opening_action_observation WHERE action_id=$1",
        [opening.action_id]
      )
    ).rows[0].n,
    2
  );
  const tracker = new ArenaClientTransactions(service, currency.address);
  const entries = [],
    approvals = [];
  for (let seat = 0; seat < 4; seat++) {
    await write(currency, "mint", [accounts[seat].address, 2000000n]);
    approvals.push(
      await write(currency, "approve", [arena.address, 2000000n], seat)
    );
    const entry = {
      player: accounts[seat].address,
      nftChainId: 1n,
      collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
      tokenId: BigInt(fixture.roster[seat].tokenId)
    };
    await source.sync();
    const ownershipFixture = {
      getBlock: async ({ blockTag }) => {
        assert.equal(blockTag, "finalized");
        return client.getBlock({ blockTag: "latest" });
      },
      readContract: async ({ address, functionName, args }) => {
        assert.equal(address, entry.collection);
        assert.equal(functionName, "ownerOf");
        assert.deepEqual(args, [entry.tokenId]);
        return entry.player;
      }
    };
    const admit = createAdmission(service, accounts[4], new Map([[1, ownershipFixture], [8453, client]]), (id, nft) => identities.ensure(id, nft));
    const request = { nftChainId: 1, collection: entry.collection, tokenId: String(entry.tokenId), incarnation: context.incarnation };
    const admitted = await admit("1", entry.player, request);
    assert.deepEqual(await admit("1", entry.player, request), admitted);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.admission WHERE deployment=$1 AND wallet=$2", [deployment, entry.player.toLowerCase()])).rows[0].n, 1);
    const expiry = BigInt(admitted.expiry), permit = admitted.signature;
    entries.push(await write(arena, "join", [1n, entry, expiry, permit], seat));
    await source.sync();
  }
  const requested = await client.readContract({
    ...chainArena,
    functionName: "tournament",
    args: [1n]
  });
  // Deliberately controlled mock VRF: retain the recorded candidate's terrain
  // while randomizing test-wallet/contract identities; not a randomness test.
  let fixtureWord = 0n;
  while (fixtureWord < 100000n && onchainIslandDraw(arena.address, "1", String(fixtureWord), catalog.pool.entries).tokenId !== fixture.island.tokenId) fixtureWord++;
  assert.ok(fixtureWord < 100000n);
  assert.equal(fixture.island.tokenId, "195");
  await write(wrapper, "fulfill", [requested.requestId, fixtureWord]);
  const draw = onchainIslandDraw(
    arena.address,
    "1",
    String(fixtureWord),
    catalog.pool.entries
  );
  await write(islands, "setOwner", [BigInt(draw.tokenId), accounts[5].address]);
  await source.sync();
  await tracker.register(accounts[0].address, entries[0].transactionHash, {
    kind: "entry",
    tournamentId: "1",
    incarnation: context.incarnation,
    nftChainId: 1,
    collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    tokenId: String(fixture.roster[0].tokenId)
  });
  await tracker.register(accounts[0].address, approvals[0].transactionHash, {
    kind: "approval",
    tournamentId: "1",
    incarnation: context.incarnation
  });
  await tracker.reconcileBatch(client);
  assert.equal(
    (await tracker.read(accounts[0].address, entries[0].transactionHash)).state,
    "indexed"
  );
  assert.equal(
    (await tracker.read(accounts[0].address, approvals[0].transactionHash))
      .state,
    "indexed"
  );

  const entryProof = await nativeSource.transaction(
    entries[0].transactionHash,
    {
      tournamentId: "1",
      blockNumber: entries[0].blockNumber,
      blockHash: entries[0].blockHash
    }
  );
  assert.equal(entryProof.inclusion, "canonical");
  assert.equal(entryProof.origin.incarnation, context.incarnation);
  assert.ok(
    entryProof.events.some(
      (event) => event.name === "Entered" && String(event.args.seat) === "0"
    )
  );
  const approvalProof = await nativeSource.transaction(
    approvals[0].transactionHash,
    { blockNumber: approvals[0].blockNumber, blockHash: approvals[0].blockHash }
  );
  assert.equal(approvalProof.inclusion, "canonical");
  assert.deepEqual(approvalProof.events, []);
  const island = await control.prepare("finalize-island", "1");
  await control.advanceIntent(island);
  await receipt(island.tx_hash);
  await source.sync();
  assert.equal((await control.advanceIntent(island)).state, "confirmed");
  assert.equal((await service.state("1")).phase, "strategies");
  for (const seat of (await service.state("1")).seats)
    await identities.ensure("1", seat);
  const compiledContext = await compiler.context("1");
  assert.equal(compiledContext.ready, true);
  const substitutions = new Map(
    fixture.roster.map((f, seat) => [f.id, compiledContext.roster[seat].id])
  );
  candidate = JSON.parse(JSON.stringify(candidate), (_, value) =>
    typeof value === "string" ? (substitutions.get(value) ?? value) : value
  );
  for (let seat = 0; seat < 4; seat++) {
    const text = fixture.strategies.find(
        (s) => s.fighterId === fixture.roster[seat].id
      ).text,
      salt = `0x${randomBytes(32).toString("hex")}`;
    const commitment = strategyCommitment(arena.address, 1n, seat, text, salt);
    const signature = await accounts[seat].signTypedData({
      domain: arenaDomain(arena.address),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 1n, seat, commitment }
    });
    await service.submit("1", accounts[seat].address, {
      seat,
      text,
      salt,
      signature,
      incarnation: context.incarnation
    });
  }
  const beforeFreeze = await client.getBlock(),
    freezeSnapshot = await localRpc("evm_snapshot");
  const freeze = await control.prepare("freeze-input", "1");
  await control.advanceIntent(freeze);
  const firstFreeze = await receipt(freeze.tx_hash);
  const firstFreezeBlock = await client.getBlock({
    blockNumber: firstFreeze.blockNumber
  });
  await source.sync();
  assert.equal((await control.advanceIntent(freeze)).state, "confirmed");
  assert.equal((await service.publicView("1")).strategies, null);
  await disclosure.tick();
  assert.equal((await service.publicView("1")).strategies.length, 4);
  await source.pauseForReorg();
  assert.equal(await localRpc("evm_revert", [freezeSnapshot]), true);
  await source.rewind(beforeFreeze.number, { expectedObservation: "waiting" });
  await assert.rejects(service.publicView("1"), /source unavailable/);
  await localRpc("evm_setNextBlockTimestamp", [
    Number(firstFreezeBlock.timestamp) + 1
  ]);
  await localRpc("anvil_mine", ["0x1", "0x0"]);
  await source.sync();
  assert.equal((await service.publicView("1")).strategies, null);
  await control.advanceIntent(freeze);
  const secondFreeze = await receipt(freeze.tx_hash);
  await source.sync();
  assert.notEqual(secondFreeze.blockHash, firstFreeze.blockHash);
  assert.equal((await control.advanceIntent(freeze)).state, "confirmed");
  assert.equal((await service.publicView("1")).strategies, null);
  await pool.query(
    "UPDATE yunipals_arena.frozen_input SET native_check_at=now() WHERE deployment=$1",
    [deployment]
  );
  await disclosure.tick();
  assert.equal((await service.publicView("1")).strategies.length, 4);
  const current = await service.tournamentContext("1");
  const saved = (
    await pool.query(
      "SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=1 AND incarnation=$2",
      [deployment, current.incarnation]
    )
  ).rows[0];
  const { input } = cipher.open(
    `${current.cipherContext}/input`,
    saved.ciphertext
  );
  const validation = await productionValidator(root)(input, candidate);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const winners = validation.matches.map((m) =>
    input.roster.findIndex((f) => f.id === m.winnerId)
  );
  assert.deepEqual(winners, [1, 3, 3]);
  const outcomeHash = `0x${sha256(canonicalJson(candidate))}`;
  let stubbedRefereeRequests = 0;
  const providerGuard = new NativeArenaProvider(
    service,
    (observed) => verifyNativeArenaAction(client, observed),
    () => capacity.check(false)
  );
  const refereeApi = new ArenaRefereeApi(
    pool,
    "test-only-not-a-key",
    async (_url, options) => {
      assert.equal(options?.method, "POST");
      assert.equal(String(_url), "https://api.openai.com/v1/responses");
      stubbedRefereeRequests++;
      return new Response(
        JSON.stringify({
          id: "resp_native_anvil",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify(candidate) }
              ]
            }
          ]
        })
      );
    },
    providerGuard
  );
  const adjudicator = new ArenaAdjudicator(
    pool,
    cipher,
    refereeApi,
    refereeSchema(root),
    productionValidator(root)
  );
  const refereeWorker = new NativeArenaReferee(
    service,
    refereeApi,
    adjudicator
  );
  assert.equal((await refereeWorker.tick()).state, "valid");
  assert.equal((await refereeWorker.tick()).state, "waiting");
  assert.equal(stubbedRefereeRequests, 1);
  const adjudication = (
    await pool.query(
      "SELECT * FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=1 AND incarnation=$2",
      [deployment, current.incarnation]
    )
  ).rows[0];
  assert.equal(adjudication.outcome_hash, outcomeHash);
  assert.deepEqual(adjudication.winners, winners);
  const actionEvidence = (
    await pool.query(
      "SELECT evidence FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
      [deployment]
    )
  ).rows[0].evidence;
  assert.equal(actionEvidence.incarnation, current.incarnation);
  assert.equal(actionEvidence.frozenBlockHash, secondFreeze.blockHash);
  const result = await settlement.prepare("1");
  await settlement.advanceIntent(result);
  const resultReceipt = await receipt(result.tx_hash);
  await source.sync();
  const acceptedResult = await settlement.advanceIntent(result);
  assert.equal(acceptedResult.state, "confirmed");
  assert.equal(acceptedResult.receipt_finalized, false);
  assert.equal(
    await client.getBlockNumber({ cacheTime: 0 }),
    resultReceipt.blockNumber
  );
  const mediaReport = await verifyMediaLifecycle(
    pool,
    cipher,
    root,
    deployment,
    undefined,
    { guard: providerGuard, storage }
  );

  async function durablePrivateSnapshot() {
    const rows = {};
    for (const table of [...arenaPrivateTables, "tournament_identity", "provider_action_evidence", "media_publication"]) {
      // Scheduler lease/due timestamps may advance on an idempotent worker
      // tick. Every business field, including ciphertext/UUID/cost/intents and
      // publication evidence, must remain identical.
      const result = await pool.query(`SELECT (to_jsonb(t)-'native_check_at'-'native_check_lease')::text AS value FROM yunipals_arena.${table} t ORDER BY 1`);
      assert.ok(result.rows.length <= 1000);
      rows[table] = result.rows.map(row => row.value);
    }
    return sha256(canonicalJson(rows));
  }
  const privateBeforeRestart = await durablePrivateSnapshot();
  const requestsBeforeRestart = stubbedRefereeRequests;
  const filmPath = join(mediaFolder(join(storage, "published"), deployment, "1", mediaIncarnation(deployment, "1", current)), "film.mp4");
  const filmBeforeRestart = sha256(await readFile(filmPath));
  assert.equal(filmBeforeRestart, mediaReport.film.sha256);
  await source.restart();
  assert.equal(await durablePrivateSnapshot(), privateBeforeRestart);
  assert.equal((await refereeWorker.tick()).state, "waiting");
  await disclosure.tick();
  assert.equal(stubbedRefereeRequests, requestsBeforeRestart);
  assert.equal(await durablePrivateSnapshot(), privateBeforeRestart);
  assert.equal(sha256(await readFile(filmPath)), filmBeforeRestart);
  const actualPonderBuild = source.release.buildId;
  const actualPonderManifest = source.release.manifestHash;

  // Only this owned idle test chain needs a wall-clock refresh after offline
  // media work. Production freshness and earlier zero-confirmation checks stay.
  const fixtureClockBeforeHead = await client.getBlock({ blockTag: "latest" });
  const fixtureClockBeforeWall = Date.now();
  assert.ok(fixtureClockBeforeHead.hash);
  assert.ok(Number.isSafeInteger(Number(fixtureClockBeforeHead.timestamp)));
  const fixtureClockTarget = Math.max(Number(fixtureClockBeforeHead.timestamp) + 1, Math.floor(fixtureClockBeforeWall / 1000));
  assert.ok(fixtureClockTarget - Number(fixtureClockBeforeHead.timestamp) <= 1800);
  await localRpc("evm_setNextBlockTimestamp", [fixtureClockTarget]);
  await localRpc("anvil_mine", ["0x1", "0x0"]);
  await source.sync();
  const fixtureClockAfterHead = await client.getBlock({ blockTag: "latest" });
  const fixtureClockAfterWall = Date.now();
  assert.equal(fixtureClockAfterHead.number, fixtureClockBeforeHead.number + 1n);
  assert.equal(fixtureClockAfterHead.parentHash, fixtureClockBeforeHead.hash);
  assert.equal(fixtureClockAfterHead.timestamp, BigInt(fixtureClockTarget));
  assert.ok(fixtureClockAfterHead.hash);
  assert.ok(Math.abs(Number(fixtureClockAfterHead.timestamp) * 1000 - fixtureClockAfterWall) <= 120000);
  const fixtureClockRefresh = {
    reason: "offline_media_elapsed", blocksMined: 1,
    before: { blockNumber: String(fixtureClockBeforeHead.number), blockHash: fixtureClockBeforeHead.hash,
      timestampSeconds: String(fixtureClockBeforeHead.timestamp), wallMilliseconds: fixtureClockBeforeWall,
      ageMilliseconds: fixtureClockBeforeWall - Number(fixtureClockBeforeHead.timestamp) * 1000 },
    after: { blockNumber: String(fixtureClockAfterHead.number), blockHash: fixtureClockAfterHead.hash,
      timestampSeconds: String(fixtureClockAfterHead.timestamp), wallMilliseconds: fixtureClockAfterWall,
      ageMilliseconds: fixtureClockAfterWall - Number(fixtureClockAfterHead.timestamp) * 1000 },
    targetTimestampSeconds: String(fixtureClockTarget), genuineSourceSyncCompleted: true,
    productionFreshnessWindowMilliseconds: 120000, earlierNoExtraConfirmationAssertionPreserved: true
  };
  const payout = await control.prepare("release-payouts", "1");
  await control.advanceIntent(payout);
  await receipt(payout.tx_hash);
  await source.sync();
  assert.equal((await control.advanceIntent(payout)).state, "confirmed");
  await verifyNativeArenaFilm(
    client,
    (await service.tournamentContext("1")).observation
  );
  for (const [seat, amount] of [
    [3, 6000000n],
    [5, 400000n],
    [0, 1600000n]
  ]) {
    assert.equal(
      BigInt(
        (await nativeSource.credit(accounts[seat].address.toLowerCase())).amount
      ),
      amount
    );
    assert.equal(
      await client.readContract({
        ...chainArena,
        functionName: "claimable",
        args: [accounts[seat].address]
      }),
      amount
    );
    const claimed = await write(arena, "claim", [accounts[seat].address], seat);
    await source.sync();
    await tracker.register(accounts[seat].address, claimed.transactionHash, {
      kind: "claim"
    });
    await tracker.reconcileBatch(client);
    assert.equal(
      (await tracker.read(accounts[seat].address, claimed.transactionHash))
        .state,
      "indexed"
    );
  }
  await source.sync();
  for (const seat of [3, 5, 0])
    assert.equal(
      (await nativeSource.credit(accounts[seat].address.toLowerCase())).amount,
      "0"
    );
  assert.equal(
    await client.readContract({
      ...currency,
      functionName: "balanceOf",
      args: [arena.address]
    }),
    0n
  );
  assert.equal(metadataCalls, 4);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.tournament WHERE deployment=$1",
        [deployment]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.chain_event WHERE deployment=$1",
        [deployment]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_arena.transaction_receipt_history WHERE action_id=$1",
        [freeze.action_id]
      )
    ).rows[0].n,
    2
  );
  // Actual selected-source restart binding using this real Ponder release.
  // The entire operational schema belongs to this isolated fixture and is
  // removed by its caller after all immutable-ledger assertions complete.
  const selectionBlock = await client.getBlock({blockTag:"latest"});
  const selectionEpoch = randomUUID(), selectionReview = "0x" + sha256("current-genuine-source-selection");
  await transaction(pool, async db => {
    await db.query("UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1", [deployment]);
    const review = {previous:{epoch:initialEpoch,kind:"unified",source_id:source.release.id},target:{kind:"unified",sourceId:source.release.id},accepted:{block:String(selectionBlock.number),hash:selectionBlock.hash}};
    await db.query("INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review) VALUES($1,$2,$3,$4)",[selectionEpoch,deployment,selectionReview,JSON.stringify(review)]);
    await db.query("UPDATE yunipals_arena.source_selection SET epoch=$2,kind='unified',source_id=$3,accepted_block=$4,accepted_hash=$5,review_hash=$6 WHERE deployment=$1",[deployment,selectionEpoch,source.release.id,String(selectionBlock.number),selectionBlock.hash,selectionReview]);
    await db.query("UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",[deployment]);
  });
  await assert.rejects(service.ready(), /source epoch changed/);
  const selected = await selectedArenaRuntimeSource({pool,sourcePool:source.readPool,native:{mode:"unified",sourceKind:"unified",releaseId:source.release.id,databaseUrl:sourceUrl},deployment:{id:deployment,contract:arena.address,startBlock:arena.block},base:client});
  const selectedService = new ArenaIntake(pool,deployment,arena.address,"https://www.yunipals.com",cipher,{message:input=>client.verifyMessage(input),strategy:input=>client.verifyTypedData(input)},selected.nativeSource,selected.binding);
  await selectedService.ready();
  await assert.rejects(selectedArenaRuntimeSource({pool,sourcePool:source.readPool,native:{mode:"unified",sourceKind:"unified",releaseId:"0x"+"66".repeat(32),databaseUrl:sourceUrl},deployment:{id:deployment,contract:arena.address,startBlock:arena.block},base:client}), /does not match/);
  const selectedSnapshot = await durablePrivateSnapshot();
  await source.restart();
  await selectedService.ready();
  await new NativeArenaDisclosure(selectedService,observed=>verifyNativeArenaAction(client,observed)).tick();
  assert.equal(await durablePrivateSnapshot(),selectedSnapshot);
  const sourceSelectionRecovery = {fullLifecycleInitiallyBound:true,actualImmutableReview:true,unboundOldActorRefused:true,wrongSourceStartupRefused:true,matchingRestartRecovered:true,privateSnapshotSha256:selectedSnapshot};
  const report = {
    checkedAt: new Date().toISOString(),
    status: "passed",
    chain: "Anvil 8453, loopback only",
    nativeSchema: source.schemaName,
    operationalProjectionRows: 0,
    actualPonderBuild, actualPonderManifest,
    rulesHash:catalog.rulesHash,sourceSelectionRecovery,
    controlledMockVrfWord: String(fixtureWord), pilotIslandTokenId: fixture.island.tokenId,
    privateRestartSnapshotSha256: privateBeforeRestart,
    fixtureClockRefresh,
    realPonderRestartCount: source.processStops.length,
    realPonderForcedStops: source.processStops.filter(row => row.forced).length,
    compilerVersion,
    verifiedSoliditySources: verifiedSources.size,
    arenaRuntimeCodeHash: keccak256(
      await client.getCode({ address: arena.address })
    ),
    minedTransactions,
    metadataLoads: metadataCalls,
    providerRequests: 0,
    stubbedRefereeRequests,
    stubbedMediaRequests: 9,
    mediaFilmSha256: mediaReport.film.sha256,
    mainnetTransactions: 0,
    checks: [
      "real contract and wallet-signed native calls",
      "actual Ponder RPC synchronization, native checkpoints and restart-based reorg recovery",
      "shorter-tip source unavailability and replacement-tip recovery",
      "entry origin proofs, approval block witnesses and changed inclusion rejection",
      "opening re-inclusion retains both origins/receipts",
      "same-byte freeze replay retains encrypted input and withholds stale disclosure",
      "native settlement and payout progress without extra confirmations",
      "native credits match contract claims and return to zero",
      "native client entry, approval and zero-balance claim tracking",
      "native referee scheduling, scoped action proof, budget check and actual offline adjudication",
      "nine scoped media tasks, real ffmpeg assembly, publication integrity, exact repair and native scheduling",
      "published-film hash verified against the contract at a canonical latest head"
    ],
    limitations: [
      "Controlled Ponder outage/restart reorg recovery, not uninterrupted same-process recovery",
      "mock currency, islands and VRF wrapper; bounded chosen word targets recorded island195, no randomness-quality claim",
      "Ethereum NFT ownership point responses are fixture-only; Base action checks use actual Anvil",
      "recorded reviewed NFT metadata and offline referee validation",
      "synthetic color/motion/audio and stubbed provider responses; no media quality assessment",
      "no production runtime grants, replay or cutover"
    ]
  };
  await writeFile(
    join(process.env.TMPDIR, "arena-lifecycle-report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  if (deployment && !(await pool.query("SELECT 1 FROM yunipals_arena.source_selection WHERE deployment=$1",[deployment])).rowCount) {
    await pool.query(
      "DELETE FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
      [deployment]
    );
    for (const table of ["client_receipt_history", "client_transaction"])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    for (const table of [
      "opening_action_observation",
      "transaction_receipt_history"
    ])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE action_id IN (SELECT action_id FROM yunipals_arena.transaction_intent WHERE deployment=$1)`,
        [deployment]
      );
    for (const table of arenaPrivateTables)
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    await pool.query(
      "DELETE FROM yunipals_arena.media_publication WHERE deployment=$1",
      [deployment]
    );
    await pool.query(
      "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
      [deployment]
    );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
  }
  await pool.end();
  await source?.close();
  assert.ok(!source || source.processStops.every(row => row.forced === false), "Final owned Ponder shutdown must be graceful");
  await rm(storage, { recursive: true, force: true });
}

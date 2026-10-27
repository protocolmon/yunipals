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
import { createArenaRpcFixture } from "../../yunipals-indexer/scripts/fixtures/arena-rpc-postgres-current-live-local.mjs";
import { migrateArena } from "../src/arena/live/schema.ts";
import { ArenaIntake } from "../src/arena/live/intake.ts";
import { createAdmission } from "../src/arena/live/admission.ts";
import { StrategyCipher } from "../src/arena/live/crypto.ts";
import { ArenaClientTransactions } from "../src/arena/live/clientTransactions.ts";
import { NativeArenaSource } from "../src/arena/live/nativeSource.ts";
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
  const context = await service.tournamentContext("1");
  const secondOpening = firstOpening;
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
  const livePonderIdentity = await source.processIdentity();
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

  let reserveOnly = true, stubbedRefereeRequests = 0, providerRetrievals = 0;
  const providerGuard = new NativeArenaProvider(service,
    observed => verifyNativeArenaAction(client, observed), async () => {
      await capacity.check(false);
      if (reserveOnly) throw new Error("Fixture-only reservation barrier");
    });
  const refereeApi = new ArenaRefereeApi(pool, "fixture-only-not-a-key", async (url, options) => {
    if (options?.method === "POST") {
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      stubbedRefereeRequests++;
      assert.equal(stubbedRefereeRequests, 1);
      return new Response(JSON.stringify({ id: "resp_live_reorg", status: "queued" }));
    }
    assert.equal(String(url), "https://api.openai.com/v1/responses/resp_live_reorg");
    providerRetrievals++;
    assert.equal(providerRetrievals, 1);
    return new Response(JSON.stringify({ id: "resp_live_reorg", status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(candidate) }] }] }));
  }, providerGuard);
  const adjudicator = new ArenaAdjudicator(pool, cipher, refereeApi, refereeSchema(root), productionValidator(root));
  const refereeWorker = new NativeArenaReferee(service, refereeApi, adjudicator);
  // The normal worker creates its actual request/reservation, then this explicit
  // fixture dependency pauses before any POST. No request-generation copy.
  await assert.rejects(refereeWorker.tick(), /Fixture-only reservation barrier/);
  reserveOnly = false;
  async function durableInvariants() {
    const privateRows = {};
    for (const table of ["submission", "fighter_snapshot", "frozen_input", "tournament_identity"]) {
      const rows = await pool.query(`SELECT (to_jsonb(t)-'native_check_at'-'native_check_lease'-'revealed_at'-'revealed_event_id'-'revealed_block_hash')::text AS value FROM yunipals_arena.${table} t WHERE deployment=$1 ORDER BY 1`, [deployment]);
      assert.ok(rows.rows.length <= 32);
      privateRows[table] = rows.rows.map(row => row.value);
    }
    const intents = (await pool.query("SELECT action_id::text,signer,nonce::text,raw_transaction,tx_hash,incarnation FROM yunipals_arena.transaction_intent WHERE deployment=$1 ORDER BY action_id", [deployment])).rows;
    const tasks = (await pool.query("SELECT request_id,request,reserved_microusd::text,actual_microusd::text FROM yunipals_arena.provider_task WHERE deployment=$1 ORDER BY request_id", [deployment])).rows;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].reserved_microusd, "700000");
    assert.equal(tasks[0].actual_microusd, null);
    return { privateRows: sha256(canonicalJson(privateRows)), intents: sha256(canonicalJson(intents)),
      task: sha256(canonicalJson(tasks)), requestId: tasks[0].request_id,
      ciphertext: sha256((await pool.query("SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment=$1 AND incarnation=$2", [deployment, context.incarnation])).rows[0].ciphertext) };
  }
  const durableBefore = await durableInvariants();
  const authorizedBefore = await providerGuard.check("1", "referee", context.incarnation);
  assert.equal(stubbedRefereeRequests, 0);
  assert.equal(await localRpc("evm_revert", [freezeSnapshot]), true);
  // Actual canonical/current-state checks block the orphan before trusting the
  // indexer's asynchronously moving head. The reservation barrier is OFF.
  await assert.rejects(providerGuard.refresh(authorizedBefore, "referee"));
  await assert.rejects(refereeApi.step(deployment, "1", context.incarnation));
  assert.equal(stubbedRefereeRequests, 0);
  assert.deepEqual(await durableInvariants(), durableBefore);
  await localRpc("evm_setNextBlockTimestamp", [Number(firstFreezeBlock.timestamp) + 1]);
  await localRpc("anvil_mine", ["0x1", "0x0"]);
  await source.sync();
  assert.deepEqual(await source.processIdentity(), livePonderIdentity);
  assert.equal((await service.state("1")).phase, "strategies");
  assert.equal((await service.publicView("1")).strategies, null);
  await assert.rejects(refereeApi.step(deployment, "1", context.incarnation));
  assert.equal(stubbedRefereeRequests, 0);
  assert.deepEqual(await durableInvariants(), durableBefore);
  const secondFreezeSnapshot = await localRpc("evm_snapshot");
  await control.advanceIntent(freeze);
  const secondFreeze = await receipt(freeze.tx_hash);
  await source.sync();
  assert.notEqual(secondFreeze.blockHash, firstFreeze.blockHash);
  assert.equal((await control.advanceIntent(freeze)).state, "confirmed");
  assert.equal((await service.publicView("1")).strategies, null);
  await assert.rejects(refereeApi.step(deployment, "1", context.incarnation));
  assert.equal(stubbedRefereeRequests, 0);
  // Only the operational scheduling clock is made due; real disclosure owns
  // proof updates, and Ponder alone owns all canonical tables/checkpoints.
  await pool.query("UPDATE yunipals_arena.frozen_input SET native_check_at=now() WHERE deployment=$1", [deployment]);
  assert.equal((await disclosure.tick()).revealed, 1);
  assert.equal((await service.publicView("1")).strategies.length, 4);
  assert.deepEqual(await durableInvariants(), durableBefore);
  const submitted = await refereeApi.step(deployment, "1", context.incarnation);
  assert.equal(submitted.state, "queued");
  assert.equal(submitted.request_id, durableBefore.requestId);
  assert.equal(stubbedRefereeRequests, 1);
  const submittedProof = (await pool.query("SELECT evidence FROM yunipals_arena.provider_action_evidence WHERE request_id=$1", [durableBefore.requestId])).rows[0].evidence;
  assert.equal(submittedProof.frozenBlockHash, secondFreeze.blockHash);
  assert.deepEqual(await durableInvariants(), durableBefore);
  const secondFreezeBlock = await client.getBlock({ blockNumber: secondFreeze.blockNumber });
  assert.equal(await localRpc("evm_revert", [secondFreezeSnapshot]), true);
  await localRpc("evm_setNextBlockTimestamp", [Number(secondFreezeBlock.timestamp) + 1]);
  await localRpc("anvil_mine", ["0x1", "0x0"]);
  await source.sync();
  assert.deepEqual(await source.processIdentity(), livePonderIdentity);
  assert.equal((await service.state("1")).phase, "strategies");
  // A known response may be retrieved under an orphaned origin. It must not
  // authorize a new POST, disclosure, adjudication or settlement on that branch.
  const recovered = await refereeWorker.reconcile();
  assert.equal(recovered.retrieved, 1); assert.equal(recovered.completed, 1);
  assert.equal(providerRetrievals, 1); assert.equal(stubbedRefereeRequests, 1);
  await assert.rejects(adjudicator.step(deployment, "1", 1600000, context.incarnation));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.adjudication WHERE deployment=$1", [deployment])).rows[0].n, 0);
  await assert.rejects(settlement.prepare("1"));
  assert.deepEqual(await durableInvariants(), durableBefore);
  await control.advanceIntent(freeze);
  const thirdFreeze = await receipt(freeze.tx_hash);
  await source.sync();
  assert.notEqual(thirdFreeze.blockHash, secondFreeze.blockHash);
  assert.equal((await control.advanceIntent(freeze)).state, "confirmed");
  assert.equal((await service.publicView("1")).strategies, null);
  await pool.query("UPDATE yunipals_arena.frozen_input SET native_check_at=now() WHERE deployment=$1", [deployment]);
  assert.equal((await disclosure.tick()).revealed, 1);
  const accepted = await refereeWorker.tick();
  assert.equal(accepted.state, "valid");
  assert.equal((await refereeWorker.tick()).state, "waiting");
  assert.equal(stubbedRefereeRequests, 1); assert.equal(providerRetrievals, 1);
  assert.deepEqual(await durableInvariants(), durableBefore);
  assert.deepEqual(await source.processIdentity(), livePonderIdentity);
  const savedProof = (await pool.query("SELECT evidence FROM yunipals_arena.provider_action_evidence WHERE request_id=$1", [durableBefore.requestId])).rows[0].evidence;
  assert.deepEqual(savedProof, submittedProof);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.transaction_receipt_history WHERE action_id=$1", [freeze.action_id])).rows[0].n, 3);
  for (const table of ["tournament", "chain_event"])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM yunipals_arena.${table} WHERE deployment=$1`, [deployment])).rows[0].n, 0);
  const report = { checkedAt:new Date().toISOString(),rulesHash:catalog.rulesHash,nativeSchema:source.schemaName,fullLifecycleInitiallyBound:true,status: "passed", scope: "same_live_ponder_freeze_reorg_external_effect_reconciliation",
    actualPonderBuild: source.release.buildId, actualPonderManifest: source.release.manifestHash,
    samePonderProcessAcrossBothReorgs: true, processIdentity: livePonderIdentity,
    realPonderRestartCount: source.processStops.length, realPonderForcedStops: 0,
    verifiedSoliditySources: verifiedSources.size, minedTransactions, metadataLoads: metadataCalls,
    stubbedRefereeRequests, providerRetrievals, stubbedMediaRequests: 0, providerRequests: 0, mainnetTransactions: 0,
    externalEffectInvariantsAccepted: true, reservationMicrousd: 700000, modeledActualChargeMicrousd: null,
    durablePrivateSha256: durableBefore.privateRows, ciphertextSha256: durableBefore.ciphertext,
    signedIntentSha256: durableBefore.intents, providerTaskSha256: durableBefore.task,
    providerRequestIdSha256: sha256(durableBefore.requestId),
    frozenBranches: [firstFreeze.blockHash, secondFreeze.blockHash, thirdFreeze.blockHash],
    checks: ["same PID/start across two real Ponder RPC reorgs", "orphaned reserved work cannot POST",
      "re-inclusion requires new disclosure", "same UUID/reservation/ciphertext/signed intent",
      "saved response retrieval while orphaned", "no adjudication or settlement on orphan branch",
      "revalidated same-input result applied without replacement POST", "immutable historical provider action proof"],
    limitations: ["isolated Anvil and mock contracts/controlled VRF", "Ethereum ownership responses are fixture-only",
      "provider responses stubbed, no billing or quality claim", "no film rendering or production role/startup acceptance"] };
  await writeFile(join(process.env.TMPDIR, "arena-lifecycle-report.json"), JSON.stringify(report, null, 2) + "\n");
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
  assert.ok(!source || source.processStops.length === 1 && source.processStops.every(row => row.forced === false && row.exitCode === 0 && row.signal === null), "Final owned Ponder shutdown must be graceful");
  await rm(storage, { recursive: true, force: true });
}

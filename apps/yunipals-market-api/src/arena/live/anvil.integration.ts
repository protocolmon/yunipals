/** Local chain only: real wallet signatures and transactions, recorded AI fixture.
 * No remote RPC, live VRF or paid model calls. Media uses synthetic test fixtures.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mock } from "node:test";
import pg from "pg";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  arenaDomain,
  ARENA_ENTRY_TYPES,
  ARENA_STRATEGY_TYPES,
  strategyCommitment,
  automaticStrategy
} from "@protopals/yunipals-market-core/arena";
import { migrateArena } from "./schema";
import { projectConfirmedArena } from "./projector";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { ArenaRefereeApi } from "./refereeApi";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "./adjudication";
import { ArenaSettlement } from "./settlement";
import { loadLiveArenaCatalog } from "./catalog";
import { ArenaIdentities, loadIdentityProfiles } from "./identity";
import { ArenaInputCompiler, onchainIslandDraw } from "./input";
import { ArenaControl } from "./control";
import {
  ArenaCapacity,
  runwareCreditMicrousd,
  type CapacitySnapshot
} from "./capacity";
import { verifyMediaLifecycle } from "./mediaVerification";

const root = resolve("../..");
const catalog = loadLiveArenaCatalog(root);
const profiles = loadIdentityProfiles(root);
const rpc = "http://127.0.0.1:55442";
const client = createPublicClient({
  // Anvil's eth_maxPriorityFeePerGas returns 1 gwei even in its low-fee mode.
  // Pin a local-only 0.001-gwei tip; production uses the Base provider quote.
  chain: { ...base, fees: { maxPriorityFeePerGas: 1_000_000n } },
  transport: http(rpc, { retryCount: 0 })
});
const publicClient = client as PublicClient;
const accounts = Array.from({ length: 6 }, (_, addressIndex) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex }
  )
);
const wallets = accounts.map((account) =>
  createWalletClient({ account, chain: base, transport: http(rpc) })
);
const pool = new pg.Pool({
  connectionString:
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena",
  max: 4
});
const deploymentId = `anvil/${randomUUID()}`;
const cipher = new StrategyCipher(randomBytes(32));
const fixture = JSON.parse(
  readFileSync(resolve("src/arena/live/fixtures/pilot-input.json"), "utf8")
);
let candidate = JSON.parse(
  readFileSync(resolve("src/arena/live/fixtures/pilot-outcome.json"), "utf8")
);
const artifact = (file: string, name: string) =>
  JSON.parse(
    readFileSync(
      resolve(root, `contracts/arena/out/${file}/${name}.json`),
      "utf8"
    )
  ) as { abi: Abi; bytecode: { object: Hex } };
async function receipt(hash: Hex) {
  const value = await client.waitForTransactionReceipt({
    hash,
    pollingInterval: 50
  });
  assert.equal(value.status, "success");
  return value;
}
async function deploy(file: string, name: string, args: unknown[] = []) {
  const a = artifact(file, name);
  const r = await receipt(
    await wallets[0]!.deployContract({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args
    })
  );
  return { address: r.contractAddress!, abi: a.abi, block: r.blockNumber };
}
async function write(
  target: { address: Address; abi: Abi },
  fn: string,
  args: unknown[] = [],
  wallet = 0
) {
  return receipt(
    await wallets[wallet]!.writeContract({ ...target, functionName: fn, args })
  );
}
try {
  assert.equal(await client.getChainId(), 8453);
  await migrateArena(pool);
  const wrapper = await deploy("YunipalsArena.t.sol", "MockWrapper");
  const islands = await deploy("YunipalsArena.t.sol", "MockNft");
  const currency = await deploy("YunipalsArena.t.sol", "MockCurrency");
  const arena = await deploy("YunipalsArena.sol", "YunipalsArena", [
    {
      admin: accounts[0]!.address,
      lobbyOperator: accounts[0]!.address,
      admissionSigner: accounts[4]!.address,
      referee: accounts[4]!.address,
      treasury: accounts[0]!.address,
      islands: islands.address,
      vrfWrapper: wrapper.address,
      paymentToken: currency.address,
      entryFee: 2_000_000n,
      winnerBps: 7500,
      islandBps: 500,
      joinWindow: 604800,
      strategyWindow: 86400,
      resolutionWindow: 86400,
      maxVrfCost: 100_000_000_000_000n,
      rulesHash: catalog.rulesHash
    }
  ]);
  const chainArena = { address: arena.address, abi: arenaAbi };
  const deployment = {
    id: deploymentId,
    contract: arena.address,
    startBlock: arena.block
  };
  const service = new ArenaIntake(
    pool,
    deploymentId,
    arena.address,
    "https://www.yunipals.com",
    cipher,
    {
      message: (args) => client.verifyMessage(args),
      strategy: (args) => client.verifyTypedData(args)
    }
  );
  let metadataCalls = 0;
  const identities = new ArenaIdentities(
    pool,
    deploymentId,
    profiles,
    async (nft) => {
      metadataCalls++;
      const fighter = fixture.roster.find(
        (f: { tokenId: string }) => f.tokenId === nft.tokenId
      );
      const profile = profiles.find((p) => p.image === fighter.image)!;
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
    }
  );
  const compiler = new ArenaInputCompiler(service, catalog, identities);
  const control = new ArenaControl(
    service,
    compiler,
    publicClient,
    accounts[4]!,
    100_000_000_000_000n
  );
  async function sync() {
    // Mine the same three local confirmations used by production.
    // Keep deadlines fixed; production never calls this test-only RPC.
    const mined = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_mine",
        params: ["0x3", "0x0"]
      })
    });
    assert.equal((await mined.json()).error, undefined);
    for (let i = 0; i < 10; i++) {
      const result = await projectConfirmedArena(
        pool,
        publicClient,
        deployment
      );
      assert.notEqual(result.status, "halted");
      if (result.status === "caught-up") return;
    }
    throw new Error("Local event projector did not catch up");
  }
  await receipt(
    await wallets[0]!.sendTransaction({
      to: arena.address,
      value: 10_000_000_000_000_000n
    })
  );
  await write(arena, "setEntriesPaused", [false]);
  await sync();
  assert.equal(
    runwareCreditMicrousd(
      { data: [{ taskUUID: "fixture", balance: 1.25 }] },
      "fixture"
    ),
    1250000
  );
  assert.equal(
    runwareCreditMicrousd(
      {
        data: [
          { taskUUID: "fixture", balance: { amount: 1.25, currency: "USD" } }
        ]
      },
      "fixture"
    ),
    1250000
  );
  assert.throws(
    () =>
      runwareCreditMicrousd(
        {
          data: [
            { taskUUID: "fixture", balance: { amount: 1.25, currency: "EUR" } }
          ]
        },
        "fixture"
      ),
    /unavailable/
  );
  const capacity = new ArenaCapacity(pool, deploymentId);
  const lobby = new ArenaControl(
    service,
    compiler,
    publicClient,
    accounts[0]!,
    100_000_000_000_000n,
    capacity
  );
  await assert.rejects(lobby.prepare("open-lobby", "1"), /operating capacity/);
  const funded: CapacitySnapshot = {
    runwareMicrousd: 1800000,
    openaiBudgetMicrousd: 1400000,
    openaiBudgetExpiresAt: Date.now() + 86400000,
    vrfAvailableWei: "1000000000000000",
    vrfQuoteWei: "1000000000000",
    vrfMaxWei: "10000000000000",
    refereeGasWei: "1000000000000000",
    operatorGasWei: "1000000000000000",
    diskFreeBytes: 10000000000
  };
  await capacity.save({ ...funded, runwareMicrousd: 899999 });
  await assert.rejects(lobby.prepare("open-lobby", "1"), /video funds/);
  await capacity.save({ ...funded, openaiBudgetMicrousd: 699999 });
  await assert.rejects(lobby.prepare("open-lobby", "1"), /referee funds/);
  await capacity.save({ ...funded, vrfAvailableWei: "0" });
  await assert.rejects(lobby.prepare("open-lobby", "1"), /island-draw funds/);
  await capacity.save({ ...funded, openaiBudgetExpiresAt: Date.now() - 1 });
  await assert.rejects(
    lobby.prepare("open-lobby", "1"),
    /allowance is renewed/
  );
  await capacity.save(funded);
  await pool.query(
    "UPDATE yunipals_arena.capacity SET checked_at=now()-interval '7 minutes' WHERE deployment=$1",
    [deploymentId]
  );
  await assert.rejects(lobby.prepare("open-lobby", "1"), /operating capacity/);
  await capacity.save(funded);
  const openings = await Promise.all([
    lobby.prepare("open-lobby", "1"),
    lobby.prepare("open-lobby", "1")
  ]);
  assert.equal(openings[0]!.tx_hash, openings[1]!.tx_hash);
  await lobby.advance("open-lobby", "1");
  await receipt(openings[0]!.tx_hash);
  await sync();
  assert.equal((await lobby.advance("open-lobby", "1")).state, "confirmed");
  await assert.rejects(lobby.prepare("open-lobby", "2"), /must progress/);
  assert.equal((await capacity.check(false)).ready, true);
  for (let seat = 0; seat < 4; seat++) {
    await write(currency, "mint", [accounts[seat]!.address, 2_000_000n]);
    await write(currency, "approve", [arena.address, 2_000_000n], seat);
    const entry = {
      player: accounts[seat]!.address,
      nftChainId: 1n,
      collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
      tokenId: BigInt(fixture.roster[seat].tokenId)
    };
    const expiry = (await client.getBlock()).timestamp + 480n;
    const permit = await accounts[4]!.signTypedData({
      domain: arenaDomain(arena.address),
      types: ARENA_ENTRY_TYPES,
      primaryType: "EntryPermit",
      message: { tournamentId: 1n, ...entry, expiry }
    });
    await write(arena, "join", [1n, entry, expiry, permit], seat);
  }
  assert.equal(
    await client.readContract({
      ...currency,
      functionName: "balanceOf",
      args: [arena.address]
    }),
    8_000_000n
  );
  const beforeDraw = await client.readContract({
    ...chainArena,
    functionName: "tournament",
    args: [1n]
  });
  await write(wrapper, "fulfill", [beforeDraw.requestId, 777n]);
  const ticket = await client.readContract({
    ...chainArena,
    functionName: "drawTicket",
    args: [1n, 777n]
  });
  assert.equal(
    onchainIslandDraw(arena.address, "1", "777", catalog.pool.entries).ticket,
    Number(ticket)
  );
  const islandId = await client.readContract({
    ...chainArena,
    functionName: "islandForTicket",
    args: [BigInt(ticket)]
  });
  await write(islands, "setOwner", [BigInt(islandId), accounts[5]!.address]);
  await sync();
  const islandIntent = await control.prepare("finalize-island", "1");
  await control.advance("finalize-island", "1");
  await receipt(islandIntent.tx_hash);
  await sync();
  assert.equal(
    (await control.advance("finalize-island", "1")).state,
    "confirmed"
  );
  assert.equal((await service.state("1")).phase, "strategies");
  for (const seat of (await service.state("1")).seats)
    await identities.ensure("1", seat);
  const context = await compiler.context("1");
  assert.equal(context.ready, true);
  assert.equal(context.island?.tokenId, String(islandId));
  assert.deepEqual(
    context.roster.map((f) => f?.locomotion),
    ["ground", "ground", "flight", "flight"]
  );
  const substitutions = new Map(
    fixture.roster.map((f: { id: string }, seat: number) => [
      f.id,
      context.roster[seat]!.id
    ])
  );
  // Recorded combat actions are unchanged; replace lab nicknames with actual NFT IDs.
  candidate = JSON.parse(JSON.stringify(candidate), (_, value: unknown) =>
    typeof value === "string" ? (substitutions.get(value) ?? value) : value
  );
  for (let seat = 0; seat < 4; seat++) {
    const challenge = await service.challenge(accounts[seat]!.address);
    const session = await service.authenticate(
      challenge.id,
      await accounts[seat]!.signMessage({ message: challenge.message })
    );
    const text = fixture.strategies.find(
      (s: { fighterId: string }) => s.fighterId === fixture.roster[seat].id
    ).text as string;
    const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
    const commitment = strategyCommitment(arena.address, 1n, seat, text, salt);
    const signature = await accounts[seat]!.signTypedData({
      domain: arenaDomain(arena.address),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 1n, seat, commitment }
    });
    await service.submit("1", await service.wallet(session.token), {
      seat,
      text,
      salt,
      signature
    });
    assert.equal((await service.publicView("1")).strategies, null);
  }
  const frozen = await compiler.prepare("1");
  assert.deepEqual(await compiler.prepare("1"), frozen);
  assert.equal(metadataCalls, 4);
  assert.equal((await service.publicView("1")).strategies, null);
  const freezes = await Promise.all([
    control.prepare("freeze-input", "1"),
    control.prepare("freeze-input", "1")
  ]);
  assert.equal(freezes[0]!.tx_hash, freezes[1]!.tx_hash);
  await control.advance("freeze-input", "1");
  await receipt(freezes[0]!.tx_hash);
  await sync();
  assert.equal((await control.advance("freeze-input", "1")).state, "confirmed");
  assert.equal((await service.publicView("1")).strategies?.length, 4);
  let modelRequests = 0;
  const api = new ArenaRefereeApi(pool, "local-test-not-a-key", (async () => {
    modelRequests++;
    return new Response(
      JSON.stringify({
        id: "resp_anvil_fixture",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(candidate) }]
          }
        ]
      })
    );
  }) as typeof fetch);
  const adjudicator = new ArenaAdjudicator(
    pool,
    cipher,
    api,
    refereeSchema(root),
    productionValidator(root)
  );
  assert.equal((await adjudicator.step(deploymentId, "1")).state, "valid");
  const settlement = new ArenaSettlement(
    pool,
    publicClient,
    accounts[4]!,
    deploymentId,
    arena.address,
    100_000_000_000_000n
  );
  const prepared = await settlement.prepare("1");
  assert.equal(prepared.state, "prepared");
  await settlement.advance("1");
  await receipt(prepared.tx_hash);
  await sync();
  assert.equal((await settlement.advance("1")).state, "confirmed");
  assert.deepEqual((await service.state("1")).winners, [1, 3, 3]);
  for (const index of [3, 5, 0]) {
    assert.equal(
      await client.readContract({
        ...chainArena,
        functionName: "claimable",
        args: [accounts[index]!.address]
      }),
      0n
    );
  }
  assert.equal(
    await client.readContract({
      ...currency,
      functionName: "balanceOf",
      args: [arena.address]
    }),
    8_000_000n
  );
  const noFilm = new ArenaControl(
    service,
    compiler,
    publicClient,
    accounts[4]!,
    100_000_000_000_000n,
    undefined,
    "/tmp/no-arena-film"
  );
  await assert.rejects(
    noFilm.prepare("release-payouts", "1"),
    /completed published film/
  );
  assert.equal(modelRequests, 1);
  let payoutTransaction: Hex | undefined;
  const mediaReport = await verifyMediaLifecycle(
    pool,
    cipher,
    root,
    deploymentId,
    async (storage) => {
      const payouts = new ArenaControl(
        service,
        compiler,
        publicClient,
        accounts[4]!,
        100_000_000_000_000n,
        undefined,
        storage
      );
      const [first, concurrent] = await Promise.all([
        payouts.prepare("release-payouts", "1"),
        payouts.prepare("release-payouts", "1")
      ]);
      assert.equal(first.tx_hash, concurrent.tx_hash);
      payoutTransaction = first.tx_hash;
      await payouts.advance("release-payouts", "1");
      await receipt(first.tx_hash);
      await sync();
      assert.equal(
        (await payouts.advance("release-payouts", "1")).state,
        "confirmed"
      );
      await payouts.advance("release-payouts", "1");
      assert.equal(
        (await service.state("1")).videoHash,
        await client.readContract({
          ...chainArena,
          functionName: "publishedVideoHash",
          args: [1n]
        })
      );
    }
  );
  for (const [index, amount] of [
    [3, 6_000_000n],
    [5, 400_000n],
    [0, 1_600_000n]
  ] as const) {
    assert.equal(
      await client.readContract({
        ...chainArena,
        functionName: "claimable",
        args: [accounts[index]!.address]
      }),
      amount
    );
    await write(arena, "claim", [accounts[index]!.address], index);
    assert.equal(
      await client.readContract({
        ...currency,
        functionName: "balanceOf",
        args: [accounts[index]!.address]
      }),
      amount
    );
  }
  await sync();
  assert.equal(
    await client.readContract({
      ...currency,
      functionName: "balanceOf",
      args: [arena.address]
    }),
    0n
  );
  // A paid, unfilled lobby expires without a VRF callback or any AI request.
  const secondLobby = await lobby.prepare("open-lobby", "2");
  await lobby.advance("open-lobby", "2");
  await receipt(secondLobby.tx_hash);
  await sync();
  assert.equal((await lobby.advance("open-lobby", "2")).state, "confirmed");
  await write(currency, "mint", [accounts[1]!.address, 2_000_000n]);
  await write(currency, "approve", [arena.address, 2_000_000n], 1);
  const refundEntry = {
    player: accounts[1]!.address,
    nftChainId: 1n,
    collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
    tokenId: BigInt(fixture.roster[1].tokenId)
  };
  const refundExpiry = (await client.getBlock()).timestamp + 480n;
  const refundPermit = await accounts[4]!.signTypedData({
    domain: arenaDomain(arena.address),
    types: ARENA_ENTRY_TYPES,
    primaryType: "EntryPermit",
    message: { tournamentId: 2n, ...refundEntry, expiry: refundExpiry }
  });
  await write(arena, "join", [2n, refundEntry, refundExpiry, refundPermit], 1);
  await sync();
  await assert.rejects(control.prepare("expire", "2"), /not expired/);
  const refundState = await client.readContract({
    ...chainArena,
    functionName: "tournament",
    args: [2n]
  });
  for (const [method, params] of [
    ["evm_setNextBlockTimestamp", [Number(refundState.deadline)]],
    ["evm_mine", []]
  ] as const) {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    assert.equal((await response.json()).error, undefined);
  }
  mock.timers.enable({
    apis: ["Date"],
    now: Number(refundState.deadline) * 1000
  });
  try {
    await sync();
    const expiryIntent = await control.prepare("expire", "2");
    await control.advance("expire", "2");
    await receipt(expiryIntent.tx_hash);
    await sync();
    assert.equal((await control.advance("expire", "2")).state, "confirmed");
    assert.equal((await service.publicView("2")).strategies, null);
    assert.equal(
      await client.readContract({
        ...chainArena,
        functionName: "claimable",
        args: [accounts[1]!.address]
      }),
      2_000_000n
    );
    await write(arena, "claim", [accounts[1]!.address], 1);
    assert.equal(
      await client.readContract({
        ...currency,
        functionName: "balanceOf",
        args: [accounts[1]!.address]
      }),
      2_000_000n
    );
    // A separate full tournament misses three prompts. Freeze the real fallback
    // transaction and compare Solidity commitments with the TypeScript compiler.
    await write(arena, "openTournament");
    for (let seat = 0; seat < 4; seat++) {
      await write(currency, "mint", [accounts[seat]!.address, 2_000_000n]);
      await write(currency, "approve", [arena.address, 2_000_000n], seat);
      const entry = {
        player: accounts[seat]!.address,
        nftChainId: 1n,
        collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
        tokenId: BigInt(fixture.roster[seat].tokenId)
      };
      const expiry = (await client.getBlock()).timestamp + 480n;
      const permit = await accounts[4]!.signTypedData({
        domain: arenaDomain(arena.address),
        types: ARENA_ENTRY_TYPES,
        primaryType: "EntryPermit",
        message: { tournamentId: 3n, ...entry, expiry }
      });
      await write(arena, "join", [3n, entry, expiry, permit], seat);
    }
    const third = await client.readContract({
      ...chainArena,
      functionName: "tournament",
      args: [3n]
    });
    await write(wrapper, "fulfill", [third.requestId, 888n]);
    await write(arena, "finalizeIsland", [3n]);
    await sync();
    for (const seat of (await service.state("3")).seats)
      await identities.ensure("3", seat);
    const text = "Move into reach and use quick strikes, then recover.";
    const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
    const commitment = strategyCommitment(arena.address, 3n, 0, text, salt);
    const signature = await accounts[0]!.signTypedData({
      domain: arenaDomain(arena.address),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 3n, seat: 0, commitment }
    });
    await service.submit("3", accounts[0]!.address, {
      seat: 0,
      text,
      salt,
      signature
    });
    const deadline = (await service.state("3")).deadline;
    await client.request({
      method: "evm_setNextBlockTimestamp" as never,
      params: [deadline] as never
    });
    await client.request({ method: "evm_mine" as never, params: [] as never });
    mock.timers.setTime(deadline * 1000);
    await sync();
    await assert.rejects(control.prepare("expire", "3"), /not expired/);
    const automatic = await compiler.prepare("3");
    assert.equal(automatic.automaticStrategyMask, 14);
    assert.equal((await service.publicView("3")).strategies, null);
    for (let seat = 1; seat < 4; seat++) {
      assert.equal(
        automatic.commitments[seat],
        automaticStrategy(arena.address, 3n, seat, catalog.rulesHash, 888n)
          .commitment
      );
      assert.equal(
        automatic.commitments[seat],
        await client.readContract({
          ...chainArena,
          functionName: "fallbackCommitment",
          args: [3n, seat]
        })
      );
    }
    const fallbackTx = await control.prepare("freeze-input", "3");
    await control.advance("freeze-input", "3");
    await receipt(fallbackTx.tx_hash);
    await sync();
    assert.equal(
      (await control.advance("freeze-input", "3")).state,
      "confirmed"
    );
    const revealed = await service.publicView("3");
    assert.equal(revealed.strategies?.[0]?.text, text);
    assert.equal(revealed.strategies?.[1]?.source, "automatic");
    assert.equal(revealed.automaticStrategyMask, 14);
    await client.request({
      method: "evm_setNextBlockTimestamp" as never,
      params: [revealed.deadline] as never
    });
    await client.request({ method: "evm_mine" as never, params: [] as never });
    mock.timers.setTime(revealed.deadline * 1000);
    await sync();
    const refereeExpiry = await control.prepare("expire", "3");
    await control.advance("expire", "3");
    await receipt(refereeExpiry.tx_hash);
    await sync();
    assert.equal((await control.advance("expire", "3")).state, "confirmed");
    for (let seat = 0; seat < 4; seat++) {
      assert.equal(
        await client.readContract({
          ...chainArena,
          functionName: "claimable",
          args: [accounts[seat]!.address]
        }),
        2_000_000n
      );
      await write(arena, "claim", [accounts[seat]!.address], seat);
    }
  } finally {
    mock.timers.reset();
  }
  const report = {
    checkedAt: new Date().toISOString(),
    status: "passed",
    network: "local Anvil only",
    checks: [
      "capacity gates stale snapshots, low Runware/referee/VRF funds and expired allowance",
      "concurrent funded lobby workers persist one zero-value transaction",
      "no second empty lobby; next opens after first film is published",
      "four exact 2-USDC-unit payments",
      "weighted mock-VRF island",
      "TypeScript draw matches Solidity drawTicket",
      "immutable NFT snapshots in paid seat order",
      "production input compiler and rules manifest",
      "persisted island-finalization and input-freeze transactions",
      "concurrent freeze workers reuse one transaction",
      "expiry worker rejects an early refund and returns all 2 USDC at the deadline",
      "real wallet authentication and signed strategies",
      "private until matching input freeze",
      "deterministic candidate validation",
      "persisted signed settlement; all eight USDC remain held",
      "no payout release before a completed published film",
      "concurrent payout release reuses one signed transaction",
      "published film hash recorded onchain; 6 / 0.40 / 1.60 USDC released once",
      "6/0.4/1.6 claims and zero escrow remainder",
      "three missing prompts use deterministic automatic attacks; real fallback freeze preserves the signed prompt",
      "Solidity and TypeScript automatic commitments match; strategy expiry does not refund; referee expiry refunds all four"
    ],
    limitations: [
      "Recorded NFT metadata and referee candidate; no live inference",
      "Mock currency and VRF wrapper",
      "No browser, live providers, mainnet transactions or AI-generated test footage"
    ],
    media: mediaReport,
    contract: arena.address,
    settlementTransaction: prepared.tx_hash,
    payoutTransaction
  };
  writeFileSync(
    resolve(root, "docs/arena/anvil-lifecycle-verification-v1.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  for (const table of [
    "client_transaction",
    "capacity",
    "media_job",
    "transaction_intent",
    "adjudication",
    "provider_task",
    "admission",
    "frozen_input",
    "submission",
    "fighter_snapshot",
    "challenge",
    "session",
    "credit",
    "tournament",
    "chain_event",
    "deployment"
  ])
    await pool.query(
      `DELETE FROM yunipals_arena.${table} WHERE ${table === "deployment" ? "id" : "deployment"}=$1`,
      [deploymentId]
    );
  await pool.end();
}

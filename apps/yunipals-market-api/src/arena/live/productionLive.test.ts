import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  hashTypedData,
  encodeEventTopics,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  TransactionReceiptNotFoundError,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  arenaDomain,
  ARENA_STRATEGY_TYPES,
  strategyCommitment,
  automaticStrategy
} from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";
import { StrategyCipher } from "./crypto";
import { ArenaIntake } from "./intake";
import { projectEvent, type ArenaEvent } from "./projection";
import { migrateArena } from "./schema";
import { ArenaClientTransactions } from "./clientTransactions";
import { ArenaReadModels } from "./readModels";
import { arenaHealth } from "./health";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { ARENA_USDC } from "@protopals/yunipals-market-core/arena";
import { ArenaSettlement } from "./settlement";
import { createArenaApp } from "./http";
import { ArenaIdentities, loadIdentityProfiles } from "./identity";
import {
  ArenaIdentityAnalysis,
  PreparingIdentity,
  IDENTITY_MODEL
} from "./identityAnalysis";
import { projectConfirmedArena } from "./projector";
import {
  ArenaRefereeApi,
  refereeCandidate,
  refereeRequest
} from "./refereeApi";
import type { PublicClient } from "viem";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "./adjudication";

const pool = new pg.Pool({
  connectionString:
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena",
  max: 8
});
const contract = "0x1111111111111111111111111111111111111111" as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const accounts = Array.from({ length: 4 }, () =>
  privateKeyToAccount(generatePrivateKey())
);
const cipher = new StrategyCipher(randomBytes(32));
const deployments: string[] = [];
before(async () => {
  await migrateArena(pool);
});
after(async () => {
  for (const id of deployments) {
    await transaction(pool, async (db) => {
      for (const table of [
        "identity_job",
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
        "chain_event"
      ])
        await db.query(
          `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
          [id]
        );
      await db.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [id]);
    });
  }
  await pool.end();
});

async function fixture() {
  const deployment = `test/${randomUUID()}`;
  deployments.push(deployment);
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,finalized_at) VALUES($1,$2,1,now())",
    [deployment, contract]
  );
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://www.yunipals.com",
    cipher,
    { message: verifyMessage, strategy: verifyTypedData }
  );
  let logIndex = 0;
  const events: ArenaEvent[] = [];
  async function emit(eventName: string, args: Record<string, unknown>) {
    const event = {
      blockNumber: 1n,
      blockHash: hash("a"),
      transactionHash: hash("b"),
      logIndex: logIndex++,
      eventName,
      args
    };
    events.push(event);
    await transaction(pool, (db) => projectEvent(db, deployment, event));
    return event;
  }
  await emit("TournamentOpened", {
    id: 1n,
    rulesHash: hash("c"),
    poolHash: hash("d"),
    deadline: 0n
  });
  await emit("TournamentTreasuryAssigned", {
    id: 1n,
    beneficiary: accounts[0]!.address
  });
  for (let seat = 0; seat < 4; seat++)
    await emit("Entered", {
      id: 1n,
      seat,
      player: accounts[seat]!.address,
      nftChainId: 8453n,
      collection: contract,
      tokenId: BigInt(seat + 1)
    });
  await emit("IslandSelected", {
    id: 1n,
    islandId: 17,
    ticket: 42,
    beneficiary: accounts[1]!.address
  });
  await emit("StrategiesOpened", {
    id: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400)
  });
  async function submission(seat: number, text = `Secret strategy ${seat}`) {
    const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
    const commitment = strategyCommitment(contract, 1n, seat, text, salt);
    const signature = await accounts[seat]!.signTypedData({
      domain: arenaDomain(contract),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 1n, seat, commitment }
    });
    return { seat, text, salt, signature };
  }
  return { deployment, service, emit, events, submission };
}

test("NFT snapshots survive concurrent preparation, metadata changes and process restart; tampering is rejected", async () => {
  const f = await fixture();
  const profiles = loadIdentityProfiles(resolve("../.."));
  const p = profiles[0]!;
  const nft = {
    nftChainId: 1,
    collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
    tokenId: "1000000242"
  };
  let reads = 0;
  const source = async () => {
    reads++;
    return {
      token: {
        chain: "ethereum",
        chain_id: 1,
        contract_address: nft.collection,
        token_id: nft.tokenId,
        image: p.image,
        attributes: [
          { trait_type: "Type", value: p.species },
          { trait_type: "Color", value: p.color },
          { trait_type: "Horn", value: p.horn }
        ]
      }
    };
  };
  const identities = new ArenaIdentities(
    pool,
    f.service.deployment,
    profiles,
    source
  );
  const [a, b] = await Promise.all([
    identities.ensure("1", nft),
    identities.ensure("1", nft)
  ]);
  assert.deepEqual(a, b);
  assert.equal(reads, 1);
  const restarted = new ArenaIdentities(
    pool,
    f.service.deployment,
    [],
    async () => {
      throw new Error("Metadata changed or unavailable");
    }
  );
  assert.deepEqual(await restarted.ensure("1", nft), a);
  await pool.query(
    "UPDATE yunipals_arena.fighter_snapshot SET snapshot=jsonb_set(snapshot,'{locomotion}','\"flight\"') WHERE deployment=$1",
    [f.service.deployment]
  );
  await assert.rejects(restarted.read("1", nft), /checksum mismatch/);
});

test("wallet challenge is single-use, domain-bound and sessions store only a hash", async () => {
  const { service, deployment } = await fixture();
  const account = accounts[0]!;
  const challenge = await service.challenge(account.address);
  assert.match(challenge.message, /www.yunipals.com/);
  const signature = await account.signMessage({ message: challenge.message });
  const results = await Promise.allSettled([
    service.authenticate(challenge.id, signature),
    service.authenticate(challenge.id, signature)
  ]);
  const successes = results.filter((r) => r.status === "fulfilled");
  assert.equal(successes.length, 1);
  const result = successes[0]!;
  if (result.status !== "fulfilled") throw new Error("Missing result");
  assert.equal(
    await service.wallet(result.value.token),
    account.address.toLowerCase()
  );
  const rows = await pool.query(
    "SELECT * FROM yunipals_arena.session WHERE deployment=$1",
    [deployment]
  );
  assert.ok(!JSON.stringify(rows.rows).includes(result.value.token));
});

test("general artwork checks bind visible wings, reuse cached bytes and stop on ambiguity or uncertain paid POST", async () => {
  const f = await fixture();
  const analysis = new ArenaIdentityAnalysis(pool, f.deployment);
  await pool.query(
    "INSERT INTO yunipals_arena.capacity(deployment,snapshot,checked_at) VALUES($1,$2,now())",
    [
      f.deployment,
      {
        openaiBudgetMicrousd: 2000000,
        openaiBudgetExpiresAt: Date.now() + 60000
      }
    ]
  );
  const nft = {
    nftChainId: 1,
    collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
    tokenId: "1000000999"
  };
  const payload = (cid: string) => ({
    token: {
      chain: "ethereum",
      chain_id: 1,
      contract_address: nft.collection,
      token_id: nft.tokenId,
      image: `https://drive.polychainmonsters.com/ipfs/${cid}`,
      attributes: [
        { trait_type: "Type", value: "Unidragon" },
        { trait_type: "Color", value: "Blue" },
        { trait_type: "Horn", value: "Spiral" }
      ]
    }
  });
  let calls = 0,
    wings = "absent";
  const fake = (async (url, options) => {
    if (String(url).startsWith("https://drive.polychainmonsters.com/ipfs/")) {
      assert.equal(options?.redirect, "error");
      return new Response(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
      );
    }
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    calls++;
    const request = JSON.parse(String(options?.body));
    assert.equal(request.model, IDENTITY_MODEL);
    assert.deepEqual(request.tools, []);
    assert.equal(request.store, false);
    assert.ok(
      request.input[0].content[1].image_url.startsWith("data:image/png;base64,")
    );
    return new Response(
      JSON.stringify({
        id: `resp_anatomy${calls}`,
        status: "completed",
        usage: { input_tokens: 2000, output_tokens: 70 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  singleSubject: true,
                  wings,
                  description:
                    "Blue unicorn-like dragon with a spiral horn and a curved tail."
                })
              }
            ]
          }
        ]
      })
    );
  }) as typeof fetch;
  const until = Date.now() + 60000;
  const enqueue = async (cid: string) => {
    let key = "";
    await assert.rejects(
      analysis.resolve(nft, payload(cid), accounts[0]!.address),
      (e) => {
        assert.ok(e instanceof PreparingIdentity);
        key = e.key;
        return true;
      }
    );
    assert.equal((await analysis.status(key)).state, "preparing");
    return key;
  };
  const first = await enqueue("QmGroundDragon");
  assert.equal(await analysis.step("test-only", 0, until, fake), "disabled");
  assert.equal(calls, 0);
  assert.equal(await analysis.step("test-only", 20000, until, fake), "ready");
  const ground = await analysis.resolve(nft, payload("QmGroundDragon"));
  assert.equal(
    ground.locomotion,
    "ground",
    "A dragon name never implies flight"
  );
  assert.equal((await analysis.status(first)).state, "ready");
  const restarted = new ArenaIdentityAnalysis(pool, f.deployment);
  assert.deepEqual(
    await restarted.resolve(nft, payload("QmGroundDragon")),
    ground
  );
  assert.equal(calls, 1);
  wings = "present";
  await enqueue("QmWingedDragon");
  assert.equal(
    await analysis.step("test-only", 20000, until, fake),
    "idle",
    "Lifetime allowance cannot be reused"
  );
  assert.equal(await analysis.step("test-only", 40000, until, fake), "ready");
  assert.equal(
    (await analysis.resolve(nft, payload("QmWingedDragon"))).locomotion,
    "flight"
  );
  wings = "uncertain";
  const uncertainWings = await enqueue("QmAmbiguousDragon");
  assert.equal(await analysis.step("test-only", 60000, until, fake), "review");
  assert.equal((await analysis.status(uncertainWings)).state, "attention");
  await assert.rejects(
    analysis.resolve(nft, payload("QmAmbiguousDragon")),
    /before entry/
  );
  await enqueue("QmTimeoutDragon");
  const timeout = (async (url, options) => {
    if (String(url).startsWith("https://api.openai.com/")) {
      calls++;
      throw new Error("Connection lost after POST");
    }
    return fake(url, options);
  }) as typeof fetch;
  assert.equal(
    await analysis.step("test-only", 80000, until, timeout),
    "uncertain"
  );
  assert.equal(await analysis.step("test-only", 100000, until, fake), "idle");
  assert.equal(calls, 4, "Timeout never causes another paid candidate");
  await pool.query(
    "UPDATE yunipals_arena.identity_job SET profile=jsonb_set(profile,'{locomotion}','\"flight\"') WHERE deployment=$1 AND key=$2",
    [f.deployment, first]
  );
  await assert.rejects(
    analysis.resolve(nft, payload("QmGroundDragon")),
    /checksum mismatch/
  );
});

test("only the entering wallet can read its locked strategy receipt before collective reveal", async () => {
  const f = await fixture();
  const input = await f.submission(0);
  assert.deepEqual(await f.service.ownStrategy("1", accounts[0]!.address, 0), {
    seat: 0,
    locked: false
  });
  await f.service.submit("1", accounts[0]!.address, input);
  const receipt = await f.service.ownStrategy("1", accounts[0]!.address, 0);
  assert.equal(receipt.locked, true);
  assert.equal("text" in receipt ? receipt.text : null, input.text);
  assert.equal(
    "commitment" in receipt ? receipt.commitment : null,
    strategyCommitment(contract, 1n, 0, input.text, input.salt)
  );
  await assert.rejects(
    f.service.ownStrategy("1", accounts[1]!.address, 0),
    /another wallet/
  );
  assert.equal((await f.service.publicView("1")).strategies, null);
});

test("operational health detects stale indexing, uncertain work and overdue deadlines using database reads only", async () => {
  const f = await fixture();
  assert.equal(
    (await arenaHealth(pool, f.deployment, false)).status,
    "healthy"
  );
  await pool.query(
    "UPDATE yunipals_arena.deployment SET finalized_at=now()-interval '5 minutes',halted=true WHERE id=$1",
    [f.deployment]
  );
  await pool.query(
    "UPDATE yunipals_arena.tournament SET state=jsonb_set(state,'{deadline}',to_jsonb((extract(epoch FROM now())-3600)::bigint)) WHERE deployment=$1",
    [f.deployment]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,request,reserved_microusd) VALUES($1,1,'referee','candidate-1',$2,'uncertain','{}',700000)",
    [f.deployment, randomUUID()]
  );
  const health = await arenaHealth(pool, f.deployment, true);
  assert.equal(health.status, "needs-attention");
  const codes = health.issues.map((i) => i.code);
  for (const code of [
    "indexer-stale",
    "confirmed-history-halted",
    "capacity-stale",
    "operating-funds-or-storage-low",
    "strategies-transition-overdue",
    "referee-job-uncertain"
  ])
    assert.ok(codes.includes(code));
  assert.equal(health.externalRequests, 0);
  assert.ok(!JSON.stringify(health).includes("Secret strategy"));
});

test("all four simultaneous submissions remain private until the exact input is confirmed", async () => {
  const { service, deployment, submission, emit } = await fixture();
  const inputs = await Promise.all(
    [0, 1, 2, 3].map((seat) => submission(seat))
  );
  await Promise.all(
    inputs.map((input, i) => service.submit("1", accounts[i]!.address, input))
  );
  const privateView = await service.publicView("1");
  assert.deepEqual(privateView.submittedSeats, [0, 1, 2, 3]);
  assert.equal(privateView.strategies, null);
  const storage = await pool.query(
    "SELECT * FROM yunipals_arena.submission WHERE deployment=$1",
    [deployment]
  );
  assert.ok(!JSON.stringify(storage.rows).includes("Secret strategy"));
  const build = (state: unknown, strategies: unknown) => ({
    state,
    strategies
  });
  const frozen = await service.prepareInput("1", build);
  assert.deepEqual(await service.prepareInput("1", build), frozen);
  assert.equal((await service.publicView("1")).strategies, null);
  await emit("InputFrozen", {
    id: 1,
    inputHash: frozen.inputHash,
    strategyCommitments: frozen.commitments,
    deadline: Math.floor(Date.now() / 1000) + 3600
  });
  const revealed = await service.publicView("1");
  assert.equal(revealed.strategies?.length, 4);
  assert.equal(revealed.strategies?.[0]?.text, inputs[0]!.text);
});

test("a conflicting resubmission, foreign wallet and mutated strategy cannot replace a prompt", async () => {
  const { service, submission } = await fixture();
  const input = await submission(0);
  await service.submit("1", accounts[0]!.address, input);
  await service.submit("1", accounts[0]!.address, input);
  await assert.rejects(
    service.submit(
      "1",
      accounts[0]!.address,
      await submission(0, "Changed intent")
    ),
    /locked/
  );
  await assert.rejects(
    service.submit("1", accounts[1]!.address, input),
    /another wallet/
  );
  await assert.rejects(
    service.submit("1", accounts[0]!.address, { ...input, text: "Tampered" }),
    /signature/
  );
});

test("incorrect input or commitments never reveals four stored prompts", async () => {
  const { service, submission, emit } = await fixture();
  for (let i = 0; i < 4; i++)
    await service.submit("1", accounts[i]!.address, await submission(i));
  const frozen = await service.prepareInput("1", (_, strategies) => ({
    strategies
  }));
  await emit("InputFrozen", {
    id: 1,
    inputHash: hash("f"),
    strategyCommitments: frozen.commitments,
    deadline: Math.floor(Date.now() / 1000) + 3600
  });
  assert.equal((await service.publicView("1")).strategies, null);
});

test("history separates credited rewards, pending allocations and aggregate withdrawals; pagination is stable", async () => {
  const f = await fixture(),
    reads = new ArenaReadModels(f.service);
  const winner = accounts[0]!.address,
    host = accounts[1]!.address;
  await f.emit("InputFrozen", {
    id: 1,
    inputHash: hash("c"),
    strategyCommitments: [hash("a"), hash("b"), hash("c"), hash("d")],
    deadline: Math.floor(Date.now() / 1000) + 86400
  });
  await f.emit("ResultSettled", {
    id: 1,
    resultHash: hash("f"),
    semifinalOneWinner: 0,
    semifinalTwoWinner: 2,
    champion: 0
  });
  const pending = await reads.wallet(winner);
  assert.equal(pending.available, "0");
  assert.equal(pending.pending, "7600000");
  assert.equal(pending.winnings, "0");
  const before = await reads.island("17");
  assert.equal(before.releasedRewards, "0");
  assert.equal(before.pendingRewards, "400000");
  const released = await f.emit("PayoutsReleased", {
    id: 1,
    videoHash: hash("e")
  });
  await transaction(pool, (db) => projectEvent(db, f.deployment, released));
  const credited = await reads.wallet(winner);
  assert.equal(credited.available, "7600000");
  assert.equal(credited.winnings, "6000000");
  assert.equal(credited.operationsRewards, "1600000");
  assert.equal(credited.pending, "0");
  assert.equal((await reads.wallet(host)).hostingRewards, "400000");
  const credits = await reads.rewards(winner);
  assert.deepEqual(credits.items.map((r) => r.kind).sort(), [
    "operations",
    "winner"
  ]);
  assert.equal(new Set(credits.items.map((r) => r.id)).size, 2);
  await f.emit("Claimed", {
    player: winner,
    recipient: accounts[2]!.address,
    amount: "7600000"
  });
  const withdrawn = await reads.wallet(winner);
  assert.equal(withdrawn.available, "0");
  assert.equal(withdrawn.withdrawals, "7600000");
  const records = await reads.rewards(winner, { limit: 1 });
  assert.equal(records.items[0]?.kind, "withdrawal");
  assert.equal(records.items[0]?.tournamentId, null);
  assert.equal(records.items[0]?.recipient, accounts[2]!.address);
  assert.ok(records.nextCursor);
  const older = await reads.rewards(winner, {
    limit: 1,
    cursor: records.nextCursor!
  });
  assert.deepEqual(older.items.map((r) => r.kind).sort(), [
    "operations",
    "winner"
  ]);
  const island = await reads.island("17");
  assert.equal(island.releasedRewards, "400000");
  assert.equal(island.items[0]?.islandBeneficiary, host.toLowerCase());
  assert.equal(
    (await reads.tournaments({ wallet: accounts[2]!.address, role: "host" }))
      .items.length,
    0
  );
  await f.emit("TournamentOpened", {
    id: 2,
    rulesHash: hash("c"),
    poolHash: hash("d"),
    deadline: 0
  });
  const page = await reads.tournaments({}, { limit: 1 });
  assert.equal(page.items[0]?.id, "2");
  await f.emit("TournamentOpened", {
    id: 3,
    rulesHash: hash("c"),
    poolHash: hash("d"),
    deadline: 0
  });
  const next = await reads.tournaments(
    {},
    { limit: 1, cursor: page.nextCursor! }
  );
  assert.deepEqual(
    next.items.map((t) => t.id),
    ["1"]
  );
  await assert.rejects(
    reads.tournaments({ status: "active" }, { cursor: page.nextCursor! }),
    /cursor/
  );
});

test("receipt and cursor alone cannot complete entry: exact indexed effect is required", async () => {
  const f = await fixture();
  const wallet = accounts[0]!.address;
  await pool.query(
    `INSERT INTO yunipals_arena.admission(deployment,tournament_id,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
    VALUES($1,1,$2,8453,$3,1,1,$4,9999999999,'0x12')`,
    [f.deployment, wallet.toLowerCase(), contract, hash("a")]
  );
  // Use a supported collection for the tracked action; the fixture itself uses
  // its local mock address. Registration binds to the stored permit, not a name.
  const collection = "0x98433df878e8c898cb907345c3a7756e5f72240f" as Address;
  await pool.query(
    "UPDATE yunipals_arena.admission SET collection=$2 WHERE deployment=$1",
    [f.deployment, collection]
  );
  const txhash = hash("e");
  const action = {
    kind: "entry" as const,
    tournamentId: "1",
    nftChainId: 8453,
    collection,
    tokenId: "1"
  };
  const tracker = new ArenaClientTransactions(f.service);
  await tracker.register(wallet, txhash, action);
  const topics = encodeEventTopics({
    abi: arenaAbi,
    eventName: "Entered",
    args: { id: 1n, seat: 0, player: wallet }
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [8453n, collection, 1n]
  );
  const client = {
    getBlock: async (options: { blockNumber?: bigint }) => ({
      number: options.blockNumber ?? 13n,
      hash: hash("a"),
      timestamp: BigInt(Math.floor(Date.now() / 1000))
    }),
    getTransactionReceipt: async () => ({
      transactionHash: txhash,
      blockNumber: 10n,
      blockHash: hash("a"),
      status: "success",
      logs: [{ address: contract, topics, data, logIndex: 50 }]
    })
  } as unknown as PublicClient;
  await tracker.reconcileBatch(client);
  assert.equal((await tracker.read(wallet, txhash)).state, "indexing");
  await pool.query(
    "UPDATE yunipals_arena.deployment SET cursor=10 WHERE id=$1",
    [f.deployment]
  );
  await pool.query(
    "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
    [f.deployment]
  );
  await tracker.reconcileBatch(client);
  assert.equal((await tracker.read(wallet, txhash)).state, "indexing");
  await pool.query(
    `INSERT INTO yunipals_arena.chain_event VALUES($1,10,$2,$3,50,'Entered',$4)`,
    [
      f.deployment,
      hash("a"),
      txhash,
      {
        id: "1",
        seat: 0,
        player: wallet,
        nftChainId: "8453",
        collection,
        tokenId: "1"
      }
    ]
  );
  await pool.query(
    "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
    [f.deployment]
  );
  await tracker.reconcileBatch(client);
  assert.equal((await tracker.read(wallet, txhash)).state, "indexing");
  await pool.query(
    "UPDATE yunipals_arena.tournament SET state=jsonb_set(state,'{seats,0,collection}',to_jsonb($2::text)) WHERE deployment=$1",
    [f.deployment, collection]
  );
  await pool.query(
    "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
    [f.deployment]
  );
  await tracker.reconcileBatch(client);
  assert.equal((await tracker.read(wallet, txhash)).state, "indexed");
  assert.equal((await tracker.read(wallet, txhash)).result?.seat, 0);
  await assert.rejects(tracker.read(accounts[1]!.address, txhash), /not found/);
  await assert.rejects(
    tracker.register(wallet, txhash, { kind: "claim" }),
    /different action/
  );
});

test("USDC approval is indexed from targeted canonical evidence and never mistaken for an Arena event", async () => {
  const f = await fixture(),
    wallet = accounts[0]!.address,
    txhash = hash("e");
  await pool.query(
    `INSERT INTO yunipals_arena.admission(deployment,tournament_id,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
    VALUES($1,1,$2,8453,$3,1,1,$4,9999999999,'0x12')`,
    [f.deployment, wallet.toLowerCase(), contract, hash("a")]
  );
  const tracker = new ArenaClientTransactions(f.service);
  await tracker.register(wallet, txhash, {
    kind: "approval",
    tournamentId: "1"
  });
  await pool.query(
    "UPDATE yunipals_arena.deployment SET cursor=10 WHERE id=$1",
    [f.deployment]
  );
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Approval",
    args: { owner: wallet, spender: contract }
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [2_000_000n]);
  let canonical = false;
  const client = {
    getBlock: async (options: { blockNumber?: bigint }) => ({
      number: options.blockNumber ?? 13n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      hash: options.blockNumber && !canonical ? hash("f") : hash("a")
    }),
    getTransactionReceipt: async () => ({
      transactionHash: txhash,
      blockNumber: 10n,
      blockHash: hash("a"),
      status: "success",
      logs: [{ address: ARENA_USDC, topics, data, logIndex: 5 }]
    })
  } as unknown as PublicClient;
  await tracker.reconcileBatch(client);
  assert.equal((await tracker.read(wallet, txhash)).state, "confirming");
  canonical = true;
  await pool.query(
    "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
    [f.deployment]
  );
  await tracker.reconcileBatch(client);
  const indexed = await tracker.read(wallet, txhash);
  assert.equal(indexed.state, "indexed");
  assert.equal(indexed.result?.event, "Approval");
  assert.equal(indexed.result?.amount, "2000000");
});

test("missing strategies receive stable automatic attacks only at deadline; accepted prompts survive and reveal atomically", async () => {
  const f = await fixture();
  const input = await f.submission(0);
  await f.service.submit("1", accounts[0]!.address, input);
  const build = (_: unknown, strategies: unknown) => ({ strategies });
  await assert.rejects(
    f.service.prepareInput("1", build),
    /Waiting for all four/
  );
  await f.emit("RandomnessReceived", { id: 1, word: 777, requestId: 100 });
  await pool.query(
    "UPDATE yunipals_arena.tournament SET state=jsonb_set(state,'{deadline}',to_jsonb($2::bigint)) WHERE deployment=$1",
    [f.deployment, Math.floor(Date.now() / 1000) - 1]
  );
  const prepared = await f.service.prepareInput("1", build);
  assert.equal(prepared.automaticStrategyMask, 14);
  assert.deepEqual(await f.service.prepareInput("1", build), prepared);
  assert.equal((await f.service.publicView("1")).strategies, null);
  assert.equal(
    prepared.commitments[1],
    automaticStrategy(contract, 1n, 1, hash("c"), 777n).commitment
  );
  assert.equal(prepared.signatures[1], "0x");
  await assert.rejects(
    f.service.submit("1", accounts[1]!.address, await f.submission(1)),
    /deadline/
  );
  await f.emit("AutomaticStrategiesAssigned", { id: 1, seatMask: 14 });
  await f.emit("InputFrozen", {
    id: 1,
    inputHash: prepared.inputHash,
    strategyCommitments: prepared.commitments,
    deadline: Math.floor(Date.now() / 1000) + 86400
  });
  const view = await f.service.publicView("1");
  assert.equal(view.strategies?.length, 4);
  assert.equal(view.strategies?.[0]?.text, input.text);
  assert.equal(view.strategies?.[0]?.source, "player");
  assert.equal(view.strategies?.[1]?.source, "automatic");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM yunipals_arena.credit WHERE deployment=$1",
        [f.deployment]
      )
    ).rows[0].count,
    "0"
  );
});

test("an automatic assignment cannot reveal input that replaces an accepted strategy", async () => {
  const f = await fixture();
  for (let seat = 0; seat < 4; seat++)
    await f.service.submit(
      "1",
      accounts[seat]!.address,
      await f.submission(seat)
    );
  const prepared = await f.service.prepareInput("1", (_, strategies) => ({
    strategies
  }));
  await f.emit("RandomnessReceived", { id: 1, word: 777, requestId: 100 });
  await f.emit("AutomaticStrategiesAssigned", { id: 1, seatMask: 1 });
  const commitments = [...prepared.commitments];
  commitments[0] = automaticStrategy(
    contract,
    1n,
    0,
    hash("c"),
    777n
  ).commitment;
  await f.emit("InputFrozen", {
    id: 1,
    inputHash: prepared.inputHash,
    strategyCommitments: commitments,
    deadline: Math.floor(Date.now() / 1000) + 86400
  });
  assert.equal((await f.service.publicView("1")).strategies, null);
});

test("expiry refunds every seat once and never exposes incomplete strategies", async () => {
  const { service, deployment, submission, emit, events } = await fixture();
  await service.submit("1", accounts[0]!.address, await submission(0));
  const expiry = await emit("TournamentExpired", { id: 1 });
  await transaction(pool, (db) => projectEvent(db, deployment, expiry));
  assert.equal((await service.publicView("1")).strategies, null);
  const credits = await pool.query<{ amount: string }>(
    "SELECT amount FROM yunipals_arena.credit WHERE deployment=$1",
    [deployment]
  );
  assert.equal(credits.rows.length, 4);
  assert.ok(credits.rows.every((r) => r.amount === "2000000"));
  for (const event of events)
    await transaction(pool, (db) => projectEvent(db, deployment, event));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT amount FROM yunipals_arena.credit WHERE deployment=$1",
        [deployment]
      )
    ).rows,
    credits.rows
  );
});

test("result holds funds; publication unlocks all eight USDC once when recipients overlap", async () => {
  const { deployment, emit } = await fixture();
  await emit("InputFrozen", {
    id: 1,
    inputHash: hash("e"),
    strategyCommitments: [hash("a"), hash("b"), hash("c"), hash("d")],
    deadline: Math.floor(Date.now() / 1000) + 3600
  });
  await emit("ResultSettled", {
    id: 1,
    resultHash: hash("f"),
    semifinalOneWinner: 0,
    semifinalTwoWinner: 2,
    champion: 0
  });
  const balances = async () =>
    new Map(
      (
        await pool.query<{ wallet: string; amount: string }>(
          "SELECT wallet,amount FROM yunipals_arena.credit WHERE deployment=$1",
          [deployment]
        )
      ).rows.map((r) => [r.wallet, r.amount])
    );
  assert.equal((await balances()).size, 0);
  await emit("PayoutsReleased", { id: 1, videoHash: hash("9") });
  assert.equal(
    (await balances()).get(accounts[0]!.address.toLowerCase()),
    "7600000"
  );
  assert.equal(
    (await balances()).get(accounts[1]!.address.toLowerCase()),
    "400000"
  );
  await emit("Claimed", {
    player: accounts[0]!.address,
    recipient: accounts[0]!.address,
    amount: 7600000n
  });
  assert.equal((await balances()).get(accounts[0]!.address.toLowerCase()), "0");
});

test("encrypted records cannot be moved between seats and EIP-712 signatures bind deployment", () => {
  const encrypted = cipher.seal("tournament/1/seat/0", { text: "secret" });
  assert.throws(() => cipher.open("tournament/1/seat/1", encrypted));
  const base = {
    types: ARENA_STRATEGY_TYPES,
    primaryType: "StrategyApproval" as const,
    message: { tournamentId: 1n, seat: 0, commitment: hash("e") }
  };
  assert.notEqual(
    hashTypedData({ ...base, domain: arenaDomain(contract) }),
    hashTypedData({ ...base, domain: arenaDomain(accounts[0]!.address) })
  );
});

test("stale or halted projection blocks new private submissions", async () => {
  const { service, deployment, submission } = await fixture();
  const input = await submission(0);
  await pool.query(
    "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
    [deployment]
  );
  await assert.rejects(
    service.submit("1", accounts[0]!.address, input),
    /catching up/
  );
});

test("HTTP rejects cross-origin writes and never sends private submissions or session tokens in JSON", async () => {
  const { service, submission } = await fixture();
  const app = createArenaApp(service, { entriesEnabled: false });
  const post = (
    path: string,
    body: unknown,
    origin = "https://www.yunipals.com"
  ) =>
    app.request(path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  assert.equal(
    (
      await post(
        "/auth/challenge",
        { wallet: accounts[0]!.address },
        "https://other.example"
      )
    ).status,
    403
  );
  assert.equal((await post("/tournaments/1/admission", {})).status, 503);
  const challenge = (await (
    await post("/auth/challenge", { wallet: accounts[0]!.address })
  ).json()) as { id: string; message: string };
  const signature = await accounts[0]!.signMessage({
    message: challenge.message
  });
  const verified = await post("/auth/verify", { id: challenge.id, signature });
  assert.equal(verified.status, 200);
  assert.deepEqual(Object.keys((await verified.json()) as object), ["wallet"]);
  const cookie = verified.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const input = await submission(0);
  const submitted = await app.request("/tournaments/1/strategies", {
    method: "POST",
    headers: {
      Origin: "https://www.yunipals.com",
      "Content-Type": "application/json",
      Cookie: cookie.split(";")[0]!
    },
    body: JSON.stringify(input)
  });
  assert.equal(submitted.status, 200);
  const publicResponse = await app.request("/tournaments/1");
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  assert.ok(!(await publicResponse.text()).includes(input.text));
});

test("connected wallets can browse indexed rewards without authentication; private actions still require proof", async () => {
  const { service, submission, deployment } = await fixture();
  const app = createArenaApp(service, {
    entriesEnabled: true,
    admit: async () => ({})
  });
  const wallet = accounts[0]!.address;
  const input = await submission(0);
  await service.submit("1", wallet, input);
  const reads = new ArenaReadModels(service);
  const publicSummary = await app.request(`/wallets/${wallet}/summary`);
  assert.equal(publicSummary.status, 200);
  assert.equal(publicSummary.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    await publicSummary.json(),
    await reads.wallet(wallet.toLowerCase() as Address)
  );
  const publicRewards = await app.request(
    `/wallets/${wallet}/rewards?limit=12`
  );
  assert.equal(publicRewards.status, 200);
  assert.deepEqual(
    await publicRewards.json(),
    await reads.rewards(wallet.toLowerCase() as Address, { limit: 12 })
  );
  for (const suffix of ["summary", "rewards"]) {
    assert.equal(
      (await app.request(`/wallets/not-an-address/${suffix}`)).status,
      400
    );
    const response = await app.request(
      `/wallets/${accounts[1]!.address}/${suffix}`
    );
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(input.text));
  }
  assert.equal(
    (await app.request(`/wallets/${wallet}/rewards?limit=999`)).status,
    400
  );
  assert.equal(
    (await app.request(`/wallets/${wallet}/rewards?cursor=invalid`)).status,
    400
  );
  for (const path of [
    "/me",
    "/tournaments/1/strategies/0/receipt",
    `/transactions/${hash("a")}`
  ])
    assert.equal((await app.request(path)).status, 401);
  for (const path of [
    "/tournaments/1/admission",
    "/tournaments/1/strategies",
    "/transactions"
  ])
    assert.equal(
      (
        await app.request(path, {
          method: "POST",
          headers: {
            Origin: "https://www.yunipals.com",
            "Content-Type": "application/json"
          },
          body: "{}"
        })
      ).status,
      401
    );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM yunipals_arena.challenge WHERE deployment=$1",
        [deployment]
      )
    ).rows[0].count,
    0
  );
});

test("projector uses local confirmations, bounds log reads and fences changed canonical history", async () => {
  const { deployment } = await fixture();
  let changed = false,
    logCalls = 0;
  const rpc = {
    getBlock: async (options: { blockNumber?: bigint; blockTag?: string }) => ({
      number: options.blockNumber ?? 303n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      hash: changed ? hash("b") : hash("a")
    }),
    getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => {
      assert.ok(args.toBlock - args.fromBlock < 500n);
      logCalls++;
      return [];
    }
  } as unknown as PublicClient;
  const config = { id: deployment, contract, startBlock: 1n };
  assert.equal(
    (await projectConfirmedArena(pool, rpc, config)).status,
    "advanced"
  );
  assert.equal(
    (await projectConfirmedArena(pool, rpc, config)).status,
    "caught-up"
  );
  assert.equal(logCalls, 1);
  changed = true;
  assert.equal(
    (await projectConfirmedArena(pool, rpc, config)).status,
    "halted"
  );
  assert.equal(
    (await projectConfirmedArena(pool, rpc, config)).status,
    "halted"
  );
  assert.equal(logCalls, 1);
});

async function refereeFixture() {
  const f = await fixture();
  for (let i = 0; i < 4; i++)
    await f.service.submit("1", accounts[i]!.address, await f.submission(i));
  const frozen = await f.service.prepareInput("1", (_, strategies) => ({
    strategies
  }));
  await f.emit("InputFrozen", {
    id: 1,
    inputHash: frozen.inputHash,
    strategyCommitments: frozen.commitments,
    deadline: Math.floor(Date.now() / 1000) + 3600
  });
  return f;
}

test("referee restart polls the same response; parallel workers cannot buy two candidates", async () => {
  const { deployment } = await refereeFixture();
  let posts = 0,
    gets = 0;
  const fetcher = (async (_: unknown, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts++;
      return new Response(
        JSON.stringify({ id: "resp_test123", status: "queued" })
      );
    }
    gets++;
    return new Response(
      JSON.stringify({
        id: "resp_test123",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"winner":"test"}' }]
          }
        ],
        usage: { input_tokens: 10, output_tokens: 10 }
      })
    );
  }) as typeof fetch;
  const api = new ArenaRefereeApi(pool, "test-only-not-a-key", fetcher);
  const request = refereeRequest("Rules", { test: true }, { type: "object" });
  await Promise.all([
    api.reserve(deployment, "1", request, 1000000),
    api.reserve(deployment, "1", request, 1000000)
  ]);
  await Promise.all([api.step(deployment, "1"), api.step(deployment, "1")]);
  const restarted = new ArenaRefereeApi(pool, "test-only-not-a-key", fetcher);
  const result = await restarted.step(deployment, "1");
  await restarted.step(deployment, "1");
  assert.equal(posts, 1);
  assert.equal(gets, 1);
  assert.deepEqual(refereeCandidate(result.response!), { winner: "test" });
  await assert.rejects(
    api.reserve(
      deployment,
      "1",
      refereeRequest("Different rules", { test: true }, {}),
      1000000
    ),
    /already frozen/
  );
});

test("an ambiguous referee request is never resubmitted and reserves its full budget", async () => {
  const { deployment } = await refereeFixture();
  let posts = 0;
  const api = new ArenaRefereeApi(pool, "test-only-not-a-key", (async () => {
    posts++;
    throw new Error("Timeout");
  }) as typeof fetch);
  await api.reserve(
    deployment,
    "1",
    refereeRequest("Rules", { test: true }, {}),
    1000000
  );
  await assert.rejects(api.step(deployment, "1"), /replacement is blocked/);
  assert.equal((await api.step(deployment, "1")).state, "uncertain");
  assert.equal(posts, 1);
  const saved = (
    await pool.query<{
      reserved_microusd: string;
      actual_microusd: string | null;
    }>("SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1", [
      deployment
    ])
  ).rows[0]!;
  assert.equal(saved.reserved_microusd, "700000");
  assert.equal(saved.actual_microusd, null);
});

test("real combat validation locks one API candidate and maps fighter IDs to paid seats", async () => {
  const root = resolve("../..");
  const fixtures = resolve("src/arena/live/fixtures");
  const input = JSON.parse(
    readFileSync(resolve(fixtures, "pilot-input.json"), "utf8")
  );
  const outcome = JSON.parse(
    readFileSync(resolve(fixtures, "pilot-outcome.json"), "utf8")
  );
  for (const invalid of [false, true]) {
    const f = await fixture();
    for (let seat = 0; seat < 4; seat++)
      await f.service.submit(
        "1",
        accounts[seat]!.address,
        await f.submission(seat)
      );
    const frozen = await f.service.prepareInput("1", () => input);
    await f.emit("InputFrozen", {
      id: 1,
      inputHash: frozen.inputHash,
      strategyCommitments: frozen.commitments,
      deadline: Math.floor(Date.now() / 1000) + 3600
    });
    const candidate = structuredClone(outcome);
    if (invalid) candidate.championId = "not-a-participant";
    let requests = 0;
    const api = new ArenaRefereeApi(pool, "test-only-not-a-key", (async () => {
      requests++;
      return new Response(
        JSON.stringify({
          id: "resp_candidate",
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
    }) as typeof fetch);
    const adjudicator = new ArenaAdjudicator(
      pool,
      cipher,
      api,
      refereeSchema(root),
      productionValidator(root)
    );
    const first = await adjudicator.step(f.deployment, "1");
    const resumed = await adjudicator.step(f.deployment, "1");
    assert.equal(requests, 1);
    assert.deepEqual(first, resumed);
    assert.equal(first.state, invalid ? "invalid" : "valid");
    if (!("winners" in first)) throw new Error("Missing saved adjudication");
    assert.deepEqual(first.winners, invalid ? null : [1, 3, 3]);
    assert.equal(first.input_hash, frozen.inputHash);
    let broadcasts = 0;
    let seenReceipt = false;
    const serialized: Hex[] = [];
    const chain = {
      getChainId: async () => 8453,
      getBlock: async (options: { blockNumber?: bigint }) => ({
        number: options.blockNumber ?? 13n,
        hash: hash("a"),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      }),
      readContract: async () => ({
        phase: 3,
        inputHash: frozen.inputHash,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600)
      }),
      estimateGas: async () => 100000n,
      estimateFeesPerGas: async () => ({
        maxFeePerGas: 1000000n,
        maxPriorityFeePerGas: 100000n
      }),
      getTransactionCount: async () => 0,
      getTransactionReceipt: async ({ hash: txHash }: { hash: Hex }) => {
        if (!seenReceipt)
          throw new TransactionReceiptNotFoundError({ hash: txHash });
        return {
          transactionHash: txHash,
          blockNumber: 7n,
          blockHash: hash("a"),
          status: "success"
        };
      },
      sendRawTransaction: async ({
        serializedTransaction
      }: {
        serializedTransaction: Hex;
      }) => {
        broadcasts++;
        serialized.push(serializedTransaction);
        const persisted = await pool.query(
          "SELECT tx_hash FROM yunipals_arena.transaction_intent WHERE deployment=$1",
          [f.deployment]
        );
        assert.equal(
          persisted.rows[0].tx_hash,
          keccak256(serializedTransaction)
        );
        if (broadcasts === 1)
          throw new Error("Broadcast timeout after provider received it");
        seenReceipt = true;
        return keccak256(serializedTransaction);
      }
    } as unknown as PublicClient;
    const settlement = new ArenaSettlement(
      pool,
      chain,
      accounts[0]!,
      f.deployment,
      contract,
      1_000_000_000_000n
    );
    if (invalid) {
      await assert.rejects(settlement.prepare("1"), /validated, immutable/);
      assert.equal(broadcasts, 0);
    } else {
      const prepared = await settlement.prepare("1");
      assert.equal(broadcasts, 0);
      assert.deepEqual(await settlement.prepare("1"), prepared);
      await assert.rejects(settlement.advance("1"), /Broadcast timeout/);
      assert.equal((await settlement.advance("1")).state, "submitted");
      assert.equal(serialized[0], serialized[1]);
      assert.equal((await settlement.advance("1")).state, "confirmed");
      await settlement.advance("1");
      assert.equal(broadcasts, 2);
    }
  }
});

test("battle review exposes the exact settled referee request and validation without unrelated provider fields", async () => {
  const f = await fixture();
  const app = createArenaApp(f.service, { entriesEnabled: false });
  const validation = {
    valid: true,
    errors: [],
    matches: [
      {
        id: "SF1",
        health: { left: 30, right: 15 },
        energy: { left: 65, right: 75 }
      }
    ]
  };
  await pool.query(
    "INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,input_hash,outcome_hash,candidate,validation,state,winners) VALUES($1,1,$2,$3,$4,$5,'valid',$6)",
    [
      f.deployment,
      hash("e"),
      hash("f"),
      { matches: [] },
      validation,
      JSON.stringify([0, 2, 0])
    ]
  );
  await pool.query(
    "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,request,reserved_microusd) VALUES($1,1,'referee','candidate-1',$2,'completed',$3,700000)",
    [
      f.deployment,
      randomUUID(),
      {
        model: "saved-model",
        instructions: "Exact system instructions",
        input: "Exact frozen provider input",
        reasoning: { effort: "xhigh" },
        max_output_tokens: 32000,
        unrelatedPrivateField: "must-not-be-published"
      }
    ]
  );
  assert.equal((await app.request("/tournaments/1/result")).status, 404);
  await f.emit("InputFrozen", {
    id: 1,
    inputHash: hash("e"),
    strategyCommitments: [hash("a"), hash("b"), hash("c"), hash("d")],
    deadline: Math.floor(Date.now() / 1000) + 86400
  });
  assert.equal((await app.request("/tournaments/1/result")).status, 404);
  await f.emit("ResultSettled", {
    id: 1,
    resultHash: hash("f"),
    semifinalOneWinner: 0,
    semifinalTwoWinner: 2,
    champion: 0
  });
  const response = await app.request("/tournaments/1/result");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const value = await response.json();
  assert.deepEqual(value.validation, validation);
  assert.deepEqual(value.referee, {
    model: "saved-model",
    instructions: "Exact system instructions",
    input: "Exact frozen provider input",
    reasoningEffort: "xhigh",
    maxOutputTokens: 32000
  });
  assert.ok(!JSON.stringify(value).includes("must-not-be-published"));
  await pool.query(
    "UPDATE yunipals_arena.adjudication SET input_hash=$2 WHERE deployment=$1",
    [f.deployment, hash("a")]
  );
  assert.equal((await app.request("/tournaments/1/result")).status, 404);
});

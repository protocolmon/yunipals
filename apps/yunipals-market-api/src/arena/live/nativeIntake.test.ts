import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  arenaDomain,
  ARENA_STRATEGY_TYPES,
  strategyCommitment,
  type ArenaTournament
} from "@protopals/yunipals-market-core/arena";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { migrateArena } from "./schema";
import { arenaPrivateTables } from "./identitySchema";
import { createArenaApp } from "./http";
import type { NativeArenaObservation } from "./nativeSource";
import { transaction } from "@/db/pool";
import { ArenaIdentities, loadIdentityProfiles } from "./identity";
import { createAdmission } from "./admission";
import { ArenaInputCompiler, onchainIslandDraw } from "./input";
import { ARENA_POOL_HASH, loadLiveArenaCatalog } from "./catalog";
import { NativeArenaDisclosure } from "./nativeDisclosure";

async function fixture() {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/arena");
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await migrateArena(pool);
  const contract = `0x${randomBytes(20).toString("hex")}` as Address,
    deployment = `8453:${contract}`;
  const accounts = Array.from({ length: 4 }, () =>
    privateKeyToAccount(generatePrivateKey())
  );
  const hash = (value: string) => `0x${value.repeat(64)}` as Hex;
  const cipher = new StrategyCipher(randomBytes(32));
  let openingHash = hash("a");
  let frozen: NonNullable<NativeArenaObservation["tournament"]>["inputFrozen"] =
    null;
  let onVerify: (() => void) | undefined;
  const state: ArenaTournament = {
    id: "1",
    phase: "strategies",
    deadline: Math.floor(Date.now() / 1000) + 86400,
    rulesHash: hash("c"),
    poolHash: hash("d"),
    treasury: accounts[0]!.address.toLowerCase() as Address,
    islandId: "17",
    islandBeneficiary: accounts[1]!.address.toLowerCase() as Address,
    requestId: "1",
    randomWord: "42",
    ticket: 42,
    inputHash: null,
    commitments: null,
    resultHash: null,
    winners: null,
    videoHash: null,
    automaticStrategyMask: 0,
    seats: accounts.map((account, seat) => ({
      seat,
      player: account.address.toLowerCase() as Address,
      nftChainId: 8453,
      collection: "0x98433df878e8c898cb907345c3a7756e5f72240f",
      tokenId: String(seat + 1)
    }))
  };
  function observe(): NativeArenaObservation & {
    tournament: NonNullable<NativeArenaObservation["tournament"]>;
  } {
    const opened = {
      id: `${deployment}:${hash("b")}:0`,
      transactionHash: hash("b"),
      blockHash: openingHash,
      blockNumber: "1",
      logIndex: 0
    };
    return {
      releaseId: hash("e"),
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: "10",
      observedThroughBlock: "9",
      tournament: {
        deployment,
        id: "1",
        state: structuredClone(state),
        opened,
        last: frozen ?? opened,
        inputFrozen: frozen ? { ...frozen } : null,
        incarnation: manifestDigest({
          deployment,
          tournamentId: "1",
          openedEventId: opened.id,
          openedBlockHash: opened.blockHash
        })
      }
    };
  }
  const source = {
    read: async (id: string) =>
      id === "0" ? { ...observe(), tournament: null } : observe(),
    credit: async () => ({
      releaseId: hash("e"),
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: "10",
      observedThroughBlock: "9",
      amount: "123",
      last: null
    }),
    list: async () => ({
      releaseId: hash("e"),
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: "10",
      observedThroughBlock: "9",
      ids: ["1"]
    })
  };
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
    [deployment, contract]
  );
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://www.yunipals.com",
    cipher,
    {
      message: verifyMessage,
      strategy: async (input) => {
        onVerify?.();
        onVerify = undefined;
        return verifyTypedData(input);
      }
    },
    source
  );
  async function submission(seat: number, text = `Native secret ${seat}`) {
    const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
    const commitment = strategyCommitment(contract, 1n, seat, text, salt);
    const signature = await accounts[seat]!.signTypedData({
      domain: arenaDomain(contract),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: 1n, seat, commitment }
    });
    return {
      seat,
      text,
      salt,
      signature,
      incarnation: observe().tournament.incarnation
    };
  }
  function freeze(
    input: Awaited<ReturnType<ArenaIntake["prepareInput"]>>,
    blockHash = hash("f")
  ) {
    state.phase = "resolving";
    state.inputHash = input.inputHash;
    state.commitments = input.commitments;
    state.automaticStrategyMask = input.automaticStrategyMask;
    frozen = {
      id: `${deployment}:${hash("7")}:0`,
      transactionHash: hash("7"),
      blockNumber: "10",
      blockHash,
      logIndex: 0
    };
  }
  async function cleanup() {
    for (const table of arenaPrivateTables)
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    for (const table of ["session", "challenge", "credit"])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
    await pool.end();
  }
  return {
    pool,
    service,
    accounts,
    state,
    observe,
    submission,
    freeze,
    cleanup,
    deployment,
    hash,
    fork: () => {
      openingHash = hash("8");
      state.phase = "strategies";
      state.inputHash = null;
      state.commitments = null;
      frozen = null;
    },
    onVerify: (action: () => void) => {
      onVerify = action;
    }
  };
}

function entryFixture(f: Awaited<ReturnType<typeof fixture>>) {
  function open() {
    Object.assign(f.state, {
      phase: "open",
      deadline: 0,
      seats: [],
      islandId: null,
      islandBeneficiary: null,
      requestId: null,
      randomWord: null,
      ticket: null
    });
  }
  open();
  const profiles = loadIdentityProfiles(resolve("../.."));
  const profile = profiles[0]!;
  const nft = {
    nftChainId: 8453,
    collection: "0x98433df878e8c898cb907345c3a7756e5f72240f" as Address,
    tokenId: "1"
  };
  const metadata = (tokenId = nft.tokenId) => ({
    token: {
      chain: "base",
      chain_id: 8453,
      contract_address: nft.collection,
      token_id: tokenId,
      image: profile.image,
      attributes: [
        { trait_type: "Type", value: profile.species },
        { trait_type: "Color", value: profile.color },
        { trait_type: "Horn", value: profile.horn }
      ]
    }
  });
  const identities = (
    load = async (input: typeof nft) => metadata(input.tokenId)
  ) =>
    new ArenaIdentities(f.pool, f.deployment, profiles, load, (id) =>
      transaction(f.pool, (db) => f.service.tournamentContext(id, db, true))
    );
  const tags: string[] = [];
  const zero = f.hash("0");
  const client = {
    getChainId: async () => 8453,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag) tags.push(input.blockTag);
      const number = input.blockNumber ?? 10n;
      return {
        number,
        hash:
          number === 1n ? f.observe().tournament.opened.blockHash : f.hash("9"),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    },
    readContract: async (input: { functionName: string }) => {
      if (input.functionName === "ownerOf") return f.accounts[0]!.address;
      if (input.functionName === "entriesPaused") return false;
      if (input.functionName === "automaticStrategyMask") return 0;
      assert.equal(input.functionName, "tournament");
      return {
        phase: f.state.phase === "open" ? 1 : 2,
        count: f.state.seats.length,
        deadline: BigInt(f.state.deadline),
        inputHash: zero,
        resultHash: zero,
        requestId: 0n,
        randomnessReceived: false,
        randomWord: 0n,
        islandId: 0,
        islandBeneficiary: `0x${"0".repeat(40)}`,
        treasuryBeneficiary: f.state.treasury
      };
    }
  } as unknown as PublicClient;
  return {
    nft,
    metadata,
    identities,
    client,
    tags,
    fork: () => {
      f.fork();
      open();
    }
  };
}

test("native NFT snapshots remain bound to their opening across a reorg and slow metadata", async () => {
  const f = await fixture();
  try {
    const e = entryFixture(f);
    let loads = 0;
    const identities = e.identities(async (nft) => {
      loads++;
      return e.metadata(nft.tokenId);
    });
    await identities.ensure("1", e.nft);
    await identities.ensure("1", e.nft);
    assert.equal(loads, 1);
    e.fork();
    assert.equal(await identities.read("1", e.nft), null);
    await identities.ensure("1", e.nft);
    assert.equal(loads, 2);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(DISTINCT incarnation)::int AS n FROM yunipals_arena.fighter_snapshot WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      2
    );
  } finally {
    await f.cleanup();
  }
  const changed = await fixture();
  try {
    const e = entryFixture(changed);
    const identities = e.identities(async (nft) => {
      e.fork();
      return e.metadata(nft.tokenId);
    });
    await assert.rejects(identities.ensure("1", e.nft), /opening changed/);
    assert.equal(
      (
        await changed.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.fighter_snapshot WHERE deployment=$1",
          [changed.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await changed.cleanup();
  }
});

test("native entry permits use latest Base ownership and preserve separate opening records", async () => {
  const f = await fixture();
  try {
    const e = entryFixture(f),
      identities = e.identities();
    const admit = createAdmission(
      f.service,
      f.accounts[1]!,
      new Map([[8453, e.client]]),
      (id, nft) => identities.ensure(id, nft)
    );
    const first = await admit("1", f.accounts[0]!.address, {
      ...e.nft,
      incarnation: f.observe().tournament.incarnation
    });
    assert.equal(first.incarnation, f.observe().tournament.incarnation);
    assert.ok(e.tags.length > 0 && e.tags.every((tag) => tag === "latest"));
    e.fork();
    await assert.rejects(
      admit("1", f.accounts[0]!.address, {
        ...e.nft,
        incarnation: first.incarnation
      }),
      /opening changed/
    );
    const second = await admit("1", f.accounts[0]!.address, {
      ...e.nft,
      incarnation: f.observe().tournament.incarnation
    });
    assert.notEqual(first.incarnation, second.incarnation);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(DISTINCT incarnation)::int AS n FROM yunipals_arena.admission WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      2
    );
  } finally {
    await f.cleanup();
  }
});

test("native entry permits cannot survive an opening change during preparation or signing", async () => {
  for (const stage of ["metadata", "signing"]) {
    const f = await fixture();
    try {
      const e = entryFixture(f);
      const signTypedData: LocalAccount["signTypedData"] = async (
        parameters
      ) => {
        if (stage === "signing") e.fork();
        return f.accounts[1]!.signTypedData(parameters);
      };
      const signer = { ...f.accounts[1]!, signTypedData };
      const admit = createAdmission(
        f.service,
        signer,
        new Map([[8453, e.client]]),
        async () => {
          if (stage === "metadata") e.fork();
        }
      );
      await assert.rejects(
        admit("1", f.accounts[0]!.address, e.nft),
        /opening changed/
      );
      assert.equal(
        (
          await f.pool.query(
            "SELECT count(*)::int AS n FROM yunipals_arena.admission WHERE deployment=$1",
            [f.deployment]
          )
        ).rows[0].n,
        0
      );
    } finally {
      await f.cleanup();
    }
  }
});

test("native input preparation pins the opening while loading fighter snapshots", async () => {
  const f = await fixture();
  try {
    const e = entryFixture(f),
      catalog = loadLiveArenaCatalog(resolve("../.."));
    const draw = onchainIslandDraw(
      f.service.contract,
      "1",
      "42",
      catalog.pool.entries
    );
    Object.assign(f.state, {
      phase: "strategies",
      deadline: Math.floor(Date.now() / 1000) + 86400,
      rulesHash: catalog.rulesHash,
      poolHash: ARENA_POOL_HASH,
      randomWord: "42",
      requestId: "1",
      ticket: draw.ticket,
      islandId: draw.tokenId,
      islandBeneficiary: f.accounts[0]!.address.toLowerCase(),
      seats: f.accounts.map((a, seat) => ({
        seat,
        player: a.address.toLowerCase(),
        ...e.nft,
        tokenId: String(seat + 1)
      }))
    });
    const identities = e.identities();
    for (const seat of f.state.seats) await identities.ensure("1", seat);
    for (let seat = 0; seat < 4; seat++)
      await f.service.submit(
        "1",
        f.accounts[seat]!.address,
        await f.submission(seat)
      );
    const compiler = new ArenaInputCompiler(f.service, catalog, identities);
    assert.equal((await compiler.context("1")).ready, true);
    const prepared = await compiler.prepare("1");
    assert.equal(prepared.incarnation, f.observe().tournament.incarnation);
    const read = identities.read.bind(identities);
    let reads = 0;
    identities.read = async (...args) => {
      const value = await read(...args);
      if (++reads === 4) f.fork();
      return value;
    };
    await assert.rejects(compiler.context("1"), /opening changed/);
    await assert.rejects(
      f.service.prepareInput(
        "1",
        () => {
          throw new Error("old roster reached builder");
        },
        prepared.incarnation
      ),
      /opening changed/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.frozen_input WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      1
    );
  } finally {
    await f.cleanup();
  }
});

test("native intake, HTTP lists/balances and disclosure use no operational public projection", async () => {
  const f = await fixture();
  try {
    await f.service.ready();
    const originals = await Promise.all(
      f.accounts.map((_, seat) => f.submission(seat))
    );
    await Promise.all(
      originals.map((input, seat) =>
        f.service.submit("1", f.accounts[seat]!.address, input)
      )
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.tournament WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.chain_event WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
    assert.equal((await f.service.publicView("1")).strategies, null);
    const app = createArenaApp(f.service, { entriesEnabled: false });
    assert.equal(
      (await (await app.request("/config")).json()).confirmationPolicy,
      "latest"
    );
    const list = await app.request("/tournaments");
    assert.equal(list.status, 200);
    assert.equal((await list.json()).items.length, 1);
    const challenge = await f.service.challenge(f.accounts[0]!.address);
    const auth = await f.service.authenticate(
      challenge.id,
      await f.accounts[0]!.signMessage({ message: challenge.message })
    );
    await f.pool.query("INSERT INTO yunipals_arena.credit VALUES($1,$2,999)", [
      f.deployment,
      f.accounts[0]!.address.toLowerCase()
    ]);
    const me = await app.request("/me", {
      headers: { Cookie: `__Host-yunipals-arena=${auth.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).claimable, "123");
    const input = await f.service.prepareInput("1", (state, strategies) => ({
      roster: state.seats,
      strategies
    }));
    f.freeze(input);
    assert.equal((await f.service.publicView("1")).strategies, null);
    let checks = 0;
    assert.equal(
      await f.service.reconcileInputFrozen("1", async () => {
        checks++;
      }),
      true
    );
    assert.equal(
      (await f.service.publicView("1")).strategies?.[0]?.text,
      originals[0]!.text
    );
    assert.equal(
      await f.service.reconcileInputFrozen("1", async () => {
        checks++;
      }),
      true
    );
    assert.equal(checks, 1);
    f.freeze(input, f.hash("6"));
    assert.equal((await f.service.publicView("1")).strategies, null);
    await assert.rejects(
      f.service.reconcileInputFrozen("1", async () => {
        f.freeze(input, f.hash("5"));
      }),
      /changed during verification/
    );
    assert.equal((await f.service.publicView("1")).strategies, null);
    assert.equal(
      await f.service.reconcileInputFrozen("1", async () => {
        checks++;
      }),
      true
    );
    assert.equal((await f.service.publicView("1")).strategies?.length, 4);
    const oldIncarnation = f.observe().tournament.incarnation;
    f.fork();
    assert.deepEqual((await f.service.publicView("1")).submittedSeats, []);
    assert.equal((await f.service.publicView("1")).strategies, null);
    await assert.rejects(
      f.service.submit("1", f.accounts[0]!.address, originals[0]!),
      /opening changed/
    );
    await assert.rejects(
      f.service.submit("1", f.accounts[0]!.address, {
        ...originals[0]!,
        incarnation: f.observe().tournament.incarnation
      }),
      /fresh strategy/
    );
    await f.service.submit(
      "1",
      f.accounts[0]!.address,
      await f.submission(0, "Fresh after the fork")
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.submission WHERE deployment=$1 AND seat=0",
          [f.deployment]
        )
      ).rows[0].n,
      2
    );
    assert.notEqual(f.observe().tournament.incarnation, oldIncarnation);
    const legacy = new ArenaIntake(
      f.pool,
      f.deployment,
      f.service.contract,
      f.service.origin,
      new StrategyCipher(randomBytes(32)),
      { message: verifyMessage, strategy: verifyTypedData }
    );
    await assert.rejects(legacy.publicView("1"), /source selection/);
  } finally {
    await f.cleanup();
  }
});

test("native strategy verification cannot accept a submission into a replacement opening", async () => {
  const f = await fixture();
  try {
    const input = await f.submission(0);
    f.onVerify(() => f.fork());
    await assert.rejects(
      f.service.submit("1", f.accounts[0]!.address, input),
      /opening changed/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.submission WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await f.cleanup();
  }
});

test("native automatic commitments disclose only the prepared, matching fallback bundle", async () => {
  const f = await fixture();
  try {
    await f.service.submit("1", f.accounts[0]!.address, await f.submission(0));
    f.state.deadline = Math.floor(Date.now() / 1000) - 1;
    const input = await f.service.prepareInput("1", (state, strategies) => ({
      roster: state.seats,
      strategies
    }));
    assert.equal(input.automaticStrategyMask, 14);
    f.freeze(input);
    assert.equal(
      await f.service.reconcileInputFrozen("1", async () => {}),
      true
    );
    assert.equal(
      (await f.service.publicView("1")).strategies?.filter(
        (s) => s.source === "automatic"
      ).length,
      3
    );
  } finally {
    await f.cleanup();
  }
});

test("native disclosure worker leases private work and recovers failed or re-included freeze checks", async () => {
  const f = await fixture();
  try {
    for (let seat = 0; seat < 4; seat++)
      await f.service.submit(
        "1",
        f.accounts[seat]!.address,
        await f.submission(seat)
      );
    const input = await f.service.prepareInput("1", (state, strategies) => ({
      roster: state.seats,
      strategies
    }));
    f.freeze(input);
    let checks = 0,
      fail = false,
      block: Promise<void> | undefined;
    const work = new NativeArenaDisclosure(f.service, async () => {
      checks++;
      if (fail) throw new Error("injected canonical RPC failure");
      await block;
    });
    let release!: () => void;
    block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = work.tick();
    // Wait until verification starts, with a bounded deadline for broken leases.
    const deadline = Date.now() + 5000;
    while (checks === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(checks, 1);
    assert.equal((await work.tick()).checked, 0);
    release();
    assert.deepEqual(await first, {
      checked: 1,
      revealed: 1,
      waiting: 0,
      unavailable: 0
    });
    assert.equal((await f.service.publicView("1")).strategies?.length, 4);
    const due = () =>
      f.pool.query(
        "UPDATE yunipals_arena.frozen_input SET native_check_at=now()-interval '1 second' WHERE deployment=$1",
        [f.deployment]
      );
    await due();
    assert.equal((await work.tick()).revealed, 1);
    assert.equal(
      checks,
      1,
      "Matching canonical disclosures need no new RPC checks"
    );
    f.freeze(input, f.hash("6"));
    assert.equal((await f.service.publicView("1")).strategies, null);
    fail = true;
    await due();
    assert.equal((await work.tick()).unavailable, 1);
    assert.equal((await f.service.publicView("1")).strategies, null);
    fail = false;
    await due();
    assert.equal((await work.tick()).revealed, 1);
    assert.equal((await f.service.publicView("1")).strategies?.length, 4);
    // A crash leaves a timed lease. A fresh process may reclaim it after expiry.
    await f.pool.query(
      "UPDATE yunipals_arena.frozen_input SET native_check_at=now()-interval '1 second',native_check_lease=$2 WHERE deployment=$1",
      [f.deployment, crypto.randomUUID()]
    );
    assert.equal(
      (await new NativeArenaDisclosure(f.service, async () => {}).tick())
        .checked,
      1
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT native_check_lease FROM yunipals_arena.frozen_input WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].native_check_lease,
      null
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.chain_event WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await f.cleanup();
  }
});

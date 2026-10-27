import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import { manifestDigest } from "../../packages/yunipals-indexer-server/src/identity";
import {
  verifyNativeArenaAction,
  type NativeArenaActionObservation
} from "../../apps/yunipals-market-api/src/arena/live/nativeAction";
import {
  assertArenaSourceBinding,
  withArenaSourceLease
} from "../../apps/yunipals-market-api/src/arena/live/sourceSelection";
import { registerTournamentIdentity } from "../../apps/yunipals-market-api/src/arena/live/tournamentIdentity";
import { NativeArenaProvider } from "../../apps/yunipals-market-api/src/arena/live/nativeProvider";
import { ArenaIntake } from "../../apps/yunipals-market-api/src/arena/live/intake";
import {
  collection,
  contract,
  deployment,
  hash,
  productionRulesHash,
  strictPool,
  wallet
} from "./fixtures";

function observation(): NativeArenaActionObservation {
  const opened = {
    id: `${deployment}:${hash("1")}:0`,
    transactionHash: hash("1"),
    blockNumber: "10",
    blockHash: hash("a"),
    logIndex: 0
  };
  const freeze = {
    id: `${deployment}:${hash("2")}:1`,
    transactionHash: hash("2"),
    blockNumber: "12",
    blockHash: hash("b"),
    logIndex: 1
  };
  return {
    releaseId: hash("c"),
    sourceId: `arena:${deployment}`,
    indexedThroughBlock: "20",
    observedThroughBlock: "20",
    tournament: {
      deployment,
      id: "1",
      opened,
      last: freeze,
      inputFrozen: freeze,
      incarnation: manifestDigest({
        deployment,
        tournamentId: "1",
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      }),
      state: {
        id: "1",
        phase: "resolving",
        deadline: Math.floor(Date.now() / 1000) + 3600,
        rulesHash: productionRulesHash,
        poolHash: hash("d"),
        treasury: wallet,
        islandId: "17",
        islandBeneficiary: wallet,
        requestId: "1",
        randomWord: "42",
        ticket: 0,
        seats: [0, 1, 2, 3].map((seat) => ({
          seat,
          player: wallet,
          nftChainId: 1,
          collection,
          tokenId: String(seat + 1)
        })),
        inputHash: hash("e"),
        commitments: [hash("f"), hash("f"), hash("f"), hash("f")],
        resultHash: null,
        winners: null,
        videoHash: null,
        automaticStrategyMask: 0
      }
    }
  };
}

function pointClient(observed: NativeArenaActionObservation) {
  const calls: string[] = [];
  const state = {
    orphan: false,
    changed: false,
    stale: false,
    wrongChain: false
  };
  const client = {
    getChainId: async () => (state.wrongChain ? 1 : 8453),
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({
      number: blockNumber ?? 20n,
      timestamp: BigInt(
        Math.floor(Date.now() / 1000) - (state.stale ? 1000 : 0)
      ),
      hash:
        blockNumber === 10n
          ? state.orphan
            ? hash("9")
            : hash("a")
          : blockNumber === 12n
            ? hash("b")
            : hash("8")
    }),
    readContract: async ({
      functionName,
      blockNumber
    }: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      calls.push(functionName);
      assert.equal(blockNumber, 20n);
      const s = observed.tournament.state;
      if (functionName === "automaticStrategyMask")
        return s.automaticStrategyMask ?? 0;
      assert.equal(functionName, "tournament");
      return {
        phase: state.changed ? 4 : 3,
        count: 4,
        deadline: BigInt(s.deadline),
        inputHash: s.inputHash,
        resultHash: hash("0"),
        requestId: 1n,
        randomnessReceived: true,
        randomWord: 42n,
        islandId: 17,
        islandBeneficiary: wallet,
        treasuryBeneficiary: wallet,
        semifinalOneWinner: 0,
        semifinalTwoWinner: 0,
        champion: 0
      };
    }
  } as unknown as PublicClient;
  return { client, calls, state };
}

test("actual native point verifier accepts latest canonical state and refuses orphan/stale/changed/other-chain proofs", async () => {
  const observed = observation(),
    positive = pointClient(observed);
  await verifyNativeArenaAction(positive.client, observed);
  assert.deepEqual(positive.calls.sort(), [
    "automaticStrategyMask",
    "tournament"
  ]);
  for (const change of ["orphan", "changed", "stale", "wrongChain"] as const) {
    const negative = pointClient(observed);
    negative.state[change] = true;
    await assert.rejects(verifyNativeArenaAction(negative.client, observed));
  }
});

test("actual source epoch fence holds a shared lease through an effect and blocks a stale actor before its effect", async () => {
  const binding = {
    epoch: "epoch-one",
    kind: "unified" as const,
    sourceId: hash("c")
  };
  let epoch = binding.epoch,
    effects = 0;
  const f = strictPool((sql) => {
    if (sql.startsWith("SELECT pg_advisory_")) return [];
    assert.ok(sql.startsWith("SELECT epoch,kind,source_id"));
    return [{ epoch, kind: binding.kind, source_id: binding.sourceId }];
  });
  const service = {
    pool: f.pool,
    deployment,
    nativeSource: {},
    assertSourceSelection: async (db = f.pool) =>
      assertArenaSourceBinding(db, deployment, binding)
  };
  await withArenaSourceLease(service, async () => {
    assert.ok(f.calls[0]!.sql.includes("pg_advisory_lock_shared"));
    assert.ok(!f.calls.some((row) => row.sql.includes("unlock")));
    effects++;
  });
  assert.equal(effects, 1);
  assert.ok(f.calls.at(-1)!.sql.includes("pg_advisory_unlock_shared"));
  epoch = "epoch-two";
  await assert.rejects(
    withArenaSourceLease(service, async () => {
      effects++;
    }),
    /epoch changed/
  );
  assert.equal(effects, 1);
  assert.equal(f.releases(), 2);
});

test("actual durable identity registration separates reused IDs by verified opening and rejects forged incarnations before writes", async () => {
  const identities = new Map<string, Record<string, unknown>>();
  const f = strictPool((sql, args) => {
    if (sql.startsWith("SELECT indexer_mode,halted"))
      return [{ indexer_mode: "unified", halted: false }];
    if (sql.includes("incarnation='legacy'")) return [];
    if (sql.startsWith("INSERT INTO yunipals_arena.tournament_identity")) {
      identities.set(String(args[2]), {
        deployment: args[0],
        tournament_id: args[1],
        incarnation: args[2],
        opened_event_id: args[3],
        opened_block_hash: args[4],
        bound_release_id: args[5],
        cipher_context: args[6]
      });
      return [];
    }
    if (sql.startsWith("SELECT deployment,tournament_id"))
      return [identities.get(String(args[2]))!];
    throw new Error("Unexpected identity acceptance SQL");
  });
  const first = observation();
  const saved = await registerTournamentIdentity(f.pool, first);
  assert.equal(
    saved.cipher_context,
    `${deployment}/1/${first.tournament.incarnation}`
  );
  const second = observation();
  second.tournament.opened.blockHash = hash("9");
  second.tournament.incarnation = manifestDigest({
    deployment,
    tournamentId: "1",
    openedEventId: second.tournament.opened.id,
    openedBlockHash: hash("9")
  });
  await registerTournamentIdentity(f.pool, second);
  assert.equal(identities.size, 2);
  const calls = f.calls.length;
  second.tournament.incarnation = first.tournament.incarnation;
  await assert.rejects(
    registerTournamentIdentity(f.pool, second),
    /Invalid observed Arena identity/
  );
  assert.equal(f.calls.length, calls);
});

test("actual native provider claim rechecks disclosure and incarnation before recording a new paid effect", async () => {
  let current = observation(),
    disclosed = true,
    funding = 0;
  const writes: { sql: string; args: readonly unknown[] }[] = [];
  const f = strictPool((sql, args) => {
    if (sql.startsWith("SELECT f.ciphertext")) {
      assert.equal(args[2], current.tournament.incarnation);
      assert.equal(args[4], current.tournament.inputFrozen!.id);
      return disclosed ? [{ ciphertext: "synthetic-encrypted-input" }] : [];
    }
    if (sql.startsWith("UPDATE yunipals_arena.provider_task")) {
      writes.push({ sql, args });
      return [{ request_id: "synthetic-request" }];
    }
    if (sql.startsWith("INSERT INTO yunipals_arena.provider_action_evidence")) {
      writes.push({ sql, args });
      return [];
    }
    throw new Error("Unexpected provider acceptance SQL");
  });
  const service = {
    pool: f.pool,
    deployment,
    nativeSource: {},
    ready: async () => {},
    tournamentContext: async () => ({
      state: structuredClone(current.tournament.state),
      incarnation: current.tournament.incarnation,
      observation: structuredClone(current)
    })
  } as unknown as ArenaIntake;
  const provider = new NativeArenaProvider(
    service,
    async (seen) => verifyNativeArenaAction(pointClient(seen).client, seen),
    async () => {
      funding++;
    }
  );
  const authorized = await provider.authorize(
    "1",
    "referee",
    current.tournament.incarnation
  );
  assert.equal(funding, 1);
  const original = current;
  current = observation();
  current.tournament.opened.blockHash = hash("9");
  current.tournament.incarnation = manifestDigest({
    deployment,
    tournamentId: "1",
    openedEventId: current.tournament.opened.id,
    openedBlockHash: hash("9")
  });
  await assert.rejects(
    provider.claim("synthetic-request", "referee", authorized),
    /context changed/
  );
  assert.equal(writes.length, 0);
  current = original;
  assert.equal(
    await provider.claim("synthetic-request", "referee", authorized),
    true
  );
  assert.equal(writes.length, 2);
  assert.equal(writes[0]!.args[3], original.tournament.incarnation);
  assert.deepEqual(writes[1]!.args[1], authorized.proof);
  disclosed = false;
  await assert.rejects(
    provider.authorize("1", "referee", current.tournament.incarnation),
    /disclosure proof/
  );
  assert.equal(
    funding,
    1,
    "missing disclosure must refuse before funding or provider work"
  );
});

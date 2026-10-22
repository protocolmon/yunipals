import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arenaNativeConfiguration,
  nativeTournamentState
} from "./nativeSource";
import { arenaRuntime } from "./runtime";

test("legacy runtime entrypoints reject native selection before loading runtime credentials", async () => {
  const changes = {
    ARENA_INDEXER_MODE: "unified",
    ARENA_INDEXER_DATABASE_URL: "postgres://localhost/test",
    ARENA_INDEXER_RELEASE_ID: `0x${"1".repeat(64)}`
  };
  const prior = Object.fromEntries(
    Object.keys(changes).map((key) => [key, process.env[key]])
  );
  try {
    Object.assign(process.env, changes);
    await assert.rejects(arenaRuntime(), /has not enabled native consumers/);
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("native Arena selection requires explicit mode and a pinned source release", () => {
  assert.deepEqual(arenaNativeConfiguration({}), { mode: "legacy" });
  assert.throws(() =>
    arenaNativeConfiguration({ ARENA_INDEXER_MODE: "other" })
  );
  assert.throws(() =>
    arenaNativeConfiguration({
      ARENA_INDEXER_RELEASE_ID: "0x" + "1".repeat(64)
    })
  );
  assert.throws(() =>
    arenaNativeConfiguration({
      ARENA_INDEXER_MODE: "unified",
      ARENA_INDEXER_DATABASE_URL: "postgres://localhost/test"
    })
  );
  const env = {
    ARENA_INDEXER_MODE: "unified",
    ARENA_INDEXER_DATABASE_URL: "postgres://localhost/test",
    ARENA_INDEXER_RELEASE_ID: "0x" + "1".repeat(64)
  };
  assert.equal(arenaNativeConfiguration(env).mode, "unified");
  assert.throws(() =>
    arenaNativeConfiguration({
      ...env,
      ARENA_INDEXER_DATABASE_URL: "https://example.invalid"
    })
  );
});

test("native public state validation rejects coercions and malformed rosters before application use", () => {
  const state = {
    id: "1",
    phase: "open",
    deadline: 0,
    rulesHash: "0x" + "a".repeat(64),
    poolHash: "0x" + "b".repeat(64),
    treasury: null,
    islandId: null,
    islandBeneficiary: null,
    requestId: null,
    randomWord: null,
    ticket: null,
    seats: [],
    inputHash: null,
    commitments: null,
    resultHash: null,
    winners: null,
    videoHash: null,
    automaticStrategyMask: 0
  };
  assert.equal(nativeTournamentState(state).phase, "open");
  for (const malformed of [
    null,
    [],
    { ...state, deadline: "0" },
    { ...state, id: String(2n ** 256n) },
    { ...state, automaticStrategyMask: 16 },
    {
      ...state,
      seats: [
        {
          seat: 1,
          player: "0x" + "1".repeat(40),
          collection: "0x" + "2".repeat(40),
          nftChainId: 8453,
          tokenId: "1"
        }
      ]
    },
    { ...state, winners: [0, 1, 4] },
    { ...state, commitments: ["0x" + "a".repeat(64)] }
  ])
    assert.throws(() => nativeTournamentState(malformed));
});

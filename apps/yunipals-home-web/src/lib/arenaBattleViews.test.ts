import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArenaTournamentSummary } from "@protopals/yunipals-market-core/arenaViews";
import { matchesArenaBattleView } from "./arenaBattleViews";

const battle: ArenaTournamentSummary = {
  id: "2",
  phase: "open",
  deadline: 2000,
  islandId: null,
  islandBeneficiary: null,
  submittedSeats: [],
  automaticStrategyMask: 0,
  videoReady: false,
  payoutsReleased: false,
  championSeat: null,
  fighters: []
};
const now = 1000000;

test("join queues exclude full, timed-out and non-open tournaments", () => {
  assert.equal(matchesArenaBattleView(battle, "queues", now), true);
  assert.equal(
    matchesArenaBattleView({ ...battle, deadline: 0 }, "queues", now),
    true
  );
  assert.equal(
    matchesArenaBattleView({ ...battle, deadline: 1000 }, "queues", now),
    false
  );
  const fighter = {
    seat: 0,
    player: `0x${"1".repeat(40)}`,
    chainId: 8453,
    collection: `0x${"2".repeat(40)}`,
    tokenId: "1",
    name: "Yunipal",
    image: null
  } as const;
  assert.equal(
    matchesArenaBattleView(
      { ...battle, fighters: [fighter, fighter, fighter, fighter] },
      "queues",
      now
    ),
    false
  );
  for (const phase of [
    "strategies",
    "resolving",
    "settled",
    "expired"
  ] as const) {
    assert.equal(
      matchesArenaBattleView({ ...battle, phase }, "queues", now),
      false
    );
  }
});

test("a settled battle remains in progress until its film is ready", () => {
  const rendering = { ...battle, phase: "settled" as const };
  assert.equal(matchesArenaBattleView(rendering, "ongoing", now), true);
  assert.equal(matchesArenaBattleView(rendering, "completed", now), false);
  assert.equal(
    matchesArenaBattleView({ ...rendering, videoReady: true }, "ongoing", now),
    false
  );
  assert.equal(
    matchesArenaBattleView(
      { ...rendering, videoReady: true },
      "completed",
      now
    ),
    true
  );
});

test("public completed films exclude every queue, strategy and refund state", () => {
  for (const phase of ["open", "strategies", "resolving", "expired"] as const) {
    assert.equal(
      matchesArenaBattleView(
        { ...battle, phase, videoReady: true },
        "completed",
        now
      ),
      false
    );
  }
});

test("all history retains every phase while refunds stay separate", () => {
  for (const phase of [
    "open",
    "strategies",
    "resolving",
    "settled",
    "expired"
  ] as const) {
    assert.equal(
      matchesArenaBattleView({ ...battle, phase }, "all", now),
      true
    );
    assert.equal(
      matchesArenaBattleView({ ...battle, phase }, "refunded", now),
      phase === "expired"
    );
  }
});

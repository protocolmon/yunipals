import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoosterOriginal } from "@protopals/yunipals-market-core/boosters";
import { allDailyOriginals, dailyClaimPlan } from "./boosterDailyClaims";

const account = "0x1111111111111111111111111111111111111111";
const deployment = {
  engine: "0x2222222222222222222222222222222222222222",
  monsters: "0x3333333333333333333333333333333333333333",
  registry: "0x4444444444444444444444444444444444444444"
} as const;
function original(
  tokenId: string,
  overrides: Partial<BoosterOriginal> = {}
): BoosterOriginal {
  return {
    id: tokenId,
    tokenId,
    collection: deployment.monsters,
    typeKey: "2",
    engine: deployment.engine,
    owner: account,
    revealedAt: "100",
    dailyCommitted: "0",
    minted: "1",
    remaining: "263",
    pendingRequest: null,
    burned: false,
    pack: {
      id: "2",
      packTypeId: "2",
      registry: deployment.registry,
      engine: deployment.engine,
      paymentToken: account,
      price: "0",
      intervalSeconds: "10",
      mintsPerInterval: 1,
      totalVariants: "264",
      maxBatch: 7,
      catalogHash: "0x",
      ruleHash: "0x",
      manifestUri: "",
      metadataBaseUri: "",
      salesPaused: false,
      openings: "1"
    },
    ...overrides
  };
}
test("all pages are loaded; cycles and incomplete loads never become a partial open-all", async () => {
  const cursors: (string | null)[] = [];
  const items = await allDailyOriginals(async (cursor) => {
    cursors.push(cursor);
    return {
      items: [original(cursor ? "8" : "7")],
      nextCursor: cursor ? null : "next"
    };
  });
  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(
    items.map((item) => item.tokenId),
    ["7", "8"]
  );
  await assert.rejects(
    allDailyOriginals(async () => ({ items: [], nextCursor: "cycle" })),
    /Could not load all/
  );
  await assert.rejects(
    allDailyOriginals(async (cursor) => {
      if (cursor) throw Error("offline");
      return { items: [original("7")], nextCursor: "next" };
    }),
    /offline/
  );
});
test("claim plan deduplicates originals and excludes foreign, burned, pending and unrevealed cards", () => {
  const items = [
    original("7"),
    original("7"),
    original("8", { pendingRequest: "9" }),
    original("9", { burned: true }),
    original("10", { owner: deployment.engine }),
    original("11", { engine: account }),
    original("12", { collection: account }),
    original("13", { revealedAt: null }),
    original("14", { dailyCommitted: "20" })
  ];
  assert.deepEqual(
    dailyClaimPlan(items, account, deployment, 300n).map(
      ({ original, quantity }) => [original.tokenId, quantity]
    ),
    [["7", 7]]
  );
  assert.equal(
    dailyClaimPlan([original("7")], account, deployment, 120n)[0].quantity,
    2
  );
  const smaller = original("15");
  smaller.pack.maxBatch = 3;
  assert.equal(
    dailyClaimPlan([smaller], account, deployment, 300n)[0].quantity,
    3
  );
});

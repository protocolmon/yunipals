import assert from "node:assert/strict";
import { test } from "node:test";
import { createArenaApp } from "../../apps/yunipals-market-api/src/arena/live/http";
import { ArenaIntake } from "../../apps/yunipals-market-api/src/arena/live/intake";
import {
  canonicalJson,
  sha256
} from "../../apps/yunipals-market-api/src/arena/draw";
import type { ArenaBrowseRequest } from "../../packages/yunipals-indexer-server/src/arena";
import {
  collection,
  contract,
  deployment,
  hash,
  origin,
  productionRulesHash,
  strictPool,
  wallet
} from "./fixtures";

function fixture() {
  const incarnation = hash("1"),
    releaseId = hash("2");
  const state = {
    id: "12",
    phase: "settled",
    deadline: 1900000000,
    rulesHash: productionRulesHash,
    poolHash: hash("3"),
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
    inputHash: hash("4"),
    commitments: [hash("5"), hash("5"), hash("5"), hash("5")],
    resultHash: hash("6"),
    winners: [0, 2, 0],
    videoHash: null,
    automaticStrategyMask: 0
  };
  const image = {
    chainId: 1,
    collection,
    tokenId: "1",
    name: "Current native opening",
    image: "https://example.invalid/native-current.png"
  };
  let drift = false,
    unavailable = false,
    fences = 0;
  const requests: ArenaBrowseRequest[] = [];
  const pool = strictPool((sql, args) => {
    if (sql === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
      return [];
    assert.ok(
      !/(?:FROM|JOIN)\s+yunipals_arena\.(?:tournament|chain_event|credit)\b/.test(
        sql
      ),
      "unified browsing must never read legacy public projections"
    );
    const rows = JSON.parse(String(args[1]));
    assert.equal(rows[0].id, state.id);
    assert.equal(rows[0].incarnation, incarnation);
    assert.ok(
      sql.includes("s.incarnation=n.incarnation") ||
        sql.includes("m.incarnation=n.incarnation")
    );
    if (sql.startsWith("SELECT n.id,s.seat"))
      return [{ id: state.id, seat: 0 }];
    if (sql.startsWith("SELECT n.id,n.incarnation,s.nft_chain_id"))
      return [
        {
          id: state.id,
          incarnation,
          nft_chain_id: 1,
          collection,
          token_id: "1",
          snapshot: image,
          snapshot_hash: sha256(canonicalJson(image))
        }
      ];
    if (sql.startsWith("SELECT n.id,n.incarnation,p.manifest")) return [];
    throw new Error(
      "Unexpected operational query while browsing native history"
    );
  });
  const source = {
    browse: async (request: ArenaBrowseRequest) => {
      requests.push(request);
      if (unavailable) throw new Error("synthetic canonical frame unavailable");
      const frame = {
        releaseId,
        sourceId: `arena:${deployment}`,
        indexedThroughBlock: "52960000",
        observedThroughBlock: "52960001",
        cursorAnchor: { number: "52960000", hash: hash("a") },
        rows:
          request.kind === "tournaments"
            ? [
                {
                  id: state.id,
                  state: structuredClone(state),
                  incarnation,
                  inputFrozen: null
                },
                {
                  id: "11",
                  state: { ...structuredClone(state), id: "11" },
                  incarnation: hash("7"),
                  inputFrozen: null
                }
              ]
            : [],
        events:
          request.kind === "timeline"
            ? [
                {
                  n: "129",
                  event_name: "TournamentOpened",
                  args: { id: "12" },
                  transaction_hash: hash("8"),
                  block_number: "20",
                  log_index: 0,
                  state
                }
              ]
            : request.kind === "rewards"
              ? [
                  {
                    n: "128",
                    event_name: "PayoutsReleased",
                    args: { id: "12" },
                    transaction_hash: hash("9"),
                    block_number: "21",
                    log_index: 0,
                    state: { ...state, videoHash: hash("a") }
                  }
                ]
              : [],
        totals:
          request.kind === "wallet"
            ? {
                entered_tournaments: "1",
                entered_seats: "4",
                hosted_tournaments: "1",
                championships: "1",
                winnings: "6000000",
                hosting: "400000",
                operations: "1600000",
                refunds: "0",
                pending: "0"
              }
            : null,
        island:
          request.kind === "island"
            ? { hosted: "1", released: "400000", pending: "0" }
            : null,
        amount: "6200000",
        withdrawals: "200000"
      };
      if (drift && requests.length % 2 === 0) frame.amount = "different-frame";
      return frame;
    }
  };
  const service = {
    pool: pool.pool,
    deployment,
    contract,
    origin,
    indexerMode: "unified",
    nativeSource: source,
    sourceSelection: {
      epoch: "synthetic-native-epoch",
      kind: "unified",
      sourceId: releaseId
    },
    assertSourceSelection: async () => {
      fences++;
    },
    ready: async () => {},
    wallet: async () => {
      throw new Error("public browse must not authenticate");
    }
  } as unknown as ArenaIntake;
  return {
    app: createArenaApp(service, { entriesEnabled: false }),
    pool,
    requests,
    fences: () => fences,
    drift: () => {
      drift = true;
    },
    unavailable: () => {
      unavailable = true;
    }
  };
}

test("actual unified HTTP history, wallet rewards and timeline use native frames with incarnation-bound private enrichment only", async () => {
  const f = fixture();
  const page = await f.app.request("/tournaments?limit=1");
  assert.equal(page.status, 200);
  const history = await page.json();
  assert.equal(history.items[0].fighters[0].name, "Current native opening");
  assert.deepEqual(history.items[0].submittedSeats, [0]);
  assert.equal(typeof history.nextCursor, "string");
  assert.equal(f.requests[0]!.kind, "tournaments");
  assert.equal(f.requests[0]!.limit, 2);
  assert.deepEqual(f.requests[1]!.cursorAnchor, {
    number: "52960000",
    hash: hash("a")
  });
  assert.deepEqual(
    JSON.parse(Buffer.from(history.nextCursor, "base64url").toString()).anchor,
    { number: "52960000", hash: hash("a") }
  );
  const summary = await f.app.request(`/wallets/${wallet}/summary`);
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).indexedThroughBlock, "52960000");
  const rewards = await f.app.request(`/wallets/${wallet}/rewards`);
  assert.equal(rewards.status, 200);
  assert.deepEqual(
    (await rewards.json()).items.map((r: { kind: string }) => r.kind),
    ["winner", "host", "operations"]
  );
  const timeline = await f.app.request("/tournaments/12/timeline");
  assert.equal(timeline.status, 200);
  assert.equal((await timeline.json()).items[0].event, "TournamentOpened");
  assert.ok(
    f.fences() >= 12,
    "source selection must remain fenced through public reads"
  );
  assert.ok(
    f.pool.calls.some((row) => row.sql.includes("s.incarnation=n.incarnation"))
  );
});

test("unavailable or changing native frames fail closed instead of returning legacy history", async () => {
  const unavailable = fixture();
  unavailable.unavailable();
  assert.equal(
    (await unavailable.app.request(`/wallets/${wallet}/summary`)).status,
    503
  );
  const changing = fixture();
  changing.drift();
  assert.equal(
    (await changing.app.request(`/wallets/${wallet}/summary`)).status,
    503
  );
  assert.ok(
    !unavailable.pool.calls.some((row) =>
      row.sql.includes("yunipals_arena.tournament")
    )
  );
  assert.ok(
    !changing.pool.calls.some((row) =>
      row.sql.includes("yunipals_arena.tournament")
    )
  );
});

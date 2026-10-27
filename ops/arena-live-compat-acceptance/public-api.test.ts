import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { createArenaApp } from "../../apps/yunipals-market-api/src/arena/live/http";
import {
  ArenaIntake,
  ArenaRequestError
} from "../../apps/yunipals-market-api/src/arena/live/intake";
import { PreparingIdentity } from "../../apps/yunipals-market-api/src/arena/live/identityAnalysis";
import { ARENA_ISLANDS } from "../../apps/yunipals-market-api/src/arena/live/catalog";
import {
  collection,
  contract,
  deployment,
  hash,
  origin,
  otherWallet,
  productionRulesHash,
  strictPool,
  wallet
} from "./fixtures";

function state(id = "12"): ArenaTournament {
  return {
    id,
    phase: "settled",
    deadline: 1900000000,
    rulesHash: productionRulesHash,
    poolHash: hash("2"),
    treasury: wallet,
    islandId: "17",
    islandBeneficiary: wallet,
    requestId: "4",
    randomWord: "42",
    ticket: 0,
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      player: seat === 0 ? wallet : otherWallet,
      nftChainId: 1,
      collection,
      tokenId: String(seat + 1)
    })),
    inputHash: hash("3"),
    commitments: [hash("4"), hash("4"), hash("4"), hash("4")],
    resultHash: hash("5"),
    winners: [0, 2, 0],
    videoHash: hash("6"),
    automaticStrategyMask: 0
  };
}

function fixture() {
  const released = state(),
    pending = state("11"),
    expired = state("10");
  pending.videoHash = null;
  pending.islandBeneficiary = otherWallet;
  pending.treasury = otherWallet;
  expired.phase = "expired";
  expired.videoHash = null;
  expired.winners = null;
  expired.islandBeneficiary = otherWallet;
  expired.treasury = otherWallet;
  expired.seats[1]!.player = wallet;
  const events = [
    {
      n: "129",
      event_name: "Claimed",
      args: { player: wallet, recipient: otherWallet, amount: "200000" },
      transaction_hash: hash("7"),
      block_number: "30",
      log_index: 0,
      state: null
    },
    {
      n: "128",
      event_name: "PayoutsReleased",
      args: { id: released.id },
      transaction_hash: hash("8"),
      block_number: "29",
      log_index: 1,
      state: released
    },
    {
      n: "127",
      event_name: "TournamentExpired",
      args: { id: expired.id },
      transaction_hash: hash("9"),
      block_number: "28",
      log_index: 2,
      state: expired
    }
  ];
  const data = strictPool((sql, args) => {
    if (sql.startsWith("SELECT t.id::text,t.state"))
      return [
        {
          id: released.id,
          state: released,
          submitted: [0, 1],
          video_ready: true
        },
        { id: pending.id, state: pending, submitted: [], video_ready: false }
      ];
    if (sql.startsWith("SELECT tournament_id::text,nft_chain_id"))
      return [
        {
          tournament_id: released.id,
          nft_chain_id: 1,
          collection,
          token_id: "1",
          snapshot: {
            name: "Reviewed Yunipal",
            image: "https://example.invalid/synthetic.png"
          }
        }
      ];
    if (sql.startsWith("SELECT state FROM yunipals_arena.tournament"))
      return [released, pending, expired].map((value) => ({ state: value }));
    if (sql.startsWith("SELECT amount::text FROM yunipals_arena.credit"))
      return [{ amount: "6200000" }];
    if (sql.includes("sum((args->>'amount')::numeric)"))
      return [{ amount: "200000" }];
    if (sql.startsWith("SELECT cursor::text")) return [{ cursor: "52960000" }];
    if (sql.startsWith("WITH records AS")) return events;
    if (sql.startsWith("SELECT event_name,transaction_hash"))
      return [
        {
          event_name: "TournamentOpened",
          transaction_hash: hash("a"),
          block_number: "20",
          log_index: 0
        }
      ];
    if (sql.startsWith("SELECT count(*)::text AS hosted"))
      return [{ hosted: "2", released: "400000", pending: "400000" }];
    throw new Error(`Unexpected offline acceptance SQL: ${sql.slice(0, 100)}`);
  });
  let walletCalls = 0,
    ready = true;
  const service = {
    pool: data.pool,
    deployment,
    contract,
    origin,
    indexerMode: "legacy",
    sourceSelection: undefined,
    ready: async () => {
      if (!ready) throw new ArenaRequestError(503, "source fence denied");
    },
    assertSourceSelection: async () => {
      if (!ready) throw new ArenaRequestError(503, "source fence denied");
    },
    wallet: async (token?: string) => {
      walletCalls++;
      if (token !== "synthetic-session")
        throw new ArenaRequestError(401, "Sign in first.");
      return wallet;
    },
    state: async () => released,
    publicView: async () => ({ ...released, submittedSeats: [0, 1] })
  } as unknown as ArenaIntake;
  return {
    service,
    data,
    walletCalls: () => walletCalls,
    unavailable: () => {
      ready = false;
    }
  };
}

function authenticated() {
  return { Origin: origin, Cookie: "__Host-yunipals-arena=synthetic-session" };
}

test("real HTTP config/rules expose both modern launch modes and the selected-source policy", async () => {
  for (const mode of ["pilot", "public"] as const) {
    const f = fixture();
    const app = createArenaApp(f.service, {
      entriesEnabled: true,
      launchMode: mode,
      rules: { rulesHash: productionRulesHash, manifest: { synthetic: true } }
    });
    const response = await app.request("/config");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).entryMode, mode);
    const rules = await app.request("/rules");
    assert.equal(rules.status, 200);
    assert.equal((await rules.json()).rulesHash, productionRulesHash);
    assert.equal(rules.headers.get("cache-control"), "no-store");
  }
  const f = fixture();
  const app = createArenaApp(f.service, {
    entriesEnabled: false,
    launchMode: "public"
  });
  assert.equal(
    (await (await app.request("/config")).json()).entryMode,
    "closed"
  );
  f.unavailable();
  assert.equal((await app.request("/health")).status, 503);
  assert.equal((await app.request("/tournaments")).status, 503);
  assert.equal((await app.request(`/wallets/${wallet}/summary`)).status, 503);
  assert.equal(
    f.data.calls.filter((row) =>
      row.sql.includes("FROM yunipals_arena.tournament")
    ).length,
    0
  );
});

test("public history is bounded, cursor-filter-bound and preserves reviewed fighter images", async () => {
  const f = fixture(),
    app = createArenaApp(f.service, { entriesEnabled: false });
  const response = await app.request(
    `/tournaments?wallet=${wallet}&role=entrant&status=completed&limit=1`
  );
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "12");
  assert.equal(page.items[0].fighters[0].name, "Reviewed Yunipal");
  assert.equal(
    page.items[0].fighters[0].image,
    "https://example.invalid/synthetic.png"
  );
  assert.equal(page.items[0].payoutsReleased, true);
  assert.equal(typeof page.nextCursor, "string");
  const mismatched = await app.request(
    `/tournaments?wallet=${wallet}&role=host&cursor=${page.nextCursor}`
  );
  assert.equal(mismatched.status, 400);
  assert.equal((await app.request("/tournaments?limit=51")).status, 400);
  assert.equal((await app.request("/tournaments?role=host")).status, 400);
  assert.equal(f.walletCalls(), 0, "public history must not require a session");
  const sql = f.data.calls.find((row) =>
    row.sql.startsWith("SELECT t.id::text,t.state")
  )!;
  assert.deepEqual(sql.args.slice(2), [
    wallet,
    "entrant",
    "completed",
    null,
    2
  ]);
});

test("real summary/reward APIs distinguish released, pending, refunds and aggregate withdrawals", async () => {
  const f = fixture(),
    app = createArenaApp(f.service, { entriesEnabled: false });
  const summary = await app.request(`/wallets/${wallet}/summary`);
  assert.equal(summary.status, 200);
  const value = await summary.json();
  assert.equal(value.enteredTournaments, 3);
  assert.equal(value.enteredSeats, 4);
  assert.equal(value.entryPayments, "8000000");
  assert.equal(value.winnings, "6000000");
  assert.equal(value.hostingRewards, "400000");
  assert.equal(value.operationsRewards, "1600000");
  assert.equal(value.refunds, "4000000");
  assert.equal(value.pending, "6000000");
  assert.equal(value.withdrawals, "200000");
  assert.equal(value.available, "6200000");
  const rewards = await app.request(`/wallets/${wallet}/rewards`);
  assert.equal(rewards.status, 200);
  const items = (await rewards.json()).items;
  assert.deepEqual(
    items.map((row: { kind: string; amount: string }) => [
      row.kind,
      row.amount
    ]),
    [
      ["withdrawal", "200000"],
      ["winner", "6000000"],
      ["host", "400000"],
      ["operations", "1600000"],
      ["refund", "4000000"]
    ]
  );
  assert.equal(
    items[0].tournamentId,
    null,
    "aggregate withdrawal must not be assigned to one tournament"
  );
  assert.equal(items[0].recipient, otherWallet);
  assert.equal(f.walletCalls(), 0);
  assert.equal((await app.request("/me/summary")).status, 401);
  assert.equal(
    (await app.request("/me/summary", { headers: authenticated() })).status,
    200
  );
});

test("island history and chain-event timeline remain real public HTTP capabilities", async () => {
  const f = fixture(),
    app = createArenaApp(f.service, { entriesEnabled: false });
  const island = await app.request(`/islands/8453/${ARENA_ISLANDS}/17/arena`);
  assert.equal(island.status, 200);
  const view = await island.json();
  assert.equal(view.hostedTournaments, 2);
  assert.equal(view.releasedRewards, "400000");
  assert.equal(view.pendingRewards, "400000");
  assert.equal(
    (await app.request(`/islands/1/${ARENA_ISLANDS}/17/arena`)).status,
    400
  );
  const timeline = await app.request("/tournaments/12/timeline");
  assert.equal(timeline.status, 200);
  assert.deepEqual((await timeline.json()).items, [
    {
      event: "TournamentOpened",
      transactionHash: hash("a"),
      blockNumber: "20",
      logIndex: 0
    }
  ]);
});

test("artwork preparation stays authenticated and responds before any payment permit", async () => {
  const f = fixture();
  let admissionCalls = 0;
  const app = createArenaApp(f.service, {
    entriesEnabled: true,
    launchMode: "public",
    admit: async () => {
      admissionCalls++;
      throw new PreparingIdentity("d".repeat(64));
    },
    identityStatus: async (key) => ({ key, state: "preparing" })
  });
  const request = {
    method: "POST",
    headers: { ...authenticated(), "Content-Type": "application/json" },
    body: JSON.stringify({ nftChainId: 1, collection, tokenId: "1" })
  };
  const response = await app.request("/tournaments/12/admission", request);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    identityState: "preparing",
    key: "d".repeat(64)
  });
  assert.equal(admissionCalls, 1);
  assert.equal(
    f.data.calls.length,
    0,
    "no transaction/permit write is performed by an artwork-preparing response"
  );
  assert.equal(
    (await app.request(`/identities/${"d".repeat(64)}`)).status,
    401
  );
  assert.equal(
    (
      await app.request(`/identities/${"d".repeat(64)}`, {
        headers: authenticated()
      })
    ).status,
    200
  );
  assert.equal(
    (
      await app.request("/tournaments/12/admission", {
        ...request,
        headers: { ...request.headers, Origin: "https://attacker.invalid" }
      })
    ).status,
    403
  );
});

test("modern HTTP keeps incarnation/publication selectors on native film access", async () => {
  const f = fixture();
  let seen: unknown[] = [];
  const app = createArenaApp(f.service, {
    entriesEnabled: false,
    media: {
      status: async () => ({ state: "ready" }),
      artifact: async (...args) => {
        seen = args;
        return new Response("synthetic-film");
      }
    }
  });
  const response = await app.request(
    `/tournaments/12/artifacts/film.mp4?origin=${hash("1")}&publication=${hash("2")}`,
    { headers: { Range: "bytes=0-9" } }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [
    "12",
    "film.mp4",
    "bytes=0-9",
    { incarnation: hash("1"), publication: hash("2") }
  ]);
  assert.equal(
    (await app.request("/tournaments/12/artifacts/film.mp4?origin=invalid"))
      .status,
    400
  );
});

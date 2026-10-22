import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import type { Address, Hex } from "viem";
import { expect, it } from "vitest";
import type { ArenaTournament } from "../../../packages/yunipals-market-core/src/arena.js";
import { projectEvent } from "../../yunipals-market-api/src/arena/live/projection.js";
import { applyArenaEvent } from "../lib/arena/state.js";

it("matches the existing Arena projector for public state, payouts, claims and expiry refunds", async () => {
  const database = new PGlite();
  const wallet = `0x${"12".repeat(20)}` as Address;
  const hash = `0x${"ab".repeat(32)}` as Hex;
  const deployment = `8453:${wallet}`;
  const states = new Map<string, ArenaTournament>();
  const credits = new Map<string, bigint>();
  const db = {
    query: async (text: string, values?: unknown[]) => {
      const result = await database.query(text, values);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    }
  } as unknown as PoolClient;
  try {
    await database.exec(`
      CREATE SCHEMA yunipals_arena;
      CREATE TABLE yunipals_arena.chain_event (
        deployment text, block_number bigint, block_hash text, transaction_hash text,
        log_index integer, event_name text, args jsonb,
        PRIMARY KEY(deployment,transaction_hash,log_index)
      );
      CREATE TABLE yunipals_arena.tournament (
        deployment text, id numeric, state jsonb, updated_at timestamptz DEFAULT now(),
        PRIMARY KEY(deployment,id)
      );
      CREATE TABLE yunipals_arena.credit (
        deployment text, wallet text, amount numeric CHECK(amount >= 0), PRIMARY KEY(deployment,wallet)
      );
      CREATE TABLE yunipals_arena.submission (deployment text,tournament_id numeric,seat integer,commitment text);
      CREATE TABLE yunipals_arena.frozen_input (deployment text,tournament_id numeric,input_hash text,revealed_at timestamptz);
    `);
    let logIndex = 0;
    const apply = async (eventName: string, args: Record<string, unknown>) => {
      const previous =
        args.id === undefined ? null : (states.get(String(args.id)) ?? null);
      const transition = applyArenaEvent(previous, eventName, args);
      if (transition.state) states.set(transition.state.id, transition.state);
      for (const change of transition.credits) {
        credits.set(
          change.wallet,
          (credits.get(change.wallet) ?? 0n) + change.amount
        );
      }
      await projectEvent(db, deployment, {
        eventName,
        args,
        blockNumber: 100n,
        blockHash: hash,
        transactionHash: hash,
        logIndex: logIndex++
      });
      const stored = await database.query<{
        id: string;
        state: ArenaTournament;
      }>("SELECT id::text,state FROM yunipals_arena.tournament");
      for (const row of stored.rows)
        expect(states.get(row.id)).toEqual(row.state);
      const balances = await database.query<{ wallet: string; amount: string }>(
        "SELECT wallet,amount::text FROM yunipals_arena.credit"
      );
      expect(balances.rows).toHaveLength(credits.size);
      for (const row of balances.rows)
        expect(credits.get(row.wallet)).toBe(BigInt(row.amount));
    };
    await apply("TournamentOpened", {
      id: 1n,
      deadline: 1000n,
      rulesHash: hash,
      poolHash: hash
    });
    await apply("TournamentTreasuryAssigned", { id: 1n, beneficiary: wallet });
    await apply("JoinWindowStarted", { id: 1n, deadline: 1100n });
    for (let seat = 0; seat < 4; seat++) {
      await apply("Entered", {
        id: 1n,
        seat,
        player: wallet,
        nftChainId: 8453n,
        collection: wallet,
        tokenId: BigInt(seat + 1)
      });
    }
    await apply("IslandRequested", { id: 1n, requestId: 7n });
    await apply("RandomnessReceived", { id: 1n, word: 42n });
    await apply("IslandSelected", {
      id: 1n,
      islandId: 1n,
      ticket: 0n,
      beneficiary: wallet
    });
    await apply("StrategiesOpened", { id: 1n, deadline: 1200n });
    await apply("InputFrozen", {
      id: 1n,
      inputHash: hash,
      strategyCommitments: [hash, hash, hash, hash],
      deadline: 1300n
    });
    await apply("ResultSettled", {
      id: 1n,
      resultHash: hash,
      semifinalOneWinner: 0,
      semifinalTwoWinner: 2,
      champion: 0
    });
    await apply("PayoutsReleased", { id: 1n, videoHash: hash });
    expect(credits.get(wallet)).toBe(8_000_000n);
    await apply("Claimed", {
      player: wallet,
      recipient: wallet,
      amount: 8_000_000n
    });
    expect(credits.get(wallet)).toBe(0n);
    await apply("TournamentOpened", {
      id: 2n,
      deadline: 2000n,
      rulesHash: hash,
      poolHash: hash
    });
    await apply("Entered", {
      id: 2n,
      seat: 0,
      player: wallet,
      nftChainId: 1n,
      collection: wallet,
      tokenId: 2n
    });
    await apply("TournamentExpired", { id: 2n });
    expect(credits.get(wallet)).toBe(2_000_000n);
    expect(() =>
      applyArenaEvent(states.get("2")!, "TournamentExpired", { id: 2n })
    ).toThrow(/expiry/);
    expect(() =>
      applyArenaEvent(states.get("1")!, "PayoutsReleased", {
        id: 1n,
        videoHash: hash
      })
    ).toThrow(/payout release/);
  } finally {
    await database.close();
  }
});

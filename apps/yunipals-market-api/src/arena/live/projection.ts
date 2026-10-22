import type { PoolClient } from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { automaticStrategy } from "@protopals/yunipals-market-core/arena";

export type ArenaEvent = {
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  eventName: string;
  args: Record<string, unknown>;
};
export const json = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v
  );
function decimal(value: unknown) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text))
    throw new Error("Invalid event integer.");
  return text;
}
const address = (value: unknown) => String(value).toLowerCase() as Address;

async function credit(
  db: PoolClient,
  deployment: string,
  wallet: Address,
  amount: bigint
) {
  if (amount < 0n) {
    const result = await db.query(
      "UPDATE yunipals_arena.credit SET amount=amount+$3 WHERE deployment=$1 AND wallet=$2",
      [deployment, wallet.toLowerCase(), amount.toString()]
    );
    if (result.rowCount !== 1)
      throw new Error("Claim has no preceding credit.");
    return;
  }
  await db.query(
    `INSERT INTO yunipals_arena.credit VALUES($1,$2,$3)
    ON CONFLICT(deployment,wallet) DO UPDATE SET amount=yunipals_arena.credit.amount+EXCLUDED.amount`,
    [deployment, wallet.toLowerCase(), amount.toString()]
  );
}

// Caller holds the deployment lock and commits events, projections and cursor together.
export async function projectEvent(
  db: PoolClient,
  deployment: string,
  event: ArenaEvent
) {
  const inserted = await db.query(
    `INSERT INTO yunipals_arena.chain_event
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [
      deployment,
      event.blockNumber.toString(),
      event.blockHash,
      event.transactionHash,
      event.logIndex,
      event.eventName,
      json(event.args)
    ]
  );
  if (!inserted.rowCount) return;
  const a = event.args;
  if (event.eventName === "Claimed") {
    await credit(db, deployment, address(a.player), -BigInt(decimal(a.amount)));
    return;
  }
  if (a.id === undefined) return;
  const id = decimal(a.id);
  let state: ArenaTournament;
  if (event.eventName === "TournamentOpened") {
    state = {
      id,
      phase: "open",
      deadline: Number(a.deadline),
      rulesHash: a.rulesHash as Hex,
      poolHash: a.poolHash as Hex,
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
    await db.query(
      "INSERT INTO yunipals_arena.tournament(deployment,id,state) VALUES($1,$2,$3)",
      [deployment, id, json(state)]
    );
    return;
  }
  const result = await db.query<{ state: ArenaTournament }>(
    "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2 FOR UPDATE",
    [deployment, id]
  );
  if (!result.rows[0])
    throw new Error("Arena event has no preceding tournament.");
  state = result.rows[0].state;
  switch (event.eventName) {
    case "TournamentTreasuryAssigned":
      state.treasury = address(a.beneficiary);
      break;
    case "JoinWindowStarted":
      state.deadline = Number(a.deadline);
      break;
    case "Entered": {
      const seat = Number(a.seat);
      if (seat !== state.seats.length || seat > 3)
        throw new Error("Invalid arena seat order.");
      state.seats.push({
        seat,
        player: address(a.player),
        nftChainId: Number(a.nftChainId),
        collection: address(a.collection),
        tokenId: decimal(a.tokenId)
      });
      break;
    }
    case "IslandRequested":
      state.requestId = decimal(a.requestId);
      break;
    case "RandomnessReceived":
      state.randomWord = decimal(a.word);
      break;
    case "IslandSelected":
      state.islandId = decimal(a.islandId);
      state.ticket = Number(a.ticket);
      state.islandBeneficiary = address(a.beneficiary);
      break;
    case "StrategiesOpened":
      state.phase = "strategies";
      state.deadline = Number(a.deadline);
      break;
    case "AutomaticStrategiesAssigned":
      if (
        state.phase !== "strategies" ||
        !Number.isInteger(Number(a.seatMask)) ||
        Number(a.seatMask) < 1 ||
        Number(a.seatMask) > 15
      )
        throw new Error("Invalid automatic strategy assignment.");
      state.automaticStrategyMask = Number(a.seatMask);
      break;
    case "InputFrozen": {
      state.phase = "resolving";
      state.deadline = Number(a.deadline);
      state.inputHash = a.inputHash as Hex;
      state.commitments = a.strategyCommitments as Hex[];
      // Publishing requires the SAME prepared input, exact player commitments and
      // deterministic automatic commitments for the explicitly assigned seats.
      const submissions = await db.query<{ seat: number; commitment: Hex }>(
        "SELECT seat,commitment FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat",
        [deployment, id]
      );
      const mask = state.automaticStrategyMask ?? 0;
      const configured = mask
        ? (
            await db.query<{ contract: Address }>(
              "SELECT contract FROM yunipals_arena.deployment WHERE id=$1",
              [deployment]
            )
          ).rows[0]
        : null;
      const matches = [0, 1, 2, 3].every((seat) => {
        const submission = submissions.rows.find((s) => s.seat === seat);
        if ((mask & (1 << seat)) === 0)
          return submission?.commitment === state.commitments?.[seat];
        // An accepted prompt must never be replaced by a server fallback.
        if (submission || !configured || state.randomWord === null)
          return false;
        return (
          automaticStrategy(
            configured.contract,
            BigInt(id),
            seat,
            state.rulesHash,
            BigInt(state.randomWord)
          ).commitment === state.commitments?.[seat]
        );
      });
      if (matches) {
        await db.query(
          "UPDATE yunipals_arena.frozen_input SET revealed_at=now() WHERE deployment=$1 AND tournament_id=$2 AND input_hash=$3",
          [deployment, id, state.inputHash]
        );
      }
      break;
    }
    case "ResultSettled": {
      if (
        state.phase !== "resolving" ||
        !state.treasury ||
        !state.islandBeneficiary
      )
        throw new Error("Invalid settlement projection.");
      state.phase = "settled";
      state.resultHash = a.resultHash as Hex;
      state.winners = [
        Number(a.semifinalOneWinner),
        Number(a.semifinalTwoWinner),
        Number(a.champion)
      ];
      break;
    }
    case "PayoutsReleased": {
      if (
        state.phase !== "settled" ||
        state.videoHash ||
        !state.winners ||
        !state.treasury ||
        !state.islandBeneficiary ||
        !/^0x[0-9a-f]{64}$/i.test(String(a.videoHash)) ||
        /^0x0{64}$/i.test(String(a.videoHash))
      )
        throw new Error("Invalid payout release projection.");
      state.videoHash = a.videoHash as Hex;
      const winner = state.seats[state.winners[2]];
      if (!winner) throw new Error("Missing winning seat.");
      await credit(db, deployment, winner.player, 6_000_000n);
      await credit(db, deployment, state.islandBeneficiary, 400_000n);
      await credit(db, deployment, state.treasury, 1_600_000n);
      break;
    }
    case "TournamentExpired":
      if (state.phase === "settled" || state.phase === "expired")
        throw new Error("Invalid expiry projection.");
      state.phase = "expired";
      for (const seat of state.seats)
        await credit(db, deployment, seat.player, 2_000_000n);
      break;
  }
  await db.query(
    "UPDATE yunipals_arena.tournament SET state=$3,updated_at=now() WHERE deployment=$1 AND id=$2",
    [deployment, id, json(state)]
  );
}

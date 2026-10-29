import type { Address, Hex } from "viem";
import { arenaEconomics } from "../../../../packages/yunipals-market-core/src/anime.js";
import type { ArenaTournament } from "../../../../packages/yunipals-market-core/src/arena.js";

export type ArenaCreditChange = { wallet: Address; amount: bigint };
export type ArenaTransition = {
  state: ArenaTournament | null;
  credits: ArenaCreditChange[];
};

function decimal(value: unknown): string {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || BigInt(text) >= 2n ** 256n) {
    throw new Error("Invalid Arena event integer.");
  }
  return text;
}
function integer(value: unknown): number {
  const number = Number(decimal(value));
  if (!Number.isSafeInteger(number))
    throw new Error("Invalid Arena event integer.");
  return number;
}
function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value)) {
    throw new Error("Invalid Arena event address.");
  }
  return value.toLowerCase() as Address;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Invalid Arena event hash.");
  }
  return value.toLowerCase() as Hex;
}

// Public chain state only. Private strategy validation/disclosure and paid jobs
// remain application work and cannot be triggered by replaying this reducer.
export function applyArenaEvent(
  previous: ArenaTournament | null,
  eventName: string,
  args: Record<string, unknown>,
  mediaKind: "video" | "anime" = "video"
): ArenaTransition {
  const credits: ArenaCreditChange[] = [];
  if (eventName === "Claimed") {
    const amount = BigInt(decimal(args.amount));
    if (amount === 0n) throw new Error("Invalid zero Arena claim.");
    return {
      state: null,
      credits: [{ wallet: address(args.player), amount: -amount }]
    };
  }
  if (args.id === undefined) return { state: null, credits };
  const id = decimal(args.id);
  if (eventName === "TournamentOpened") {
    if (previous) throw new Error("Arena tournament already exists.");
    return {
      state: {
        id,
        phase: "open",
        deadline: integer(args.deadline),
        rulesHash: hash(args.rulesHash),
        poolHash: hash(args.poolHash),
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
      },
      credits
    };
  }
  if (!previous || previous.id !== id)
    throw new Error("Arena event has no preceding tournament.");
  const state = structuredClone(previous);
  switch (eventName) {
    case "TournamentTreasuryAssigned":
      state.treasury = address(args.beneficiary);
      break;
    case "JoinWindowStarted":
      state.deadline = integer(args.deadline);
      break;
    case "Entered": {
      const seat = integer(args.seat);
      if (seat !== state.seats.length || seat > 3)
        throw new Error("Invalid Arena seat order.");
      state.seats.push({
        seat,
        player: address(args.player),
        nftChainId: integer(args.nftChainId),
        collection: address(args.collection),
        tokenId: decimal(args.tokenId)
      });
      break;
    }
    case "IslandRequested":
      state.requestId = decimal(args.requestId);
      break;
    case "RandomnessReceived":
      state.randomWord = decimal(args.word);
      break;
    case "IslandSelected":
      state.islandId = decimal(args.islandId);
      state.ticket = integer(args.ticket);
      state.islandBeneficiary = address(args.beneficiary);
      break;
    case "StrategiesOpened":
      state.phase = "strategies";
      state.deadline = integer(args.deadline);
      break;
    case "AutomaticStrategiesAssigned": {
      const mask = integer(args.seatMask);
      if (state.phase !== "strategies" || mask < 1 || mask > 15)
        throw new Error("Invalid automatic strategy assignment.");
      state.automaticStrategyMask = mask;
      break;
    }
    case "InputFrozen": {
      if (
        !Array.isArray(args.strategyCommitments) ||
        args.strategyCommitments.length !== 4
      ) {
        throw new Error("Invalid Arena strategy commitments.");
      }
      state.phase = "resolving";
      state.deadline = integer(args.deadline);
      state.inputHash = hash(args.inputHash);
      state.commitments = args.strategyCommitments.map(hash);
      break;
    }
    case "ResultSettled": {
      if (
        state.phase !== "resolving" ||
        !state.treasury ||
        !state.islandBeneficiary
      ) {
        throw new Error("Invalid Arena settlement projection.");
      }
      const winners: [number, number, number] = [
        integer(args.semifinalOneWinner),
        integer(args.semifinalTwoWinner),
        integer(args.champion)
      ];
      if (winners.some((seat) => seat > 3))
        throw new Error("Invalid Arena winning seat.");
      state.phase = "settled";
      state.resultHash = hash(args.resultHash);
      state.winners = winners;
      break;
    }
    case "PayoutsReleased": {
      const videoHash = hash(args.videoHash);
      if (
        state.phase !== "settled" ||
        state.videoHash ||
        !state.winners ||
        !state.treasury ||
        !state.islandBeneficiary ||
        /^0x0{64}$/.test(videoHash)
      ) {
        throw new Error("Invalid Arena payout release projection.");
      }
      const winner = state.seats[state.winners[2]];
      if (!winner) throw new Error("Missing Arena winning seat.");
      state.videoHash = videoHash;
      credits.push(
        {
          wallet: winner.player,
          amount: BigInt(arenaEconomics(mediaKind).winner)
        },
        {
          wallet: state.islandBeneficiary,
          amount: BigInt(arenaEconomics(mediaKind).island)
        },
        {
          wallet: state.treasury,
          amount: BigInt(arenaEconomics(mediaKind).operations)
        }
      );
      break;
    }
    case "TournamentExpired":
      if (state.phase === "settled" || state.phase === "expired")
        throw new Error("Invalid Arena expiry projection.");
      state.phase = "expired";
      credits.push(
        ...state.seats.map((seat) => ({
          wallet: seat.player,
          amount: BigInt(arenaEconomics(mediaKind).entry)
        }))
      );
      break;
    default:
      throw new Error("Unsupported Arena tournament event.");
  }
  return { state, credits };
}

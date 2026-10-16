import type { Address, Hex } from "viem";
import type { ArenaPhase } from "./arena";

export type ArenaListStatus = "all" | "active" | "completed" | "refunded";
export type ArenaHistoryRole = "any" | "entrant" | "host";
export type ArenaTournamentSummary = {
  id: string;
  phase: ArenaPhase;
  deadline: number;
  islandId: string | null;
  islandBeneficiary: Address | null;
  submittedSeats: number[];
  automaticStrategyMask: number;
  videoReady: boolean;
  payoutsReleased: boolean;
  championSeat: number | null;
  fighters: Array<{
    seat: number;
    player: Address;
    chainId: number;
    collection: Address;
    tokenId: string;
    name: string;
    image: string | null;
  }>;
};
export type ArenaHistoryPage = {
  items: ArenaTournamentSummary[];
  nextCursor: string | null;
};
export type ArenaWalletSummary = {
  wallet: Address;
  enteredTournaments: number;
  enteredSeats: number;
  hostedTournaments: number;
  championships: number;
  entryPayments: string;
  winnings: string;
  hostingRewards: string;
  operationsRewards: string;
  refunds: string;
  withdrawals: string;
  available: string;
  pending: string;
  indexedThroughBlock: string | null;
};
export type ArenaRewardRecord = {
  id: string;
  kind: "winner" | "host" | "operations" | "refund" | "withdrawal";
  tournamentId: string | null;
  islandId: string | null;
  wallet: Address;
  recipient: Address;
  amount: string;
  transactionHash: Hex;
  blockNumber: string;
};
export type ArenaRewardsPage = {
  items: ArenaRewardRecord[];
  nextCursor: string | null;
};
export type ArenaTimelineEvent = {
  event: string;
  transactionHash: Hex;
  blockNumber: string;
  logIndex: number;
};
export type ArenaIslandHistory = ArenaHistoryPage & {
  chainId: 8453;
  collection: Address;
  tokenId: string;
  hostedTournaments: number;
  releasedRewards: string;
  pendingRewards: string;
};

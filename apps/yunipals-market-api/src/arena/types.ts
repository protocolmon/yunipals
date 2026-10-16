// Browser-safe wire types. Private strategy storage lives in store.ts.
export type Fighter = {
  id: string;
  name: string;
  tokenId: string;
  chain: string;
  species: string;
  identity: string;
  image: string;
  sourcePage: string;
  locomotion: "ground" | "flight";
};

export type Island = {
  tokenId: string;
  edition: "Genesis" | "Personal";
  weight: number;
  name: string;
  image: string;
  profileSha256: string;
  profile: Record<string, unknown>;
  traits: Record<string, string>;
};

export type ArenaRules = {
  version: string;
  strategyMaxLength: number;
  combat: Record<string, unknown>;
  refereeInstructions: string;
};

export type Draw = {
  mode: "test-randomness";
  requestId: string;
  requestedAt: string;
  fulfilledAt: string | null;
  word: string | null;
  ticket: number | null;
  algorithm: "sha256-rejection-weighted-v1";
};

export type FrozenInput = {
  version: "arena-lab-v1";
  tournamentId: string;
  mode: "local-lab";
  rules: ArenaRules;
  pool: {
    chainId: 8453;
    contract: string;
    sha256: string;
    entries: Array<
      Pick<Island, "tokenId" | "edition" | "weight" | "profileSha256">
    >;
  };
  draw: Draw;
  island: Island;
  roster: Fighter[];
  semifinals: [string, string][];
  strategies: Array<{ fighterId: string; text: string }>;
};

export type TournamentView = {
  id: string;
  mode: "local-lab";
  createdAt: string;
  phase:
    | "waiting-for-players"
    | "drawing-island"
    | "collecting-strategies"
    | "revealed";
  pool: {
    sha256: string;
    count: number;
    totalWeight: number;
    genesisWeight: number;
    personalWeight: number;
  };
  rulesVersion: string;
  rulesSha256: string;
  rules: ArenaRules;
  tiePriority: string[];
  draw: Draw | null;
  island: Island | null;
  seats: Array<{ fighter: Fighter; submitted: boolean }>;
  semifinals: [string, string][];
  submissionCount: number;
  revealedAt: string | null;
  strategies: FrozenInput["strategies"] | null;
  inputSha256: string | null;
  resolution: "not-ready" | "ready-for-referee";
};

export type LabCatalog = {
  mode: "local-lab";
  fighters: Fighter[];
  islandCount: number;
  genesisCount: number;
  personalCount: number;
  genesisWeight: number;
  personalWeight: number;
  strategyMaxLength: number;
  rulesVersion: string;
};

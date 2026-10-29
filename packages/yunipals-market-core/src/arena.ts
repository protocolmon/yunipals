import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
  type Hex
} from "viem";

export const ARENA_CHAIN_ID = 8453;
export const ARENA_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const ARENA_ENTRY_FEE = 2_000_000n;
export const ARENA_STRATEGY_LIMIT = 2400;
export const ARENA_RESOLUTION_SECONDS = 86400;
export const ARENA_FALLBACK_ATTACKS = [
  "Move within reach and use quick direct strikes whenever recovered. Otherwise recover and face the opponent.",
  "Move within reach and use heavy direct body strikes whenever recovered. Otherwise recover and face the opponent.",
  "Approach the opponent's exposed side and use quick direct strikes, recovering between attacks.",
  "Approach the opponent's exposed side and use heavy direct body strikes, recovering between attacks."
] as const;

export function automaticStrategy(
  contract: Address,
  tournamentId: bigint,
  seat: number,
  rulesHash: Hex,
  word: bigint
) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || tournamentId <= 0n)
    throw new Error("Invalid automatic strategy seat.");
  const common = [
    8453n,
    contract,
    tournamentId,
    seat,
    rulesHash,
    word
  ] as const;
  const attack = Number(
    BigInt(
      keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
            { type: "uint8" },
            { type: "bytes32" },
            { type: "uint256" }
          ],
          [
            keccak256(stringToHex("yunipals-arena/automatic-attack/v1")),
            ...common
          ]
        )
      )
    ) % 4n
  );
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint8" }
      ],
      [
        keccak256(stringToHex("yunipals-arena/automatic-commitment/v1")),
        ...common,
        attack
      ]
    )
  );
  return {
    seat,
    text: ARENA_FALLBACK_ATTACKS[attack]!,
    commitment,
    salt: `0x${"0".repeat(64)}` as Hex,
    signature: "0x" as Hex,
    source: "automatic" as const
  };
}
export const ARENA_ENTRY_TYPES = {
  EntryPermit: [
    { name: "tournamentId", type: "uint256" },
    { name: "player", type: "address" },
    { name: "nftChainId", type: "uint256" },
    { name: "collection", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "expiry", type: "uint256" }
  ]
} as const;
export const ARENA_STRATEGY_TYPES = {
  StrategyApproval: [
    { name: "tournamentId", type: "uint256" },
    { name: "seat", type: "uint8" },
    { name: "commitment", type: "bytes32" }
  ]
} as const;

export function arenaDomain(contract: Address) {
  return {
    name: "YunipalsArena",
    version: "1",
    chainId: ARENA_CHAIN_ID,
    verifyingContract: contract
  } as const;
}

// Normalize before showing the wallet confirmation; this exact text is adjudicated.
export function canonicalStrategy(text: string) {
  const normalized = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (
    !normalized ||
    normalized.length > ARENA_STRATEGY_LIMIT ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)
  )
    throw new Error(
      `Strategy must contain 1–${ARENA_STRATEGY_LIMIT} characters.`
    );
  return normalized;
}

export function strategyCommitment(
  contract: Address,
  tournamentId: bigint,
  seat: number,
  text: string,
  salt: Hex
) {
  if (
    !/^(0x)[a-fA-F0-9]{64}$/.test(salt) ||
    !Number.isInteger(seat) ||
    seat < 0 ||
    seat > 3 ||
    tournamentId <= 0n
  )
    throw new Error("Invalid strategy commitment parameters.");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" }
      ],
      [
        keccak256(stringToHex("yunipals-arena/strategy/v1")),
        BigInt(ARENA_CHAIN_ID),
        contract,
        tournamentId,
        seat,
        keccak256(stringToHex(canonicalStrategy(text))),
        salt
      ]
    )
  );
}

export type ArenaPhase =
  | "open"
  | "strategies"
  | "resolving"
  | "settled"
  | "expired";
export type ArenaSeat = {
  seat: number;
  player: Address;
  nftChainId: number;
  collection: Address;
  tokenId: string;
};

export type ArenaTransactionAction =
  | {
      kind: "entry";
      tournamentId: string;
      incarnation?: Hex;
      nftChainId: number;
      collection: Address;
      tokenId: string;
    }
  | { kind: "approval"; tournamentId: string; incarnation?: Hex }
  | { kind: "claim" };
export type ArenaTransactionStatus = {
  hash: Hex;
  action: ArenaTransactionAction;
  state:
    | "submitted"
    | "confirming"
    | "indexing"
    | "indexed"
    | "failed"
    | "delayed"
    | "reorged";
  indexedThroughBlock: string | null;
  finalized?: boolean;
  receiptBlockHash?: Hex | null;
  trackingExpiresAt?: string;
  result: {
    event: "Entered" | "Claimed" | "Approval";
    blockNumber: string;
    logIndex: number;
    seat?: number;
    amount?: string;
  } | null;
};
export type ArenaTournament = {
  id: string;
  phase: ArenaPhase;
  deadline: number;
  rulesHash: Hex;
  poolHash: Hex;
  treasury: Address | null;
  islandId: string | null;
  islandBeneficiary: Address | null;
  requestId: string | null;
  randomWord: string | null;
  ticket: number | null;
  seats: ArenaSeat[];
  inputHash: Hex | null;
  commitments: Hex[] | null;
  resultHash: Hex | null;
  winners: [number, number, number] | null;
  videoHash: Hex | null;
  automaticStrategyMask?: number;
};

export type ArenaPublicTournament = ArenaTournament & {
  incarnation?: Hex;
  serverTime?: number;
  projection?: {
    throughBlock: string | null;
    ready: boolean;
    checkedAt: string | null;
  };
  submittedSeats: number[];
  strategies: Array<{
    loadout?: [string, string];
    seat: number;
    text: string;
    salt: Hex;
    commitment: Hex;
    signature: Hex;
    source?: "player" | "automatic";
  }> | null;
};

export const ARENA_NFT_COLLECTIONS: Readonly<Record<number, Address>> = {
  1: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  56: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  137: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  8453: "0x98433df878e8c898cb907345c3a7756e5f72240f"
};
export function supportedArenaNft(chainId: number, collection: string) {
  return ARENA_NFT_COLLECTIONS[chainId] === collection.toLowerCase();
}

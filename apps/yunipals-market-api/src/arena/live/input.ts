import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address
} from "viem";
import type {
  ArenaPublicTournament,
  ArenaTournament
} from "@protopals/yunipals-market-core/arena";
import { canonicalJson, sha256 } from "../draw";
import type { FighterSnapshot } from "./identity";
import { ArenaIdentities } from "./identity";
import { ARENA_POOL_HASH, type LiveArenaCatalog } from "./catalog";
import { ArenaIntake, ArenaRequestError } from "./intake";

export function onchainIslandDraw(
  contract: Address,
  id: string,
  word: string,
  entries: LiveArenaCatalog["pool"]["entries"]
) {
  if (
    !/^[1-9][0-9]{0,77}$/.test(id) ||
    BigInt(id) >= 2n ** 256n ||
    !/^(0|[1-9][0-9]{0,77})$/.test(word) ||
    BigInt(word) >= 2n ** 256n
  )
    throw new Error("Invalid onchain draw input.");
  const total = entries.reduce((n, e) => n + e.weight, 0);
  if (total !== 1948 || entries.length !== 898)
    throw new Error("Invalid island pool.");
  const threshold = (1n << 256n) % BigInt(total);
  for (let counter = 0n; counter < 256n; counter++) {
    const value = BigInt(
      keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint256" },
            { type: "uint256" }
          ],
          [
            keccak256(stringToHex("yunipals-arena/onchain-island/v1")),
            8453n,
            contract,
            BigInt(id),
            ARENA_POOL_HASH,
            BigInt(word),
            counter
          ]
        )
      )
    );
    if (value < threshold) continue;
    const ticket = Number(value % BigInt(total));
    let end = 0;
    for (const entry of entries) {
      end += entry.weight;
      if (ticket < end) return { ticket, tokenId: entry.tokenId };
    }
  }
  throw new Error("Island draw rejection limit exceeded.");
}

export function tiePriority(
  id: string,
  word: string,
  roster: FighterSnapshot[]
) {
  const rank = (fighter: string) =>
    sha256(canonicalJson(["yunipals-arena/tie/v2", id, word, fighter]));
  return roster.map((f) => f.id).sort((a, b) => rank(a).localeCompare(rank(b)));
}

function verifyContext(
  state: ArenaTournament,
  contract: Address,
  catalog: LiveArenaCatalog
) {
  if (
    state.rulesHash !== catalog.rulesHash ||
    state.poolHash !== ARENA_POOL_HASH
  )
    throw new Error("Tournament rules or pool differ from the pinned release.");
  if (state.islandId === null) return null;
  if (
    state.randomWord === null ||
    state.requestId === null ||
    state.ticket === null ||
    !state.islandBeneficiary
  )
    throw new Error("Selected island is missing its draw evidence.");
  const draw = onchainIslandDraw(
    contract,
    state.id,
    state.randomWord,
    catalog.pool.entries
  );
  if (draw.ticket !== state.ticket || draw.tokenId !== state.islandId)
    throw new Error("Confirmed island does not match its VRF word.");
  const island = catalog.islands.find((i) => i.tokenId === state.islandId);
  if (!island)
    throw new Error("Selected island is outside the published pool.");
  return island;
}

export function compileLiveInput(
  state: ArenaTournament,
  contract: Address,
  catalog: LiveArenaCatalog,
  roster: FighterSnapshot[],
  strategies: NonNullable<ArenaPublicTournament["strategies"]>
) {
  const island = verifyContext(state, contract, catalog);
  if (
    !island ||
    state.seats.length !== 4 ||
    roster.length !== 4 ||
    strategies.length !== 4 ||
    new Set(roster.map((f) => f.id)).size !== 4
  )
    throw new Error(
      "Input needs four distinct paid NFTs, four strategies and the selected island."
    );
  for (let i = 0; i < 4; i++) {
    const seat = state.seats[i]!,
      fighter = roster[i]!;
    if (
      seat.seat !== i ||
      strategies[i]?.seat !== i ||
      seat.nftChainId !== fighter.chainId ||
      seat.collection.toLowerCase() !== fighter.collection ||
      seat.tokenId !== fighter.tokenId
    )
      throw new Error(
        "Fighter or strategy does not match the paid seat order."
      );
  }
  return {
    version: "arena-mainnet-input-v1" as const,
    mode: "base-mainnet" as const,
    tournamentId: state.id,
    contract,
    rulesHash: catalog.rulesHash,
    rules: catalog.rules,
    pool: catalog.pool,
    draw: {
      mode: "chainlink-vrf" as const,
      algorithm: "keccak256-abi-rejection-weighted-v1" as const,
      chainId: 8453,
      contract,
      requestId: state.requestId!,
      word: state.randomWord!,
      ticket: state.ticket!
    },
    island,
    roster,
    seats: state.seats,
    semifinals: [
      [roster[0]!.id, roster[1]!.id],
      [roster[2]!.id, roster[3]!.id]
    ],
    strategies: strategies.map((s) => ({
      fighterId: roster[s.seat]!.id,
      text: s.text,
      source: s.source ?? "player"
    })),
    tiePriority: tiePriority(state.id, state.randomWord!, roster)
  };
}
export type LiveFrozenInput = ReturnType<typeof compileLiveInput>;

export class ArenaInputCompiler {
  constructor(
    private readonly service: ArenaIntake,
    private readonly catalog: LiveArenaCatalog,
    private readonly identities: ArenaIdentities
  ) {}

  async context(id: string) {
    const state = await this.service.state(id);
    const island = verifyContext(state, this.service.contract, this.catalog);
    // Public reads only read saved snapshots. They never fetch metadata or trigger RPCs.
    const roster = await Promise.all(
      state.seats.map((s) => this.identities.read(id, s))
    );
    return {
      rules: this.catalog.rules,
      rulesHash: this.catalog.rulesHash,
      island,
      roster,
      tiePriority:
        state.randomWord !== null &&
        roster.length === 4 &&
        roster.every((f): f is FighterSnapshot => f !== null)
          ? tiePriority(id, state.randomWord, roster)
          : [],
      ready: !!island && roster.length === 4 && roster.every(Boolean)
    };
  }

  async prepare(id: string) {
    await this.service.ready();
    const state = await this.service.state(id);
    const roster = await Promise.all(
      state.seats.map((s) => this.identities.read(id, s))
    );
    if (roster.length !== 4 || roster.some((f) => f === null))
      throw new ArenaRequestError(
        503,
        "Fighter snapshots are not ready. Strategies remain private."
      );
    // All external work happens before the intake row lock. Recheck seat and draw
    // identity against the locked state before committing the immutable input.
    return this.service.prepareInput(id, (locked, strategies) =>
      compileLiveInput(
        locked,
        this.service.contract,
        this.catalog,
        roster as FighterSnapshot[],
        strategies
      )
    );
  }
}

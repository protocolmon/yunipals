import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalJson, poolEntries, sha256, weightedDraw } from "./draw";
import { ArenaStore } from "./store";
import type {
  ArenaRules,
  Draw,
  Fighter,
  FrozenInput,
  Island,
  LabCatalog,
  TournamentView
} from "./types";

const islandContract = "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168";

export class ArenaError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

export type PrivateTournament = {
  id: string;
  createdAt: string;
  islands: Island[];
  poolSha256: string;
  rules: ArenaRules;
  rulesSha256: string;
  draw: Draw | null;
  island: Island | null;
  seats: Array<{
    fighter: Fighter;
    credentialHash: string;
    strategy: string | null;
  }>;
  revealedAt: string | null;
  input: FrozenInput | null;
  inputSha256: string | null;
};

function required(value: PrivateTournament | null): PrivateTournament {
  if (!value) throw new ArenaError(404, "Tournament not found.");
  return value;
}

function bracket(state: PrivateTournament): [string, string][] {
  if (state.seats.length !== 4) return [];
  return [
    [state.seats[0]!.fighter.id, state.seats[1]!.fighter.id],
    [state.seats[2]!.fighter.id, state.seats[3]!.fighter.id]
  ];
}

function view(state: PrivateTournament): TournamentView {
  // Explicit allowlist. Never spread a stored tournament or seat into a response.
  return {
    id: state.id,
    mode: "local-lab",
    createdAt: state.createdAt,
    phase: state.revealedAt
      ? "revealed"
      : state.seats.length < 4
        ? "waiting-for-players"
        : !state.island
          ? "drawing-island"
          : "collecting-strategies",
    pool: {
      sha256: state.poolSha256,
      count: state.islands.length,
      totalWeight: state.islands.reduce(
        (sum, island) => sum + island.weight,
        0
      ),
      genesisWeight:
        state.islands.find((island) => island.edition === "Genesis")?.weight ??
        0,
      personalWeight:
        state.islands.find((island) => island.edition === "Personal")?.weight ??
        0
    },
    rulesVersion: state.rules.version,
    rulesSha256: state.rulesSha256,
    rules: structuredClone(state.rules),
    tiePriority:
      state.rules.version === "arena-combat-lab-v2" &&
      state.draw?.word &&
      state.seats.length === 4
        ? state.seats
            .map((seat) => seat.fighter.id)
            .sort((a, b) => {
              const key = (fighter: string) =>
                sha256(
                  canonicalJson([
                    "yunipals-arena/tie/v2",
                    state.id,
                    state.draw!.word,
                    fighter
                  ])
                );
              return key(a).localeCompare(key(b));
            })
        : [],
    draw: state.draw,
    island: state.island,
    seats: state.seats.map((seat) => ({
      fighter: seat.fighter,
      submitted: seat.strategy !== null
    })),
    semifinals: bracket(state),
    submissionCount: state.seats.filter((seat) => seat.strategy !== null)
      .length,
    revealedAt: state.revealedAt,
    strategies: state.revealedAt ? state.input!.strategies : null,
    inputSha256: state.inputSha256,
    resolution: state.input ? "ready-for-referee" : "not-ready"
  };
}

// This adapter is deliberately limited to a local lab. Seat credentials stand in
// for wallet auth; only a separate verified on-chain adapter may admit real users.
export class ArenaLabService {
  private readonly islands: Island[];
  private readonly fighters: Fighter[];
  private readonly rules: ArenaRules;

  constructor(
    private readonly store: ArenaStore<PrivateTournament>,
    config: { islands: Island[]; fighters: Fighter[]; rules: ArenaRules }
  ) {
    this.islands = structuredClone(config.islands).sort((a, b) =>
      BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1
    );
    this.fighters = structuredClone(config.fighters);
    this.rules = structuredClone(config.rules);
    if (
      new Set(this.fighters.map((fighter) => fighter.id)).size !==
        this.fighters.length ||
      new Set(
        this.fighters.map((fighter) => `${fighter.chain}:${fighter.tokenId}`)
      ).size !== this.fighters.length
    )
      throw new Error(
        "The fighter catalog contains a duplicate identity or NFT."
      );
    if (
      !this.islands.length ||
      new Set(this.islands.map((island) => island.tokenId)).size !==
        this.islands.length
    )
      throw new Error("An immutable, nonempty island pool is required.");
    for (const edition of ["Genesis", "Personal"] as const) {
      const weights = new Set(
        this.islands
          .filter((island) => island.edition === edition)
          .map((island) => island.weight)
      );
      if (
        weights.size > 1 ||
        [...weights].some(
          (weight) => !Number.isSafeInteger(weight) || weight < 1
        )
      )
        throw new Error(
          "Each edition must have a consistent positive integer weight."
        );
    }
  }

  catalog(): LabCatalog {
    return {
      mode: "local-lab",
      fighters: structuredClone(this.fighters),
      islandCount: this.islands.length,
      genesisCount: this.islands.filter(
        (island) => island.edition === "Genesis"
      ).length,
      personalCount: this.islands.filter(
        (island) => island.edition === "Personal"
      ).length,
      genesisWeight:
        this.islands.find((island) => island.edition === "Genesis")?.weight ??
        0,
      personalWeight:
        this.islands.find((island) => island.edition === "Personal")?.weight ??
        0,
      strategyMaxLength: this.rules.strategyMaxLength,
      rulesVersion: this.rules.version
    };
  }

  create() {
    const state: PrivateTournament = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      islands: this.islands,
      poolSha256: sha256(
        canonicalJson({
          chainId: 8453,
          contract: islandContract,
          entries: poolEntries(this.islands)
        })
      ),
      rules: this.rules,
      rulesSha256: sha256(canonicalJson(this.rules)),
      seats: [],
      draw: null,
      island: null,
      revealedAt: null,
      input: null,
      inputSha256: null
    };
    this.store.insert(state.id, state);
    return view(state);
  }

  get(id: string) {
    return view(required(this.store.read(id)));
  }
  list() {
    return this.store
      .ids()
      .slice(0, 30)
      .map((id) => this.get(id));
  }

  join(id: string, fighterId: string, credential: string) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new ArenaError(400, "Provide a valid seat credential.");
    const fighter = this.fighters.find((entry) => entry.id === fighterId);
    if (!fighter)
      throw new ArenaError(400, "Choose a fighter from the lab roster.");
    return this.store.update(id, (value) => {
      const state = required(value);
      const credentialHash = sha256(credential);
      const existing = state.seats.find(
        (seat) => seat.fighter.id === fighterId
      );
      if (existing) {
        if (existing.credentialHash !== credentialHash)
          throw new ArenaError(409, "That NFT already joined.");
        return view(state); // Lost HTTP responses can be retried safely.
      }
      if (state.seats.length === 4)
        throw new ArenaError(409, "The four-player roster is locked.");
      if (state.seats.some((seat) => seat.credentialHash === credentialHash))
        throw new ArenaError(
          409,
          "Use a separate credential for each lab player."
        );
      state.seats.push({ fighter, credentialHash, strategy: null });
      if (!state.draw) {
        state.draw = {
          mode: "test-randomness",
          requestId: randomUUID(),
          requestedAt: new Date().toISOString(),
          fulfilledAt: null,
          word: null,
          ticket: null,
          algorithm: "sha256-rejection-weighted-v1"
        };
      }
      return view(state);
    });
  }

  // No HTTP route accepts a word or island choice. Live fulfillment will need a
  // chain-confirmed requestId/tournament binding and a verified oracle address.
  fulfillTestDraw(id: string, requestId: string, word: string) {
    return this.store.update(id, (value) => {
      const state = required(value);
      if (!state.draw || state.draw.requestId !== requestId)
        throw new ArenaError(
          409,
          "Randomness request does not match this tournament."
        );
      if (state.draw.word) {
        if (state.draw.word !== word)
          throw new ArenaError(409, "This island draw is already final.");
        return view(state);
      }
      const result = weightedDraw({
        tournamentId: id,
        poolSha256: state.poolSha256,
        word,
        entries: state.islands
      });
      state.island = state.islands.find(
        (island) => island.tokenId === result.tokenId
      )!;
      state.draw = {
        ...state.draw,
        word,
        ticket: result.ticket,
        fulfilledAt: new Date().toISOString()
      };
      return view(state);
    });
  }

  fulfillPendingTestDraws() {
    for (const id of this.store.ids()) {
      const state = required(this.store.read(id));
      if (state.draw && !state.draw.word)
        this.fulfillTestDraw(
          id,
          state.draw.requestId,
          `0x${randomBytes(32).toString("hex")}`
        );
    }
  }

  submit(id: string, fighterId: string, credential: string, strategy: string) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new ArenaError(403, "This seat credential is not valid.");
    return this.store.update(id, (value) => {
      const state = required(value);
      const seat = state.seats.find((entry) => entry.fighter.id === fighterId);
      if (
        !seat ||
        !timingSafeEqual(
          Buffer.from(seat.credentialHash, "hex"),
          Buffer.from(sha256(credential), "hex")
        )
      )
        throw new ArenaError(403, "This seat credential is not valid.");
      if (state.seats.length !== 4 || !state.island || !state.draw?.word)
        throw new ArenaError(
          409,
          "Wait for all four players and the island draw before submitting."
        );
      if (
        !strategy.trim() ||
        strategy.length > state.rules.strategyMaxLength ||
        strategy.includes("\u0000")
      )
        throw new ArenaError(
          400,
          `Write a strategy of 1–${state.rules.strategyMaxLength} characters.`
        );
      if (seat.strategy !== null) {
        if (seat.strategy !== strategy)
          throw new ArenaError(409, "Your submitted strategy is locked.");
        return view(state);
      }
      seat.strategy = strategy;
      if (state.seats.every((entry) => entry.strategy !== null)) {
        state.revealedAt = new Date().toISOString();
        state.input = {
          version: "arena-lab-v1",
          mode: "local-lab",
          tournamentId: id,
          rules: state.rules,
          pool: {
            chainId: 8453,
            contract: islandContract,
            sha256: state.poolSha256,
            entries: poolEntries(state.islands)
          },
          draw: state.draw,
          island: state.island,
          roster: state.seats.map((entry) => entry.fighter),
          semifinals: bracket(state),
          strategies: state.seats.map((entry) => ({
            fighterId: entry.fighter.id,
            text: entry.strategy!
          }))
        };
        state.inputSha256 = sha256(canonicalJson(state.input));
      }
      return view(state);
    });
  }

  export(id: string) {
    const state = required(this.store.read(id));
    if (!state.input || !state.inputSha256)
      throw new ArenaError(
        409,
        "Strategies are private until all four players submit."
      );
    return { inputSha256: state.inputSha256, input: state.input };
  }
}

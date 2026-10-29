import {
  arenaContractAbi,
  type ArenaContractVersion
} from "@protopals/yunipals-market-core/arenaProtocol";
import type { Pool } from "pg";
import { createIndexerReader } from "@protopals/yunipals-indexer-server/readers";
import {
  readArenaTournament,
  readArenaCredit,
  readArenaTournamentIds,
  readArenaTransaction,
  readArenaBrowse,
  type ArenaBrowseRequest
} from "@protopals/yunipals-indexer-server/arena";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";

const decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) < 2n ** 256n;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const address = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function arenaNativeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.ARENA_INDEXER_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "unified")
    throw new Error("Invalid Arena indexer mode.");
  if (mode === "legacy") {
    if (
      env.ARENA_INDEXER_DATABASE_URL ||
      env.ARENA_INDEXER_RELEASE_ID ||
      env.ARENA_INDEXER_SOURCE_KIND
    )
      throw new Error("Native Arena selectors require explicit unified mode.");
    return { mode } as const;
  }
  if (!env.ARENA_INDEXER_DATABASE_URL || !hash(env.ARENA_INDEXER_RELEASE_ID))
    throw new Error(
      "Native Arena requires a database and pinned release identity."
    );
  const sourceKind = env.ARENA_INDEXER_SOURCE_KIND ?? "unified";
  if (sourceKind !== "unified" && sourceKind !== "legacy_rollback")
    throw new Error("Invalid Arena public source kind.");
  let url: URL;
  try {
    url = new URL(env.ARENA_INDEXER_DATABASE_URL);
  } catch {
    throw new Error("Invalid native Arena database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid native Arena database protocol.");
  return {
    mode,
    sourceKind,
    databaseUrl: env.ARENA_INDEXER_DATABASE_URL,
    releaseId: env.ARENA_INDEXER_RELEASE_ID
  } as const;
}

/** The shared package verifies canonical event/coverage identities; the
 * application separately validates the public state shape before using it.
 */
export function nativeTournamentState(value: unknown): ArenaTournament {
  if (
    !record(value) ||
    !decimal(value.id) ||
    !["open", "strategies", "resolving", "settled", "expired"].includes(
      String(value.phase)
    ) ||
    !integer(value.deadline) ||
    !hash(value.rulesHash) ||
    !hash(value.poolHash) ||
    ![value.treasury, value.islandBeneficiary].every(
      (item) => item === null || address(item)
    ) ||
    ![value.islandId, value.requestId, value.randomWord].every(
      (item) => item === null || decimal(item)
    ) ||
    !(value.ticket === null || integer(value.ticket)) ||
    ![value.inputHash, value.resultHash, value.videoHash].every(
      (item) => item === null || hash(item)
    ) ||
    !(
      value.commitments === null ||
      (Array.isArray(value.commitments) &&
        value.commitments.length === 4 &&
        value.commitments.every(hash))
    ) ||
    !(
      value.winners === null ||
      (Array.isArray(value.winners) &&
        value.winners.length === 3 &&
        value.winners.every((item) => integer(item) && item < 4))
    ) ||
    !(
      value.automaticStrategyMask === undefined ||
      (integer(value.automaticStrategyMask) &&
        value.automaticStrategyMask <= 15)
    ) ||
    !Array.isArray(value.seats) ||
    value.seats.length > 4 ||
    !value.seats.every(
      (seat, index) =>
        record(seat) &&
        seat.seat === index &&
        address(seat.player) &&
        address(seat.collection) &&
        integer(seat.nftChainId) &&
        seat.nftChainId > 0 &&
        decimal(seat.tokenId)
    )
  )
    throw new Error("Native Arena state has an unsupported shape.");
  return value as ArenaTournament;
}

export type NativeArenaObservation = Awaited<
  ReturnType<NativeArenaSource["read"]>
>;
export type NativeArenaTournament = NonNullable<
  NativeArenaObservation["tournament"]
>;

/** Read-only application adapter over the shared Ponder reader. It owns no
 * chain cursor or public-state projection and never queries private records.
 */
export class NativeArenaSource {
  readonly definition;
  constructor(
    readonly pool: Pool,
    readonly releaseId: string,
    contract: string,
    startBlock: bigint,
    mediaKind: "video" | "anime" = "video",
    readonly contractVersion: ArenaContractVersion = 1
  ) {
    if (
      !hash(releaseId) ||
      !address(contract.toLowerCase()) ||
      /^0x0{40}$/i.test(contract) ||
      startBlock < 0n
    )
      throw new Error("Invalid native Arena source configuration.");
    this.definition = {
      contract: contract.toLowerCase(),
      startBlock: String(startBlock),
      abiHash: manifestDigest(arenaContractAbi(contractVersion)),
      ...(contractVersion === 2 ? { contractVersion } : {}),
      mediaKind
    };
  }
  async read(
    id: string,
    options: {
      requiredThroughBlock?: bigint;
      expectedIncarnation?: string;
    } = {}
  ) {
    const reader = await createIndexerReader(this.pool, {
      releaseId: this.releaseId
    });
    const result = await readArenaTournament(
      reader,
      this.definition,
      id,
      options
    );
    return {
      ...result,
      tournament: result.tournament
        ? {
            ...result.tournament,
            state: nativeTournamentState(result.tournament.state)
          }
        : null
    };
  }
  async credit(wallet: string) {
    return readArenaCredit(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      wallet.toLowerCase()
    );
  }
  async list(wallet?: string) {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { wallet: wallet?.toLowerCase(), limit: 30 }
    );
  }
  async work() {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { workOnly: true, limit: 100 }
    );
  }
  async browse(request: ArenaBrowseRequest) {
    return readArenaBrowse(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      request
    );
  }
  async transaction(
    hash: string,
    options: {
      tournamentId?: string;
      blockNumber?: bigint;
      blockHash?: string;
    } = {}
  ) {
    return readArenaTransaction(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      hash.toLowerCase(),
      {
        ...options,
        ...(options.blockHash
          ? { blockHash: options.blockHash.toLowerCase() }
          : {})
      }
    );
  }
}

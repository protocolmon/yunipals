import { encodeFunctionData, type LocalAccount, type PublicClient } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { ARENA_RESOLUTION_SECONDS } from "@protopals/yunipals-market-core/arena";
import type { ControlPurpose } from "./control";
import type { ArenaCapacity } from "./capacity";
import type { ArenaInputCompiler } from "./input";
import { ArenaIntake, type ArenaTournamentContext } from "./intake";
import {
  NativeArenaTransactions,
  type NativeActionHead,
  type NativeIntent
} from "./nativeTransactions";
import { publishedPayoutFilm } from "./payout";

export class NativeArenaControl {
  private readonly transactions: NativeArenaTransactions;
  constructor(
    private readonly service: ArenaIntake,
    private readonly compiler: ArenaInputCompiler,
    private readonly client: PublicClient,
    private readonly account: LocalAccount,
    maxFee: bigint,
    private readonly capacity?: ArenaCapacity,
    private readonly storage?: string
  ) {
    this.transactions = new NativeArenaTransactions(
      service,
      client,
      account,
      maxFee
    );
  }
  async prepare(
    purpose: ControlPurpose,
    id: string,
    expectedIncarnation?: string
  ) {
    return this.transactions.prepare(
      purpose,
      id,
      (context, head) => this.data(purpose, id, context, head),
      expectedIncarnation
    );
  }
  async advance(
    purpose: ControlPurpose,
    id: string,
    expectedIncarnation?: string | null
  ) {
    const incarnation =
      purpose === "open-lobby"
        ? null
        : (expectedIncarnation ??
          (await this.service.tournamentContext(id)).incarnation);
    const intent = await this.transactions.saved(purpose, id, incarnation);
    if (!intent)
      throw new Error(
        "Native control must be prepared for this opening first."
      );
    return this.advanceIntent(intent);
  }
  async advanceIntent(intent: NativeIntent) {
    if (intent.purpose === "settle")
      throw new Error("Control cannot process settlement intents.");
    const purpose = intent.purpose;
    return this.transactions.advance(intent, (context, head) =>
      this.data(purpose, intent.tournament_id, context, head)
    );
  }
  private async data(
    purpose: ControlPurpose,
    id: string,
    context: ArenaTournamentContext | null,
    head: NativeActionHead
  ) {
    if (purpose === "open-lobby") {
      if (!this.capacity || this.capacity.indexerMode !== "unified")
        throw new Error(
          "Native lobby creation requires native capacity checks."
        );
      await this.capacity.check(true);
      if (!this.service.nativeSource?.list)
        throw new Error("Native lobby list is unavailable.");
      const latest = await this.service.nativeSource.list();
      if (BigInt(latest.ids[0] ?? "0") + 1n !== BigInt(id))
        throw new Error(
          "Native lobby coverage has not caught up to the next ID."
        );
      const [next, paused, operator] = await Promise.all([
        this.client.readContract({
          address: this.service.contract,
          abi: arenaAbi,
          functionName: "nextTournamentId",
          blockNumber: head.number
        }),
        this.client.readContract({
          address: this.service.contract,
          abi: arenaAbi,
          functionName: "entriesPaused",
          blockNumber: head.number
        }),
        this.client.readContract({
          address: this.service.contract,
          abi: arenaAbi,
          functionName: "lobbyOperator",
          blockNumber: head.number
        })
      ]);
      if (
        next !== BigInt(id) ||
        paused ||
        operator.toLowerCase() !== this.account.address.toLowerCase()
      )
        throw new Error(
          "Native lobby is paused or its operator/next ID changed."
        );
      return encodeFunctionData({
        abi: arenaAbi,
        functionName: "openTournament"
      });
    }
    if (!context)
      throw new Error("Native control requires a canonical opening.");
    const state = context.state;
    const live = await this.client.readContract({
      address: this.service.contract,
      abi: arenaAbi,
      functionName: "tournament",
      args: [BigInt(id)],
      blockNumber: head.number
    });
    if (purpose === "finalize-island") {
      if (
        state.phase !== "open" ||
        state.randomWord === null ||
        state.islandId !== null ||
        live.phase !== 1 ||
        !live.randomnessReceived ||
        live.islandId !== 0 ||
        live.deadline <= head.timestamp + 60n
      )
        throw new Error("Native island is not ready to finalize.");
      return encodeFunctionData({
        abi: arenaAbi,
        functionName: "finalizeIsland",
        args: [BigInt(id)]
      });
    }
    if (purpose === "freeze-input") {
      const prepared = await this.compiler.prepare(id);
      if (
        prepared.incarnation !== context.incarnation ||
        state.phase !== "strategies" ||
        live.phase !== 2 ||
        live.deadline + BigInt(ARENA_RESOLUTION_SECONDS) <=
          head.timestamp + 30n ||
        (prepared.automaticStrategyMask !== 0 &&
          live.deadline > head.timestamp) ||
        live.count !== 4 ||
        live.islandId === 0
      )
        throw new Error("Native input is not ready to freeze.");
      const args = [
        BigInt(id),
        prepared.inputHash,
        prepared.commitments as [
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`
        ],
        prepared.signatures as [
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`
        ]
      ] as const;
      return prepared.automaticStrategyMask === 0
        ? encodeFunctionData({
            abi: arenaAbi,
            functionName: "freezeInput",
            args
          })
        : encodeFunctionData({
            abi: arenaAbi,
            functionName: "freezeInputWithFallback",
            args: [...args, prepared.automaticStrategyMask]
          });
    }
    if (purpose === "expire") {
      if (
        !["open", "strategies", "resolving"].includes(state.phase) ||
        ![1, 2, 3].includes(live.phase) ||
        live.deadline === 0n ||
        live.deadline +
          (live.phase === 2 ? BigInt(ARENA_RESOLUTION_SECONDS) : 0n) >
          head.timestamp
      )
        throw new Error("Native tournament has not expired.");
      return encodeFunctionData({
        abi: arenaAbi,
        functionName: "expire",
        args: [BigInt(id)]
      });
    }
    const [published, referee] = await Promise.all([
      this.client.readContract({
        address: this.service.contract,
        abi: arenaAbi,
        functionName: "publishedVideoHash",
        args: [BigInt(id)],
        blockNumber: head.number
      }),
      this.client.readContract({
        address: this.service.contract,
        abi: arenaAbi,
        functionName: "referee",
        blockNumber: head.number
      })
    ]);
    if (
      state.phase !== "settled" ||
      state.videoHash ||
      live.phase !== 4 ||
      live.resultHash !== state.resultHash ||
      !/^0x0{64}$/.test(published) ||
      referee.toLowerCase() !== this.account.address.toLowerCase()
    )
      throw new Error("Native tournament is not ready for payout release.");
    const film = await publishedPayoutFilm(
      this.service.pool,
      this.service.deployment,
      id,
      this.storage,
      context
    );
    return encodeFunctionData({
      abi: arenaAbi,
      functionName: "releasePayouts",
      args: [BigInt(id), film]
    });
  }
}

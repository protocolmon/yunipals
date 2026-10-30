import {
  encodeFunctionData,
  type Hex,
  type LocalAccount,
  type PublicClient
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { canonicalJson, sha256 } from "../draw";
import { ArenaIntake, type ArenaTournamentContext } from "./intake";
import {
  NativeArenaTransactions,
  type NativeActionHead,
  type NativeIntent
} from "./nativeTransactions";
import type { SavedAdjudication } from "./adjudication";

export class NativeArenaSettlement {
  private readonly transactions: NativeArenaTransactions;
  constructor(
    private readonly service: ArenaIntake,
    private readonly client: PublicClient,
    account: LocalAccount,
    maxFee: bigint
  ) {
    this.transactions = new NativeArenaTransactions(
      service,
      client,
      account,
      maxFee
    );
  }
  async prepare(id: string, expectedIncarnation?: string) {
    return this.transactions.prepare(
      "settle",
      id,
      (context, head) => this.data(id, context, head),
      expectedIncarnation
    );
  }
  async advance(id: string, expectedIncarnation?: string) {
    const incarnation =
      expectedIncarnation ??
      (await this.service.tournamentContext(id)).incarnation;
    const intent = await this.transactions.saved("settle", id, incarnation);
    if (!intent)
      throw new Error(
        "Native settlement must be prepared for this opening first."
      );
    return this.advanceIntent(intent);
  }
  async advanceIntent(intent: NativeIntent) {
    if (intent.purpose !== "settle")
      throw new Error("Settlement cannot process a control intent.");
    return this.transactions.advance(intent, (context, head) =>
      this.data(intent.tournament_id, context, head)
    );
  }
  private async data(
    id: string,
    context: ArenaTournamentContext | null,
    head: NativeActionHead
  ) {
    if (!context || context.state.phase !== "resolving")
      throw new Error(
        "Native settlement requires a resolving canonical input."
      );
    const proof = context.observation!.tournament.inputFrozen;
    const saved = (
      await this.service.pool.query<SavedAdjudication>(
        `SELECT a.* FROM yunipals_arena.adjudication a
      JOIN yunipals_arena.frozen_input f ON f.deployment=a.deployment AND f.tournament_id=a.tournament_id AND f.incarnation=a.incarnation
      WHERE a.deployment=$1 AND a.tournament_id=$2 AND a.incarnation=$3 AND a.state='valid'
        AND a.input_hash=$4 AND f.input_hash=a.input_hash AND f.revealed_at IS NOT NULL
        AND f.revealed_event_id=$5 AND f.revealed_block_hash=$6`,
        [
          this.service.deployment,
          id,
          context.incarnation,
          context.state.inputHash,
          proof?.id ?? null,
          proof?.blockHash ?? null
        ]
      )
    ).rows[0];
    if (
      !saved ||
      saved.outcome_hash !== `0x${sha256(canonicalJson(saved.candidate))}` ||
      !saved.validation.valid ||
      saved.validation.errors.length ||
      !saved.winners
    )
      throw new Error(
        "Native settlement requires a validated candidate for its canonical disclosed input."
      );
    const [first, second, champion] = saved.winners;
    if (
      ![0, 1].includes(first!) ||
      ![2, 3].includes(second!) ||
      ![first, second].includes(champion)
    )
      throw new Error("Invalid native paid-seat bracket.");
    const live = await this.client.readContract({
      address: this.service.contract,
      abi: this.service.contractAbi,
      functionName: "tournament",
      args: [BigInt(id)],
      blockNumber: head.number
    });
    if (
      live.phase !== 3 ||
      live.inputHash !== saved.input_hash ||
      live.deadline <= head.timestamp + 90n
    )
      throw new Error(
        "Native input is not ready for settlement or its deadline is too close."
      );
    return encodeFunctionData({
      abi: this.service.contractAbi,
      functionName: "settle",
      args: [BigInt(id), saved.outcome_hash as Hex, first!, second!, champion!]
    });
  }
}

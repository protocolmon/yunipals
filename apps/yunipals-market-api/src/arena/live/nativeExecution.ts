import type { Address } from "viem";
import { ARENA_RESOLUTION_SECONDS } from "@protopals/yunipals-market-core/arena";
import { ArenaIntake } from "./intake";
import type { NativeArenaControl } from "./nativeControl";
import type { NativeArenaSettlement } from "./nativeSettlement";
import type { NativeIntent, NativeIntentPurpose } from "./nativeTransactions";

export class NativeArenaExecution {
  constructor(
    private readonly service: ArenaIntake,
    private readonly signer: Address,
    private readonly role: "lobby" | "referee",
    private readonly control: NativeArenaControl,
    private readonly settlement: NativeArenaSettlement
  ) {
    if (!service.nativeSource)
      throw new Error("Native execution requires its selected source.");
  }
  private async advance(intent: NativeIntent) {
    if (intent.incarnation === "legacy")
      throw new Error("Pending legacy transaction requires explicit adoption.");
    if ((this.role === "lobby") !== (intent.purpose === "open-lobby"))
      throw new Error("Saved action belongs to another execution role.");
    return intent.purpose === "settle"
      ? this.settlement.advanceIntent(intent)
      : this.control.advanceIntent(intent);
  }
  async tick() {
    await this.service.ready();
    const pending = (
      await this.service.pool.query<NativeIntent>(
        `SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND lower(signer)=lower($2)
      AND state NOT IN ('confirmed','reverted') ORDER BY nonce LIMIT 1`,
        [this.service.deployment, this.signer]
      )
    ).rows[0];
    if (pending) return this.advance(pending);
    const audit = (
      await this.service.pool.query<NativeIntent>(
        `SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND lower(signer)=lower($2)
      AND incarnation IS DISTINCT FROM 'legacy' AND state IN ('confirmed','reverted') AND NOT receipt_finalized
      AND (checked_at IS NULL OR checked_at<now()-interval '30 seconds') ORDER BY checked_at NULLS FIRST,nonce LIMIT 1`,
        [this.service.deployment, this.signer]
      )
    ).rows[0];
    if (audit) {
      const result = await this.advance(audit);
      if (!["confirmed", "reverted"].includes(result.state)) return result;
    }
    if (this.role === "lobby") {
      const source = this.service.nativeSource!;
      if (!source.list)
        throw new Error("Native lobby coverage is unavailable.");
      const latest = await source.list(),
        id = String(BigInt(latest.ids[0] ?? "0") + 1n);
      const intent = await this.control.prepare("open-lobby", id);
      return this.control.advanceIntent(intent);
    }
    const source = this.service.nativeSource!;
    if (!source.work)
      throw new Error("Native execution coverage is unavailable.");
    const work = await source.work();
    const actions: Array<{
      id: string;
      incarnation: string;
      purpose: NativeIntentPurpose;
    }> = [];
    for (const id of work.ids) {
      const context = await this.service.tournamentContext(id),
        state = context.state;
      const now = Math.floor(Date.now() / 1000);
      let purpose: NativeIntentPurpose | undefined;
      if (
        ["open", "strategies", "resolving"].includes(state.phase) &&
        state.deadline > 0 &&
        state.deadline +
          (state.phase === "strategies" ? ARENA_RESOLUTION_SECONDS : 0) <=
          now
      )
        purpose = "expire";
      else if (
        state.phase === "open" &&
        state.randomWord !== null &&
        state.islandId === null
      )
        purpose = "finalize-island";
      else if (
        state.phase === "strategies" &&
        state.deadline + ARENA_RESOLUTION_SECONDS > now + 30
      ) {
        const rows = (
          await this.service.pool.query<{ seat: number; wallet: string }>(
            "SELECT seat,wallet FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
            [this.service.deployment, id, context.incarnation]
          )
        ).rows;
        if (
          state.deadline <= now ||
          (rows.length === 4 &&
            state.seats.every((s) =>
              rows.some((r) => r.seat === s.seat && r.wallet === s.player)
            ))
        )
          purpose = "freeze-input";
      } else if (state.phase === "resolving" && state.deadline > now + 90) {
        if (
          (
            await this.service.pool.query(
              "SELECT 1 FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND state='valid' AND input_hash=$4",
              [
                this.service.deployment,
                id,
                context.incarnation,
                state.inputHash
              ]
            )
          ).rowCount
        )
          purpose = "settle";
      } else if (state.phase === "settled" && !state.videoHash) {
        if (
          (
            await this.service.pool.query(
              "SELECT 1 FROM yunipals_arena.media_job WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND state='ready'",
              [this.service.deployment, id, context.incarnation]
            )
          ).rowCount
        )
          purpose = "release-payouts";
      }
      if (purpose)
        actions.push({ id, incarnation: context.incarnation, purpose });
    }
    actions.sort(
      (a, b) =>
        Number(b.purpose === "expire") - Number(a.purpose === "expire") ||
        (BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    );
    const next = actions[0];
    if (!next) return null;
    const intent =
      next.purpose === "settle"
        ? await this.settlement.prepare(next.id, next.incarnation)
        : await this.control.prepare(next.purpose, next.id, next.incarnation);
    return this.advance(intent);
  }
}

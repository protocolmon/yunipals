import type { PoolClient } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import { ArenaIntake, type ArenaTournamentContext } from "./intake";
import type { NativeArenaActionObservation } from "./nativeAction";

type Queryable = Pick<PoolClient, "query">;
export type ProviderKind = "referee" | "media";
export type NativeProviderProof = {
  deployment: string;
  tournamentId: string;
  incarnation: string;
  releaseId: string;
  openedEventId: string;
  openedBlockHash: string;
  frozenEventId: string;
  frozenBlockHash: string;
  inputHash: string;
  resultHash: string | null;
};
export type NativeProviderContext = {
  context: ArenaTournamentContext;
  proof: NativeProviderProof;
  ciphertext: string;
};

export async function assertProviderMode(
  pool: Queryable,
  deployment: string,
  native: boolean
) {
  const row = (
    await pool.query<{ indexer_mode: string }>(
      "SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",
      [deployment]
    )
  ).rows[0];
  if (row?.indexer_mode !== (native ? "unified" : "legacy"))
    throw new Error(
      "Arena provider source selection does not match this worker."
    );
}

/** Current native input/result permission for a new paid action. Retrieval of
 * a known provider response is separate and may finish under an orphaned origin. */
export class NativeArenaProvider {
  constructor(
    readonly service: ArenaIntake,
    private readonly verify: (
      observed: NativeArenaActionObservation
    ) => Promise<void>,
    private readonly funding: () => Promise<unknown>
  ) {
    if (!service.nativeSource)
      throw new Error("Native provider requires the Ponder source.");
  }
  async check(
    id: string,
    kind: ProviderKind,
    expectedIncarnation?: string,
    db: Queryable = this.service.pool,
    allowPublished = false
  ): Promise<NativeProviderContext> {
    await this.service.ready(db);
    const context = await this.service.tournamentContext(
        id,
        db,
        false,
        expectedIncarnation
      ),
      observed = context.observation!,
      t = observed.tournament,
      freeze = t.inputFrozen;
    if (
      !freeze ||
      !context.state.inputHash ||
      context.state.phase !== (kind === "referee" ? "resolving" : "settled") ||
      (kind === "referee" &&
        context.state.deadline * 1000 <= Date.now() + 60000) ||
      (kind === "media" &&
        (!context.state.resultHash ||
          (!allowPublished && context.state.videoHash)))
    )
      throw new Error(
        "Native provider action requires its current active input/result."
      );
    const row = (
      await db.query<{ ciphertext: string }>(
        `SELECT f.ciphertext FROM yunipals_arena.frozen_input f WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3
        AND input_hash=$4 AND revealed_at IS NOT NULL AND revealed_event_id=$5 AND revealed_block_hash=$6`,
        [
          this.service.deployment,
          id,
          context.incarnation,
          context.state.inputHash,
          freeze.id,
          freeze.blockHash
        ]
      )
    ).rows[0];
    if (!row)
      throw new Error("Native provider input has no current disclosure proof.");
    if (kind === "media") {
      const adjudication = await db.query(
        `SELECT 1 FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=$2
        AND incarnation=$3 AND state='valid' AND input_hash=$4 AND outcome_hash=$5`,
        [
          this.service.deployment,
          id,
          context.incarnation,
          context.state.inputHash,
          context.state.resultHash
        ]
      );
      if (!adjudication.rowCount)
        throw new Error("Native media result is not the current adjudication.");
    }
    return {
      context,
      ciphertext: row.ciphertext,
      proof: {
        deployment: this.service.deployment,
        tournamentId: id,
        incarnation: context.incarnation,
        releaseId: observed.releaseId,
        openedEventId: t.opened.id,
        openedBlockHash: t.opened.blockHash,
        frozenEventId: freeze.id,
        frozenBlockHash: freeze.blockHash,
        inputHash: context.state.inputHash,
        resultHash: kind === "media" ? context.state.resultHash : null
      }
    };
  }
  async authorize(id: string, kind: ProviderKind, incarnation: string) {
    const before = await this.check(id, kind, incarnation);
    await this.funding();
    return this.refresh(before, kind);
  }
  async refresh(before: NativeProviderContext, kind: ProviderKind) {
    await this.verify(before.context.observation!);
    const current = await this.check(
      before.proof.tournamentId,
      kind,
      before.proof.incarnation
    );
    this.same(before, current);
    return current;
  }
  same(before: NativeProviderContext, after: NativeProviderContext) {
    if (
      canonicalJson(before.proof) !== canonicalJson(after.proof) ||
      canonicalJson(before.context.state) !==
        canonicalJson(after.context.state) ||
      before.ciphertext !== after.ciphertext
    )
      throw new Error("Native provider context changed during the action.");
  }
  async claim(
    requestId: string,
    kind: ProviderKind,
    authorized: NativeProviderContext
  ) {
    return transaction(this.service.pool, async (db) => {
      const current = await this.check(
        authorized.proof.tournamentId,
        kind,
        authorized.proof.incarnation,
        db
      );
      this.same(authorized, current);
      const claimed = await db.query(
        `UPDATE yunipals_arena.provider_task SET state='submitting',updated_at=now()
        WHERE request_id=$1 AND deployment=$2 AND tournament_id=$3 AND incarnation=$4 AND kind=$5 AND state='reserved' RETURNING request_id`,
        [
          requestId,
          this.service.deployment,
          authorized.proof.tournamentId,
          authorized.proof.incarnation,
          kind
        ]
      );
      if (!claimed.rowCount) return false;
      await db.query(
        "INSERT INTO yunipals_arena.provider_action_evidence(request_id,evidence) VALUES($1,$2)",
        [requestId, authorized.proof]
      );
      return true;
    });
  }
}

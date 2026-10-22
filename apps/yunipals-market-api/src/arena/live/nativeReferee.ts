import { randomUUID } from "node:crypto";
import { transaction } from "@/db/pool";
import { ArenaIntake } from "./intake";
import { ArenaRefereeApi } from "./refereeApi";
import { ArenaAdjudicator } from "./adjudication";

/** Scheduling only: native Ponder state selects current work. Saved response
 * IDs also have a bounded recovery queue independent of canonical existence. */
export class NativeArenaReferee {
  constructor(
    readonly service: ArenaIntake,
    readonly api: ArenaRefereeApi,
    readonly adjudicator: ArenaAdjudicator
  ) {
    if (!service.nativeSource?.work || api.native?.service !== service)
      throw new Error(
        "Native referee requires matching native readers and API guard."
      );
  }
  async reconcile() {
    await this.service.assertSourceSelection();
    const lease = randomUUID();
    const rows = await transaction(this.service.pool, async (db) => {
      const selected = (
        await db.query<{ request_id: string; id: string; incarnation: string }>(
          `SELECT request_id,tournament_id::text AS id,incarnation FROM yunipals_arena.provider_task
        WHERE deployment=$1 AND kind='referee' AND provider_id IS NOT NULL AND incarnation<>'legacy'
          AND state NOT IN('completed','failed','incomplete','cancelled') AND native_check_at<=now()
        ORDER BY native_check_at,request_id LIMIT 2 FOR UPDATE SKIP LOCKED`,
          [this.service.deployment]
        )
      ).rows;
      for (const row of selected)
        await db.query(
          `UPDATE yunipals_arena.provider_task SET native_check_lease=$2,native_check_at=now()+interval '2 minutes'
          WHERE request_id=$1`,
          [row.request_id, lease]
        );
      return selected;
    });
    let completed = 0,
      unavailable = 0;
    for (const row of rows) {
      try {
        const result = await this.api.step(
          this.service.deployment,
          row.id,
          row.incarnation
        );
        if (result.state === "completed") completed++;
      } catch {
        unavailable++;
      }
      await this.service.pool.query(
        `UPDATE yunipals_arena.provider_task SET native_check_lease=NULL,native_check_at=now()+interval '30 seconds'
        WHERE request_id=$1 AND native_check_lease=$2`,
        [row.request_id, lease]
      );
    }
    return { retrieved: rows.length, completed, unavailable };
  }
  async tick() {
    const recovery = await this.reconcile();
    await this.service.ready();
    const work = await this.service.nativeSource!.work!();
    for (const id of work.ids) {
      const context = await this.service.tournamentContext(id);
      if (
        context.state.phase !== "resolving" ||
        context.state.deadline * 1000 <= Date.now() + 60000
      )
        continue;
      const prior = await this.service.pool.query(
        "SELECT 1 FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
        [this.service.deployment, id, context.incarnation]
      );
      if (prior.rowCount) continue;
      const task = (
        await this.service.pool.query<{
          state: string;
          provider_id: string | null;
          due: boolean;
        }>(
          `SELECT state,provider_id,native_check_at<=now() AND native_check_lease IS NULL AS due
        FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='referee' AND asset='candidate-1'`,
          [this.service.deployment, id, context.incarnation]
        )
      ).rows[0];
      if (
        task &&
        ([
          "failed",
          "incomplete",
          "cancelled",
          "uncertain",
          "submitting"
        ].includes(task.state) ||
          (task.state !== "completed" && task.provider_id && !task.due))
      )
        continue;
      // Missing disclosure is ordinary waiting work; the disclosure worker owns
      // that proof, and the referee never opens an unverified private input.
      try {
        await this.api.native!.check(id, "referee", context.incarnation);
      } catch {
        continue;
      }
      const result = await this.adjudicator.step(
        this.service.deployment,
        id,
        1600000,
        context.incarnation
      );
      return {
        ...recovery,
        tournamentId: id,
        incarnation: context.incarnation,
        state: result.state
      };
    }
    return { ...recovery, tournamentId: null, state: "waiting" };
  }
}

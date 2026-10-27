import { randomUUID } from "node:crypto";
import { transaction } from "@/db/pool";
import { ArenaIntake } from "./intake";
import { ArenaMedia } from "./media";
import { ArenaMediaApi } from "./mediaApi";

/** Native state selects paid work; retrieval of saved UUIDs also survives
 * an orphaned tournament. Neither queue scans chain logs. */
export class NativeArenaMedia {
  constructor(
    readonly service: ArenaIntake,
    readonly api: ArenaMediaApi,
    readonly media: ArenaMedia
  ) {
    if (!service.nativeSource?.work || api.native?.service !== service)
      throw new Error(
        "Native media requires matching native readers and API guard."
      );
  }
  async reconcile() {
    await this.service.assertSourceSelection();
    const lease = randomUUID();
    const rows = await transaction(this.service.pool, async (db) => {
      const selected = (
        await db.query<{
          request_id: string;
          id: string;
          incarnation: string;
          asset: string;
        }>(
          `SELECT request_id,tournament_id::text AS id,incarnation,asset FROM yunipals_arena.provider_task
        WHERE deployment=$1 AND kind='media' AND incarnation<>'legacy' AND state NOT IN('reserved','completed','failed','incomplete','cancelled')
          AND native_check_at<=now() ORDER BY native_check_at,request_id LIMIT 2 FOR UPDATE SKIP LOCKED`,
          [this.service.deployment]
        )
      ).rows;
      for (const row of selected)
        await db.query(
          `UPDATE yunipals_arena.provider_task SET native_check_lease=$2,native_check_at=now()+interval '2 minutes' WHERE request_id=$1`,
          [row.request_id, lease]
        );
      return selected;
    });
    let completed = 0,
      unavailable = 0;
    for (const row of rows) {
      try {
        const folder = await this.api.folder(
          this.service.deployment,
          row.id,
          row.incarnation
        );
        const result = await this.api.step(
          this.service.deployment,
          row.id,
          row.asset,
          folder,
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
    const due = (
      await this.service.pool.query<{ id: string }>(
        `SELECT tournament_id::text AS id FROM yunipals_arena.media_job WHERE deployment=$1 AND incarnation<>'legacy'
        AND native_check_at<=now() ORDER BY native_check_at,tournament_id LIMIT 10`,
        [this.service.deployment]
      )
    ).rows;
    for (const id of new Set([...due.map((row) => row.id), ...work.ids])) {
      const context = await this.service
        .tournamentContext(id)
        .catch(() => null);
      await this.service.pool.query(
        `UPDATE yunipals_arena.media_job SET native_check_at=now()+interval '5 minutes'
        WHERE deployment=$1 AND tournament_id=$2 AND native_check_at<=now() AND ($3::text IS NULL OR incarnation<>$3)`,
        [this.service.deployment, id, context?.incarnation ?? null]
      );
      if (!context) continue;
      if (context.state.phase !== "settled") continue;
      try {
        await this.api.native!.check(
          id,
          "media",
          context.incarnation,
          undefined,
          true
        );
      } catch {
        continue;
      }
      const lease = randomUUID();
      const claimed = await this.service.pool.query(
        `INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation,input_hash,outcome_hash,native_check_lease,native_check_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes') ON CONFLICT(deployment,tournament_id,incarnation) DO UPDATE
          SET native_check_lease=EXCLUDED.native_check_lease,native_check_at=EXCLUDED.native_check_at
          WHERE yunipals_arena.media_job.native_check_at<=now() AND yunipals_arena.media_job.state<>'needs-attention'
            AND (yunipals_arena.media_job.input_hash IS NULL OR
              (yunipals_arena.media_job.input_hash=EXCLUDED.input_hash AND yunipals_arena.media_job.outcome_hash=EXCLUDED.outcome_hash))
          RETURNING tournament_id`,
        [
          this.service.deployment,
          id,
          context.incarnation,
          context.state.inputHash,
          context.state.resultHash,
          lease
        ]
      );
      if (!claimed.rowCount) continue;
      let state = "retrying";
      try {
        state = (
          await this.media.step(
            this.service.deployment,
            id,
            context.incarnation
          )
        ).state;
      } catch {
        recovery.unavailable++;
      } finally {
        await this.service.pool.query(
          `UPDATE yunipals_arena.media_job SET native_check_lease=NULL,
          native_check_at=now()+CASE WHEN state='ready' THEN interval '5 minutes' ELSE interval '30 seconds' END
          WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND native_check_lease=$4`,
          [this.service.deployment, id, context.incarnation, lease]
        );
      }
      return {
        ...recovery,
        tournamentId: id,
        incarnation: context.incarnation,
        state
      };
    }
    return { ...recovery, tournamentId: null, state: "waiting" };
  }
}

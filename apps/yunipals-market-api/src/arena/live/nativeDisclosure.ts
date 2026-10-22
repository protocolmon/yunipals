import { randomUUID } from "node:crypto";
import { transaction } from "@/db/pool";
import { ArenaIntake, ArenaRequestError } from "./intake";
import type { NativeArenaActionObservation } from "./nativeAction";

/** Reconcile saved private input with native public evidence. Leases schedule
 * application work only; Ponder remains the sole Arena log ingestor.
 */
export class NativeArenaDisclosure {
  constructor(
    private readonly service: ArenaIntake,
    private readonly verify: (
      observation: NativeArenaActionObservation
    ) => Promise<void>
  ) {
    if (!service.nativeSource)
      throw new Error("Native disclosure requires the selected Ponder source.");
  }

  async tick(limit = 8) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw new Error("Invalid native disclosure batch size.");
    await this.service.ready();
    const lease = randomUUID();
    const rows = await transaction(this.service.pool, async (db) => {
      await this.service.assertSourceSelection(db);
      const selected = (
        await db.query<{ id: string; incarnation: string }>(
          `SELECT tournament_id::text AS id,incarnation FROM yunipals_arena.frozen_input
        WHERE deployment=$1 AND native_check_at<=now()
        ORDER BY native_check_at,tournament_id,incarnation LIMIT $2 FOR UPDATE SKIP LOCKED`,
          [this.service.deployment, limit]
        )
      ).rows;
      for (const row of selected)
        await db.query(
          `UPDATE yunipals_arena.frozen_input SET native_check_at=now()+interval '2 minutes',native_check_lease=$4
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3`,
          [this.service.deployment, row.id, row.incarnation, lease]
        );
      return selected;
    });
    const result = { checked: 0, revealed: 0, waiting: 0, unavailable: 0 };
    for (const id of new Set(rows.map((row) => row.id))) {
      let delay = 30;
      try {
        const revealed = await this.service.reconcileInputFrozen(
          id,
          this.verify
        );
        if (revealed) {
          result.revealed++;
          delay = 60;
        } else {
          result.waiting++;
          delay = 5;
        }
      } catch (error) {
        if (error instanceof ArenaRequestError && error.status === 404) {
          result.waiting++;
          delay = 600;
        } else result.unavailable++;
      }
      result.checked++;
      // A late worker cannot change a newer lease's schedule. A crash leaves
      // this work eligible again without touching its input or disclosure proof.
      await this.service.pool.query(
        `UPDATE yunipals_arena.frozen_input SET native_check_at=now()+$4*interval '1 second',native_check_lease=NULL
        WHERE deployment=$1 AND tournament_id=$2 AND native_check_lease=$3`,
        [this.service.deployment, id, lease, delay]
      );
    }
    return result;
  }
}

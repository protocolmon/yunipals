import type { Pool, PoolClient } from "pg";

export type ArenaSourceBinding = {
  epoch: string;
  kind: "unified" | "legacy_rollback";
  sourceId: string;
};
type Queryable = Pick<PoolClient, "query">;
export const sourceLeaseKey = (deployment: string) =>
  `arena/source-selection/${deployment}`;

export async function selectedArenaSource(db: Queryable, deployment: string) {
  return (
    await db.query<{
      epoch: string;
      kind: ArenaSourceBinding["kind"];
      source_id: string;
    }>(
      "SELECT epoch,kind,source_id FROM yunipals_arena.source_selection WHERE deployment=$1",
      [deployment]
    )
  ).rows[0];
}

export async function assertArenaSourceBinding(
  db: Queryable,
  deployment: string,
  binding?: ArenaSourceBinding
) {
  const selected = await selectedArenaSource(db, deployment);
  if (
    selected
      ? !binding ||
        selected.epoch !== binding.epoch ||
        selected.kind !== binding.kind ||
        selected.source_id !== binding.sourceId
      : binding
  )
    throw new Error(
      "Arena source epoch changed; restart with its selected source."
    );
}

/** Session-scoped because a database transaction must not span network work.
 * A reviewed source switch holds the exclusive counterpart. Selection remains
 * stable until the actual signature/provider call/broadcast has returned. */
export async function withArenaSourceLease<T>(
  service: {
    pool: Pool;
    deployment: string;
    nativeSource?: unknown;
    assertSourceSelection(db?: Queryable): Promise<void>;
  },
  work: () => Promise<T>
): Promise<T> {
  if (!service.nativeSource) return work();
  const db = await service.pool.connect();
  let locked = false,
    discard = false;
  try {
    await db.query("SELECT pg_advisory_lock_shared(hashtext($1))", [
      sourceLeaseKey(service.deployment)
    ]);
    locked = true;
    await service.assertSourceSelection(db);
    return await work();
  } finally {
    if (locked)
      try {
        await db.query("SELECT pg_advisory_unlock_shared(hashtext($1))", [
          sourceLeaseKey(service.deployment)
        ]);
      } catch {
        discard = true;
      }
    db.release(discard);
  }
}

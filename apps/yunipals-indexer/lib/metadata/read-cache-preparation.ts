import type { PoolClient } from "pg";

import { collectionSlugs } from "../constants.js";
import { buildReadCache, readCacheFreshSql } from "./read-cache.js";

export function prepublishReadCacheEnabled() {
  const value = process.env.PROJECTION_PREPARE_READ_CACHE ?? "false";
  if (!["true", "false"].includes(value))
    throw new Error("Invalid PROJECTION_PREPARE_READ_CACHE");
  return value === "true";
}

// Renew between builds. An expired lease loses its old cache proofs before
// reuse, including when a slow build outlives its lease. Cleanup/preparation
// also share the worker lock.
export async function renewReadCachePreparation(db: PoolClient, id: string) {
  await db.query(
    `WITH previous AS MATERIALIZED (
      SELECT expires_at FROM metadata_projection.read_preparation WHERE generation_id=$1 FOR UPDATE
    ), expired AS (
      DELETE FROM metadata_projection.read_set WHERE generation_id=$1
        AND EXISTS(SELECT 1 FROM previous WHERE expires_at<=clock_timestamp()) RETURNING generation_id
    )
    INSERT INTO metadata_projection.read_preparation(generation_id,expires_at)
      SELECT $1,clock_timestamp()+interval '20 minutes'
      WHERE (SELECT count(*) FROM expired)>=0
      ON CONFLICT(generation_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`,
    [id]
  );
}

export async function prepareGenerationReadCache(db: PoolClient, id: string) {
  await db.query("SELECT pg_advisory_lock(hashtext('yunipals:read-cache'))");
  try {
    await renewReadCachePreparation(db, id);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const chain of collectionSlugs) {
        await renewReadCachePreparation(db, id);
        const fresh = (
          await db.query<{ fresh: boolean }>(
            `SELECT ${readCacheFreshSql(id, [chain], { preparing: true })} AS fresh`
          )
        ).rows[0]?.fresh;
        if (!fresh) {
          const started = performance.now();
          const rows = await buildReadCache(db, id, chain);
          console.info(
            JSON.stringify({
              event: "read_cache_prepared",
              generation: id,
              chain,
              rows,
              durationMs: Math.round(performance.now() - started)
            })
          );
        }
      }
      await db.query("SELECT metadata_projection.analyze_read_cache()");
      if (
        (
          await db.query<{ fresh: boolean }>(
            `SELECT ${readCacheFreshSql(id, collectionSlugs, { preparing: true })} AS fresh`
          )
        ).rows[0]?.fresh
      )
        return;
    }
    throw new Error("projection_read_cache_changed_during_preparation");
  } finally {
    await db.query(
      "SELECT pg_advisory_unlock(hashtext('yunipals:read-cache'))"
    );
  }
}

export const retainedReadCacheGenerationsSql = `SELECT current_id FROM metadata_projection.active WHERE current_id IS NOT NULL
  UNION SELECT previous_id FROM metadata_projection.active WHERE previous_id IS NOT NULL
  UNION SELECT generation_id FROM metadata_projection.read_preparation WHERE expires_at>statement_timestamp()`;

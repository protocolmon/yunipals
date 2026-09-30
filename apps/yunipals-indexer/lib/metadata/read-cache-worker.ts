import { setTimeout as delay } from "node:timers/promises";
import { pool, apiPool } from "../offchain/db.js";
import { collectionSlugs } from "../constants.js";
import { buildReadCache, readCacheFreshSql } from "./read-cache.js";

let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopped = true;
  });
while (!stopped) {
  const client = await pool.connect();
  try {
    const locked = (
      await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('yunipals:read-cache')) AS locked"
      )
    ).rows[0]?.locked;
    if (locked) {
      const id = (
        await client.query<{ current_id: string }>(
          "SELECT current_id FROM metadata_projection.active WHERE singleton"
        )
      ).rows[0]?.current_id;
      if (id) {
        for (const chain of [
          "bnb",
          ...collectionSlugs.filter((chain) => chain !== "bnb")
        ] as const) {
          if (stopped) break;
          const fresh = (
            await client.query<{ fresh: boolean }>(
              `SELECT ${readCacheFreshSql(id, [chain])} AS fresh`
            )
          ).rows[0]?.fresh;
          if (!fresh) {
            const started = performance.now();
            const rows = await buildReadCache(client, id, chain);
            console.info(
              JSON.stringify({
                event: "read_cache_built",
                generation: id,
                chain,
                rows,
                durationMs: Math.round(performance.now() - started)
              })
            );
          }
        }
      }
      await client.query(`DELETE FROM metadata_projection.read_set
        WHERE generation_id NOT IN (SELECT current_id FROM metadata_projection.active WHERE current_id IS NOT NULL
          UNION SELECT previous_id FROM metadata_projection.active WHERE previous_id IS NOT NULL)`);
      // Small batches keep maintenance bounded and avoid a large deletion transaction.
      const orphan = (
        await client.query<{
          id: string;
        }>(`SELECT g.id FROM metadata_projection.generation g
        WHERE g.id NOT IN(SELECT current_id FROM metadata_projection.active WHERE current_id IS NOT NULL
          UNION SELECT previous_id FROM metadata_projection.active WHERE previous_id IS NOT NULL)
        AND EXISTS(SELECT 1 FROM metadata_projection.read_member m WHERE m.generation_id=g.id) LIMIT 1`)
      ).rows[0];
      if (orphan)
        await client.query(
          `DELETE FROM metadata_projection.read_member WHERE ctid IN (
        SELECT ctid FROM metadata_projection.read_member WHERE generation_id=$1 LIMIT 10000)`,
          [orphan.id]
        );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "read_cache_refresh_failed",
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "refresh_failed"
      })
    );
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('yunipals:read-cache'))")
      .catch(() => undefined);
    client.release();
  }
  if (!stopped) await delay(5000);
}
await Promise.all([pool.end(), apiPool.end()]);

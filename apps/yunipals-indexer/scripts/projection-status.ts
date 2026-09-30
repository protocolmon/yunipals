import { statfs } from "node:fs/promises";

import { closePool, pool } from "../lib/offchain/db.js";

try {
  const [pointer, generations, storage, activity, directory] = await Promise.all([
    pool.query(`SELECT a.current_id,a.previous_id,a.updated_at,
      g.metadata_release_id,g.published_at
      FROM metadata_projection.active a LEFT JOIN metadata_projection.generation g
        ON g.id=a.current_id WHERE a.singleton`),
    pool.query(`SELECT id,state,started_at,completed_at,published_at,retired_at,
      validation->>'search_count' AS search_count,
      validation->>'trait_count' AS trait_count
      FROM metadata_projection.generation ORDER BY id DESC LIMIT 12`),
    pool.query(`SELECT c.relname,pg_total_relation_size(c.oid)::text AS bytes,
      COALESCE(s.n_dead_tup,0)::text AS dead_tuples
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
      WHERE n.nspname='metadata_projection' AND c.relkind='r'
      ORDER BY c.relname`),
    pool.query(`SELECT max(extract(epoch FROM clock_timestamp()-xact_start))::numeric(12,1) AS oldest_seconds
      FROM pg_stat_activity WHERE datname=current_database() AND xact_start IS NOT NULL`),
    process.env.PROJECTION_STORAGE_PATH
      ? Promise.resolve({ rows: [{ directory: process.env.PROJECTION_STORAGE_PATH }] })
      : pool.query<{ directory: string }>("SELECT current_setting('data_directory') AS directory")
  ]);
  const disk = await statfs(process.env.PROJECTION_STORAGE_PATH ?? directory.rows[0]!.directory);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    active: pointer.rows[0] ?? null,
    generations: generations.rows,
    tables: storage.rows,
    oldestTransactionSeconds: activity.rows[0]?.oldest_seconds ?? null,
    freeBytes: Number(disk.bavail) * Number(disk.bsize)
  }, null, 2));
} finally {
  await closePool();
}

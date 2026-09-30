import { closePool, pool } from "../lib/offchain/db.js";

const client = await pool.connect();
let committed = false;
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='500ms'");
  await client.query("SET LOCAL statement_timeout='2s'");
  const result = await client.query<{
    current_id: string | null;
    previous_id: string | null;
    state: string | null;
    source_mode: string | null;
    metadata_release_id: string | null;
  }>(`SELECT a.current_id,a.previous_id,g.state,g.source_mode,g.metadata_release_id
    FROM metadata_projection.active a LEFT JOIN metadata_projection.generation g
      ON g.id=a.previous_id WHERE a.singleton FOR UPDATE OF a`);
  const row = result.rows[0];
  if (!row?.previous_id || row.state !== "ready") throw new Error("No ready rollback generation");
  if (row.source_mode === "archive") {
    const active = await client.query<{ release_id: string }>(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE");
    if (active.rows[0]?.release_id !== row.metadata_release_id) {
      throw new Error("Rollback generation has an obsolete metadata release");
    }
  }
  await client.query(`UPDATE metadata_projection.active SET
    current_id=previous_id,previous_id=current_id,updated_at=now() WHERE singleton`);
  if (row.source_mode === "archive") await client.query(`INSERT INTO metadata.derived_snapshot(name,metadata_release_id)
    VALUES('traits',$1) ON CONFLICT(name) DO UPDATE SET
    metadata_release_id=EXCLUDED.metadata_release_id,updated_at=now()`, [row.metadata_release_id]);
  await client.query("COMMIT");
  committed = true;
  console.log(JSON.stringify({ currentId: row.previous_id, previousId: row.current_id }));
} finally {
  if (!committed) await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await closePool();
}

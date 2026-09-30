import { closePool, pool } from "../lib/offchain/db.js";
import { metadataSourceMode } from "../lib/metadata/publication.js";
import { assertProjectionBuildCapacity } from "../lib/metadata/projection-refresh.js";

const client = await pool.connect();
let committed = false;
try {
  await client.query("SELECT pg_advisory_lock(hashtext('yunipals:trait-refresh'))");
  await assertProjectionBuildCapacity(client);
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const current = await client.query<{ current_id: string | null }>(
    "SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE");
  if (current.rows[0]?.current_id) throw new Error("Projection already seeded");
  const archive = metadataSourceMode() === "archive";
  const release = archive
    ? (await client.query<{ metadata_release_id: string }>(
        "SELECT metadata_release_id FROM metadata.derived_snapshot WHERE name='traits'"
      )).rows[0]?.metadata_release_id ?? null
    : null;
  if (archive) {
    const active = (await client.query<{ release_id: string }>(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE"
    )).rows[0]?.release_id;
    if (!release || release !== active) throw new Error("Legacy trait release is not current");
  }
  const created = await client.query<{ id: string }>(`
    INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state)
    VALUES($1,$2,'building') RETURNING id`, [archive ? "archive" : "legacy", release]);
  const id = created.rows[0]!.id;
  const copies = [
    ["search", "token_search", "collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped,updated_at"],
    ["trait", "token_trait", "collection,token_id,lifecycle,trait_type,value,value_numeric"],
    ["revision", "projection_revision", "collection,token_id,lifecycle,metadata_content_hash"],
    ["facet", "trait_facet", "scope,trait_type,kind,min_value,max_value,values,updated_at"],
    ["facet_status", "trait_facet_status", "scope,singleton,available,missing,updated_at"]
  ] as const;
  const counts: Record<string, number> = {};
  for (const [destination, source, columns] of copies) {
    const inserted = await client.query(`INSERT INTO metadata_projection.${destination}
      (generation_id,${columns}) SELECT $1::bigint,${columns} FROM metadata.${source}`, [id]);
    const sourceCount = Number((await client.query<{ count: string }>(
      `SELECT count(*) FROM metadata.${source}`)).rows[0]!.count);
    if (inserted.rowCount !== sourceCount) throw new Error(`${source} changed during seed`);
    counts[destination] = sourceCount;
  }
  if (!counts.search || counts.facet_status !== 15 || (archive && counts.revision !== counts.search)) {
    throw new Error(`Projection seed failed coverage check: ${JSON.stringify(counts)}`);
  }
  await client.query(`UPDATE metadata_projection.generation
    SET state='ready',completed_at=now(),validation=$2::jsonb,published_at=now()
    WHERE id=$1`, [id, JSON.stringify({ seed: true, counts })]);
  await client.query(`UPDATE metadata_projection.active SET current_id=$1,updated_at=now()
    WHERE singleton AND current_id IS NULL`, [id]);
  await client.query("COMMIT");
  committed = true;
  console.log(JSON.stringify({ generationId: id, counts }));
} finally {
  if (!committed) await client.query("ROLLBACK").catch(() => undefined);
  await client.query("SELECT pg_advisory_unlock(hashtext('yunipals:trait-refresh'))").catch(() => undefined);
  client.release();
  await closePool();
}

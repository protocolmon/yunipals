import { pool } from "../lib/offchain/db.js";
import { metadataSourceMode } from "../lib/metadata/publication.js";
import { projectionMode } from "../lib/metadata/projection-mode.js";
import {
  publishGeneration,
  validateGeneration
} from "../lib/metadata/projection-refresh.js";

function requiredId(name: string) {
  const value = process.env[name];
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

const generationId = requiredId("PROJECTION_RESUME_GENERATION_ID");
const predecessorId = requiredId("PROJECTION_RESUME_PREDECESSOR_ID");
const expectedSearch = Number(requiredId("PROJECTION_RESUME_EXPECTED_SEARCH_COUNT"));
if (!Number.isSafeInteger(expectedSearch)) throw new Error("Invalid expected search count");
if (metadataSourceMode() !== "archive" || projectionMode() !== "generation") {
  throw new Error("Projection resume requires archive and generation modes");
}

const client = await pool.connect();
let locked = false;
try {
  const advisory = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('yunipals:trait-refresh')) AS acquired"
  );
  if (!advisory.rows[0]?.acquired) throw new Error("Trait refresh is still running");
  locked = true;

  const active = await client.query<{ current_id: string | null }>(
    "SELECT current_id FROM metadata_projection.active WHERE singleton"
  );
  if (active.rows[0]?.current_id !== predecessorId) {
    throw new Error("Projection predecessor changed");
  }
  const candidate = await client.query<{
    state: string;
    source_mode: string;
    metadata_release_id: string | null;
    format_version: number;
    published_at: Date | null;
    failure_reason: string | null;
    validation: unknown;
  }>(`SELECT state,source_mode,metadata_release_id,format_version,
      published_at,failure_reason,validation
      FROM metadata_projection.generation WHERE id=$1`, [generationId]);
  const row = candidate.rows[0];
  if (!row || row.source_mode !== "archive" || row.format_version !== 1 || row.published_at ||
    !((row.state === "failed" && row.failure_reason?.startsWith("canceling statement")) ||
      (row.state === "ready" && row.validation !== null))) {
    throw new Error("Candidate is not a cancelled, unpublished generation");
  }
  const release = await client.query<{ release_id: string }>(
    "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
  );
  if (!row.metadata_release_id || release.rows[0]?.release_id !== row.metadata_release_id) {
    throw new Error("Projection source release changed");
  }

  const validation = await validateGeneration(client, generationId, expectedSearch);
  const updated = await client.query(`UPDATE metadata_projection.generation
    SET state='ready',completed_at=now(),failure_reason=NULL,validation=$2::jsonb
    WHERE id=$1 AND state IN ('failed','ready') AND published_at IS NULL`,
    [generationId, JSON.stringify(validation)]);
  if (updated.rowCount !== 1) throw new Error("Candidate changed before publication");

  try {
    await publishGeneration(client, generationId, row.metadata_release_id, predecessorId);
  } catch (error) {
    const pointer = await pool.query<{ current_id: string | null }>(
      "SELECT current_id FROM metadata_projection.active WHERE singleton"
    );
    if (pointer.rows[0]?.current_id !== generationId) throw error;
  }
  console.log(JSON.stringify({ generationId, previousId: predecessorId, validation }));
} finally {
  if (locked) {
    await client.query("SELECT pg_advisory_unlock(hashtext('yunipals:trait-refresh'))").catch(() => undefined);
  }
  client.release();
  await pool.end();
}

import type { Pool } from "pg";

import { collectionSlugs } from "../constants.js";
import { ponderSchema } from "../offchain/sql.js";
import {
  localRarityJoin,
  rarityPointsCappedSql,
  rarityPointsSql
} from "../rarity/read-source.js";
import { metadataSourceMode } from "./publication.js";
import {
  metadataScanReadRelation,
  readActiveProjectionId
} from "./read-source.js";

export type ProjectionCheck =
  | { state: "unavailable" }
  /** Readers accept the live generation; inputs were not compared. */
  | { state: "available"; generationId: string }
  | {
      state: "current" | "changed";
      generationId: string;
      /** Tokens whose metadata, availability or rarity points differ. */
      metadataChanges: number;
      /** Collections whose number of unburned tokens differs. */
      tokenChanges: number;
    };

/** Tokens whose metadata, availability or rarity points differ from generation
 * $1. It reads the same inputs as the search, trait and revision rows of a
 * build. */
export const projectionMetadataChangesSql = `WITH current_rows AS MATERIALIZED (
      SELECT m.collection,m.token_id::numeric AS token_id,m.lifecycle,m.content_hash,
        (m.document IS NOT NULL) AS metadata_available,
        ${rarityPointsSql} AS rarity_points,${rarityPointsCappedSql} AS rarity_points_capped
      FROM ${metadataScanReadRelation} m ${localRarityJoin}
      LEFT JOIN LATERAL (SELECT a->>'value' AS value
        FROM jsonb_array_elements(COALESCE(m.attributes,'[]')) a
        WHERE a->>'trait_type'='Rarity Points' LIMIT 1) rp ON true
    ), live_rows AS MATERIALIZED (
      SELECT s.collection,s.token_id,s.lifecycle,r.metadata_content_hash AS content_hash,
        s.metadata_available,s.rarity_points,s.rarity_points_capped
      FROM metadata_projection.search s LEFT JOIN metadata_projection.revision r
        ON r.generation_id=s.generation_id AND r.collection=s.collection
          AND r.token_id=s.token_id AND r.lifecycle=s.lifecycle
      WHERE s.generation_id=$1
    )
    SELECT count(*)::int AS changes FROM current_rows c FULL JOIN live_rows l
      ON l.collection=c.collection AND l.token_id=c.token_id AND l.lifecycle=c.lifecycle
    WHERE c.token_id IS NULL OR l.token_id IS NULL
      OR (c.content_hash,c.metadata_available,c.rarity_points,c.rarity_points_capped)
        IS DISTINCT FROM (l.content_hash,l.metadata_available,l.rarity_points,l.rarity_points_capped)`;

/** Collections whose unburned token count differs from generation $1, for the
 * chains in $2. Facets count unburned tokens only, so a burn changes them. */
export const projectionTokenChangesSql = `SELECT count(*)::int AS changes FROM (
      SELECT collection,count(*) FILTER(WHERE NOT burned)::int AS unburned
      FROM ${ponderSchema}.token WHERE collection=ANY($2::text[]) GROUP BY collection
      HAVING count(*) FILTER(WHERE NOT burned)>0
    ) current_tokens FULL JOIN (
      SELECT scope AS collection,available+missing AS unburned
      FROM metadata_projection.facet_status WHERE generation_id=$1 AND scope=ANY($2::text[])
    ) live_tokens USING(collection)
    WHERE current_tokens.unburned IS DISTINCT FROM live_tokens.unburned`;

/** Whether readers accept the live generation. "unavailable" means search and
 * traits are failing, for example after a new indexer or archive release.
 * One cheap query, so it can run often. */
export async function checkProjectionAvailable(
  db: Pick<Pool, "query">
): Promise<ProjectionCheck> {
  try {
    const generationId = await readActiveProjectionId(db);
    if (!generationId) throw new Error("Projection checks need generations");
    return { state: "available", generationId };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "projection_generation_unavailable"
    )
      return { state: "unavailable" };
    throw error;
  }
}

/** Compare current inputs with the live generation, without building.
 * "changed": metadata, rarity points or burns differ from it. Ownership is not
 * part of a generation, so transfers alone change nothing. This reads every
 * token's metadata, minutes on a large deployment, so run it rarely.
 */
export async function checkProjectionInputs(
  db: Pick<Pool, "connect" | "query">
): Promise<ProjectionCheck> {
  if (metadataSourceMode() !== "archive")
    throw new Error("Projection checks require METADATA_SOURCE_MODE=archive");
  const available = await checkProjectionAvailable(db);
  if (available.state !== "available") return available;
  const { generationId } = available;
  const client = await db.connect();
  try {
    // Read committed: each statement takes its own snapshot. The ownership
    // views reject an observation that is minutes old, which is what a single
    // snapshot would show the second statement after a long first one.
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL work_mem='64MB'");
    const metadata = await client.query<{ changes: number }>(
      projectionMetadataChangesSql,
      [generationId]
    );
    const tokens = await client.query<{ changes: number }>(
      projectionTokenChangesSql,
      [generationId, collectionSlugs]
    );
    await client.query("COMMIT");
    const metadataChanges = metadata.rows[0]!.changes;
    const tokenChanges = tokens.rows[0]!.changes;
    return {
      state: metadataChanges || tokenChanges ? "changed" : "current",
      generationId,
      metadataChanges,
      tokenChanges
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

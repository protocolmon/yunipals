import { metadataReadRelation } from "../lib/metadata/read-source.js";
import { pool } from "../lib/offchain/db.js";
import { rarityFormulaVersion } from "../lib/rarity/calculate.js";

const comparisonSql = `
  WITH comparison AS MATERIALIZED (
    SELECT m.collection, m.token_id, m.lifecycle, r.status,
      CASE
        WHEN m.document->>'rarity' ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (m.document->>'rarity')::numeric
        WHEN rp.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN rp.value::numeric
      END AS upstream_raw,
      COALESCE(
        CASE WHEN m.document->>'rarityCapped' ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (m.document->>'rarityCapped')::numeric END,
        CASE
          WHEN m.document->>'rarity' ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN (m.document->>'rarity')::numeric
          WHEN rp.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN rp.value::numeric
        END
      ) AS upstream_capped,
      r.rarity_points AS local_raw,
      r.rarity_points_capped AS local_capped
    FROM ${metadataReadRelation} m
    LEFT JOIN metadata.token_rarity r ON r.collection=m.collection
      AND r.token_id=m.token_id AND r.lifecycle=m.lifecycle
      AND r.formula_version=$1
    LEFT JOIN LATERAL (
      SELECT a->>'value' AS value
      FROM jsonb_array_elements(COALESCE(m.attributes, '[]')) a
      WHERE a->>'trait_type'='Rarity Points' LIMIT 1
    ) rp ON true
    WHERE m.document IS NOT NULL
  ), summary AS (
    SELECT collection, count(*)::int AS total,
      count(*) FILTER (WHERE status='valid')::int AS local_valid,
      count(*) FILTER (WHERE status='unscored')::int AS local_unscored,
      count(*) FILTER (WHERE status='missing_input')::int AS local_missing_input,
      count(*) FILTER (WHERE status='invalid')::int AS local_invalid,
      count(*) FILTER (WHERE status IS NULL)::int AS local_missing,
      count(*) FILTER (WHERE upstream_raw IS NOT NULL AND upstream_capped IS NOT NULL)::int AS comparable,
      count(*) FILTER (WHERE upstream_raw IS NOT NULL AND upstream_capped IS NOT NULL
        AND status='valid' AND upstream_raw=local_raw AND upstream_capped=local_capped)::int AS exact_matches,
      count(*) FILTER (WHERE upstream_raw IS NOT NULL AND upstream_capped IS NOT NULL
        AND status IN ('unscored','missing_input','invalid'))::int AS fallback_with_upstream,
      count(*) FILTER (WHERE status IS NULL OR (
        upstream_raw IS NOT NULL AND upstream_capped IS NOT NULL AND status='valid'
        AND (upstream_raw IS DISTINCT FROM local_raw OR upstream_capped IS DISTINCT FROM local_capped)
      ))::int AS mismatches,
      count(*) FILTER (WHERE upstream_raw IS NULL AND status='valid')::int AS locally_scored_without_upstream
    FROM comparison GROUP BY collection
  ), mismatch_samples AS (
    SELECT collection, token_id::text AS "tokenId", lifecycle, status,
      upstream_raw::text AS "upstreamRaw", local_raw::text AS "localRaw",
      upstream_capped::text AS "upstreamCapped", local_capped::text AS "localCapped"
    FROM comparison
    WHERE status IS NULL OR (
      upstream_raw IS NOT NULL AND upstream_capped IS NOT NULL AND status='valid'
      AND (upstream_raw IS DISTINCT FROM local_raw OR upstream_capped IS DISTINCT FROM local_capped)
    )
    ORDER BY collection, token_id, lifecycle LIMIT 25
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY collection) FROM summary), '[]') AS chains,
    COALESCE((SELECT jsonb_agg(to_jsonb(mismatch_samples)) FROM mismatch_samples), '[]') AS mismatch_samples`;

try {
  const comparison = await pool.query<{
    chains: Array<Record<string, number | string>>;
    mismatch_samples: Array<Record<string, number | string | null>>;
  }>(comparisonSql, [rarityFormulaVersion]);
  const chains = comparison.rows[0]?.chains ?? [];
  const report = {
    status: chains.some(
      (row) =>
        Number(row.mismatches) > 0 ||
        Number(row.locally_scored_without_upstream) > 0
    )
      ? "mismatch"
      : "compatible",
    formulaVersion: rarityFormulaVersion,
    chains,
    mismatchSamples: comparison.rows[0]?.mismatch_samples ?? []
  };
  console.log(JSON.stringify(report));
  if (report.status !== "compatible") process.exitCode = 1;
} finally {
  await pool.end();
}

import type { CollectionSlug } from "../constants.js";

/** Materialize validated identities once before joining current tokens. Without
 * this boundary, a UNION proof relation can become a quadratic nested loop.
 */
export function traitCountQuery(input: {
  chain: CollectionSlug;
  source: string;
  filters: string[];
  traits: string;
  rawTraits: string;
  traitFilters: { type: number; values: number }[];
}) {
  // Every trait of one generation shares the same revision/publication proof.
  // Intersect raw identities first, then validate once, even for many filters.
  const rawMatches = input.traitFilters.slice(1).map(
    (filter) => `EXISTS(SELECT 1 FROM ${input.rawTraits} other
      WHERE other.collection=f.collection AND other.token_id=f.token_id
        AND other.lifecycle=f.lifecycle AND other.trait_type=$${filter.type}
        AND other.value=ANY($${filter.values}::text[]))`
  );
  const first = input.traitFilters[0]!;
  const rawKeys = `raw_trait_keys AS MATERIALIZED (
    SELECT DISTINCT f.collection,f.token_id,f.lifecycle FROM ${input.rawTraits} f
    WHERE f.collection='${input.chain}' AND f.trait_type=$${first.type}
      AND f.value=ANY($${first.values}::text[]) AND ${rawMatches.join(" AND ")})`;
  const keys = input.traitFilters.slice(0, 1).map(
    (filter, index) => `trait_keys_${index} AS MATERIALIZED (
      SELECT DISTINCT f.collection,f.token_id,f.lifecycle FROM ${input.traits} f
      WHERE f.collection='${input.chain}' AND f.trait_type=$${filter.type}
        AND f.value=ANY($${filter.values}::text[])
        ${rawMatches.length ? `AND EXISTS(SELECT 1 FROM raw_trait_keys raw WHERE raw.collection=f.collection AND raw.token_id=f.token_id AND raw.lifecycle=f.lifecycle)` : ""})`
  );
  const matches = input.traitFilters.slice(0, 1).map(
    (_, index) => `EXISTS(SELECT 1 FROM trait_keys_${index} f
      WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric
        AND f.lifecycle=t.lifecycle)`
  );
  return `WITH ${[...(rawMatches.length ? [rawKeys] : []), ...keys].join(", ")}
    SELECT count(*)::bigint AS total FROM ${input.source}
    WHERE ${[`t.collection='${input.chain}'`, ...input.filters, ...matches].join(" AND ")}`;
}

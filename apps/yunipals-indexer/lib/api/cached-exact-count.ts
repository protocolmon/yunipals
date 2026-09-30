import type { CollectionSlug } from "../constants.js";
import { readCacheFreshSql } from "../metadata/read-cache.js";
import { activeVisibilityRowPredicate } from "./visibility-query.js";

/** Cache guards prove membership equals current token identities/lifecycles.
 * Broad counts can count that membership directly and subtract live hidden
 * identities. Owner, burn, and trait filters keep the normal current-token join.
 */
export function cachedExactCountSql(input: {
  chains: readonly CollectionSlug[];
  generation: string;
  relations: string[];
  filters: string[];
  fallback: string;
}) {
  const fresh = readCacheFreshSql(input.generation, input.chains);
  const generation = `${input.generation}::bigint`;
  const memberFilters = input.filters.map((filter) =>
    filter
      .replaceAll("t.collection", "s.collection")
      .replace(
        /COALESCE\(s\.metadata_available,\s*false\)/g,
        "s.metadata_available"
      )
  );
  const total = `(SELECT count(*) FROM metadata_projection.read_member s
    WHERE s.generation_id=${generation} AND ${memberFilters.join(" AND ")})`;
  const hidden = input.relations.map(
    (relation) => `EXISTS(SELECT 1 FROM ${relation} t
    JOIN LATERAL (SELECT * FROM metadata_projection.read_member member
      WHERE member.generation_id=${generation} AND member.collection=t.collection
        AND member.token_id=t.token_id::numeric AND member.lifecycle=t.lifecycle OFFSET 0) s ON true
    WHERE t.collection=visibility.collection AND t.token_id::numeric=visibility.token_id
      AND ${activeVisibilityRowPredicate("t")} AND ${input.filters.join(" AND ")} OFFSET 0)`
  );
  return `SELECT CASE WHEN ${fresh} THEN (${total} -
    (SELECT count(*) FROM metadata.token_visibility visibility WHERE ${hidden.join(" OR ")}))::int
    ELSE (SELECT total FROM (${input.fallback}) original_count) END AS total`;
}

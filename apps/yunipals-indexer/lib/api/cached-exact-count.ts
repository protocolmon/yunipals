import type { CollectionSlug } from "../constants.js";
import { readCacheFreshSql } from "../metadata/read-cache.js";
import { activeVisibilityRowPredicate } from "./visibility-query.js";

/** Cache guards prove membership equals current token identities/lifecycles.
 * Broad counts can count that membership directly and subtract live hidden
 * identities. Burn filtering checks only the burned subset against current
 * token state; owner and trait filters keep the normal current-token join.
 */
export function cachedExactCountSql(input: {
  chains: readonly CollectionSlug[];
  generation: string;
  relations: string[];
  filters: string[];
  fallback: string;
  burned?: boolean;
}) {
  const fresh = readCacheFreshSql(input.generation, input.chains);
  const generation = `${input.generation}::bigint`;
  const burnFilter = /^t\.burned\s*=\s*\$\d+$/;
  const burnFilters = input.filters.filter((filter) => burnFilter.test(filter));
  if (burnFilters.length !== (input.burned === undefined ? 0 : 1))
    throw new Error("Cached burn count requires its matching token filter");
  const memberFilters = input.filters
    .filter((filter) => !burnFilter.test(filter))
    .map((filter) =>
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
  const burned = `(SELECT count(*) FROM (
    ${input.relations
      .map(
        (
          relation
        ) => `SELECT t.collection,t.token_id,t.lifecycle FROM ${relation} t
          WHERE t.burned AND t.collection=ANY($1::text[])`
      )
      .join(" UNION ALL ")}
    ) burned_tokens JOIN metadata_projection.read_member s
      ON s.collection=burned_tokens.collection AND s.token_id=burned_tokens.token_id::numeric
        AND s.lifecycle=burned_tokens.lifecycle
    WHERE s.generation_id=${generation} AND ${memberFilters.join(" AND ")})`;
  const selectedTotal =
    input.burned === undefined
      ? total
      : input.burned
        ? burned
        : `(${total} - ${burned})`;
  return `SELECT CASE WHEN ${fresh} THEN (${selectedTotal} -
    (SELECT count(*) FROM metadata.token_visibility visibility WHERE ${hidden.join(" OR ")}))::int
    ELSE (SELECT total FROM (${input.fallback}) original_count) END AS total`;
}

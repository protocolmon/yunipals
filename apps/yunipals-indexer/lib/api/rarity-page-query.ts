type Cursor = { tokenId: string; collection: string; rarity: string | null };

export type RarityCandidate = {
  collection: string;
  chain_id: number;
  contract_address: string;
  token_id: string;
  owner: string;
  burned: boolean;
  lifecycle: number;
  mint_block: string;
  last_transfer_block: string;
  metadata_available: boolean;
  rarity_points: string | null;
  rarity_points_capped: string | null;
};

export type RarityPageQuery = {
  relations: string[];
  rawSearch: string;
  validatedSearch: string;
  bulkSearch: (relation: string) => string;
  columns: string;
  filters: string[];
  cursorFilters: string[];
  values: unknown[];
  sort: string;
  cursor?: Cursor;
  selective: boolean;
  selectiveTokens?: (relation: string) => string;
  nullsExcluded: boolean;
  missingExcluded?: boolean;
};

/** Every filter precedes LIMIT; rejected proofs cannot leave gaps in a page. */
export function rarityPageQueries(query: RarityPageQuery) {
  const score = query.sort.startsWith("rarity-capped")
    ? "rarity_points_capped"
    : "rarity_points";
  const direction = query.sort.endsWith("desc") ? "DESC" : "ASC";
  const limit = `$${query.values.length}`;
  const rankedSource = (relation: string) => `${query.rawSearch} s
    JOIN LATERAL (SELECT current.* FROM ${relation} current
      WHERE current.collection=s.collection AND current.token_id=s.token_id::text
        AND current.lifecycle=s.lifecycle OFFSET 0) t ON true
    JOIN LATERAL (SELECT 1 FROM ${query.validatedSearch} validated
      WHERE validated.collection=s.collection AND validated.token_id=s.token_id
        AND validated.lifecycle=s.lifecycle OFFSET 0) proof ON true`;
  const pointSource = (
    relation: string
  ) => `${query.selectiveTokens?.(relation) ?? relation} t
    LEFT JOIN LATERAL (SELECT * FROM ${query.validatedSearch} validated
      WHERE validated.collection=t.collection AND validated.token_id=t.token_id::numeric
        AND validated.lifecycle=t.lifecycle OFFSET 0) s ON true`;
  const rankedOrder = `s.${score} ${direction} NULLS LAST, s.token_id ASC, s.collection ASC`;
  const tokenOrder = "t.token_id::numeric ASC, t.collection ASC";
  // Keep missing metadata compatible with nullable legacy flags while allowing
  // the flag index to reject a collection with no matching ranked rows.
  const rawFilters = (filters: string[]) =>
    filters.map((filter) =>
      filter.replace(
        /COALESCE\(s\.metadata_available,\s*false\)\s*=\s*(\$\d+)/g,
        "(s.metadata_available=$1 OR (s.metadata_available IS NULL AND NOT $1))"
      )
    );
  const cursorTypes = query.cursor
    ? `WITH page_cursor AS (SELECT
    ${query.cursor.rarity === null ? "" : `$${query.values.length - 3}::numeric AS rarity,`}
    $${query.values.length - 2}::numeric AS token_id,$${query.values.length - 1}::text AS collection) `
    : "";
  const merge = (
    branches: string[],
    ranked: boolean
  ) => `${cursorTypes}SELECT * FROM (
    ${branches.map((branch) => `(${branch})`).join(" UNION ALL ")}
  ) merged ORDER BY ${ranked ? `${score} ${direction} NULLS LAST,` : ""}
    token_id::numeric ASC, collection ASC LIMIT ${limit}`;
  const nonnull = query.relations.map((relation) => {
    const filters = query.cursorFilters.map((filter) =>
      filter.replace(`OR s.${score} IS NULL OR`, "OR")
    );
    filters.push(`s.${score} IS NOT NULL`);
    if (!query.selective) {
      for (let i = 0; i < filters.length; i++)
        filters[i] = filters[i]!.replaceAll(
          "t.token_id::numeric",
          "s.token_id"
        ).replaceAll("t.collection", "s.collection");
      filters.push("s.collection=ANY($1::text[])");
      if (query.cursor?.rarity !== undefined && query.cursor.rarity !== null)
        filters.push(
          `s.${score}${direction === "DESC" ? "<=" : ">="}$${query.values.length - 3}::numeric`
        );
    }
    const order = query.selective
      ? `s.${score} ${direction} NULLS LAST, ${tokenOrder}`
      : rankedOrder;
    return `SELECT ${query.columns} FROM ${query.selective ? pointSource(relation) : rankedSource(relation)}
      WHERE ${(query.selective ? filters : rawFilters(filters)).join(" AND ")} ORDER BY ${order} LIMIT ${limit}`;
  });
  const nullFilters = [...query.filters];
  if (query.cursor?.rarity === null) {
    nullFilters.push(`(t.token_id::numeric>$${query.values.length - 2}::numeric OR
      (t.token_id::numeric=$${query.values.length - 2}::numeric AND t.collection>$${query.values.length - 1}))`);
  }
  const nulls = query.relations.flatMap((relation) => {
    if (query.selective)
      return [
        `SELECT ${query.columns} FROM ${pointSource(relation)}
      WHERE ${[...nullFilters, `s.${score} IS NULL`].join(" AND ")}
      ORDER BY ${tokenOrder} LIMIT ${limit}`
      ];
    const known = `SELECT ${query.columns} FROM ${rankedSource(relation)}
      WHERE ${rawFilters([...nullFilters, "s.collection=ANY($1::text[])", `s.${score} IS NULL`]).join(" AND ")}
      ORDER BY s.token_id ASC,s.collection ASC LIMIT ${limit}`;
    // A materialization boundary prevents LIMIT from turning this bulk proof
    // into an ordered scan with one complete proof lookup per current token.
    const missing = `WITH validated_keys AS MATERIALIZED (SELECT collection,token_id,lifecycle FROM ${query.bulkSearch(relation)})
      SELECT ${query.columns} FROM ${relation} t CROSS JOIN
        (SELECT false AS metadata_available,NULL::numeric AS rarity_points,NULL::numeric AS rarity_points_capped) s
      WHERE ${nullFilters.join(" AND ")} AND NOT EXISTS(SELECT 1 FROM validated_keys valid
        WHERE valid.collection=t.collection AND valid.token_id=t.token_id::numeric AND valid.lifecycle=t.lifecycle)
      ORDER BY ${tokenOrder} LIMIT ${limit}`;
    return query.missingExcluded ? [known] : [known, missing];
  });
  return {
    nonnull: query.cursor?.rarity === null ? null : merge(nonnull, true),
    nulls: query.nullsExcluded ? null : merge(nulls, false)
  };
}

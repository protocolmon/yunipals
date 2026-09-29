type Cursor = { tokenId: string; collection: string; rarity: string | null };

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
  const pointSource = (relation: string) => `${relation} t
    LEFT JOIN LATERAL (SELECT * FROM ${query.validatedSearch} validated
      WHERE validated.collection=t.collection AND validated.token_id=t.token_id::numeric
        AND validated.lifecycle=t.lifecycle OFFSET 0) s ON true`;
  const rankedOrder = `s.${score} ${direction} NULLS LAST, s.token_id ASC, s.collection ASC`;
  const tokenOrder = "t.token_id::numeric ASC, t.collection ASC";
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
      WHERE ${filters.join(" AND ")} ORDER BY ${order} LIMIT ${limit}`;
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
      WHERE ${[...nullFilters, "s.collection=ANY($1::text[])", `s.${score} IS NULL`].join(" AND ")}
      ORDER BY s.token_id ASC,s.collection ASC LIMIT ${limit}`;
    const missing = `SELECT ${query.columns} FROM ${relation} t
      LEFT JOIN ${query.bulkSearch(relation)} s ON s.collection=t.collection
        AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE ${[...nullFilters, "s.token_id IS NULL"].join(" AND ")}
      ORDER BY ${tokenOrder} LIMIT ${limit}`;
    return query.missingExcluded ? [known] : [known, missing];
  });
  return {
    nonnull: query.cursor?.rarity === null ? null : merge(nonnull, true),
    nulls: query.nullsExcluded ? null : merge(nulls, false)
  };
}

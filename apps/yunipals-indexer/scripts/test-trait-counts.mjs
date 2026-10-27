import assert from "node:assert/strict";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (
  url.pathname !== "/yunipals_rarity_test" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
) {
  throw new Error(
    "Use the disposable loopback yunipals_rarity_test database after test-rarity-pagination.mjs"
  );
}
Object.assign(process.env, {
  DATABASE_SCHEMA: "rarity_physical",
  READ_DATABASE_SCHEMA: "rarity_read",
  BNB_DATABASE_SCHEMA: "rarity_bnb",
  METADATA_SOURCE_MODE: "archive",
  YUNIPALS_PROJECTION_MODE: "generation"
});
const { metadataTraitReadRelationAt, metadataRawTraitReadRelationAt } =
  await import("../lib/metadata/read-source.ts");
const { cachedTraitReadRelationFor } = await import(
  "../lib/metadata/read-cache.ts"
);
const { activeVisibilityPredicate } = await import(
  "../lib/api/visibility-query.ts"
);
const { traitCountQuery } = await import("../lib/api/trait-count-query.ts");
const db = new pg.Client({
  connectionString: url.toString(),
  statement_timeout: 5000
});
await db.connect();
let cases = 0;
async function verify(label) {
  for (const chain of ["ethereum", "base", "polygon", "bnb"]) {
    const schema = chain === "bnb" ? '"rarity_bnb"' : '"rarity_physical"';
    const canonical = metadataTraitReadRelationAt("2");
    const cached = cachedTraitReadRelationFor(schema, [chain], "2");
    for (const values of [["Blue"], ["Red"], ["Blue", "Red"], ["Missing"]]) {
      const query = (
        traits
      ) => `SELECT t.collection,t.token_id,t.lifecycle FROM ${schema}.token t
        WHERE t.collection=$1 AND NOT t.burned AND NOT ${activeVisibilityPredicate()}
          AND EXISTS(SELECT 1 FROM ${traits} f WHERE f.collection=t.collection
            AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle
            AND f.trait_type='Color' AND f.value=ANY($2::text[]))
        ORDER BY t.token_id::numeric`;
      assert.deepEqual(
        (await db.query(query(cached), [chain, values])).rows,
        (await db.query(query(canonical), [chain, values])).rows,
        `${label}:${chain}:${values}`
      );
      const count = traitCountQuery({
        chain,
        source: `${schema}.token t`,
        filters: ["NOT t.burned", `NOT ${activeVisibilityPredicate()}`],
        traits: cached,
        rawTraits: metadataRawTraitReadRelationAt("2"),
        traitFilters: [{ type: 1, values: 2 }]
      });
      assert.equal(
        Number((await db.query(count, ["Color", values])).rows[0].total),
        (await db.query(query(canonical), [chain, values])).rows.length,
        `materialized count:${label}:${chain}:${values}`
      );
      const combined = traitCountQuery({
        chain,
        source: `${schema}.token t`,
        filters: ["NOT t.burned", `NOT ${activeVisibilityPredicate()}`],
        traits: cached,
        rawTraits: metadataRawTraitReadRelationAt("2"),
        traitFilters: [
          { type: 1, values: 2 },
          { type: 1, values: 3 }
        ]
      });
      const baseline = query(canonical).replace(
        "ORDER BY t.token_id",
        `AND EXISTS(SELECT 1 FROM ${canonical} extra WHERE extra.collection=t.collection AND extra.token_id=t.token_id::numeric AND extra.lifecycle=t.lifecycle AND extra.trait_type='Color' AND extra.value='Red') ORDER BY t.token_id`
      );
      assert.equal(
        Number(
          (await db.query(combined, ["Color", values, ["Red"]])).rows[0].total
        ),
        (await db.query(baseline, [chain, values])).rows.length,
        `combined count:${label}:${chain}:${values}`
      );
      cases++;
    }
  }
}
try {
  await db.query("SET jit=off");
  await verify("fresh");
  for (const mutation of [
    "DELETE FROM metadata_projection.search WHERE generation_id=2 AND collection='bnb' AND token_id=1",
    "UPDATE metadata_projection.revision SET metadata_content_hash='wrong' WHERE generation_id=2 AND collection='bnb' AND token_id=1",
    "UPDATE metadata.token_publication SET publication_status='unavailable' WHERE collection='bnb' AND token_id=1",
    "UPDATE metadata.token_metadata SET document='{}' WHERE collection='bnb' AND token_id=1",
    "UPDATE metadata_source.chain_metadata_scan SET next_block=1",
    "UPDATE metadata_projection.trait SET value='Red' WHERE generation_id=2 AND collection='bnb' AND token_id=1",
    "UPDATE rarity_bnb.token SET burned=true WHERE token_id='1'",
    "UPDATE rarity_bnb.token SET lifecycle=2 WHERE token_id='1'"
  ]) {
    await db.query("BEGIN");
    try {
      await db.query(mutation);
      await verify(mutation);
    } finally {
      await db.query("ROLLBACK");
    }
  }
  console.log(JSON.stringify({ event: "trait_count_parity", cases }));
} finally {
  await db.end();
}

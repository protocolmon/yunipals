import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { testUrl } from "@/bnb/fixtures/database";

test("indexed current attribute keys preserve source text semantics across updates", async () => {
  const client = new pg.Client({
    connectionString: testUrl("MARKET_TEST_DATABASE_URL")
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA IF NOT EXISTS metadata");
    await client.query(
      await readFile(
        new URL("../../scripts/catalog-attribute-keys.sql", import.meta.url),
        "utf8"
      )
    );
    await client.query(`CREATE TEMP TABLE current_attributes(id integer,attributes jsonb);
      CREATE INDEX current_attributes_keys ON current_attributes USING gin(metadata.market_attribute_keys(attributes));`);
    const fixtures = [
      null,
      "null",
      "{}",
      '"text"',
      "[]",
      '[null,7,true,"text",{},[]]',
      '[{"trait_type":"Value","value":7.00},{"trait_type":"Value","value":7}]',
      '[{"trait_type":"Value","value":true},{"trait_type":"Value","value":null},{"trait_type":"Missing"}]',
      '[{"trait_type":"Object","value":{"b":2,"a":1}},{"trait_type":"Array","value":[1,"x"]}]',
      '[{"trait_type":"Color","value":"Red"},{"trait_type":"Color","value":"Blue"},{"trait_type":"Color","value":"Red"}]',
      '[{"trait_type":null,"value":"x"},{"value":"x"},{"trait_type":7,"value":"x"}]',
      JSON.stringify([{ trait_type: 'quote"\\:\n', value: 'value"\\:\n' }])
    ];
    for (const [id, attributes] of fixtures.entries())
      await client.query(
        "INSERT INTO current_attributes VALUES($1,$2::jsonb)",
        [id, attributes]
      );
    const predicate = `metadata.market_attribute_keys(attributes) &&
      ARRAY(SELECT jsonb_build_array($1::text,v)::text FROM unnest($2::text[]) v)`;
    for (const [type, values] of [
      ["Value", ["7.00"]],
      ["Value", ["7"]],
      ["Value", ["true", "null"]],
      ["Missing", ["null"]],
      ["Object", ['{"a": 1, "b": 2}']],
      ["Array", ['[1, "x"]']],
      ["Color", ["Red", "Blue"]],
      ["7", ["x"]],
      ['quote"\\:\n', ['value"\\:\n']],
      ["Unknown", ["x"]]
    ] as const) {
      const indexed = await client.query(
        `SELECT id FROM current_attributes WHERE ${predicate} ORDER BY id`,
        [type, values]
      );
      const reference = await client.query(
        `SELECT id FROM current_attributes WHERE EXISTS(
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(attributes)='array'
            THEN attributes ELSE '[]'::jsonb END) attribute
          WHERE attribute->>'trait_type'=$1 AND coalesce(attribute->>'value','null')=ANY($2::text[])) ORDER BY id`,
        [type, values]
      );
      assert.deepEqual(indexed.rows, reference.rows, type);
    }
    await client.query("SET LOCAL enable_seqscan=off");
    const plan = await client.query(
      `EXPLAIN (FORMAT JSON) SELECT id FROM current_attributes WHERE ${predicate}`,
      ["Color", ["Red"]]
    );
    assert.match(JSON.stringify(plan.rows), /current_attributes_keys/);
    await client.query(
      `UPDATE current_attributes SET attributes='[{"trait_type":"Color","value":"Green"}]' WHERE id=9`
    );
    assert.equal(
      (
        await client.query(
          `SELECT id FROM current_attributes WHERE ${predicate}`,
          ["Color", ["Red", "Blue"]]
        )
      ).rowCount,
      0
    );
    assert.deepEqual(
      (
        await client.query(
          `SELECT id FROM current_attributes WHERE ${predicate}`,
          ["Color", ["Green"]]
        )
      ).rows,
      [{ id: 9 }]
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

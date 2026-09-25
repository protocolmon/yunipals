import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { readOpenSeaSources } from "@/reads/openseaSources";
import { marketOrderRowsSql } from "@/reads/orderRows";

test("OpenSea source health excludes the BNB discovery token join", async () => {
  let statement = "";
  const db = {
    query: async (sql: string) => {
      statement = sql;
      return { rows: [] };
    }
  } as unknown as Pick<PoolClient, "query">;

  await readOpenSeaSources(db, new Date(), "false");

  assert.match(statement, /opensea_discovered_order/);
  assert.doesNotMatch(statement, /bnb_discovered_order/);
  assert.doesNotMatch(statement, /yunipals_read_v4\.token bt/);
  assert.match(marketOrderRowsSql, /bnb_discovered_order/);
});

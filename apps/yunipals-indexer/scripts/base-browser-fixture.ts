/** Local integration fixture: actual PostgreSQL queries and API handlers; no blockchain RPC. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { Pool } from "pg";
import { islandsMigrations } from "../lib/islands/schema.js";
import { baseIslandsMigrations } from "../lib/islands/base-schema.js";
import {
  baseIslandCollection,
  ethereumIslandCollection,
  fixedIslandUri
} from "../lib/islands/collections.js";
import { applyBaseRange, type BaseTransfer } from "../lib/islands/base-sync.js";
import {
  dueIslandJobs,
  publishIslandMetadata
} from "../lib/islands/publication.js";
import { registerIslandsRoutes } from "../lib/api/islands-routes.js";
import { registerCombinedIslandsRoutes } from "../lib/api/islands-combined.js";

const db = new PGlite();
const query = (sql: string, params?: unknown[]) => db.query(sql, params);
const pool = {
  query,
  connect: async () => ({ query, release: () => undefined })
} as unknown as Pool;
await db.exec(
  await readFile(
    new URL("../test/fixtures/islands-schema.sql", import.meta.url),
    "utf8"
  )
);
for (const sql of islandsMigrations) await db.exec(sql);
for (const sql of baseIslandsMigrations) await db.exec(sql);
const alice = "0x0000000000000000000000000000000000000001",
  bob = "0x0000000000000000000000000000000000000002";
const zero = "0x0000000000000000000000000000000000000000",
  hash = `0x${"11".repeat(32)}`;
const ids = [
  ...Array.from({ length: 30 }, (_, index) => String(index + 1)),
  "1001"
];
const block = BigInt(baseIslandCollection.deploymentBlock);
const events: BaseTransfer[] = [];
for (const [index, id] of ids.entries()) {
  await query(
    `INSERT INTO public.token VALUES('ethereum-islands',1,$1,$2,$3,false,1,14570452,1,14570452,1,$4)`,
    [ethereumIslandCollection.address, id, alice, hash]
  );
  await query(
    `INSERT INTO public.token_lifecycle VALUES('ethereum-islands',$1,1,$2,14570452,1,$3,NULL,NULL,NULL)`,
    [id, alice, hash]
  );
  await query(
    `INSERT INTO public.transfer_event VALUES($1,'ethereum-islands',1,$2,$3,1,$4,$5,14570452,1,$6,0,$7)`,
    [
      `ethereum-islands:${hash}:${index}`,
      ethereumIslandCollection.address,
      id,
      zero,
      alice,
      hash,
      index
    ]
  );
  await query(
    `INSERT INTO metadata.island_airdrop_origin VALUES($1,'ethereum-islands','base-islands',$2,$3,25694139,$4,$5)`,
    [id, alice, bob, hash, "1".repeat(64)]
  );
  events.push({
    id: `base-islands:${hash}:${index}`,
    tokenId: id,
    from: zero,
    to: bob,
    blockNumber: block,
    blockTimestamp: 1790000000n,
    blockHash: hash,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: index
  });
}
await applyBaseRange(pool, block, { number: block, hash }, events, []);
const documents = await Promise.all(
  ["genesis", "personal"].map((name) =>
    readFile(`/root/islands-airdrop/assets/original/${name}.json`, "utf8").then(
      JSON.parse
    )
  )
);
for (const [definition, schema] of [
  [ethereumIslandCollection, "public"],
  [baseIslandCollection, baseIslandCollection.schemaName]
] as const) {
  const jobs = await dueIslandJobs(pool, schema, block, 100, definition);
  for (const job of jobs)
    await publishIslandMetadata(
      pool,
      schema,
      job,
      {
        uri: fixedIslandUri(job.tokenId),
        blockNumber: block,
        blockHash: hash,
        metadataStorage: definition.chain === "base" ? null : alice,
        genesisLimit: 1000n
      },
      documents[BigInt(job.tokenId) > 1000n ? 1 : 0],
      3600,
      definition
    );
}
const app = new Hono();
app.use("*", cors({ origin: "*" }));
registerCombinedIslandsRoutes(app, {
  pool,
  ethereumSchema: "public",
  baseEnabled: () => true,
  stakingEnabled: () => false,
  ethereumReady: async () => ({ ready: true }),
  baseReady: async () => ({ ready: true })
});
for (const [definition, schema] of [
  [ethereumIslandCollection, "public"],
  [baseIslandCollection, baseIslandCollection.schemaName]
] as const)
  registerIslandsRoutes(app, {
    pool,
    schemaName: schema,
    collection: definition,
    enabled: () => true,
    stakingEnabled: () => false,
    airdropEnabled: () => true,
    checkReadiness: async () => ({ ready: true, indexedBlock: String(block) })
  });
app.get("*", async (c) => {
  const response = await fetch(
    `https://api.yunipals.com/yunipals-indexer${new URL(c.req.url).pathname}${new URL(c.req.url).search}`
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "access-control-allow-origin": "*"
    }
  });
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 9420 });
console.log(
  "Base islands browser fixture ready on 127.0.0.1:9420; 62 NFTs; no blockchain RPC"
);

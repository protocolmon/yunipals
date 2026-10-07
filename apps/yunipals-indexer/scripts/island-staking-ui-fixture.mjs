import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { registerIslandsRoutes } from "../lib/api/islands-routes.ts";
import { islandsMigrations } from "../lib/islands/schema.ts";
import {
  syncIslandStaking,
  islandStakingAddress
} from "../lib/islands/staking.ts";
import { publishIslandMetadata } from "../lib/islands/publication.ts";
const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite"),
  { Hono } = require("hono"),
  { cors } = require("hono/cors"),
  { serve } = require("@hono/node-server");
const { createPublicClient, http, erc721Abi } = require("viem");
if (process.env.ISLAND_STAKING_UI_FIXTURE !== "true")
  throw new Error(
    "Set ISLAND_STAKING_UI_FIXTURE=true for this disposable test server"
  );
(async () => {
  const db = new PGlite();
  const query = (sql, params) => db.query(sql, params);
  const pool = { query, connect: async () => ({ query, release: () => {} }) };
  const owner = "0x4d294954a76747b34e1087cfe8e9d5fe24f8c0f6",
    nft = "0xa22e2f53ca787414dc0643c399f92234949e2305",
    hash = "0x" + "11".repeat(32),
    block = 26141662n;
  await db.exec(
    readFileSync(
      new URL("../test/fixtures/islands-schema.sql", import.meta.url),
      "utf8"
    )
  );
  for (const m of islandsMigrations) await db.exec(m);
  await query(
    'INSERT INTO public._ponder_meta VALUES(\'app\',\'{"is_ready":"1","build_id":"ui-fixture"}\')'
  );
  await query("INSERT INTO public._ponder_checkpoint VALUES(1,$1)", [
    "1790782295" +
      "1".padStart(16, "0") +
      String(block).padStart(16, "0") +
      "0".repeat(33)
  ]);
  for (const id of ["1", "2"]) {
    await query(
      `INSERT INTO public.token VALUES('ethereum-islands',1,$1,$2,$3,false,1,14570452,1,14570452,1,$4)`,
      [nft, id, owner, hash]
    );
    await query(
      `INSERT INTO public.token_lifecycle VALUES('ethereum-islands',$1,1,$2,14570452,1,$3,NULL,NULL,NULL)`,
      [id, owner, hash]
    );
    await query(
      `INSERT INTO public.transfer_event VALUES($1,'ethereum-islands',1,$2,$3,1,$4,$5,14570452,1,$6,0,$7)`,
      ["mint:" + id, nft, id, "0x" + "0".repeat(40), owner, hash, Number(id)]
    );
    await publishIslandMetadata(
      pool,
      "public",
      {
        tokenId: id,
        lifecycle: 1,
        mintTransactionHash: hash,
        mintLogIndex: Number(id),
        attempts: 0
      },
      {
        uri: "https://meta.polychainmonsters.com/v1/island-meta/grassland/10000000",
        blockNumber: block,
        blockHash: hash,
        metadataStorage: owner,
        genesisLimit: 1000n
      },
      {
        name: "Grassland Genesis Island",
        image: "",
        description: "Island staking browser fixture"
      }
    );
  }
  await query(
    `UPDATE public.token SET owner=$1,last_transfer_block=16000000,last_transaction_hash=$2 WHERE token_id='1'`,
    [islandStakingAddress, "0x" + "22".repeat(32)]
  );
  await query(
    `INSERT INTO public.transfer_event VALUES('stake:1','ethereum-islands',1,$1,'1',1,$2,$3,16000000,2,$4,0,1)`,
    [nft, owner, islandStakingAddress, "0x" + "22".repeat(32)]
  );
  await syncIslandStaking(pool, "public", {
    finalizedBlock: async () => ({ number: block, hash }),
    blockHash: async () => hash,
    islandContract: async () => nft,
    custodyBalance: async () => 1n,
    owners: async () => [islandStakingAddress],
    stakedIslands: async () => [1n]
  });
  const app = new Hono();
  app.use("*", cors());
  registerIslandsRoutes(app, {
    pool,
    schemaName: "public",
    enabled: () => true,
    stakingEnabled: () => true,
    checkReadiness: async () => ({ ready: true })
  });
  app.post("/test/stale", async (c) => {
    await query("UPDATE metadata.island_staking_scan SET state='unavailable'");
    return c.json({ ok: true });
  });
  app.post("/test/ready", async (c) => {
    await query(
      "UPDATE metadata.island_staking_scan SET state='ready',verified_at=now()"
    );
    return c.json({ ok: true });
  });
  app.post("/test/refresh", async (c) => {
    const chain = createPublicClient({
      transport: http("http://127.0.0.1:18547")
    });
    const current = (
      await chain.readContract({
        address: nft,
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [1n]
      })
    ).toLowerCase();
    if (current !== owner)
      throw new Error("Fork withdrawal did not return island");
    await query(
      "UPDATE public.token SET owner=$1,last_transfer_block=$2 WHERE token_id='1'",
      [current, String(await chain.getBlockNumber())]
    );
    return c.json({ ok: true });
  });
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 18548 });
  console.log(
    "Islands fixture API ready: actual Hono routes and PGlite database"
  );
})();

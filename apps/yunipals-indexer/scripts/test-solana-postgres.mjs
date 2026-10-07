import assert from "node:assert/strict";
import { Hono } from "hono";

const url = process.env.EXOMON_TEST_DATABASE_URL;
let parsed = null;
try {
  parsed = url ? new URL(url) : null;
} catch {
  // Report the required fixture shape without echoing the supplied URL.
}
if (
  !parsed ||
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !/^\/exomon_test_[a-z0-9_]+$/.test(parsed.pathname) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
) {
  throw new Error("EXOMON_TEST_DATABASE_URL must point to a loopback exomon_test_ database");
}
process.env.DATABASE_URL = url;
process.env.SOLANA_API_ENABLED = "true";
process.env.SOLANA_MAX_MISSING = "1";
const [{ pool, apiPool }, { solanaSchemaStatements }, { publishScan }, { mountSolanaApi }] = await Promise.all([
  import("../lib/offchain/db.ts"), import("../lib/solana/schema.ts"),
  import("../lib/solana/worker.ts"), import("../lib/solana/api.ts")
]);

const mintA = "9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
const mintB = "11111111111111111111111111111111";
const ownerA = "4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";
const ownerB = "11111111111111111111111111111111";
const app = new Hono();
mountSolanaApi(app, pool);

try {
  for (const sql of solanaSchemaStatements) await pool.query(sql);
  await pool.query(`INSERT INTO solana_indexer.manifest(singleton,release_id,checksum,asset_count)
    VALUES(true,'test','test-checksum',2)`);
  await pool.query(`INSERT INTO solana_indexer.manifest_asset
    (mint,legacy_alias,asset_key,source_hash,release_id) VALUES
    ($1,'1',repeat('a',64),repeat('b',64),'test'),
    ($2,'2',repeat('c',64),repeat('d',64),'test')`, [mintA,mintB]);
  for (const [mint,kind] of [[mintA,"Fire"],[mintB,"Water"]]) {
    const attributes = [{trait_type:"Type",value:kind},{trait_type:"Special",value:"No"}];
    await pool.query(`INSERT INTO solana_indexer.asset_metadata
      (mint,release_id,source_hash,document,content_hash,name,image,attributes,rarity_points,rarity_points_capped)
      VALUES($1,'test',repeat('b',64),$2::jsonb,repeat('e',64),$3,NULL,$4::jsonb,10,10)`,
    [mint,JSON.stringify({name:kind,attributes}),kind,JSON.stringify(attributes)]);
  }
  async function scan(owners) {
    const id = Number((await pool.query(`INSERT INTO solana_indexer.scan_run
      (manifest_checksum,state,asset_count,batch_size,next_batch) VALUES
      ('test-checksum','running',2,2,1) RETURNING id`)).rows[0].id);
    await pool.query(`INSERT INTO solana_indexer.scan_stage
      (run_id,mint,status,owner,burnt,observed_at) VALUES
      ($1,$2,'observed',$3,false,now()),($1,$4,'observed',$5,false,now())`,
    [id,mintA,owners[0],mintB,owners[1]]);
    await publishScan(id,2);
    return id;
  }
  await scan([ownerA,ownerB]);
  let result = await app.request("http://localhost/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&traitType=Type&traitValue=Water");
  assert.equal(result.status,200);
  assert.equal((await result.json()).total,2);
  result = await app.request("http://localhost/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&traitType=Special&traitValue=No");
  assert.equal((await result.json()).total,1);
  result = await app.request("http://localhost/v1/tokens?chain=solana&limit=0");
  assert.equal(result.status,400);
  result = await app.request(`http://localhost/v1/owners/${ownerA}/tokens?chain=solana`);
  assert.equal(result.status,200);
  assert.equal((await result.json()).total,1);
  result = await app.request("http://localhost/v1/leaderboards/collector-score?chain=solana");
  assert.equal(result.status,200);
  assert.equal((await result.json()).items.length,2);
  await scan([ownerB,ownerB]);
  assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM solana_indexer.observed_change`)).rows[0].n),1);
  result = await app.request(`http://localhost/v1/owners/${ownerA}/tokens?chain=solana`);
  assert.equal((await result.json()).total,0);
  result = await app.request(`http://localhost/v1/tokens/solana/${mintA}`);
  assert.equal((await result.json()).token.owner,ownerB);
  const failedId=Number((await pool.query(`INSERT INTO solana_indexer.scan_run
    (manifest_checksum,state,error_code,asset_count,batch_size,next_batch) VALUES
    ('test-checksum','failed','solana_scan_incomplete',2,2,1) RETURNING id`)).rows[0].id);
  await pool.query(`INSERT INTO solana_indexer.scan_stage
    (run_id,mint,status,owner,burnt,observed_at) VALUES
    ($1,$2,'observed',$3,false,now()),($1,$4,'missing',NULL,NULL,now())`,
    [failedId,mintA,ownerB,mintB]);
  await publishScan(failedId,2);
  result = await app.request(`http://localhost/v1/tokens/solana/${mintB}`);
  assert.equal(result.status,503);
  assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM solana_indexer.token`)).rows[0].n),1);
  console.log(JSON.stringify({postgresIntegration:"passed",publishedScans:3,observedChanges:1,unknownOwners:1}));
} finally {
  await Promise.all([pool.end(),apiPool.end()]);
}

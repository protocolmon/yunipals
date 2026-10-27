import assert from "node:assert/strict";
import { Hono } from "hono";

const url = process.env.EXOMON_TEST_DATABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/exomon_test_unified" ||
  new URL(url).search
) {
  throw new Error(
    "EXOMON_TEST_DATABASE_URL must name the isolated localhost exomon_test_unified database"
  );
}
process.env.DATABASE_URL = url;
process.env.SOLANA_API_ENABLED = "true";
process.env.SOLANA_MAX_MISSING = "1";
const [
  { pool, apiPool },
  { solanaSchemaStatements },
  { publishScan },
  { mountSolanaApi }
] = await Promise.all([
  import("../lib/offchain/db.ts"),
  import("../lib/solana/schema.ts"),
  import("../lib/solana/worker.ts"),
  import("../lib/solana/api.ts")
]);

const mintA = "9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
const mintB = "11111111111111111111111111111111";
const ownerA = "4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";
const ownerB = "11111111111111111111111111111111";
const app = new Hono();
mountSolanaApi(app, pool);

try {
  await pool.query("DROP SCHEMA IF EXISTS solana_indexer CASCADE");
  for (const sql of solanaSchemaStatements) await pool.query(sql);
  await pool.query(`INSERT INTO solana_indexer.manifest(singleton,release_id,checksum,asset_count)
    VALUES(true,'test','test-checksum',2)`);
  await pool.query(
    `INSERT INTO solana_indexer.manifest_asset
    (mint,legacy_alias,asset_key,source_hash,release_id) VALUES
    ($1,'1',repeat('a',64),repeat('b',64),'test'),
    ($2,'2',repeat('c',64),repeat('d',64),'test')`,
    [mintA, mintB]
  );
  for (const [mint, kind] of [
    [mintA, "Fire"],
    [mintB, "Water"]
  ]) {
    const attributes = [
      { trait_type: "Type", value: kind },
      { trait_type: "Special", value: "No" }
    ];
    await pool.query(
      `INSERT INTO solana_indexer.asset_metadata
      (mint,release_id,source_hash,document,content_hash,name,image,attributes,rarity_points,rarity_points_capped)
      VALUES($1,'test',repeat('b',64),$2::jsonb,repeat('e',64),$3,NULL,$4::jsonb,10,10)`,
      [
        mint,
        JSON.stringify({ name: kind, attributes }),
        kind,
        JSON.stringify(attributes)
      ]
    );
  }
  async function scan(owners) {
    const id = Number(
      (
        await pool.query(`INSERT INTO solana_indexer.scan_run
      (manifest_checksum,state,asset_count,batch_size,next_batch) VALUES
      ('test-checksum','running',2,2,1) RETURNING id`)
      ).rows[0].id
    );
    await pool.query(
      `INSERT INTO solana_indexer.scan_stage
      (run_id,mint,status,owner,burnt,observed_at) VALUES
      ($1,$2,'observed',$3,false,now()),($1,$4,'observed',$5,false,now())`,
      [id, mintA, owners[0], mintB, owners[1]]
    );
    await publishScan(id, 2);
    return id;
  }
  await scan([ownerA, ownerB]);
  let cursorResult = await app.request(
    "http://localhost/v1/tokens?chain=solana&limit=1"
  );
  const previousCursor = (await cursorResult.json()).nextCursor;
  assert.ok(previousCursor);
  let result = await app.request(
    "http://localhost/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&traitType=Type&traitValue=Water"
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).total, 2);
  result = await app.request(
    "http://localhost/v1/tokens?chain=solana&traitType=Type&traitValue=Fire&traitType=Special&traitValue=No"
  );
  assert.equal((await result.json()).total, 1);
  result = await app.request("http://localhost/v1/tokens?chain=solana&limit=0");
  assert.equal(result.status, 400);
  result = await app.request(
    `http://localhost/v1/owners/${ownerA}/tokens?chain=solana`
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).total, 1);
  result = await app.request(
    "http://localhost/v1/leaderboards/collector-score?chain=solana"
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).items.length, 2);
  await scan([ownerB, ownerB]);
  cursorResult = await app.request(
    `http://localhost/v1/tokens?chain=solana&limit=1&cursor=${previousCursor}`
  );
  assert.equal(cursorResult.status, 409);
  assert.equal(
    Number(
      (
        await pool.query(
          `SELECT count(*) AS n FROM solana_indexer.observed_change`
        )
      ).rows[0].n
    ),
    1
  );
  result = await app.request(
    `http://localhost/v1/owners/${ownerA}/tokens?chain=solana`
  );
  assert.equal((await result.json()).total, 0);
  result = await app.request(`http://localhost/v1/tokens/solana/${mintA}`);
  assert.equal((await result.json()).token.owner, ownerB);
  const failedId = Number(
    (
      await pool.query(`INSERT INTO solana_indexer.scan_run
    (manifest_checksum,state,error_code,asset_count,batch_size,next_batch) VALUES
    ('test-checksum','failed','solana_scan_incomplete',2,2,1) RETURNING id`)
    ).rows[0].id
  );
  await pool.query(
    `INSERT INTO solana_indexer.scan_stage
    (run_id,mint,status,owner,burnt,observed_at) VALUES
    ($1,$2,'observed',$3,false,now()),($1,$4,'missing',NULL,NULL,now())`,
    [failedId, mintA, ownerB, mintB]
  );
  await publishScan(failedId, 2);
  result = await app.request(`http://localhost/v1/tokens/solana/${mintB}`);
  assert.equal(result.status, 503);
  assert.equal(
    Number(
      (await pool.query(`SELECT count(*) AS n FROM solana_indexer.token`))
        .rows[0].n
    ),
    1
  );
  const { reserveRpcCredits } = await import("../lib/solana/budget.ts");
  const reservations = await Promise.allSettled([
    reserveRpcCredits(pool, "fixture", null, 10, 10, 10),
    reserveRpcCredits(pool, "fixture", null, 10, 10, 10)
  ]);
  assert.equal(
    reservations.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    reservations.filter((result) => result.status === "rejected").length,
    1
  );
  // Commit a new publication after a request has read its selected run but
  // before it reads its data. No timing/sleep race and no provider calls.
  async function requestAcrossPublication(path, owners) {
    let injected = false;
    const interleavedPool = new Proxy(pool, {
      get(target, key) {
        if (key === "connect")
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(connection, property) {
                if (property === "query")
                  return async (...args) => {
                    const result = await Reflect.apply(
                      connection.query,
                      connection,
                      args
                    );
                    if (
                      !injected &&
                      typeof args[0] === "string" &&
                      args[0].includes("s.published_run_id") &&
                      args[0].includes("r.state='published'")
                    ) {
                      injected = true;
                      await scan(owners);
                    }
                    return result;
                  };
                const value = Reflect.get(connection, property, connection);
                return typeof value === "function"
                  ? value.bind(connection)
                  : value;
              }
            });
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const concurrentApp = new Hono();
    mountSolanaApi(concurrentApp, interleavedPool);
    const response = await concurrentApp.request(`http://localhost${path}`);
    assert.ok(injected, "fixture must publish during the request");
    assert.equal(response.status, 200);
    return response.json();
  }
  await scan([ownerA, ownerB]);
  let concurrent = await requestAcrossPublication(
    `/v1/tokens/solana/${mintA}`,
    [ownerB, ownerB]
  );
  assert.equal(concurrent.token.owner, ownerA);
  assert.equal(
    (await (await app.request(`/v1/tokens/solana/${mintA}`)).json()).token
      .owner,
    ownerB
  );
  concurrent = await requestAcrossPublication(
    "/v1/leaderboards/monster-count?chain=solana&limit=1",
    [ownerA, ownerB]
  );
  assert.equal(concurrent.items[0].monsterCount, 2);
  assert.equal(concurrent.nextCursor, null);
  concurrent = await requestAcrossPublication(
    `/v1/owners/${ownerA}/leaderboard?chain=solana`,
    [ownerB, ownerB]
  );
  assert.equal(concurrent.monsterCount, 1);
  await scan([ownerA, ownerB]);
  concurrent = await requestAcrossPublication("/v1/leaderboards?chain=solana", [
    ownerB,
    ownerB
  ]);
  assert.equal(concurrent.wallets, 2);
  const run = (
    await pool.query(
      "SELECT published_run_id FROM solana_indexer.sync_state WHERE singleton"
    )
  ).rows[0].published_run_id;
  await pool.query(
    "UPDATE solana_indexer.scan_run SET completed_at=now()+interval '1 hour' WHERE id=$1",
    [run]
  );
  assert.equal((await app.request(`/v1/tokens/solana/${mintA}`)).status, 503);
  assert.equal((await app.request("/v1/collection?chain=solana")).status, 503);
  await pool.query(
    "UPDATE solana_indexer.scan_run SET completed_at=now() WHERE id=$1",
    [run]
  );
  await pool.query(
    "UPDATE solana_indexer.manifest SET checksum='replacement-not-yet-published' WHERE singleton"
  );
  assert.equal((await app.request("/v1/collection?chain=solana")).status, 503);
  assert.equal((await app.request(`/v1/tokens/solana/${mintA}`)).status, 503);
  await pool.query(
    "UPDATE solana_indexer.manifest SET checksum='test-checksum' WHERE singleton"
  );
  console.log(
    JSON.stringify({
      postgresIntegration: "passed",
      publishedScans: Number(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM solana_indexer.scan_run WHERE state='published'"
          )
        ).rows[0].n
      ),
      initialObservedChanges: 1,
      unknownOwners: 1,
      cursorExpiration: "passed",
      concurrentBudgetReservations: "passed",
      pointAndLeaderboardSnapshotInterleaving: "passed",
      futureAndWrongManifestPublicationRejected: "passed"
    })
  );
} finally {
  await Promise.all([pool.end(), apiPool.end()]);
}

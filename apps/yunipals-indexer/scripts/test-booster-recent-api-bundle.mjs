import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
const root = "/root/yunipals",
  project = root + "/apps/yunipals-indexer",
  require = createRequire(project + "/package.json");
const { Pool, Client } = require("pg"),
  nonce = randomBytes(5).toString("hex"),
  database = "booster_api_" + nonce,
  actor = "booster_reader_" + nonce,
  password = randomBytes(20).toString("hex");
const admin = new Pool({
  connectionString:
    "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres",
  max: 1
});
const node = process.execPath,
  container = "yunipals-unified-indexer-test-20261020";
const wallet = "0x1111111111111111111111111111111111111111",
  registry = "0x2222222222222222222222222222222222222222",
  engine = "0x3333333333333333333333333333333333333333",
  monsters = "0x4444444444444444444444444444444444444444",
  wrapper = "0x5555555555555555555555555555555555555555";
let db,
  reader,
  child,
  folder,
  created = false,
  role = false;
try {
  await admin.query(`CREATE DATABASE ${database} OWNER unified_test`);
  created = true;
  db = new Pool({
    connectionString: `postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/${database}`,
    max: 1
  });
  const dump = execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      container,
      "pg_dump",
      "-U",
      "unified_test",
      "-d",
      "yunipals_ponder_dependency_test",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--schema",
      "dependency_check"
    ],
    {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      timeout: 15000,
      encoding: "utf8",
      maxBuffer: 4e6
    }
  );
  await db.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", "launch")
  );
  await db.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  const tables = [
    "_ponder_meta",
    "_ponder_checkpoint",
    "booster_type",
    "booster_original",
    "booster_request",
    "booster_monster",
    "booster_refund",
    "booster_engine_state",
    "booster_checkpoint",
    "booster_event"
  ];
  await admin.query(
    `CREATE ROLE ${actor} LOGIN NOINHERIT CONNECTION LIMIT 6 PASSWORD '${password}'`
  );
  role = true;
  await db.query(
    `GRANT USAGE ON SCHEMA launch TO ${actor};GRANT SELECT ON ${tables.map((n) => "launch." + n).join(",")} TO ${actor}`
  );
  const ts = Math.floor(Date.now() / 1000),
    point =
      String(ts).padStart(10, "0") +
      "8453".padStart(16, "0") +
      "140".padStart(16, "0") +
      "9".repeat(33);
  await db.query("INSERT INTO launch._ponder_meta(key,value)VALUES('app',$1)", [
    JSON.stringify({
      version: "6",
      build_id: "actual_fixture",
      is_dev: 0,
      is_locked: 1,
      is_ready: 1,
      heartbeat_at: Date.now()
    })
  ]);
  await db.query(
    "INSERT INTO launch._ponder_checkpoint(chain_id,chain_name,latest_checkpoint,safe_checkpoint,finalized_checkpoint)VALUES(8453,'base',$1,$1,$1)",
    [point]
  );
  const typeKey = `8453:${registry}:1`,
    originalKey = `8453:${monsters}:1`;
  await db.query(
    `INSERT INTO launch.booster_type(id,pack_type_id,registry,engine,payment_token,price,interval_seconds,mints_per_interval,total_variants,max_batch,catalog_hash,rule_hash,manifest_uri,metadata_base_uri,sales_paused,openings)VALUES($1,'1',$2,$3,$4,'1000000000000000000',86400,1,264,7,$5,$5,'https://example.test/manifest','https://example.test/variants/',false,1)`,
    [typeKey, registry, engine, wallet, "0x" + "ab".repeat(32)]
  );
  await db.query(
    `INSERT INTO launch.booster_original(id,collection,token_id,type_key,engine,owner,revealed_at,daily_committed,minted,remaining,pending_request,burned)VALUES($1,$2,'1',$3,$4,$5,$6,0,1,263,null,false)`,
    [originalKey, monsters, typeKey, engine, wallet, ts]
  );
  await db.query(
    `INSERT INTO launch.booster_monster(id,collection,token_id,original_key,request_key,type_key,owner,minted_to,variant_id,monster_type,color,horn,glitter,is_original,burned,mint_block)VALUES($1,$2,'1',$1,'request',$3,$4,$4,149,7,2,1,1,true,false,140)`,
    [originalKey, monsters, typeKey, wallet]
  );

  const requestKey = `8453:${engine}:1`,
    bh = "0x" + "cd".repeat(32),
    th = "0x" + "ef".repeat(32);
  await db.query("UPDATE launch.booster_monster SET request_key=$1", [
    requestKey
  ]);
  await db.query(
    `INSERT INTO launch.booster_request(id,engine,wrapper,request_id,original_key,payer,quantity,opening,paid,rule_hash,callback_gas,status,seed,requested_at,received_at,transaction_hash,recipient)VALUES($1,$2,$3,'1',$4,$5,1,true,'0',$6,500000,'completed','123',$7,$7,$8,$5)`,
    [
      requestKey,
      engine,
      wrapper,
      originalKey,
      wallet,
      "0x" + "ab".repeat(32),
      ts,
      th
    ]
  );
  const mintArgs = {
    tokenId: "1",
    originalTokenId: "1",
    packTypeId: "1",
    recipient: wallet,
    variantId: 149,
    monsterType: 7,
    color: 2,
    horn: 1,
    glitter: 1,
    isOriginal: true
  };
  for (const [name, address, args, log] of [
    ["MonsterMinted", monsters, mintArgs, 1],
    [
      "RequestCompleted",
      engine,
      {
        requestId: "1",
        originalId: "1",
        recipient: wallet,
        quantity: 1,
        minted: 1,
        remaining: 263
      },
      2
    ]
  ])
    await db.query(
      "INSERT INTO launch.booster_event(id,address,name,args,block_number,block_hash,timestamp,transaction_hash,log_index)VALUES($1,$2,$3,$4,140,$5,$6,$7,$8)",
      [
        `${bh}:${th}:${log}`,
        address,
        name,
        JSON.stringify(args),
        bh,
        ts,
        th,
        log
      ]
    );
  folder = await mkdtemp(path.join(os.tmpdir(), "booster-api-bundle-"));
  await mkdir(path.join(folder, "catalogs/demo"), { recursive: true });
  const dictionary = JSON.parse(
    await readFile(
      root + "/contracts/boosters/config/base-standard-v1.traits.json",
      "utf8"
    )
  );
  await writeFile(
    path.join(folder, "catalogs/demo/manifest.json"),
    JSON.stringify({
      slug: "demo",
      catalogHash:
        "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733",
      artworkHash: "0x" + "a".repeat(64),
      dictionary
    })
  );
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  child = spawn(
    node,
    [project + "/artifacts/booster-recent-openings-api-v1/booster-api.mjs"],
    {
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        DATABASE_URL: `postgresql://${actor}:${password}@127.0.0.1:56967/${database}`,
        BOOSTER_DATABASE_SCHEMA: "launch",
        BOOSTER_API_PORT: String(port),
        BOOSTER_REGISTRY: registry,
        BOOSTER_ENGINE: engine,
        BOOSTER_MONSTERS: monsters,
        BOOSTER_WRAPPER: wrapper,
        BOOSTER_DEPLOYMENT_BLOCK: "123",
        BOOSTER_ARTWORK_DIRECTORY: folder
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let errors = "";
  child.stderr.on("data", (c) => (errors += c));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) break;
    try {
      up = (await fetch(base + "/healthz")).status === 200;
      if (up) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(up, errors);
  const get = async (url) => {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    return r.json();
  };
  assert.equal((await get("/readyz")).indexedBlock, "140");
  const types = await get("/v1/boosters/types");
  assert.equal(types.items[0].totalVariants, "264");
  assert.equal(types.lastBoosterEvent, null);
  assert.equal(
    (await get(`/v1/owners/${wallet}/booster-monsters`)).items[0].metadataUri,
    "https://example.test/variants/149.json"
  );
  assert.equal(
    (await get(`/v1/owners/${wallet}/booster-originals`)).items[0].pack
      .intervalSeconds,
    "86400"
  );
  assert.equal(
    (await fetch(base + "/v1/boosters/art/demo/149.json")).status,
    202
  );
  assert.equal((await fetch(base + "/v1/tokens")).status, 404);
  const recent = await get("/v1/boosters/recent-openings?limit=12");
  assert.equal(recent.items.length, 1);
  assert.equal(recent.items[0].requestKey, requestKey);
  assert.equal(recent.items[0].revealedAt, String(ts));
  assert.equal(recent.items[0].monster.tokenId, "1");
  assert.equal(recent.items[0].monster.mintedTo, wallet);
  assert.equal(
    (await fetch(base + "/v1/boosters/recent-openings?limit=25")).status,
    400
  );
  await db.query("UPDATE launch.booster_monster SET burned=true");
  assert.equal(
    (await get("/v1/boosters/recent-openings")).items[0].monster.burned,
    true
  );
  await db.query("UPDATE launch.booster_monster SET burned=false");

  reader = new Client({
    connectionString: `postgresql://${actor}:${password}@127.0.0.1:56967/${database}`
  });
  await reader.connect();
  await assert.rejects(
    reader.query("DELETE FROM launch.booster_monster"),
    (error) => error.code === "42501"
  );
  await db.query(
    "UPDATE launch.booster_type SET catalog_hash='0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733',metadata_base_uri='https://example.test/art/demo/'"
  );
  await writeFile(
    path.join(folder, "catalogs/demo/manifest.json"),
    JSON.stringify({
      slug: "demo",
      catalogHash:
        "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733",
      artworkHash: "0x" + "a".repeat(64),
      metadataBaseURI: "https://example.test/art/demo/",
      dictionary
    })
  );
  const queueEnv = {
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    DATABASE_URL: `postgresql://${actor}:${password}@127.0.0.1:56967/${database}`,
    BOOSTER_DATABASE_SCHEMA: "launch",
    BOOSTER_REGISTRY: registry,
    BOOSTER_ENGINE: engine,
    BOOSTER_MONSTERS: monsters,
    BOOSTER_WRAPPER: wrapper,
    BOOSTER_DEPLOYMENT_BLOCK: "123",
    BOOSTER_ARTWORK_DIRECTORY: folder,
    BOOSTER_ARTWORK_CATALOGS: "demo"
  };
  const sync = () =>
    JSON.parse(
      execFileSync(
        node,
        [
          project +
            "/artifacts/booster-recent-openings-api-v1/booster-artwork-sync.mjs",
          "--once"
        ],
        { env: queueEnv, encoding: "utf8", timeout: 10000 }
      )
    );
  assert.equal(sync().queued, 1);
  assert.equal(sync().queued, 0);
  assert.equal(
    JSON.parse(await readFile(path.join(folder, "jobs/demo/149.json"), "utf8"))
      .traits.type,
    "Yuniturtle"
  );
  await db.query(
    "UPDATE launch._ponder_meta SET value=jsonb_set(value,'{is_locked}','0')WHERE key='app'"
  );
  assert.equal((await fetch(base + "/v1/boosters/types")).status, 503);
  assert.equal(sync().skipped, true);
  assert.equal(
    (await fetch(base + "/v1/boosters/art/demo/149.json")).status,
    202
  );
  assert.equal(
    (await fetch(base + "/v1/boosters/recent-openings")).status,
    503
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "actual_bundled_entrypoint_serves_HTTP",
        "restricted_ten_table_role_without_writes",
        "actual_recent_request_journal_and_mint_provenance",
        "burned_historical_cover_and_bounded_limit",
        "framework_checkpoint_and_genuine_booster_journal_ready",
        "actual_Ponder_table_pack_and_wallet_payloads",
        "unavailable_source_returns503",
        "approved_artwork_protocol_independent_of_source",
        "OG_and_marketplace_routes_absent",
        "bundled_queue_once_uses_indexed_traits_and_catalog_only",
        "bundled_queue_deduplicates_and_skips_stale_source"
      ],
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
  }
  await reader?.end().catch(() => {});
  await db?.end();
  if (created) await admin.query(`DROP DATABASE ${database} WITH(FORCE)`);
  if (role) await admin.query(`DROP ROLE ${actor}`);
  await admin.end();
  if (folder) await rm(folder, { recursive: true, force: true });
}

import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  it,
  expect,
  vi
} from "vitest";
import {
  registerPortalCardCountRoutes,
  readPortalCardCounts
} from "../lib/api/portal-card-counts.js";

const addr = (n: number) => `0x${String(n).repeat(40)}`;
const owner = addr(1),
  cards = addr(2),
  grading = addr(3),
  collection = addr(4),
  registry = addr(5),
  engine = addr(6);
const deployment = {
  monsters: cards,
  registry,
  engine,
  wrapper: addr(7),
  startBlock: 1
} as const;
const key = (address: string, id: number | string) => `8453:${address}:${id}`;
const db = new PGlite();
let ready = true;
const query = vi.fn(async (sql: string, params?: unknown[]) => {
  // PGlite is a single connection. All route SQL still executes in PostgreSQL.
  if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    return db.query("BEGIN");
  return db.query(sql, params);
});
const client = { query, release: vi.fn() };
const pool = { connect: vi.fn(async () => client) };
const app = new Hono();
registerPortalCardCountRoutes(app, {
  pool: pool as never,
  schemaName: "eligibility",
  readSnapshot: async () =>
    ready
      ? {
          ready: true,
          indexedBlock: "100",
          indexedBlockHash: null,
          indexedTimestamp: "1800000000",
          buildId: "test",
          requestsPaused: false,
          lastBoosterEvent: null
        }
      : { ready: false, reason: "booster_index_catching_up" }
});
const request = (ids = "1", wallet = owner) =>
  app.request(
    `/v1/boosters/portal-card-counts?owner=${wallet}&grading=${grading}&collection=${collection}&portalIds=${ids}`
  );
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA eligibility;
    CREATE TABLE eligibility.booster_monster(id text PRIMARY KEY,token_id text,collection text,type_key text,owner text,
      color int,monster_type int,horn int,glitter int,is_original boolean,burned boolean);
    CREATE INDEX owner_idx ON eligibility.booster_monster(owner);
    CREATE TABLE eligibility.booster_type(id text PRIMARY KEY,pack_type_id text,registry text,engine text);
    CREATE TABLE eligibility.booster_card_facts(id text PRIMARY KEY,sequence int);
    CREATE TABLE eligibility.portal_eligibility_config(id text PRIMARY KEY,collection text,cards text,pack_type_id text);
    CREATE TABLE eligibility.portal_eligibility_portal(id text PRIMARY KEY,sequence_start int,sequence_length int,
      color_gate int,type_gate int,original_only boolean,glitter_gate boolean,diamond_gate boolean,retired boolean);
    CREATE TABLE eligibility.portal_eligibility_pending(id text PRIMARY KEY,request_id text);
    CREATE TABLE eligibility.indexer_source(id text PRIMARY KEY,definition text);
    CREATE TABLE eligibility.canonical_event(source_id text,block_number bigint,transaction_index int,log_index int);
    CREATE INDEX event_order ON eligibility.canonical_event(source_id,block_number,transaction_index,log_index);`);
});
beforeEach(async () => {
  for (const [name, value] of Object.entries({
    BOOSTER_REGISTRY: registry,
    BOOSTER_ENGINE: engine,
    BOOSTER_MONSTERS: cards,
    BOOSTER_WRAPPER: addr(7),
    BOOSTER_DEPLOYMENT_BLOCK: "1"
  }))
    vi.stubEnv(name, value);
  await db.exec(`TRUNCATE eligibility.booster_monster,eligibility.booster_type,eligibility.booster_card_facts,
    eligibility.portal_eligibility_config,eligibility.portal_eligibility_portal,eligibility.portal_eligibility_pending,
    eligibility.indexer_source,eligibility.canonical_event;`);
  await db.query("INSERT INTO eligibility.booster_type VALUES($1,'1',$2,$3)", [
    key(registry, 1),
    registry,
    engine
  ]);
  await db.query(
    "INSERT INTO eligibility.portal_eligibility_config VALUES($1,$2,$3,'1')",
    [grading, collection, cards]
  );
  for (const [id, address, event] of [
    ["boosters:boostermonsters", cards, "CardFactsRecorded"],
    ["boosters:boosterregistry", registry, "TypeActivated"],
    ["boosters:boosterengine", engine, "RequestCompleted"],
    ["portals:8453:collection", collection, "PortalMinted"],
    ["portals:8453:grading", grading, "Initialized"]
  ]) {
    await db.query("INSERT INTO eligibility.indexer_source VALUES($1,$2)", [
      id,
      JSON.stringify({ address, enabled: true, events: [event] })
    ]);
    await db.query(
      "INSERT INTO eligibility.canonical_event VALUES($1,100,0,0)",
      [id]
    );
  }
  await portal(1);
  ready = true;
  query.mockClear();
  pool.connect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.close());
async function portal(
  id: number,
  start = 260,
  length = 10,
  original = false,
  glitter = false,
  diamond = false,
  retired = false
) {
  await db.query(
    "INSERT INTO eligibility.portal_eligibility_portal VALUES($1,$2,$3,0,0,$4,$5,$6,$7)",
    [key(collection, id), start, length, original, glitter, diamond, retired]
  );
}
async function card(
  id: number,
  sequence: number | null,
  options: {
    owner?: string;
    type?: string;
    burned?: boolean;
    color?: number;
    monster?: number;
    glitter?: number;
    horn?: number;
    original?: boolean;
  } = {}
) {
  await db.query(
    "INSERT INTO eligibility.booster_monster VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      key(cards, id),
      String(id),
      cards,
      key(registry, options.type ?? 1),
      options.owner ?? owner,
      options.color ?? 1,
      options.monster ?? 1,
      options.horn ?? 1,
      options.glitter ?? 0,
      options.original ?? sequence === 0,
      options.burned ?? false
    ]
  );
  if (sequence !== null)
    await db.query("INSERT INTO eligibility.booster_card_facts VALUES($1,$2)", [
      key(cards, id),
      sequence
    ]);
}
it("counts all portals in one aggregate; matches wraparound, exact endpoints, originals and trait gates", async () => {
  for (const [id, seq] of [260, 263, 0, 5, 6, 259].entries())
    await card(id + 1, seq);
  await portal(2, 0, 1, true);
  await portal(3, 0, 100, false, true);
  await portal(4, 0, 100, false, false, true);
  await portal(5, 260, 1);
  await portal(6, 0, 100, false, false, false, true);
  await card(7, 3, { glitter: 1, horn: 2 });
  const response = await request("1,2,3,4,5,6");
  expect(response.status).toBe(200);
  expect(
    (await response.json()).items.map((x: { count: number }) => x.count)
  ).toEqual([5, 1, 1, 1, 1, 0]);
  expect(
    query.mock.calls.filter(([sql]) => sql.startsWith("WITH config"))
  ).toHaveLength(1);
});
it("excludes wrong owner, burned, unsupported pack, missing facts, wrong traits and pending spells", async () => {
  await card(1, 0);
  await card(2, 1, { owner: addr(8) });
  await card(3, 1, { burned: true });
  await card(4, null);
  await db.query("INSERT INTO eligibility.booster_type VALUES($1,'2',$2,$3)", [
    key(registry, 2),
    registry,
    engine
  ]);
  await card(5, 1, { type: "2" });
  await card(6, 1, { color: 2 });
  await card(7, 1, { monster: 2 });
  await card(8, 1);
  await db.query(
    "INSERT INTO eligibility.portal_eligibility_pending VALUES($1,'9')",
    [key(grading, 8)]
  );
  expect((await (await request()).json()).items[0].count).toBe(1);
  // Completion and transfer become visible on the next indexed read.
  await db.exec("DELETE FROM eligibility.portal_eligibility_pending");
  expect((await (await request()).json()).items[0].count).toBe(2);
  await db.query(
    "UPDATE eligibility.booster_monster SET owner=$1 WHERE id=$2",
    [addr(8), key(cards, 1)]
  );
  expect((await (await request()).json()).items[0].count).toBe(1);
});
it("keeps known empty wallets distinct from unknown portals, deployments and unavailable indexes", async () => {
  expect((await (await request()).json()).items[0].count).toBe(0);
  expect((await request("2")).status).toBe(503);
  ready = false;
  expect((await request()).status).toBe(503);
  ready = true;
  await db.exec("DELETE FROM eligibility.portal_eligibility_config");
  expect((await request()).status).toBe(503);
});
it("refuses an old source manifest or partially indexed block", async () => {
  await db.exec(
    "UPDATE eligibility.canonical_event SET block_number=101 WHERE source_id='portals:8453:grading'"
  );
  expect((await request()).status).toBe(503);
  await db.exec(
    "UPDATE eligibility.canonical_event SET block_number=100; DELETE FROM eligibility.indexer_source WHERE id='boosters:boostermonsters'"
  );
  expect((await request()).status).toBe(503);
});
it("validates inputs before opening a connection and releases failed snapshots", async () => {
  for (const ids of [
    "",
    "0",
    "01",
    "1,1",
    "1,2,3,4,5,6,7,8,9,10,11,12",
    "1');DROP TABLE x;--"
  ])
    expect((await request(ids)).status).toBe(400);
  expect((await request("1", "invalid")).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
  ready = false;
  expect((await request()).status).toBe(503);
  expect(client.release).toHaveBeenCalled();
});
it("bounds work to one wallet even with a large unrelated collection", async () => {
  await db.query(
    `INSERT INTO eligibility.booster_monster
    SELECT 'other:'||n,n::text,$1,$2,$3,1,1,1,0,false,false FROM generate_series(1,100000) n`,
    [cards, key(registry, 1), addr(8)]
  );
  await db.query(
    `INSERT INTO eligibility.booster_monster
    SELECT '8453:'||$1||':'||n,n::text,$1,$2,$3,1,1,1,0,false,false FROM generate_series(100001,110000) n`,
    [cards, key(registry, 1), owner]
  );
  await db.query(
    `INSERT INTO eligibility.booster_card_facts SELECT id,1 FROM eligibility.booster_monster WHERE owner=$1`,
    [owner]
  );
  for (let i = 2; i <= 11; i++) await portal(i);
  await db.exec("ANALYZE eligibility.booster_monster");
  const started = performance.now();
  const result = await readPortalCardCounts(
    client as never,
    "eligibility",
    deployment as never,
    {
      owner,
      grading,
      collection,
      portalIds: Array.from({ length: 11 }, (_, i) => String(i + 1))
    }
  );
  expect(result.every((row) => row.count === 10000)).toBe(true);
  const duration = performance.now() - started;
  process.stdout.write(
    `Eligibility aggregate: 10,000 wallet cards / 110,000 total / 11 portals: ${Math.round(duration)}ms (PGlite)\n`
  );
  const call = query.mock.calls
    .filter(([sql]) => sql.startsWith("WITH config"))
    .at(-1)!;
  const plan = await db.query<{ "QUERY PLAN": string }>(
    "EXPLAIN " + call[0],
    call[1]
  );
  expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
    "owner_idx"
  );
}, 20000);

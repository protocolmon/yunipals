// Actual Ponder functions + actual multirange SQL on disposable PG16 only.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  mkdtempSync,
  writeFileSync,
  openSync,
  closeSync,
  rmSync
} from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const ROOT = new URL("../../", import.meta.url).pathname,
  require = createRequire(ROOT + "apps/yunipals-indexer/package.json");
const ponderRoot = realpathSync(
  ROOT + "apps/yunipals-indexer/node_modules/ponder"
);
const bytes = readFileSync(
  new URL("./ypal-alchemy-restart-cache-v1.filters.json", import.meta.url)
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(
  sha(bytes),
  "394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675"
);
const artifact = JSON.parse(bytes);
for (const [f, p] of Object.entries(artifact.runtimeFiles))
  assert.equal(sha(readFileSync(ponderRoot + "/" + f)), p, f);
const inside = (p) => import(pathToFileURL(ponderRoot + "/dist/esm/" + p).href);
const { getFragments, encodeFragment } = await inside("runtime/fragments.js"),
  { getCachedBlock, getLocalSyncProgress } = await inside("runtime/index.js"),
  { createSyncStore } = await inside("sync-store/index.js");
const prequire = createRequire(ponderRoot + "/package.json"),
  { drizzle } = prequire("drizzle-orm/node-postgres"),
  { Pool } = require("pg");
const helper =
  ROOT + "ops/unified-indexer-transition/ypal-alchemy-restart-cache-v1.test.py";
const py = (x) => {
  const dir = mkdtempSync("/tmp/alchemy-cache-python-");
  writeFileSync(dir + "/in", JSON.stringify(x));
  const fds = [
    openSync(dir + "/in", "r"),
    openSync(dir + "/out", "wx"),
    openSync(dir + "/err", "wx")
  ];
  try {
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('t',${JSON.stringify(helper)});f=importlib.util.module_from_spec(s);s.loader.exec_module(f);x=json.load(sys.stdin)
if x['mode']=='fixture':n,c,p=f.fixture();v={'native':n,'plan':p,'sql':f.m.capture_sql(),'rows':f.m.filters()}
elif x['mode']=='prefix':v=[f.m.prefix(r['from'],r['ranges'])for r in x['rows']]
else:
 c=x['capture'];c['identity'].update(databaseOid='17584',port='5432',socket=True);c['schemaOid']='75963410';n={k:c[k]for k in ['schemaOid','app','tables','cache','checkpoints','clock']}
 try:v=f.m.validate_capture(c,x['plan'],n)
 except RuntimeError as e:v={'refused':str(e)}
print(json.dumps(v))`
      ],
      { stdio: fds, timeout: 15000 }
    );
    return JSON.parse(readFileSync(dir + "/out", "utf8"));
  } catch (e) {
    throw Error(String(e) + readFileSync(dir + "/err", "utf8"));
  } finally {
    fds.forEach(closeSync);
    rmSync(dir, { recursive: true, force: true });
  }
};
const fixture = py({ mode: "fixture" }),
  groups = [],
  logger = Object.fromEntries(
    ["info", "debug", "trace", "warn", "error"].map((k) => [k, () => {}])
  );
const block = (n) => ({
  number: "0x" + BigInt(n).toString(16),
  hash: "0x" + BigInt(n).toString(16).padStart(64, "0"),
  parentHash:
    "0x" +
    BigInt(n - 1)
      .toString(16)
      .padStart(64, "0"),
  timestamp: "0x" + BigInt(1700000000 + n).toString(16),
  transactions: [],
  logsBloom: "0x" + "00".repeat(256)
});
for (const r of artifact.filters)
  assert.deepEqual(getFragments(r.filter), r.fragments);
groups.push("all84 derived fragments match actual getFragments");
const cases = [],
  expected = [];
for (let k = 0; k < 200; k++) {
  const start = 1000 + k,
    ranges =
      k % 3 === 0
        ? []
        : k % 3 === 1
          ? [[start, start + 20]]
          : [
              [start, start + 4],
              [start + 7, start + 20]
            ];
  const f = {
    type: "log",
    chainId: 56,
    sourceId: "fixture",
    address: "0x" + "11".repeat(20),
    topic0: "0x" + "22".repeat(32),
    topic1: null,
    topic2: null,
    topic3: null,
    fromBlock: start,
    hasTransactionReceipt: false,
    include: []
  };
  const cache = new Map([
    [
      f,
      getFragments(f).map((x) => ({ fragment: x.fragment, intervals: ranges }))
    ]
  ]);
  expected.push(getCachedBlock({ filters: [f], cachedIntervals: cache }));
  cases.push({
    from: start,
    ranges: ranges.map(([a, b]) => [String(a), String(b + 1), true, true])
  });
}
assert.deepEqual(py({ mode: "prefix", rows: cases }), expected);
groups.push(
  "200 cases equal actual getCachedBlock including first older holes"
);
for (const chain of [1, 8453, 137, 56]) {
  const safe = Number(
      fixture.native.checkpoints[String(chain)].safe.slice(26, 42)
    ),
    filters = artifact.filters
      .filter((x) => x.filter.chainId === chain)
      .map((x) => ({
        ...x.filter,
        fromBlock: x.filter.type === "block" ? safe + 100 : x.filter.fromBlock
      }));
  const cached = new Map(
    filters.map((f) => [
      f,
      getFragments(f).map((x) => ({
        fragment: x.fragment,
        intervals: f.type === "block" ? [] : [[f.fromBlock, safe + 50]]
      }))
    ])
  );
  const calls = [];
  const progress = await getLocalSyncProgress({
    common: { logger },
    chain: { id: chain },
    filters,
    cachedIntervals: cached,
    finalizedBlock: block(safe + 1000),
    rpc: {
      request: async (c) => {
        calls.push(c);
        return block(Number(BigInt(c.params[0])));
      }
    }
  });
  assert.equal(Number(BigInt(progress.current.number)), safe + 50);
  assert.deepEqual(
    calls.map((c) => [c.method, Number(BigInt(c.params[0])), c.params[1]]),
    [
      [
        "eth_getBlockByNumber",
        Math.min(...filters.map((f) => f.fromBlock)),
        false
      ],
      ["eth_getBlockByNumber", safe + 50, false]
    ]
  );
}
groups.push(
  "actual restart always requests configured-start plus cached-point numeric headers"
);
const container = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "inspect",
      "yunipals-unified-indexer-test-20261020"
    ],
    { encoding: "utf8" }
  )
)[0];
assert.equal(container.Config.Image, "postgres:16.15");
assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const name = "alchemy_restart_" + randomBytes(6).toString("hex"),
  url = (db) =>
    "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + db,
  admin = new Pool({ connectionString: url("postgres"), max: 1 });
let pool;
try {
  await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
  pool = new Pool({ connectionString: url(name), max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE SCHEMA unified_ypal_20261023_v1;CREATE TABLE unified_ypal_20261023_v1._ponder_meta(key text PRIMARY KEY,value jsonb);CREATE TABLE unified_ypal_20261023_v1._ponder_checkpoint(chain_id bigint PRIMARY KEY,latest_checkpoint varchar(75),safe_checkpoint varchar(75),finalized_checkpoint varchar(75));CREATE SCHEMA ponder_sync;CREATE TABLE ponder_sync.intervals(fragment_id text PRIMARY KEY,chain_id bigint NOT NULL,blocks nummultirange NOT NULL)`
    );
    for (let n = 0; n < 42; n++)
      await client.query(
        "CREATE TABLE unified_ypal_20261023_v1.fixture_" + n + "(id int)"
      );
    await client.query(
      "INSERT INTO unified_ypal_20261023_v1._ponder_meta VALUES('app',$1)",
      [fixture.native.app]
    );
    for (const [c, p] of Object.entries(fixture.native.checkpoints))
      await client.query(
        "INSERT INTO unified_ypal_20261023_v1._ponder_checkpoint VALUES($1,$2,$3,$4)",
        [c, p.latest, p.safe, p.finalized]
      );
    const db = drizzle(client, { casing: "snake_case" }),
      store = createSyncStore({
        common: { logger, options: { databaseMaxQueryParameters: 32767 } },
        qb: { raw: db, wrap: async (_label, fn) => fn(db) }
      }),
      logs = artifact.filters
        .filter((x) => x.filter.type === "log")
        .map((x) => x.filter);
    for (const chain of [1, 8453, 137, 56]) {
      const safe = Number(
        fixture.native.checkpoints[String(chain)].safe.slice(26, 42)
      );
      await store.insertIntervals({
        chainId: chain,
        intervals: logs
          .filter((f) => f.chainId === chain)
          .map((filter) => ({
            filter,
            interval: [filter.fromBlock, safe + 50]
          })),
        factoryIntervals: []
      });
    }
    const actual = await store.getIntervals({ filters: logs });
    assert.equal(actual.size, 80);
    groups.push(
      "actual createSyncStore insertIntervals/getIntervals with genuine PG16 closed numranges"
    );
    const capture = async () => {
      await client.query("BEGIN READ ONLY");
      try {
        return (await client.query(fixture.sql)).rows[0].jsonb_build_object;
      } finally {
        await client.query("ROLLBACK");
      }
    };
    let c = await capture();
    assert.equal(c.identity.readOnly, true);
    assert.equal(Object.keys(c.matrix).length, 80);
    assert.equal(Object.keys(c.tables).length, 44);
    let proof = py({ mode: "validate", capture: c, plan: fixture.plan });
    assert.equal(proof.cacheCoverageQualified, true, proof.refused);
    for (const r of fixture.rows) {
      const f = logs.find(
          (f) =>
            f.sourceId === r.sourceId &&
            f.topic0 === artifact.filters[Number(r.key)].filter.topic0
        ),
        ranges = actual.get(f)[0].intervals;
      assert.deepEqual(
        c.matrix[r.key],
        ranges.map(([a, b]) => [String(a), String(b + 1), true, true])
      );
    }
    groups.push(
      "actual readonly native/cache SQL80 rows equal official interval reader"
    );
    const first = fixture.rows[0],
      f = logs.find(
        (f) =>
          f.sourceId === first.sourceId &&
          f.topic0 === artifact.filters[Number(first.key)].filter.topic0
      ),
      id = encodeFragment(getFragments(f)[0].fragment),
      safe = Number(
        fixture.native.checkpoints[String(f.chainId)].safe.slice(26, 42)
      );
    await client.query(
      "UPDATE ponder_sync.intervals SET blocks=nummultirange(numrange($1,$2,'[]'),numrange($3,$4,'[]'))WHERE fragment_id=$5",
      [f.fromBlock, f.fromBlock + 5, f.fromBlock + 7, safe + 51, id]
    );
    c = await capture();
    proof = py({ mode: "validate", capture: c, plan: fixture.plan });
    assert.match(proof.refused, /older_cache_hole/);
    groups.push("actual old hole refuses despite higher maximum endpoint");
    const adjacent = first.adjacentIds.find((x) => x !== id);
    assert(adjacent);
    await client.query(
      "INSERT INTO ponder_sync.intervals VALUES($1,$2,nummultirange(numrange($3,$4,'[]')))",
      [adjacent, f.chainId, f.fromBlock, safe + 51]
    );
    c = await capture();
    proof = py({ mode: "validate", capture: c, plan: fixture.plan });
    assert.equal(proof.cacheCoverageQualified, true, proof.refused);
    groups.push("actual adjacent-ID superset union restores genuine coverage");
  } finally {
    client.release();
  }
} finally {
  if (pool) await pool.end();
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
console.log(
  JSON.stringify({
    passed: groups.length,
    groups,
    actualInstalledPonder: true,
    disposablePostgresOnly: true,
    productionDatabaseNormalizedOnlyInFixture: true,
    productionQualified: false,
    providerCalls: 0,
    serviceActions: 0
  })
);

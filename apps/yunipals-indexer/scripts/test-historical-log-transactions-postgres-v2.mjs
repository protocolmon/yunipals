import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { encodeEventTopics, http, toHex, zeroAddress } from "viem";
import { bsc } from "viem/chains";
import { collectionAbi } from "../lib/abi.ts";

// Local-only SQL integration test. A uniquely created PostgreSQL container has
// no network, no published ports, and a Unix socket under this test's temp dir.
// Existing containers, dependencies, lockfiles and operational helpers are untouched.
assert.equal(process.versions.node.split(".")[0], "24", "Use the pinned Node 24 runtime");
const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), "../../..");
const ponderEntry = import.meta.resolve("ponder");
const esm = dirname(fileURLToPath(ponderEntry));
const internal = (path) => import(new URL(path, ponderEntry));
const expected = {
  patch: "9f708ce34408df20addd38f16b88d8d0a6cd357778ebb2d2edc7c290058e03e2",
  helper: "77254e48c28eb51c08328bb4ea291a5d636b10230df8fb776c66cbed4929b44b",
  candidateRuntime: "7f45bc31e0d6e103441244c0bcfca51e4657d3d237be5aaafea01dd02ab8e10e"
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
const number = 7_579_200;
const hash = (value) => toHex(BigInt(value), { size: 32 });
const address = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d";
const recipient = `0x${"22".repeat(20)}`;
const { defaultLogFilterInclude, defaultBlockFilterInclude } = await internal("./runtime/filter.js");
const filter = {
  type: "log", chainId: 56, sourceId: "YunipalsBnb", address,
  topic0: encodeEventTopics({ abi: collectionAbi, eventName: "Transfer" })[0],
  topic1: null, topic2: null, topic3: null,
  fromBlock: number, toBlock: undefined, hasTransactionReceipt: false,
  include: defaultLogFilterInclude
};
const filters = [filter, {
  type: "block", chainId: 56, sourceId: "BnbCheckpoint", fromBlock: number + 1000,
  interval: 1, offset: 0, hasTransactionReceipt: false, include: defaultBlockFilterInclude
}];
const eventCallbacks = [{
  filter, name: "YunipalsBnb:Transfer", type: "contract",
  abiItem: collectionAbi.find((item) => item.type === "event" && item.name === "Transfer"),
  metadata: { safeName: "Transfer", abi: collectionAbi }
}];
const tables = ["blocks", "transactions", "logs", "transaction_receipts", "traces",
  "intervals", "factories", "factory_addresses", "rpc_request_results"];

function fixture(blockNumber) {
  const transactions = Array.from({ length: 24 }, (_, i) => ({
    hash: hash(blockNumber * 100 + i), transactionIndex: toHex(i),
    blockNumber: toHex(blockNumber), blockHash: hash(blockNumber),
    from: zeroAddress, to: address, input: `0x${"ab".repeat(64)}`,
    value: toHex(i + 17), nonce: toHex(i + 31), gas: "0x30d40",
    gasPrice: "0x12", type: "0x0", r: hash(2), s: hash(3), v: "0x1b"
  }));
  const block = {
    hash: hash(blockNumber), parentHash: hash(blockNumber - 1), number: toHex(blockNumber),
    timestamp: toHex(1_600_000_000 + blockNumber), logsBloom: `0x${"00".repeat(256)}`,
    receiptsRoot: hash(300), transactions
  };
  const indices = blockNumber === number + 1 ? [] : [7, 19, 19];
  const logs = indices.map((index, i) => ({
    address, topics: encodeEventTopics({ abi: collectionAbi, eventName: "Transfer",
      args: { from: zeroAddress, to: recipient, tokenId: BigInt(blockNumber * 10 + i) } }),
    data: "0x", blockNumber: block.number, blockHash: block.hash,
    transactionHash: transactions[index].hash, transactionIndex: toHex(index),
    logIndex: toHex(i), removed: false
  }));
  return { block, logs };
}

async function child({ socket, database, runtime, stage, output }) {
  assert.ok(socket.startsWith("/tmp/yunipals-log-tx-postgres-") && socket.endsWith("/socket"));
  assert.ok(["stock_cache", "candidate_cache"].includes(database));
  assert.ok(["populate", "reopen", "extend", "rollback"].includes(stage));
  assert.ok(runtime === fileURLToPath(new URL("./sync-historical/index.js", ponderEntry)) ||
    (runtime.startsWith(dirname(socket) + "/candidate/") && runtime.endsWith("/sync-historical/index.js")));
  const { createHistoricalSync } = await import(pathToFileURL(runtime));
  const { createSyncStore } = await internal("./sync-store/index.js");
  const { createQB } = await internal("./database/queryBuilder.js");
  const { createRpc } = await internal("./rpc/index.js");
  const { createLogger } = await internal("./internal/logger.js");
  const { MetricsService } = await internal("./internal/metrics.js");
  const { createShutdown } = await internal("./internal/shutdown.js");
  const { NonRetryableUserError } = await internal("./internal/errors.js");
  const { getRequiredIntervals, getRequiredIntervalsWithFilters } = await internal("./runtime/index.js");
  const { buildEvents, decodeEvents } = await internal("./runtime/events.js");
  const schema = await internal("./sync-store/schema.js");
  const common = {
    logger: createLogger({ level: "silent", mode: "json" }), metrics: new MetricsService(),
    shutdown: createShutdown(),
    options: { factoryAddressCountThreshold: 1000, databaseMaxQueryParameters: 16_000 }
  };
  const connection = { host: socket, user: "historical_test", database, max: 3,
    connectionTimeoutMillis: 5000, statement_timeout: 10_000 };
  let migrationCount;
  if (stage === "populate") {
    const require = createRequire(ponderEntry);
    const { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } = require("kysely");
    const { buildMigrationProvider } = await internal("./sync-store/migrations.js");
    const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool(connection) }),
      plugins: [new WithSchemaPlugin("ponder_sync")] });
    try {
      const result = await new Migrator({ db, provider: buildMigrationProvider(common.logger),
        migrationTableSchema: "ponder_sync" }).migrateToLatest();
      if (result.error) throw result.error;
      migrationCount = result.results.length;
      assert.ok(migrationCount > 20);
    } finally { await db.destroy(); }
  }
  const pool = new pg.Pool(connection);
  const qb = createQB(drizzle(pool, { casing: "snake_case", schema }), { common });
  const syncStore = createSyncStore({ common, qb });
  const calls = [];
  let invalidBlock;
  const chain = { id: 56, name: "bnb", viemChain: bsc, finalityBlockCount: 20,
    rpc: http("http://offline-fixture.invalid", { retryCount: 0, fetchFn: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const call = await request.json();
      calls.push({ method: call.method, params: call.params });
      let result;
      if (call.method === "eth_getLogs") {
        const [query] = call.params;
        const from = Number(BigInt(query.fromBlock)), to = Number(BigInt(query.toBlock));
        assert.ok(from >= number && to <= number + 5 && from <= to);
        result = Array.from({ length: to - from + 1 }, (_, i) => fixture(from + i).logs).flat();
      } else if (call.method === "eth_getBlockByNumber") {
        const n = Number(BigInt(call.params[0]));
        assert.ok(n >= number && n <= number + 5);
        result = fixture(n).block;
        if (!call.params[1]) result.transactions = result.transactions.map((tx) => tx.hash);
        else if (n === invalidBlock) result.transactions[7].blockHash = hash(999);
      } else if (call.method === "eth_getTransactionByHash") {
        const value = Number(BigInt(call.params[0])), n = Math.floor(value / 100);
        assert.ok(n >= number && n <= number + 5);
        result = fixture(n).block.transactions[value % 100] ?? null;
        if (n === invalidBlock && result) result.blockHash = hash(999);
        // Exercise real PostgreSQL writes after selective capability failure.
        if (stage === "extend") result = null;
      } else throw new Error(`Unexpected RPC method ${call.method}`);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }),
        { headers: { "content-type": "application/json" } });
    } }) };
  const rpc = createRpc({ common, chain, concurrency: 3 });
  const sync = createHistoricalSync({ common, chain, rpc, childAddresses: new Map() });
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) {
      // Table names are a fixed allowlist, never CLI input.
      rows[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM ponder_sync.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(({ row }) => row);
    }
    return rows;
  };
  async function syncInterval(tx, interval) {
    const store = createSyncStore({ common, qb: tx });
    const cachedIntervals = await store.getIntervals({ filters });
    const required = getRequiredIntervalsWithFilters({ filters, interval, cachedIntervals });
    const args = { interval, requiredIntervals: required.intervals,
      requiredFactoryIntervals: required.factoryIntervals, syncStore: store };
    const logs = await sync.syncBlockRangeData(args);
    const tip = await sync.syncBlockData({ ...args, logs });
    await store.insertIntervals({ intervals: required.intervals,
      factoryIntervals: required.factoryIntervals, chainId: 56 });
    return tip;
  }
  try {
    let tip, rollbackVerified = false;
    if (stage === "populate") tip = await qb.transaction((tx) => syncInterval(tx, [number, number + 2]));
    if (stage === "extend") {
      const cachedIntervals = await syncStore.getIntervals({ filters });
      assert.deepEqual(getRequiredIntervals({ filters, interval: [number, number + 3], cachedIntervals }), [[number + 3, number + 3]]);
      tip = await qb.transaction((tx) => syncInterval(tx, [number + 3, number + 3]));
    }
    if (stage === "rollback") {
      const before = await snapshot();
      const beforeIntervals = await syncStore.getIntervals({ filters });
      invalidBlock = number + 5;
      await assert.rejects(qb.transaction(async (tx) => {
        await syncInterval(tx, [number + 4, number + 4]);
        // Prove the first block/interval really reached PostgreSQL inside this
        // transaction before the next RPC identity failure forces a rollback.
        const visible = await tx.wrap((db) => db.select().from(schema.blocks));
        assert.ok(visible.some((block) => block.number === BigInt(number + 4)));
        try { await syncInterval(tx, [number + 5, number + 5]); }
        catch (error) {
          // Fixture-only bound: suppress QB's nine retries of a deliberate fault.
          throw new NonRetryableUserError(`Deliberate identity failure: ${error.message}`);
        }
        assert.fail("Invalid transaction identity must fail");
      }), /Deliberate identity failure/);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await syncStore.getIntervals({ filters }), beforeIntervals);
      rollbackVerified = true;
    }
    const end = stage === "populate" ? number + 2 : number + 3;
    const cachedIntervals = await syncStore.getIntervals({ filters });
    const missing = getRequiredIntervals({ filters, interval: [number, end], cachedIntervals });
    assert.deepEqual(missing, []);
    const data = await syncStore.getEventData({ filters, fromBlock: number, toBlock: end, chainId: 56, limit: 100 });
    const events = decodeEvents(common, chain, eventCallbacks, buildEvents({ ...data, eventCallbacks,
      childAddresses: new Map(), chainId: 56 })).map((value) => ({
      type: value.type, checkpoint: value.checkpoint, chainId: value.chain.id,
      name: value.eventCallback.name, event: value.event
    }));
    const rows = await snapshot();
    assert.equal(rows.logs.length, stage === "populate" ? 6 : 9);
    assert.equal(rows.transactions.length, stage === "populate" ? 4 : 6);
    assert.equal(events.length, rows.logs.length);
    if (stage === "reopen") assert.deepEqual(calls, [], "Reopen must read solely from persisted cache");
    const intervals = Array.from(cachedIntervals, ([key, value]) => ({ sourceId: key.sourceId, value }));
    await writeFile(output, json({ pid: process.pid, stage, migrationCount, rows, intervals,
      events, tip, calls, rollbackVerified, postgres: (await pool.query("SHOW server_version")).rows[0].server_version }));
  } finally {
    await common.shutdown.kill();
    await pool.end();
  }
}

async function main() {
  const patchPath = join(repository, "patches/ponder-historical-log-transactions-v2.patch");
  const helperPath = join(repository, "patches/ponder-historical-log-transactions-v2.mjs");
  assert.equal(digest(await readFile(patchPath)), expected.patch);
  assert.equal(digest(await readFile(helperPath)), expected.helper);
  const temporary = await mkdtemp("/tmp/yunipals-log-tx-postgres-");
  const dockerEnv = { ...process.env };
  for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[name];
  const docker = (...args) => execFileSync("docker", ["--host=unix:///var/run/docker.sock", ...args],
    { env: dockerEnv, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  let container;
  try {
    const daemon = docker("info", "--format", "{{.ServerVersion}}");
    const image = docker("image", "inspect", "postgres:16.15", "--format", "{{.Id}}");
    const socket = join(temporary, "socket");
    await chmod(temporary, 0o755);
    await mkdir(socket, { mode: 0o777 });
    await chmod(socket, 0o777);
    container = docker("run", "--detach", "--pull=never", "--network=none", "--memory=512m", "--cpus=1", "--pids-limit=128",
      "--label", "yunipals.test=historical-log-transactions-postgres",
      "--mount", `type=bind,src=${socket},dst=/var/run/postgresql`,
      "-e", "POSTGRES_USER=historical_test", "-e", "POSTGRES_DB=postgres",
      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16.15", "postgres", "-c", "listen_addresses=");
    assert.match(container, /^[a-f0-9]{64}$/);
    // The image starts a temporary socket-only server for initdb and then
    // restarts it. Do not connect until that temporary server has stopped.
    let initialized = false;
    for (let i = 0; i < 80; i++) {
      if (docker("logs", container).includes("PostgreSQL init process complete; ready for start up.")) {
        initialized = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    assert.ok(initialized, "Isolated PostgreSQL initialization timed out");
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const client = new pg.Client({ host: socket, user: "historical_test", database: "postgres", connectionTimeoutMillis: 500 });
      client.on("error", () => {});
      try {
        await client.connect();
        await client.query("CREATE DATABASE stock_cache");
        await client.query("CREATE DATABASE candidate_cache");
        ready = true;
        break;
      } catch { await new Promise((done) => setTimeout(done, 250)); }
      finally { await client.end(); }
    }
    assert.ok(ready, "Isolated PostgreSQL did not become ready");
    const candidateRoot = join(temporary, "candidate"), candidateEsm = join(candidateRoot, "dist/esm");
    await mkdir(join(candidateEsm, "sync-historical"), { recursive: true });
    await writeFile(join(candidateRoot, "package.json"), '{"type":"module"}');
    await symlink(dirname(await realpath(resolve(esm, "../.."))), join(candidateRoot, "node_modules"));
    for (const entry of await readdir(esm)) {
      if (entry !== "sync-historical") await symlink(join(esm, entry), join(candidateEsm, entry));
    }
    await copyFile(join(esm, "sync-historical/index.js"), join(candidateEsm, "sync-historical/index.js"));
    execFileSync("patch", ["--batch", "--fuzz=0", "-p1", "-i", patchPath], { cwd: candidateRoot, stdio: "pipe" });
    const candidate = join(candidateEsm, "sync-historical/index.js"), stock = join(esm, "sync-historical/index.js");
    assert.equal(digest(await readFile(candidate)), expected.candidateRuntime);
    assert.equal(digest(await readFile(join(candidateEsm, "sync-historical/yunipals-log-transactions.mjs"))), expected.helper);
    const stages = [];
    function run(database, runtime, stage) {
      const output = join(temporary, `result-${stages.length}.json`);
      execFileSync(process.execPath, ["--import", "tsx", script, "--child",
        JSON.stringify({ socket, database, runtime, stage, output })],
        { cwd: resolve(dirname(script), ".."), encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
      stages.push({ database, runtime: runtime === stock ? "stock" : "candidate", stage, output });
      return output;
    }
    const stockInitial = run("stock_cache", stock, "populate");
    const candidateInitial = run("candidate_cache", candidate, "populate");
    // Every stage runs in a fresh Node process. Opposite runtime reopens each
    // cache too, proving a candidate -> stock rollback does not require replay.
    const stockExtended = run("stock_cache", candidate, "extend");
    const candidateExtended = run("candidate_cache", stock, "extend");
    run("stock_cache", stock, "reopen");
    run("stock_cache", candidate, "reopen");
    run("candidate_cache", candidate, "reopen");
    run("candidate_cache", stock, "reopen");
    run("stock_cache", candidate, "rollback");
    run("candidate_cache", stock, "rollback");
    run("stock_cache", stock, "reopen");
    run("candidate_cache", candidate, "reopen");
    const read = async (file) => JSON.parse(await readFile(file, "utf8"));
    const select = ({ rows, intervals, events }) => ({ rows, intervals, events });
    const a = await read(stockInitial), b = await read(candidateInitial);
    assert.deepEqual(select(a), select(b));
    assert.deepEqual(a.tip, b.tip);
    const c = await read(stockExtended), d = await read(candidateExtended);
    assert.deepEqual(select(c), select(d));
    assert.deepEqual(c.tip, d.tip);
    assert.ok(c.calls.some(({ method }) => method === "eth_getTransactionByHash"));
    assert.equal(c.calls.filter(({ method, params }) => method === "eth_getBlockByNumber" && params[1]).length, 1);
    const results = [];
    for (const stage of stages) {
      const result = await read(stage.output);
      if (stage.stage !== "populate") assert.deepEqual(select(result), select(c));
      results.push({ database: stage.database, runtime: stage.runtime, stage: stage.stage,
        pid: result.pid, migrationCount: result.migrationCount, calls: result.calls,
        rollbackVerified: result.rollbackVerified,
        cacheSha256: digest(json(result.rows)), intervalsSha256: digest(json(result.intervals)),
        eventsSha256: digest(json(result.events)) });
    }
    assert.equal(new Set(results.map(({ pid }) => pid)).size, results.length);
    assert.ok(a.calls.some(({ method, params }) => method === "eth_getBlockByNumber" && params[1]));
    assert.ok(b.calls.some(({ method }) => method === "eth_getTransactionByHash"));
    assert.ok(!b.calls.some(({ method, params }) => method === "eth_getBlockByNumber" && params[1]));
    const evidence = { status: "passed", completedAt: new Date().toISOString(),
      node: process.version, postgres: a.postgres, docker: daemon, image,
      candidate: expected, testSha256: digest(await readFile(script)),
      network: "none; Unix socket only; all RPC replies are local fixtures",
      actualComponents: ["Ponder sync-store migrations", "createQB SQL transactions", "createHistoricalSync",
        "createRpc with offline viem HTTP transport", "createSyncStore inserts and reads",
        "getRequiredIntervals", "buildEvents", "decodeEvents"],
      initial: { blocks: a.rows.blocks.length, logs: a.rows.logs.length, transactions: a.rows.transactions.length,
        events: a.events.length, range: [number, number + 2] },
      final: { blocks: c.rows.blocks.length, logs: c.rows.logs.length, transactions: c.rows.transactions.length,
        events: c.events.length, range: [number, number + 3] },
      verified: ["Stock and candidate PostgreSQL rows, intervals and decoded events are identical",
        "All cache tables compared, including empty receipt/trace/factory tables",
        "Fresh processes resume solely from retained cache without RPC",
        "Stock can extend candidate cache; candidate can extend stock cache",
        "Candidate extension persists an actual full-block fallback after null selective transactions",
        "Invalid RPC identity rolls back already-written block and interval in both runtimes",
        "Cache remains identical when reopened again after failed transactions"],
      limits: ["Focused historical cache boundary test, not whole Ponder CLI or application indexing",
        "No live provider throughput, multichain or reorg claim", "PostgreSQL server remains running across client process restarts"],
      results };
    const output = "/tmp/yunipals-historical-log-transactions-postgres-v2-20261022.json";
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ status: evidence.status, stages: results.length, postgres: a.postgres,
      initial: evidence.initial, final: evidence.final, output }));
  } finally {
    if (container) docker("rm", "--force", "--volumes", container);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--child") await child(JSON.parse(process.argv[3]));
else await main();

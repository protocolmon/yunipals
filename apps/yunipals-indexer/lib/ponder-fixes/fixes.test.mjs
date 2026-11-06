import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyFixes, checkRuntime, expectedFiles } from "./fixes.mjs";

const application = fileURLToPath(new URL("../../", import.meta.url));
const root = realpathSync(resolve(application, "node_modules/ponder"));
const preload = fileURLToPath(new URL("./preload.mjs", import.meta.url));
const composed = fileURLToPath(
  new URL("./preload-with-profiling.mjs", import.meta.url)
);
const profiler = fileURLToPath(
  new URL("../profiling/runtime.mjs", import.meta.url)
);
const internal = (path) => JSON.stringify(resolve(root, "dist/esm", path));

function run(imports, program, env = {}) {
  const child = spawn(
    process.execPath,
    [
      ...imports.flatMap((path) => ["--import", path]),
      "--input-type=module",
      "-e",
      program
    ],
    { cwd: application, timeout: 60_000, env: { ...process.env, ...env } }
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  return new Promise((resolveRun, reject) => {
    child.once("error", reject);
    child.once("close", (status) => {
      if (status !== 0) {
        reject(new Error(`Child failed (${status}): ${stderr}\n${stdout}`));
        return;
      }
      resolveRun(
        stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      );
    });
  });
}

// Filters come from Ponder's real config builder, because the null topics it
// produces are the root cause. Logs are served through an offline RPC fixture.
const historicalSetup = `
  import { buildIndexingFunctions } from ${internal("build/config.js")};
  import { createHistoricalSync } from ${internal("sync-historical/index.js")};
  import { RpcError, toEventSelector } from ${JSON.stringify(resolve(root, "../viem/_esm/index.js"))};

  const hex = (value) => "0x" + value.toString(16);
  const hash = (value) => "0x" + value.toString(16).padStart(64, "0");
  const account = (value) => "0x" + value.repeat(40);
  const abi = [
    { type: "event", name: "Transfer", inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false } ] },
    { type: "event", name: "Approval", inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false } ] },
    { type: "event", name: "Other", inputs: [
      { name: "value", type: "uint256", indexed: false } ] },
    { type: "event", name: "Unregistered", inputs: [
      { name: "value", type: "uint256", indexed: false } ] }
  ];
  const topic = Object.fromEntries(abi.map((item) => [item.name, toEventSelector(item)]));
  const [alpha, beta, gamma, unrelated] = ["a", "b", "c", "d"].map(account);
  const sender = account("1"), otherSender = account("2"), receiver = account("3");
  const padded = (address) => "0x" + address.slice(2).padStart(64, "0");

  const shapes = [
    [alpha, [topic.Transfer, padded(sender), padded(receiver)]],
    [alpha, [topic.Approval, padded(sender), padded(receiver)]],
    [alpha, [topic.Other]],
    [alpha, [topic.Unregistered]],
    [beta, [topic.Transfer, padded(sender), padded(receiver)]],
    [beta, [topic.Other]],
    [beta, [topic.Approval, padded(sender), padded(receiver)]],
    [gamma, [topic.Transfer, padded(sender), padded(receiver)]],
    [gamma, [topic.Transfer, padded(otherSender), padded(receiver)]],
    [gamma, [topic.Approval, padded(sender), padded(receiver)]],
    [unrelated, [topic.Transfer, padded(sender), padded(receiver)]]
  ];
  const first = 100, last = 112;
  const blockHash = (number) => hash(1_000_000 + number);
  const transactionHash = (number, index) => hash(number * 1_000 + index);
  const blockLogs = (number) => shapes.map(([address, topics], index) => ({
    address, topics, data: hash(index), blockHash: blockHash(number),
    blockNumber: hex(number), logIndex: hex(index), removed: false,
    transactionHash: transactionHash(number, index), transactionIndex: hex(index)
  }));
  const block = (number, full) => ({
    number: hex(number), hash: blockHash(number), parentHash: blockHash(number - 1),
    timestamp: hex(1_700_000_000 + number), logsBloom: "0x" + "00".repeat(256),
    miner: account("0"), gasUsed: "0x0", gasLimit: "0x1", baseFeePerGas: "0x1",
    nonce: "0x0000000000000000", mixHash: hash(0), stateRoot: hash(0),
    receiptsRoot: hash(0), transactionsRoot: hash(0), sha3Uncles: hash(0),
    size: "0x1", difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x",
    transactions: shapes.map((_, index) => full ? ({
      hash: transactionHash(number, index), blockHash: blockHash(number),
      blockNumber: hex(number), transactionIndex: hex(index), from: sender,
      to: alpha, input: "0x", value: "0x0", nonce: "0x0", gas: "0x1",
      gasPrice: "0x1", type: "0x0", r: "0x1", s: "0x1", v: "0x1b"
    }) : transactionHash(number, index))
  });
  const matches = (log, { address, topics = [] }) =>
    (address === undefined || [address].flat().includes(log.address)) &&
    topics.every((value, index) => value === null || [value].flat().includes(log.topics[index]));

  const logRequests = [];
  const maximumRange = Number(process.env.FIXTURE_MAXIMUM_RANGE ?? 100000);
  const fixtureRpc = (recording) => ({
    request: async ({ method, params }) => {
      if (method === "eth_getBlockByNumber") {
        const number = params[0] === "latest" ? 1000 : Number(BigInt(params[0]));
        return block(number, params[1]);
      }
      if (method === "eth_getLogs") {
        const [filter] = params;
        const from = Number(BigInt(filter.fromBlock)), to = Number(BigInt(filter.toBlock));
        if (recording) logRequests.push(filter);
        // The same typed response-density failure the managed transport raises.
        if (to - from + 1 > maximumRange)
          throw new RpcError(new Error("too large"), { code: -32005,
            shortMessage: "backend response too large: source log response exceeded the client byte limit" });
        const logs = [];
        for (let number = Math.max(from, first); number <= Math.min(to, last); number++)
          logs.push(...blockLogs(number).filter((log) => matches(log, filter)));
        return logs;
      }
      throw new Error("Unexpected RPC method " + method);
    }
  });

  const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
  const metric = { observe() {}, inc() {}, set() {} };
  const common = { logger, metrics: new Proxy({}, { get: () => metric }),
    shutdown: { add() {}, isKilled: false, abortController: new AbortController() },
    options: { factoryAddressCountThreshold: 1000, command: "start" } };
  const chain = { id: 8453, name: "base", rpc: "http://offline.invalid", pollingInterval: 2000,
    finalityBlockCount: 30, disableCache: false };
  const contract = (address, extra = {}) => ({ abi, chain: "base", address, startBlock: first, ...extra });
  const config = { ordering: "multichain", chains: { base: { id: 8453, rpc: "http://offline.invalid" } },
    contracts: {
      Alpha: contract(alpha), Beta: contract(beta),
      Gamma: contract(gamma, { filter: { event: "Transfer", args: { from: sender } } }) } };
  const names = ["Alpha:Transfer", "Alpha:Approval", "Alpha:Other", "Beta:Transfer", "Beta:Other",
    "Gamma:Transfer", "Gamma:Approval"];
  const build = await buildIndexingFunctions({ common, config,
    indexingFunctions: names.map((name) => ({ name, fn: async () => {} })),
    configBuild: { chains: [chain], rpcs: [fixtureRpc(false)] } });
  const filters = build.eventCallbacks[0].map(({ filter }) => filter);
  const interval = [first, last];
  const required = filters.map((filter) => ({ filter, interval }));
  const stored = [];
  const syncStore = {
    insertChildAddresses: async () => {}, insertBlocks: async () => {}, insertTransactions: async () => {},
    insertTransactionReceipts: async () => {}, insertTraces: async () => {},
    insertLogs: async ({ logs }) => { stored.push(...logs); }
  };
  const key = (log) => [log.blockNumber, log.logIndex, log.address, log.topics.join("/")].join(":");
  const sync = (rpc) => createHistoricalSync({ common, chain, rpc, childAddresses: new Map() });
`;

const historicalProgram = `
  ${historicalSetup}
  const historical = sync(fixtureRpc(true));
  const args = { interval, requiredIntervals: required, requiredFactoryIntervals: [], syncStore };
  const logs = await historical.syncBlockRangeData(args);
  await historical.syncBlockData({ ...args, logs });
  console.log(JSON.stringify({
    filterTopics: filters.map(({ topic1, topic2, topic3 }) => [topic1, topic2, topic3]),
    filterCount: filters.length,
    logRequests,
    logs: logs.map(key).sort(),
    stored: stored.map(key).sort()
  }));
`;

const result = async (imports, env) => {
  const rows = await run(imports, historicalProgram, env);
  return rows.find((row) => row.logRequests);
};

test("the fix only accepts the pinned files and matches each target once", () => {
  assert.deepEqual(
    [...checkRuntime(application).values()].sort(),
    Object.keys(expectedFiles).sort()
  );
  for (const relative of Object.keys(expectedFiles)) {
    const source = readFileSync(resolve(root, "dist/esm", relative), "utf8");
    assert.notEqual(applyFixes(relative, source), source);
    assert.throws(() => applyFixes(relative, "changed"), /pinned Ponder/);
    assert.throws(
      () => applyFixes(relative, applyFixes(relative, source)),
      /pinned Ponder/
    );
  }
  assert.throws(() => applyFixes("runtime/index.js", ""), /Unsupported/);
});

test("the preload --check passes against the installed runtime", async () => {
  const child = spawn(process.execPath, [preload, "--check"], {
    cwd: application
  });
  let stdout = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  assert.equal(
    await new Promise((resolveRun) => child.once("close", resolveRun)),
    0
  );
  assert.equal(JSON.parse(stdout).event, "yunipals_ponder_fixes_verified");
});

test("log requests merge per address and fetch and store exactly the same logs", async () => {
  const [control, fixed] = await Promise.all([result([]), result([preload])]);

  // Ponder's real config builder yields null topics, the shape behind the bug.
  assert.ok(control.filterTopics.flat().includes(null));
  assert.equal(control.filterTopics.flat().includes(undefined), false);

  // Control: every event sends its own request.
  assert.equal(control.logRequests.length, control.filterCount);
  assert.equal(control.filterCount, 7);

  // Fixed: Alpha and Beta merge into one each, Gamma's unfiltered event gets
  // one, and Gamma's filtered event keeps its own because its topic1 is set.
  assert.equal(fixed.logRequests.length, 4);
  const byAddress = (address) =>
    fixed.logRequests.filter((request) => request.address === address);
  const [alpha] = byAddress("0x" + "a".repeat(40));
  assert.equal(alpha.topics.length, 1);
  assert.equal(alpha.topics[0].length, 3);
  assert.equal(byAddress("0x" + "b".repeat(40))[0].topics[0].length, 2);
  const gamma = byAddress("0x" + "c".repeat(40));
  assert.equal(gamma.length, 2);
  assert.equal(gamma.filter(({ topics }) => topics.length === 2).length, 1);
  assert.equal(gamma.filter(({ topics }) => topics.length === 1).length, 1);

  // The results are identical and non-trivial, including what reaches storage.
  assert.deepEqual(fixed.logs, control.logs);
  assert.deepEqual(fixed.stored, control.stored);
  assert.equal(fixed.stored.length, 13 * 7);

  // Excluded shapes stay excluded: the unregistered event, Beta's unregistered
  // Approval, Gamma's other sender, and the unrelated contract.
  const unrelated = "0x" + "d".repeat(40);
  assert.equal(
    fixed.stored.some((row) => row.includes(unrelated)),
    false
  );
});

test("merged requests still split when a response is too dense", async () => {
  const env = { FIXTURE_MAXIMUM_RANGE: "4" };
  const [control, fixed] = await Promise.all([
    result([], env),
    result([preload], env)
  ]);
  assert.ok(fixed.logRequests.length > 4, "The fixture must force a split.");
  assert.deepEqual(fixed.stored, control.stored);
  assert.equal(fixed.stored.length, 13 * 7);
});

const limiterProgram = (mode) => `
  import { createRpc } from ${internal("rpc/index.js")};
  import { createShutdown } from ${internal("internal/shutdown.js")};

  const events = [];
  const logger = { trace() {}, info() {}, warn() {}, error() {}, child() { return logger; },
    debug(row) { events.push(row); } };
  const metric = { observe() {}, inc() {}, set() {} };
  const shutdown = createShutdown();
  let failNext = false;
  const rpc = createRpc({
    common: { logger, shutdown, metrics: new Proxy({}, { get: () => metric }) },
    chain: { id: 8453, name: "base", rpc: () => ({ request: async () => {
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error("HTTP request failed."), { status: 429 });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "0x2105";
    } }) }
  });
  const call = () => rpc.request({ method: "eth_chainId", params: [] });
  const named = (msg) => events.filter((row) => row.msg === msg);

  // 20 * 0.95^34 = 3.499, inside the stuck range for a floor of 3 (3 < 3.149).
  for (let index = 0; index < 34; index++) {
    failNext = true;
    await call();
  }
  const decreases = named("JSON-RPC provider rate limited").length;

  const deadline = Date.now() + 15_000;
  const increased = () => named("Increased JSON-RPC provider RPS limit").length > 0;
  const worker = async (pause) => {
    while (Date.now() < deadline && !increased()) {
      await call();
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  };
  ${
    mode === "saturated"
      ? "await Promise.all(Array.from({ length: 8 }, () => worker(0)));"
      : "await worker(500);"
  }
  console.log(JSON.stringify({
    decreases,
    floorAfterDecreases: named("JSON-RPC provider rate limited").at(-1).rps_limit,
    increases: named("Increased JSON-RPC provider RPS limit").map((row) => row.rps_limit)
  }));
  await shutdown.kill();
`;

test("a rate limit in the stuck range recovers only under sustained saturation", async () => {
  const [control, fixed, idle] = (
    await Promise.all([
      run([], limiterProgram("saturated")),
      run([preload], limiterProgram("saturated")),
      run([preload], limiterProgram("idle"))
    ])
  ).map((rows) => rows.find((row) => row.increases));

  for (const row of [control, fixed, idle]) {
    assert.equal(row.decreases, 34);
    assert.equal(row.floorAfterDecreases, 3);
  }
  // Control: Ponder cannot leave the stuck range, even fully saturated.
  assert.deepEqual(control.increases, []);
  // Fixed: saturation raises the limit again.
  assert.equal(fixed.increases.length, 1);
  // Fixed: the limit does not grow without sustained demand.
  assert.deepEqual(idle.increases, []);
});

test("the composed preload keeps profiling and the fixes active together", async () => {
  const rows = await run(
    [composed],
    `
    ${historicalSetup}
    import { createRpc } from ${internal("rpc/index.js")};
    import { createShutdown } from ${internal("internal/shutdown.js")};
    import { profiler } from ${JSON.stringify(profiler)};
    const shutdown = createShutdown();
    const fixture = fixtureRpc(true);
    const rpc = createRpc({
      common: { ...common, shutdown },
      chain: { ...chain, rpc: () => ({ request: fixture.request }) }
    });
    const historical = sync(rpc);
    const args = { interval, requiredIntervals: required, requiredFactoryIntervals: [], syncStore };
    await historical.syncBlockRangeData(args);
    profiler.flush();
    console.log(JSON.stringify({ logRequests }));
    await shutdown.kill();
  `
  );
  const events = rows.map((row) => row.event);
  assert.ok(events.includes("yunipals_indexer_profile_enabled"));
  assert.ok(events.includes("yunipals_ponder_fixes_enabled"));
  const profile = rows.find((row) => row.durations?.["rpc_total.eth_getLogs"]);
  assert.ok(profile, "The profiler must still see RPC requests.");
  assert.equal(profile.durations["rpc_total.eth_getLogs"].count, 4);
  assert.equal(rows.find((row) => row.logRequests).logRequests.length, 4);
});

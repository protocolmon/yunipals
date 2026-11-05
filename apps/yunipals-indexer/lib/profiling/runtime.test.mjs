import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createProfiler } from "./runtime.mjs";
import { checkRuntime, instrument } from "./instrumentation.mjs";

const application = fileURLToPath(new URL("../../", import.meta.url));
const root = realpathSync(resolve(application, "node_modules/ponder"));
const preload = fileURLToPath(new URL("./preload.mjs", import.meta.url));

function fixture(write) {
  let time = 0;
  const rows = [];
  const profile = createProfiler({
    now: () => time,
    wall: () => 1700000000000 + time,
    cpu: () => ({ user: 0, system: 0 }),
    write: write ?? ((row) => rows.push(row))
  });
  return {
    profile,
    rows,
    advance: (ms) => {
      time += ms;
    }
  };
}

test("head queue wait and processing remain separate across reporting windows", () => {
  const { profile, rows, advance } = fixture();
  const block = { number: "0x64", timestamp: "0x6553f100" };
  const first = profile.enqueue(56, block);
  const second = profile.enqueue(56, block);
  advance(100);
  profile.dequeue(first);
  advance(20);
  profile.complete(first, true);
  profile.complete(first, true);
  profile.flush();
  assert.equal(rows[0].queue.pendingHeads, 1);
  assert.equal(rows[0].queue.activeHeads, 0);
  assert.equal(rows[0].queue.peakPendingHeads, 2);
  assert.equal(rows[0].durations.head_queue_wait.meanMs, 100);
  assert.equal(rows[0].durations.head_processing.meanMs, 20);
  advance(200);
  profile.dequeue(second);
  profile.complete(second, false);
  profile.flush();
  assert.equal(rows[1].queue.pendingHeads, 0);
  assert.equal(rows[1].queue.peakPendingHeads, 1);
  assert.equal(rows[1].durations.head_queue_wait.meanMs, 320);
  assert.equal(rows[1].counts.heads_rejected, 1);
  assert.equal(rows[1].counts.heads_received, undefined);
});

test("RPC profiling preserves values and exact errors, including a throwing output sink", async () => {
  const { profile, advance } = fixture(() => {
    throw new Error("sink failed");
  });
  const value = { result: 123 };
  assert.equal(
    await profile.rpc(56, { method: "eth_chainId" }, async (token) => {
      advance(7);
      profile.rpcStart(token);
      advance(3);
      return value;
    }),
    value
  );
  const failure = new Error("provider-secret-value");
  await assert.rejects(
    profile.rpc(56, { method: "eth_call" }, () => {
      throw failure;
    }),
    (error) => error === failure
  );
  assert.doesNotThrow(() => profile.flush());
});

test("RPC queue and total durations include failures and use bounded labels", async () => {
  const { profile, rows, advance } = fixture();
  for (let i = 0; i < 1000; i++) {
    await profile.rpc(
      56,
      { method: `unknown-${i}`, params: ["secret"] },
      async (token) => {
        advance(2);
        profile.rpcStart(token);
        advance(3);
      }
    );
  }
  profile.flush();
  assert.deepEqual(Object.keys(rows[0].durations).sort(), [
    "rpc_queue.other",
    "rpc_total.other"
  ]);
  assert.equal(rows[0].durations["rpc_queue.other"].meanMs, 2);
  assert.equal(rows[0].durations["rpc_total.other"].meanMs, 5);
  assert.equal(rows[0].queue.pendingRpc, 0);
  assert.equal(rows[0].queue.activeRpc, 0);
});

test("structured summaries never retain raw logs, request arguments, URLs or errors", () => {
  const { profile, rows, advance } = fixture();
  profile.log({
    chain_id: 56,
    msg: "Received JSON-RPC error",
    method: "eth_getLogs",
    error: new Error("SECRET"),
    request: "SECRET",
    hostname: "SECRET",
    retry_delay: 1000
  });
  profile.log({
    chain_id: 56,
    msg: "Indexed block",
    number: 120,
    duration: 31,
    hash: "SECRET"
  });
  profile.log({ chain_id: 999, msg: "Indexed block", number: 1, duration: 1 });
  profile.log({ chain_id: 56, msg: "SECRET", duration: 1 });
  advance(30000);
  profile.flush();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastIndexedBlock, 120);
  assert.equal(rows[0].counts["rpc_attempt_errors.eth_getLogs"], 1);
  assert.equal(rows[0].durations.index_block.meanMs, 31);
  assert.doesNotMatch(JSON.stringify(rows), /SECRET/);
});

test("instrumentation rejects runtime drift before installing any hooks", () => {
  assert.equal(checkRuntime(application).size, 3);
  const source = readFileSync(resolve(root, "dist/esm/rpc/index.js"), "utf8");
  assert.throws(() => instrument("rpc/index.js", source + "\n"), /Unsupported/);
});

test("actual Ponder logger and RPC queue produce profiles with logging disabled", async () => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      preload,
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createLogger } from ${JSON.stringify(resolve(root, "dist/esm/internal/logger.js"))};
    import { createRpc } from ${JSON.stringify(resolve(root, "dist/esm/rpc/index.js"))};
    import { createShutdown } from ${JSON.stringify(resolve(root, "dist/esm/internal/shutdown.js"))};
    import { profiler } from ${JSON.stringify(fileURLToPath(new URL("./runtime.mjs", import.meta.url)))};
    import { getRealtimeEventGenerator } from ${JSON.stringify(resolve(root, "dist/esm/runtime/realtime.js"))};
    const logger = createLogger({level:"silent"});
    const shutdown = createShutdown();
    const metric = {observe(){},inc(){},set(){}};
    const common = {logger,shutdown,metrics:new Proxy({}, {get:()=>metric})};
    const rpc=createRpc({common,chain:{id:56,name:"bnb",rpc:()=>({request:async(body)=>{assert.equal(body.method,"eth_chainId");return "0x38";}})}});
    assert.equal(await rpc.request({method:"eth_chainId",params:[]}),"0x38");
    logger.debug({msg:"Fetched block data",chain_id:56,duration:12,hash:"SECRET"});
    logger.info({msg:"Indexed block",chain_id:56,number:123,duration:5});
    const block = (number) => ({number:"0x"+number.toString(16),hash:"0x"+number.toString(16).padStart(64,"0"),parentHash:"0x"+(number-1).toString(16).padStart(64,"0"),timestamp:"0x6553f100",logsBloom:"0x01",transactions:[]});
    const timers = [];
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (...args) => {const timer=originalTimeout(...args);timers.push(timer);return timer;};
    const acknowledgements = [];
    const realtime = getRealtimeEventGenerator({common,chain:{id:56,name:"bnb",finalityBlockCount:100},childAddresses:new Map(),eventCallbacks:[],syncProgress:{finalized:block(0),end:block(2)},rpc:{subscribe({onBlock}){for(const number of [1,1,2])acknowledgements.push(onBlock(block(number)));},async unsubscribe(){}}});
    const first = await realtime.next();
    assert.equal(first.value.event.block.number,"0x1");
    profiler.flush();
    first.value.event.blockCallback(true);
    const second = await realtime.next();
    assert.equal(second.value.event.block.number,"0x2");
    second.value.event.blockCallback(true);
    assert.equal((await realtime.next()).done,true);
    assert.deepEqual(await Promise.all(acknowledgements),[true,false,true]);
    for(const timer of timers)clearTimeout(timer);
    globalThis.setTimeout = originalTimeout;
    profiler.flush();
    await shutdown.kill();
  `
    ],
    { cwd: application, encoding: "utf8", timeout: 10000 }
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, stderr);
  assert.doesNotMatch(stdout, /SECRET/);
  assert.ok(stdout.trim(), stderr);
  const rows = stdout.trim().split("\n").filter(Boolean).map(JSON.parse);
  const row = rows.find((row) => row.durations?.["rpc_total.eth_chainId"]);
  assert.ok(row, stdout);
  assert.equal(row.durations["rpc_queue.eth_chainId"].count, 1);
  assert.equal(row.durations["rpc_attempt.eth_chainId"].count, 1);
  assert.equal(row.durations.fetch_block_data.maxMs, 12);
  assert.equal(row.queue.pendingHeads, 2);
  const completed = rows.find((row) => row.counts?.heads_accepted === 2);
  assert.ok(completed);
  assert.equal(completed.queue.pendingHeads, 0);
  assert.equal(completed.queue.activeHeads, 0);
  assert.equal(completed.counts.heads_rejected, 1);
  assert.equal(row.counts.blocks_indexed, 1);
});

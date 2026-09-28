import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { padHex, toEventSelector, toHex } from "viem";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL for a disposable PostgreSQL database is required");

const blockNumber = 7_579_197n;
const blockHash = `0x${"ab".repeat(32)}`;
const transactionHash = `0x${"cd".repeat(32)}`;
const holder = "0x1111111111111111111111111111111111111111";
const collection = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d";
const transfer = {
  address: collection,
  blockHash,
  blockNumber: toHex(blockNumber),
  data: "0x",
  logIndex: "0x0",
  topics: [
    toEventSelector("Transfer(address,address,uint256)"),
    padHex("0x0000000000000000000000000000000000000000", { size: 32 }),
    padHex(holder, { size: 32 }),
    toHex(1n, { size: 32 })
  ],
  transactionHash,
  transactionIndex: "0x0"
};

const methods = new Map();
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const call = JSON.parse(Buffer.concat(chunks).toString());
  methods.set(call.method, (methods.get(call.method) ?? 0) + 1);
  let result;
  switch (call.method) {
    case "eth_blockNumber":
      result = toHex(blockNumber + 1n);
      break;
    case "eth_getLogs":
      result = call.params[0].fromBlock === toHex(blockNumber) ? [transfer] : [];
      break;
    case "eth_getBlockByNumber":
      result = {
        number: toHex(blockNumber),
        hash: blockHash,
        parentHash: `0x${"00".repeat(32)}`,
        timestamp: toHex(1_700_000_000),
        transactions: []
      };
      break;
    case "eth_chainId":
      result = "0x38";
      break;
    default:
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "Unexpected RPC method" } }));
      return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const rpcUrl = `http://127.0.0.1:${server.address().port}`;
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const names = [`bnb_test_${process.pid}_a`, `bnb_test_${process.pid}_b`];
const workers = [];

function runScript(script, schema) {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL(`../lib/bnb/${script.replace(/\.js$/, ".ts")}`, import.meta.url))], {
    env: {
      ...process.env,
      BNB_DATABASE_SCHEMA: schema,
      BNB_RPC_URL: rpcUrl,
      BNB_CONFIRMATIONS: "1",
      BNB_LOG_BLOCK_RANGE: "1",
      BNB_RECONCILE_MS: "10000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { output += value; });
  const done = new Promise((resolve) => child.once("exit", (code) => resolve({ code, output })));
  return { child, done, output: () => output };
}

async function waitForIndex(schema, worker) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await database.query(
      `SELECT token_id,owner,lifecycle FROM "${schema}".token WHERE token_id='1'`
    );
    if (result.rows.length) return result.rows[0];
    if (worker.child.exitCode !== null) throw new Error(worker.output());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for BNB transfer indexing");
}

try {
  const rows = [];
  for (const schema of names) {
    const migration = runScript("migrate.js", schema);
    const migrated = await migration.done;
    assert.equal(migrated.code, 0, migrated.output);
    const worker = runScript("worker.js", schema);
    workers.push(worker);
    rows.push(await waitForIndex(schema, worker));
    const state = await database.query(
      `SELECT next_block,last_scanned_hash,caught_up_at FROM "${schema}".sync_state WHERE singleton`
    );
    assert.equal(String(state.rows[0].next_block), String(blockNumber + 1n));
    assert.equal(state.rows[0].last_scanned_hash, blockHash);
    assert.ok(state.rows[0].caught_up_at);
    const events = await database.query(`SELECT count(*)::integer AS count FROM "${schema}".transfer_event`);
    assert.equal(events.rows[0].count, 1);
  }
  assert.deepEqual(rows[0], rows[1]);
  assert.deepEqual(rows[0], { token_id: "1", owner: holder, lifecycle: 1 });
  assert.equal(methods.get("eth_getLogs"), 2);
  console.log("Two independent BNB indexers reconstructed the same ownership and cursor");
} finally {
  for (const worker of workers) {
    worker.child.kill("SIGTERM");
    await worker.done;
  }
  for (const schema of names) await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await database.end();
  server.close();
}

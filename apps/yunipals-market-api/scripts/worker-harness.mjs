import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

// Fault injection for the built worker only. This proxy can forward solely to
// the local RPC already verified as a BNB Anvil fork by admission-fork.mjs.
export async function createWorkerHarness({ pool, rpcUrl, runtimeUrl }) {
  const url = new URL(rpcUrl);
  assert.ok(
    url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
  let unavailable = false;
  let hold = false;
  const held = new Set();
  let child;
  let closed;
  let output = "";
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = JSON.parse(body);
      if (hold && parsed.method === "eth_call") {
        await new Promise((resolve) => {
          held.add(resolve);
        });
        if (response.destroyed) return;
      }
      if (unavailable) {
        response.writeHead(503);
        response.end();
        return;
      }
      const upstream = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000)
      });
      response.writeHead(upstream.status, {
        "Content-Type": "application/json"
      });
      response.end(await upstream.text());
    } catch {
      if (!response.destroyed) {
        response.writeHead(503);
        response.end();
      }
    }
  });
  proxy.listen(19647, "127.0.0.1");
  await once(proxy, "listening");
  async function waitFor(predicate, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (child && child.exitCode !== null)
        throw new Error(`Worker exited: ${output}`);
      if (await predicate()) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for worker state: ${output}`);
  }
  async function stop(signal = "SIGTERM") {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
    const timer = setTimeout(() => child.kill("SIGKILL"), 18000);
    try {
      const [code, actualSignal] = await closed;
      if (signal === "SIGKILL") assert.equal(actualSignal, "SIGKILL", output);
      else {
        assert.equal(code, 0, output);
        assert.equal(actualSignal, null, output);
      }
    } finally {
      clearTimeout(timer);
      child = undefined;
    }
  }
  async function start() {
    await stop();
    const startedAt = new Date();
    output = "";
    child = spawn(process.execPath, ["dist/worker.mjs"], {
      env: {
        ...process.env,
        MARKET_DEPLOYMENT: "staging",
        MARKET_DATABASE_URL: runtimeUrl,
        MARKET_BNB_VALIDATION_RPC: "http://127.0.0.1:19647",
        MARKET_WORKER_CONCURRENCY: "2"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    closed = once(child, "close");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM yunipals_market.checkpoint WHERE source='chain'
      AND chain_id=56 AND name='bnb-order-worker' AND checked_at>=$1 AND state='available'`,
            [startedAt]
          )
        ).rowCount === 1
    );
  }
  async function due(hashes) {
    await pool.query(
      "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE chain_id=56 AND order_hash=ANY($1::text[])",
      [hashes]
    );
  }
  async function state(
    hash,
    expected,
    minimumGeneration = 1n,
    timeoutMs = 20000
  ) {
    await waitFor(async () => {
      const row = (
        await pool.query(
          "SELECT state,reconcile_generation::text FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1",
          [hash]
        )
      ).rows[0];
      return (
        row?.state === expected &&
        BigInt(row.reconcile_generation) >= minimumGeneration
      );
    }, timeoutMs);
  }
  function release() {
    hold = false;
    for (const resolve of held) resolve();
    held.clear();
  }
  return {
    start,
    stop,
    due,
    state,
    async outage(hashes) {
      unavailable = true;
      await due(hashes);
      for (const hash of hashes) await state(hash, "unavailable");
      await waitFor(
        async () =>
          (
            await pool.query(`SELECT 1 FROM yunipals_market.checkpoint WHERE source='chain'
        AND chain_id=56 AND name='bnb-order-worker' AND state='unavailable'`)
          ).rowCount === 1
      );
    },
    async recover(expected) {
      unavailable = false;
      await due(expected.map(([hash]) => hash));
      for (const [hash, status] of expected) await state(hash, status);
    },
    async crashAndRecover(hash, expected) {
      hold = true;
      await due([hash]);
      await waitFor(
        async () =>
          held.size > 0 &&
          (
            await pool.query(
              `SELECT 1 FROM yunipals_market.job WHERE kind='bnb_order_reconcile'
        AND payload->>'orderHash'=$1 AND state='running'`,
              [hash]
            )
          ).rowCount > 0
      );
      const running = (
        await pool.query(
          `SELECT id,lease_token FROM yunipals_market.job WHERE kind='bnb_order_reconcile'
        AND payload->>'orderHash'=$1 AND state='running'`,
          [hash]
        )
      ).rows[0];
      const startedAt = Date.now();
      await stop("SIGKILL");
      release();
      await start();
      // Use real lease expiry, without changing its deadline in SQL.
      await waitFor(
        async () =>
          (
            await pool.query(
              "SELECT state FROM yunipals_market.job WHERE id=$1",
              [running.id]
            )
          ).rows[0]?.state === "completed",
        45000
      );
      await state(hash, expected);
      assert.equal(
        (
          await pool.query(
            "SELECT attempts FROM yunipals_market.job WHERE id=$1",
            [running.id]
          )
        ).rows[0].attempts,
        2
      );
      return { elapsedMs: Date.now() - startedAt, attempts: 2 };
    },
    async close() {
      release();
      try {
        await stop();
      } finally {
        proxy.closeAllConnections();
        await new Promise((resolve) => proxy.close(resolve));
      }
    }
  };
}

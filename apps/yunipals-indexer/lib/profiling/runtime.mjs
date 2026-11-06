import { performance } from "node:perf_hooks";

const chains = new Set([1, 56, 137, 8453]);
const methods = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getBlockReceipts",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_call",
  "eth_getCode",
  "debug_traceBlockByHash"
]);
const bounds = [
  1,
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1000,
  2500,
  5000,
  10000,
  30000,
  60000,
  120000,
  300000,
  600000,
  Infinity
];
const stages = new Map([
  ["Fetched block data", "fetch_block_data"],
  ["Indexed block", "index_block"],
  ["Finalized block", "finalize_block"],
  ["Reorged block", "reorg_block"]
]);

function distribution() {
  return { count: 0, sumMs: 0, maxMs: 0, buckets: bounds.map(() => 0) };
}

function summarize(value) {
  const percentile = (fraction) => {
    let count = 0;
    for (let i = 0; i < bounds.length; i++) {
      count += value.buckets[i];
      if (count >= Math.ceil(value.count * fraction))
        return Number.isFinite(bounds[i]) ? bounds[i] : null;
    }
    return null;
  };
  return {
    count: value.count,
    sumMs: Math.round(value.sumMs),
    meanMs: Math.round((value.sumMs / value.count) * 100) / 100,
    maxMs: Math.round(value.maxMs),
    p50UpperBoundMs: percentile(0.5),
    p95UpperBoundMs: percentile(0.95)
  };
}

function rpcLabel(body) {
  const method = methods.has(body?.method) ? body.method : "other";
  if (method !== "eth_getBlockByNumber") return method;
  const tag = body.params?.[0];
  return `${method}.${["latest", "safe", "finalized", "pending"].includes(tag) ? tag : "number"}.${body.params?.[1] === true ? "full" : "header"}`;
}

// Fixed chain/method labels and fixed histograms keep memory bounded. Raw RPC
// arguments, URLs, errors, hashes, addresses and logger bindings are never saved.
export function createProfiler({
  now = () => performance.now(),
  wall = () => Date.now(),
  cpu = () => process.cpuUsage(),
  write = (row) => {
    if (process.stdout.destroyed || process.stdout.writableLength > 65536)
      return false;
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return true;
  }
} = {}) {
  const states = new Map();
  let startedAt = now();
  let startedCpu = cpu();
  let droppedWindows = 0;
  let timer;
  const state = (chainId) => {
    if (!chains.has(chainId)) return null;
    if (!states.has(chainId)) {
      states.set(chainId, {
        pendingHeads: 0,
        activeHeads: 0,
        peakPendingHeads: 0,
        rpcPending: 0,
        rpcActive: 0,
        head: null,
        indexed: null,
        durations: new Map(),
        counts: new Map()
      });
    }
    return states.get(chainId);
  };
  const observe = (s, name, milliseconds) => {
    if (!s || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    const metric = s.durations.get(name) ?? distribution();
    metric.count++;
    metric.sumMs += milliseconds;
    metric.maxMs = Math.max(metric.maxMs, milliseconds);
    metric.buckets[bounds.findIndex((bound) => milliseconds <= bound)]++;
    s.durations.set(name, metric);
  };
  const count = (s, name) => {
    if (s) s.counts.set(name, (s.counts.get(name) ?? 0) + 1);
  };
  const safe =
    (fn) =>
    (...args) => {
      try {
        return fn(...args);
      } catch {
        // Profiling must never change indexing success or failure behavior.
        return undefined;
      }
    };
  const api = {
    enqueue: safe((chainId, block) => {
      const s = state(chainId);
      if (!s) return null;
      const token = {
        chainId,
        enqueuedAt: now(),
        dequeuedAt: null,
        done: false
      };
      s.pendingHeads++;
      s.peakPendingHeads = Math.max(s.peakPendingHeads, s.pendingHeads);
      const timestamp = Number(BigInt(block.timestamp)) * 1000;
      s.head = { number: Number(BigInt(block.number)), timestamp };
      observe(s, "head_age_on_receipt", Math.max(0, wall() - timestamp));
      count(s, "heads_received");
      return token;
    }),
    dequeue: safe((token) => {
      if (!token || token.dequeuedAt !== null) return;
      const s = state(token.chainId);
      token.dequeuedAt = now();
      s.pendingHeads--;
      s.activeHeads++;
      observe(s, "head_queue_wait", token.dequeuedAt - token.enqueuedAt);
    }),
    complete: safe((token, accepted) => {
      if (!token || token.done) return;
      token.done = true;
      const s = state(token.chainId);
      if (token.dequeuedAt !== null) {
        s.activeHeads--;
        observe(s, "head_processing", now() - token.dequeuedAt);
      }
      observe(s, "head_total", now() - token.enqueuedAt);
      count(s, accepted ? "heads_accepted" : "heads_rejected");
    }),
    rpcStart: safe((token) => {
      if (!token || token.started) return;
      token.started = true;
      const s = state(token.chainId);
      s.rpcPending--;
      s.rpcActive++;
      observe(s, `rpc_queue.${token.label}`, now() - token.at);
    }),
    async rpc(chainId, body, run) {
      const token = safe(() => {
        const s = state(chainId);
        if (!s) return null;
        s.rpcPending++;
        return { chainId, label: rpcLabel(body), at: now(), started: false };
      })();
      try {
        return await run(token);
      } catch (error) {
        safe(() =>
          count(state(chainId), `rpc_errors.${token?.label ?? "other"}`)
        )();
        throw error;
      } finally {
        safe(() => {
          if (!token) return;
          const s = state(chainId);
          if (token.started) s.rpcActive--;
          else s.rpcPending--;
          observe(s, `rpc_total.${token.label}`, now() - token.at);
        })();
      }
    },
    log: safe((event) => {
      const s = state(event?.chain_id);
      if (!s) return;
      const stage = stages.get(event.msg);
      if (stage) observe(s, stage, event.duration);
      if (event.msg === "Indexed block" && Number.isSafeInteger(event.number)) {
        s.indexed = { number: event.number, observedAt: wall() };
        count(s, "blocks_indexed");
      }
      if (event.msg === "Fetched missing blocks") count(s, "gap_fetches");
      if (
        event.msg === "Reconciled reorg in local chain" &&
        Number.isSafeInteger(event.reorg_depth)
      ) {
        count(s, "reorgs");
        // Ponder logs reorg depth at debug level only. Record each reorg as its
        // own line, so that reorg tracking can count the deep ones exactly.
        try {
          write({
            event: "yunipals_indexer_reorg",
            schemaVersion: 1,
            observedAt: new Date(wall()).toISOString(),
            chainId: event.chain_id,
            depth: event.reorg_depth,
            commonAncestorBlock: Number.isSafeInteger(
              event.common_ancestor_block
            )
              ? event.common_ancestor_block
              : null
          });
        } catch {
          droppedWindows++;
        }
      }
      if (event.msg === "Sent JSON-RPC request")
        observe(
          s,
          `rpc_bucket_wait.${methods.has(event.method) ? event.method : "other"}`,
          event.duration
        );
      if (event.msg === "Received JSON-RPC response")
        observe(
          s,
          `rpc_attempt.${methods.has(event.method) ? event.method : "other"}`,
          event.duration
        );
      if (event.msg === "Received JSON-RPC error") {
        count(
          s,
          `rpc_attempt_errors.${methods.has(event.method) ? event.method : "other"}`
        );
        observe(s, "rpc_retry_backoff", event.retry_delay);
      }
      if (event.msg === "Detected live indexing backpressure") {
        const step = {
          "fetch block data": "head_buffer",
          "order block events": "event_buffer",
          "execute indexing functions": "index_buffer"
        }[event.indexing_step];
        if (step && Number.isSafeInteger(event.buffer_size))
          s.counts.set(
            `${step}_peak`,
            Math.max(s.counts.get(`${step}_peak`) ?? 0, event.buffer_size)
          );
      }
    }),
    flush: safe(() => {
      const endedAt = now();
      const endedCpu = cpu();
      const elapsedMs = endedAt - startedAt;
      if (elapsedMs <= 0) return;
      for (const [chainId, s] of states) {
        const row = {
          event: "yunipals_indexer_profile",
          schemaVersion: 1,
          observedAt: new Date(wall()).toISOString(),
          pid: process.pid,
          chainId,
          windowMs: Math.round(elapsedMs),
          droppedWindows,
          processCpuMs: Math.round(
            (endedCpu.user +
              endedCpu.system -
              startedCpu.user -
              startedCpu.system) /
              1000
          ),
          queue: {
            pendingHeads: s.pendingHeads,
            peakPendingHeads: s.peakPendingHeads,
            activeHeads: s.activeHeads,
            pendingRpc: s.rpcPending,
            activeRpc: s.rpcActive
          },
          latestReceivedBlock: s.head?.number ?? null,
          latestReceivedBlockAgeMs: s.head
            ? Math.max(0, wall() - s.head.timestamp)
            : null,
          lastIndexedBlock: s.indexed?.number ?? null,
          lastIndexUpdateAgeMs: s.indexed
            ? wall() - s.indexed.observedAt
            : null,
          receivedToIndexedBlocks:
            s.head && s.indexed ? s.head.number - s.indexed.number : null,
          durations: Object.fromEntries(
            [...s.durations].map(([name, metric]) => [name, summarize(metric)])
          ),
          counts: Object.fromEntries(s.counts)
        };
        try {
          if (write(row) === false) droppedWindows++;
        } catch {
          droppedWindows++;
        }
        s.durations.clear();
        s.counts.clear();
        s.peakPendingHeads = s.pendingHeads;
      }
      startedAt = endedAt;
      startedCpu = endedCpu;
    }),
    start() {
      timer ??= setInterval(api.flush, 30000);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      api.flush();
    }
  };
  return api;
}

export const profiler = createProfiler();

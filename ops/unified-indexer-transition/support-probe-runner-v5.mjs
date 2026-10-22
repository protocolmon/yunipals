// External operator runner. Uses a separately verified receipt correction; never scans logs.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

export const ROLE = "yunipals_unified_support";
export const RELEASE = "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c";
export const SCHEMA = "unified_shadow_20261020_7e7375b0";
export const BUILD = "bf4939b3ff";
export const MANIFEST = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029";

const ENDPOINTS = { 1: "http://127.0.0.1:19201/unified", 56: "http://127.0.0.1:19204/unified", 137: "http://127.0.0.1:19203/unified", 8453: "http://127.0.0.1:19202/unified" };
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_getCode"]);
const serializable = (value) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? String(item) : item));

export function validateConfiguration(config) {
  if (Object.keys(config).sort().join() !== "chains,maxResponseBytes,maxRpcCalls,maxSeconds,profileId,queueLimit,receiptLimit,task" ||
      !Array.isArray(config.chains) || !config.chains.length || config.chains.length > 4 ||
      config.chains.some((chain, i) => ![1, 56, 137, 8453].includes(chain) || (i && chain <= config.chains[i - 1]))) {
    throw Error("invalid_probe_configuration");
  }
  if (typeof config.profileId !== "string" || !/^0x[0-9a-f]{64}$/.test(config.profileId)) throw Error("explicit_reviewed_profile_required");
  if (!["observe-once", "receipts-once", "worker"].includes(config.task)) throw Error("invalid_official_support_task");
  for (const [key, min, max] of [["queueLimit", 1, 8], ["receiptLimit", 1, 2], ["maxRpcCalls", 1, 64],
    ["maxSeconds", 1, 180], ["maxResponseBytes", 1024, 2097152]]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) throw Error("invalid_probe_bound");
  }
  return config;
}

export function createBoundedFetch(config, fetchImpl, { now = Date.now } = {}) {
  validateConfiguration(config);
  const started = now();
  const state = { rpcCalls: 0, preflights: 0, responseBytes: 0, failed: false };
  const preflighted = new Set();
  const allowed = new Set(config.chains.map((chain) => ENDPOINTS[chain]));
  const fail = (code) => { state.failed = true; throw Error(code); };
  const check = () => {
    if (state.failed || now() - started >= config.maxSeconds * 1000) fail("probe_stopped_or_deadline");
  };
  const bounded = async (input, options = {}) => {
    check();
    const url = String(input);
    const endpoint = url.replace(/\/preflight$/, "");
    if (!allowed.has(endpoint)) fail("unreviewed_endpoint");
    const headers = new Headers(options.headers);
    if (headers.get("x-yunipals-unified-rpc-profile") !== config.profileId || headers.get("x-yunipals-rpc-workload") !== "unified_evidence" ||
        [...headers.keys()].some((key) => key.includes("permit") || key === "authorization" || key === "cookie")) fail("unreviewed_headers");
    const isPreflight = url.endsWith("/preflight");
    if (isPreflight) {
      if ((options.method ?? "GET") !== "GET" || options.body || preflighted.has(url)) fail("unbounded_preflight");
      preflighted.add(url);
      state.preflights += 1;
    } else {
      if (options.method !== "POST" || typeof options.body !== "string") fail("invalid_rpc_envelope");
      let body;
      try { body = JSON.parse(options.body); } catch { fail("invalid_rpc_envelope"); }
      const calls = Array.isArray(body) ? body : [body];
      if (!calls.length || calls.length > 10 || state.rpcCalls + calls.length > config.maxRpcCalls) fail("rpc_call_limit");
      if (calls.some((call) => !call || !METHODS.has(call.method) || !(Array.isArray(call.params) || (call.method === "eth_chainId" && call.params === undefined)))) fail("unreviewed_rpc_method");
      state.rpcCalls += calls.length;
    }
    const remaining = config.maxSeconds * 1000 - (now() - started);
    const signal = AbortSignal.timeout(Math.max(1, Math.min(15000, remaining)));
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal });
      if (!response.ok || response.redirected) fail("proxy_refused_or_unavailable");
      const reader = response.body?.getReader();
      const chunks = [];
      let bytes = 0;
      if (!reader) fail("empty_proxy_response");
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > config.maxResponseBytes) fail("proxy_response_limit");
          chunks.push(part.value);
          check();
        }
      } finally { await reader.cancel().catch(() => {}); }
      state.responseBytes += bytes;
      const raw = Buffer.concat(chunks);
      let value;
      try { value = JSON.parse(raw.toString()); } catch { fail("invalid_proxy_response"); }
      if (!isPreflight && (Array.isArray(value) ? value : [value]).some((row) => !row || row.error || !("result" in row))) fail("rpc_result_error");
      return new Response(raw, { status: response.status, headers: { "content-type": "application/json" } });
    } catch {
      state.failed = true;
      throw Error("bounded_proxy_request_failed");
    }
  };
  return { fetch: bounded, state, check };
}

export function assertRelease(release) {
  if (release.id !== RELEASE || release.schema !== SCHEMA || release.buildId !== BUILD || release.manifestHash !== MANIFEST) throw Error("registered_release_mismatch");
}

export function runnable(snapshot, now = Date.now(), task = "worker") {
  const block = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
  return ["observe-once", "receipts-once", "worker"].includes(task) &&
    snapshot.running === true && Number.isFinite(snapshot.observedAtMs) && snapshot.observedAtMs <= now && now - snapshot.observedAtMs <= 180000 &&
    Array.isArray(snapshot.chains) && snapshot.chains.length > 0 &&
    snapshot.chains.every((chain) => block(chain.completeThroughBlock) &&
      (task === "receipts-once" || block(chain.witnessBlock)));
}

export function assertPeer() {
  const status = Object.fromEntries(readFileSync("/proc/self/status", "utf8").split("\n").filter((line) => line.includes(":"))
    .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]));
  if (!["YUNIPALS_SUPPORT_UID", "YUNIPALS_SUPPORT_GID"].every((key) => /^[1-9][0-9]*$/.test(process.env[key] ?? "")) ||
      process.getuid() !== Number(process.env.YUNIPALS_SUPPORT_UID) || process.getgid() !== Number(process.env.YUNIPALS_SUPPORT_GID) ||
      status.Groups !== "" || status.NoNewPrivs !== "1" ||
      ["CapInh", "CapPrm", "CapEff", "CapAmb"].some((key) => !/^[0-9a-f]+$/.test(status[key] ?? "") || BigInt("0x" + status[key]) !== 0n)) {
    throw Error("restricted_support_os_identity_required");
  }
}

export async function runProbe(mode, config) {
  validateConfiguration(config);
  if (!["inspect", "apply"].includes(mode)) throw Error("invalid_probe_mode");
  assertPeer();
  const fetchImpl = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("provider_access_disabled_during_inspection"); };
  const moduleAt = (relative) => import(pathToFileURL(path.resolve(process.cwd(), relative)).href);
  const [{ default: pg }, releases, statusModule, observer, receipts, rpcModule, policyModule] = await Promise.all([
    import(pathToFileURL(path.resolve("node_modules/pg/lib/index.js")).href),
    moduleAt("lib/unified/releases.ts"), moduleAt("../../packages/yunipals-indexer-server/src/status.ts"),
    moduleAt("lib/unified/observer.ts"), import("file:///opt/yunipals-unified/operations/free-replay-20261020/source008-receipt-support-v1/receipt-worker.mjs"), moduleAt("lib/unified/rpc.ts"),
    moduleAt("lib/unified/rpc-preflight.ts")
  ]);
  const policy = policyModule.unifiedRpcConfiguration(process.env);
  if (!policy || Object.keys(process.env).some((key) => key.includes("PERMIT")) || policy.headers("unified_evidence")["x-yunipals-unified-rpc-profile"] !== config.profileId) throw Error("free_profile_required");
  const pool = new pg.Pool({ host: "/var/run/postgresql", port: 5432, database: "yunipals_backfill", user: ROLE, max: 2,
    connectionTimeoutMillis: 3000, statement_timeout: 8000, lock_timeout: 1500, query_timeout: 10000, application_name: "yunipals-restricted-support-probe" });
  let release;
  let before;
  let bounded;
  const results = [];
  const snapshot = async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const identity = (await db.query("SELECT session_user,current_user")).rows[0];
      if (identity.session_user !== ROLE || identity.current_user !== ROLE) throw Error("support_peer_mismatch");
      release = await releases.loadIndexerRelease(db, RELEASE);
      assertRelease(release);
      const runtime = await releases.readBoundRuntime(db, release);
      const chains = config.chains.map((chainId) => ({ chainId,
        completeThroughBlock: runtime.chains.find((row) => row.chainId === chainId)?.completeThroughBlock ?? null,
        witnessBlock: runtime.witnesses.find((row) => row.chainId === chainId)?.blockNumber ?? null }));
      const sources = [];
      for (const source of release.manifest.sources.filter((item) => item.enabled && config.chains.includes(item.chainId))) {
        for (const policy of source.policies) {
          const status = await statusModule.readIndexerSourceStatus(db, release, source.id, policy);
          sources.push({ sourceId: source.id, chainId: source.chainId, policy, receiptStartBlock: source.receiptStartBlock ?? source.startBlock,
            readiness: status.readiness, anchor: status.anchor, errorCode: status.errorCode });
        }
      }
      await db.query("ROLLBACK");
      return serializable({ running: runtime.running, frameworkReady: runtime.frameworkReady, observedAtMs: runtime.observedAtMs, chains, sources });
    } finally { await db.query("ROLLBACK").catch(() => {}); db.release(); }
  };
  try {
    before = await snapshot();
    if (mode === "inspect") return { inspected: true, releaseId: RELEASE, before, rpcCalls: 0, writes: false };
    if (!runnable(before, Date.now(), config.task)) return { executed: false, reason: "native_source_unavailable", before, rpcCalls: 0, writes: false };
    bounded = createBoundedFetch(config, fetchImpl);
    globalThis.fetch = bounded.fetch;
    let successful = true;
    for (const chainId of config.chains) {
      bounded.check();
      const response = await bounded.fetch(`${ENDPOINTS[chainId]}/preflight`, { headers: policy.headers("unified_evidence", chainId) });
      const preflight = await response.json();
      if (preflight.profileId !== config.profileId || preflight.manifestHash !== MANIFEST || preflight.chainId !== chainId ||
          preflight.workload !== "unified_evidence" || preflight.scope !== "yunipals-opensea" ||
          preflight.coordinatorId !== policy.profile.coordinatorId || !preflight.budget ||
          preflight.paid !== "explicit_bounded_permit_only" || preflight.replay?.mode !== "free_only") throw Error("free_preflight_mismatch");
      const rpc = rpcModule.evidenceRpc(chainId, process.env);
      const observed = config.task === "receipts-once" ? null : await observer.observeIndexerChain(pool, release, chainId, rpc);
      bounded.check();
      const row = { chainId, observed, queued: 0, claimed: 0, receipts: [] };
      results.push(row);
      if (config.task !== "receipts-once" && observed !== "observed") { successful = false; break; }
      if (config.task === "observe-once") continue;
      row.queued = await receipts.queueReceiptCandidates(pool, release, chainId, config.queueLimit);
      const jobs = await receipts.claimReceiptJobs(pool, release, chainId, config.receiptLimit);
      row.claimed = jobs.length;
      for (const job of jobs) {
        bounded.check();
        const outcome = await receipts.enrichReceiptJob(pool, release, job, rpc);
        row.receipts.push(outcome);
        bounded.check();
        if (!["stored", "orphaned"].includes(outcome)) { successful = false; break; }
      }
      if (!successful) break;
    }
    return { executed: true, successful, task: config.task, workerIterationOnly: config.task === "worker", results, requests: bounded.state, before, after: await snapshot(), writes: true,
      receiptValidationPerformed: results.some((row) => row.receipts.includes("stored")),
      coverageClaim: "Receipt-only validation does not establish source readiness; bounded receipt batch is not complete receipt history." };
  } catch {
    return { executed: mode === "apply", successful: false, failed: true, operationalWritesMayHaveOccurred: mode === "apply",
      requests: bounded?.state ?? { rpcCalls: 0, preflights: 0 }, results, before, code: "restricted_support_probe_failed" };
  } finally {
    globalThis.fetch = fetchImpl;
    await pool.end();
  }
}

if (process.argv[1] === "-" && process.argv[2] === "yunipals-support-probe-v2") {
  try {
    const config = JSON.parse(process.argv[4]);
    const result = await runProbe(process.argv[3], config);
    console.log(JSON.stringify(result));
    if (result.executed && result.successful !== true) process.exitCode = 2;
  } catch {
    console.log(JSON.stringify({ executed: process.argv[3] === "apply", failed: true, operationalWritesMayHaveOccurred: process.argv[3] === "apply", code: "restricted_support_probe_failed" }));
    process.exitCode = 1;
  }
}

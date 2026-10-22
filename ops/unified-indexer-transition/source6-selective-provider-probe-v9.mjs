import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORMAT = "yunipals-source6-selective-provider-proof-v9";
export const BLOCKS = [7579200, 14826444];
export const INDICES = [0, 1, 2, 3];
export const TRANSACTION_INDICES = [1, 2, 3];
export const LIMITS = Object.freeze({ rpcCalls: 16, providerHttpRequests: 10, totalResponseBytes: 33554432,
  perResponseBytes: 10485760, deadlineMs: 60000, perRequestMs: 10000, minimumSpacingMs: 1000,
  maximumConcurrentRequests: 1, identityCheckReserveMs: 5000, redirects: 0, clientRetries: 0 });
export const PINS = Object.freeze({
  previousProofSha256: "2d02f221555e7b3e832e6c8806bb6cd5ab3b2ba66242ccd14c7942a593491923",
  comparisonWorkerSha256: "f7fc646a01f38b12665037a8ee526e305f4ca17be22c457a46806764328c0e24",
  poolProofSha256: "76a31f7fb1af08a939ef451bcf87c4ba63341be91b18a1dc3ef2f5d379600463",
  primaryPoolSha256: "d75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b",
  v5ReceiptSha256: "21f777d59cd3e454e6f5fbfaa1fe1df680958a6786dedcde1484b81f05307e56",
  comparisonsSha256: "f11dd7aa6138da7f582cd26b323b91214ed2a45e19a2c17fa6d33a0957f1905e",
  candidateHelperSha256: "c2892a2e8b6237cef969a7e70f7d029a08746b8afdb128120a0ca430efbb14aa",
  historicalManifestSha256: "7138a40ec0e1c907eca212523344e79258aeb421bf2dbaa3101db4d0e95ea4ea",
  ponderActionsSha256: "a34e95a4d965d9156b9a5ab7106ec795083981e8efab20502830bbd47b16c70a",
  ponderEncodersSha256: "29b811adcbd3c54142e1f68fa699ab654d89332cc3f936acaef6efe46912584e"
});
const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const WORKSPACE = "/var/lib/yunipals-unified-shadow/20261020-008028af-a";
const ACTIONS = WORKSPACE + "/node_modules/.pnpm/ponder@0.17.5_patch_hash=srrmuiqb5i2rcvch3r4b6lqznm_@opentelemetry+api@1.9.1_@types+node@22.1_tdbbixbrmtn4q2y4g3krukmyfy/node_modules/ponder/dist/esm/rpc/actions.js";
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export const canonical = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? { __bigint: item.toString() } : item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
const fail = (code) => { throw new Error(code); };
const monotonic = () => Number(process.hrtime.bigint()) / 1e6;
function pinned(path, expected) {
  for (let item = path; item !== "/"; item = dirname(item)) {
    const info = lstatSync(item);
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022)) fail("protected_input_required");
  }
  if (lstatSync(path).size > 3_000_000) fail("bounded_input_required");
  const raw = readFileSync(path);
  if (raw.length > 3_000_000 || sha(raw) !== expected) fail("exact_input_pin_required");
  return raw;
}
export function validatePrivateInput(input) {
  if (!input || !same(Object.keys(input).sort(), ["deadlineMonotonicMs", "primaryPoolSha256", "selected", "startedMonotonicMs"].sort()) ||
    input.primaryPoolSha256 !== PINS.primaryPoolSha256 || !Number.isFinite(input.deadlineMonotonicMs) ||
    !Number.isFinite(input.startedMonotonicMs) || input.deadlineMonotonicMs - input.startedMonotonicMs !== LIMITS.deadlineMs ||
    !Array.isArray(input.selected) || !same(input.selected.map((row) => row.primaryIndex), INDICES)) fail("fixed_private_input_shape");
  for (const row of input.selected) {
    if (!same(Object.keys(row).sort(), ["primaryIndex", "url", "urlSha256"].sort())) fail("private_endpoint_shape");
    const url = new URL(row.url);
    if (url.href !== row.url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      sha(url.href) !== row.urlSha256) fail("exact_https_free_endpoint_required");
  }

}
export function validateEnvelope(value, request) {
  const batch = Array.isArray(request), calls = batch ? request : [request], rows = batch ? value : [value];
  if (Array.isArray(value) !== batch || !Array.isArray(rows) || rows.length !== calls.length ||
    new Set(rows.map((row) => row?.id)).size !== calls.length) fail("rpc_response_shape");
  return calls.map((call) => {
    const row = rows.find((item) => item?.id === call.id);
    if (!row || row.jsonrpc !== "2.0" || Object.hasOwn(row, "error") || !Object.hasOwn(row, "result")) fail("rpc_response_error");
    return row.result;
  });
}
export function createTransport(input, { clock = monotonic, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), request = httpsRequest } = {}) {
  validatePrivateInput(input);
  let count = 0, logicalCalls = 0, bytes = 0, lastStart = -Infinity;
  const traces = [];
  return { traces, bytes: () => bytes, elapsed: () => clock() - input.startedMonotonicMs,
    exchange: async (primaryIndex, payload) => {
      const selected = input.selected.find((row) => row.primaryIndex === primaryIndex);
      const calls = Array.isArray(payload) ? payload : [payload];
      if (calls.length + logicalCalls > LIMITS.rpcCalls) fail("logical_request_bound");
      if (!calls.every((call) => call?.jsonrpc === "2.0" && Number.isSafeInteger(call.id) &&
        Array.isArray(call.params) && call.params.length === 2 &&
        BLOCKS.some((number) => call.params[0] === "0x" + number.toString(16))) ||
        (primaryIndex === 0 ? Array.isArray(payload) || payload.method !== "eth_getBlockByNumber" || typeof payload.params[1] !== "boolean" :
          !TRANSACTION_INDICES.includes(primaryIndex) || !Array.isArray(payload) || calls.length !== 2 ||
          calls.some((call) => call.method !== "eth_getTransactionByBlockNumberAndIndex" ||
            !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(call.params[1])) || calls[0].params[0] !== calls[1].params[0] ||
          calls[0].params[1] !== "0x0" || calls[1].params[1] === "0x0")) fail("fixed_rpc_shape_required");
      if (!selected || count >= LIMITS.providerHttpRequests) fail("provider_request_bound");
      if (bytes >= LIMITS.totalResponseBytes) fail("response_byte_bound");
      const delay = Math.max(0, lastStart + LIMITS.minimumSpacingMs - clock());
      if (clock() + delay >= input.deadlineMonotonicMs - LIMITS.identityCheckReserveMs) fail("probe_deadline");
      if (delay) await sleep(delay);
      const started = clock(); lastStart = started;
      if (bytes >= LIMITS.totalResponseBytes) fail("response_byte_bound");
      const remaining = input.deadlineMonotonicMs - started - LIMITS.identityCheckReserveMs;
      if (remaining <= 0) fail("probe_deadline");
      const body = JSON.stringify(payload), trace = { primaryIndex, logicalCalls: Array.isArray(payload) ? payload.length : 1,
        shape: Array.isArray(payload) ? "block_index_pair" : payload.params[1] === false ? "header_singleton" : "full_singleton",
        requestSha256: sha(body), startedAfterMs: started - input.startedMonotonicMs };
      count++; logicalCalls += calls.length; traces.push(trace);
      return await new Promise((resolve, reject) => {
        let settled = false, received = 0, timer;
        const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); trace.elapsedMs = clock() - started; trace.responseBytes = received;
          if (error) { trace.failure = "provider_request_failed"; reject(new Error("provider_request_failed")); } else resolve(value); };
        // Native HTTPS does not follow redirects. No auth/cookie/proxy headers
        // or inherited environment values are forwarded to another endpoint.
        const req = request(new URL(selected.url), { method: "POST", agent: false,
          headers: { "content-type": "application/json", "accept-encoding": "identity", "content-length": Buffer.byteLength(body), connection: "close" } }, (response) => {
          trace.httpStatus = response.statusCode;
          if (response.statusCode !== 200) { response.destroy(); done(true); return; }
          const chunks = [];
          response.on("data", (chunk) => {
            received += chunk.length; bytes += chunk.length;
            if (received > LIMITS.perResponseBytes || bytes > LIMITS.totalResponseBytes) { response.destroy(); req.destroy(); done(true); }
            else chunks.push(chunk);
          });
          response.on("error", () => done(true));
          response.on("end", () => {
            trace.responseBytes = received;
            if (settled) return;
            try {
              const raw = Buffer.concat(chunks); trace.responseSha256 = sha(raw);
              const value = JSON.parse(raw), rows = Array.isArray(value) ? value : [value];
              const errors = rows.filter((row) => row && Object.hasOwn(row, "error"));
              if (errors.length) trace.rpcErrorCodes = errors.map((row) => Number.isInteger(row.error?.code) &&
                row.error.code >= -32768 && row.error.code <= -32000 ? row.error.code : "unlisted");
              done(false, validateEnvelope(value, payload));
            }
            catch { done(true); }
          });
        });
        timer = setTimeout(() => { req.destroy(); done(true); }, Math.min(LIMITS.perRequestMs, remaining));
        req.on("error", () => done(true)); req.end(body);
      });
    }
  };
}

export async function probe({ transport, discoveries, deps, selected }) {
  const result = { format: FORMAT, chainId: 56, ...PINS, blocks: BLOCKS, primaryIndices: INDICES,
    transactionPrimaryIndices: TRANSACTION_INDICES, baselinePrimaryIndex: 0, limits: LIMITS,
    proposedRouteExecuted: false, proposedSplitRouteExecuted: false, proposedHelperExecuted: false,
    helperExecution: "offline_replay_of_actual_responses", helperNetworkRequests: 0,
    endpointAttribution: "direct_existing_free_primary_index_and_url_hash",
    transactionRequestsSameHttpBatch: true, headerBeforeTransactionBatch: true, fullBlockSeparateRequest: true,
    transportShape: "provider0_full_and_header_singletons_then_other_provider_first_last_index_batches",
    transactionSelection: "first_and_last_distinct_transaction_bound_to_provider0_full_and_header",
    lookupMethod: "eth_getTransactionByBlockNumberAndIndex",
    qualificationScope: "transaction_lookup_only_two_fixed_blocks_against_provider0_full_and_header",
    headersOnTransactionProvidersTested: false, transactionProvidersQualifiedForHeaders: false,
    configurationChanged: false, rawResponsesExported: false, rawUrlsExported: false, rawPrivateValuesExported: false,
    matchingLogsQueried: false, fullHistoryVerified: false, throughputVerified: false, allFutureResponsesQualified: false,
    qualifiedTransactionPrimaryIndices: [], samples: [], rpcCalls: 0, paidCalls: 0, freeOnly: false,
    diagnosticComplete: false, probeCalls: transport.traces };
  let requestId = 0;
  try {
    if (!same(discoveries.map((d) => d.blockNumber), BLOCKS) || !same(selected.map((s) => s.primaryIndex), INDICES)) fail("fixed_targets_required");
    for (const discovery of discoveries) {
      const blockNumber = discovery.blockNumber, hex = "0x" + blockNumber.toString(16);
      const fullCall = { jsonrpc: "2.0", id: ++requestId, method: "eth_getBlockByNumber", params: [hex, true] };
      const headerCall = { jsonrpc: "2.0", id: ++requestId, method: "eth_getBlockByNumber", params: [hex, false] };
      let full, header, selection;
      try { [full] = await transport.exchange(0, fullCall); } catch { /* Retain a failed baseline, never qualify from it. */ }
      try { [header] = await transport.exchange(0, headerCall); } catch { /* The paired baseline is still bounded. */ }
      try { selection = deps.selectTransactions(full, header, discovery, deps); } catch { /* No transaction calls without bound indices. */ }
      for (const primaryIndex of TRANSACTION_INDICES) {
        const provenance = { primaryIndex, transactionPrimaryIndex: primaryIndex, baselinePrimaryIndex: 0,
          headerPrimaryIndex: 0, fullBlockPrimaryIndex: 0, blockNumber,
          primaryUrlSha256: selected.find((row) => row.primaryIndex === primaryIndex).urlSha256,
          baselinePrimaryUrlSha256: selected[0].urlSha256,
          headerAndFullAttribution: { primaryIndex: 0, reason: "exact_configured_endpoint_direct_request" },
          transactionAttribution: { primaryIndex, reason: "exact_configured_endpoint_direct_request" },
          transactionProviderHeaderQualified: false };
        let sample;
        try {
          if (!selection) fail("baseline_binding_failed");
          const calls = selection.map((row) => ({ jsonrpc: "2.0", id: ++requestId,
            method: "eth_getTransactionByBlockNumberAndIndex", params: [hex, row.index] }));
          const transactions = await transport.exchange(primaryIndex, calls);
          sample = await deps.compareSample(primaryIndex, discovery, [full, header, transactions], selection, deps);
          // v8's old single-provider attribution is replaced by explicit split
          // provenance. Its strict equality and no-fallback checks are unchanged.
          delete sample.attribution;
        } catch { sample = { equivalent: false, failure: "provider_request_or_baseline_binding_failed" }; }
        Object.assign(sample, provenance);
        result.samples.push(sample);
        if (sample.offlineHelperCalls > 0) result.proposedHelperExecuted = true;
      }
    }
    result.diagnosticComplete = true;
    result.endpointQualifications = TRANSACTION_INDICES.map((primaryIndex) => {
      const samples = result.samples.filter((sample) => sample.primaryIndex === primaryIndex);
      return { primaryIndex, transactionLookupQualified: samples.length === 2 && samples.every((sample) => sample.equivalent === true),
        headerQualified: false, passingBlocks: samples.filter((sample) => sample.equivalent).map((sample) => sample.blockNumber) };
    });
    result.qualifiedTransactionPrimaryIndices = result.endpointQualifications.filter((row) => row.transactionLookupQualified).map((row) => row.primaryIndex);
    result.status = result.qualifiedTransactionPrimaryIndices.length ? "qualified_transaction_samples" : "no_qualified_transaction_endpoints";
  } catch { result.status = "refused_or_failed"; result.failure = "bounded_probe_failed"; }
  result.rpcCalls = transport.traces.reduce((sum, row) => sum + row.logicalCalls, 0);
  result.providerHttpRequests = transport.traces.length;
  result.elapsedMs = transport.elapsed(); result.responseBytes = transport.bytes();
  if (result.rpcCalls !== LIMITS.rpcCalls || result.providerHttpRequests !== LIMITS.providerHttpRequests ||
    result.elapsedMs > LIMITS.deadlineMs || result.responseBytes > LIMITS.totalResponseBytes) {
    result.status = "refused_or_failed"; result.failure = "probe_bound_or_incomplete"; result.qualifiedTransactionPrimaryIndices = [];
  }
  return result;
}
async function main() {
  if (process.argv.length !== 2 || process.getuid() !== 0 || hostname() !== "yunipals-main" || process.version !== "v24.18.1" ||
    realpathSync(process.execPath) !== "/opt/node-v24.18.1/bin/node") fail("fixed_worker_host_required");
  let inputRaw = "";
  for await (const chunk of process.stdin) { inputRaw += chunk; if (inputRaw.length > 131072) fail("private_pipe_bound"); }
  const input = JSON.parse(inputRaw); validatePrivateInput(input);
  const pool = JSON.parse(pinned(OPS + "/source6-selective-pool-identity-v1.json", PINS.poolProofSha256));
  if (pool.primaryPoolSha256 !== PINS.primaryPoolSha256 || pool.primaryCount !== 5 ||
    input.selected.some((row) => row.urlSha256 !== pool.primaryUrlSha256[row.primaryIndex])) fail("private_endpoint_membership_pin");
  pinned(OPS + "/source6-selective-provider-proof-v8.json", PINS.previousProofSha256);
  const comparisonPath = OPS + "/source6-selective-provider-probe-v5.mjs", v8Path = OPS + "/source6-selective-provider-probe-v8.mjs";
  pinned(comparisonPath, PINS.comparisonsSha256); pinned(v8Path, PINS.comparisonWorkerSha256);
  const v5 = JSON.parse(pinned(OPS + "/source6-selective-provider-proof-v5.json", PINS.v5ReceiptSha256));
  const helper = OPS + "/source6-selective-historical-v3/yunipals-log-transactions.mjs";
  pinned(helper, PINS.candidateHelperSha256);
  pinned(OPS + "/source6-selective-historical-v3/manifest.json", PINS.historicalManifestSha256);
  pinned(ACTIONS, PINS.ponderActionsSha256); const encoders = join(dirname(ACTIONS), "../sync-store/encode.js"); pinned(encoders, PINS.ponderEncodersSha256);
  const deps = { ...await import(pathToFileURL(comparisonPath)), ...await import(pathToFileURL(v8Path)), ...await import(pathToFileURL(ACTIONS)),
    ...await import(pathToFileURL(encoders)), ...await import(pathToFileURL(helper)) };
  const result = await probe({ transport: createTransport(input), discoveries: v5.discoveries, deps, selected: input.selected });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { console.log(JSON.stringify({ format: FORMAT, status: "refused_or_failed", failure: "fixed_worker_failed" })); process.exitCode = 1; });
}

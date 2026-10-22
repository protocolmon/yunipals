import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORMAT = "yunipals-source6-selective-provider-proof-v8";
export const BLOCKS = [7579200, 14826444];
export const INDICES = [0];
export const LIMITS = Object.freeze({ rpcCalls: 8, providerHttpRequests: 6, totalResponseBytes: 33554432,
  perResponseBytes: 10485760, deadlineMs: 60000, perRequestMs: 10000, minimumSpacingMs: 1000,
  maximumConcurrentRequests: 1, identityCheckReserveMs: 5000, redirects: 0, clientRetries: 0 });
export const PINS = Object.freeze({
  previousProofSha256: "3a7892b7a1f9779c7631baca1cd311bd264cbcf7ee5f30b88d3fc2c6a2db17a1",
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
  let count = 0, bytes = 0, lastStart = -Infinity;
  const traces = [];
  return { traces, bytes: () => bytes, elapsed: () => clock() - input.startedMonotonicMs,
    exchange: async (primaryIndex, payload) => {
      const selected = input.selected.find((row) => row.primaryIndex === primaryIndex);
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
      count++; traces.push(trace);
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
export function prepareFull(raw, blockNumber, deps) {
  if (!raw || raw.number !== "0x" + blockNumber.toString(16) || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash) ||
    !Array.isArray(raw.transactions) || !raw.transactions.length) fail("historical_full_block_shape");
  const request = { method: "eth_getBlockByNumber", params: [raw.number, true] };
  const block = deps.standardizeBlock(structuredClone(raw), request); deps.validateTransactionsAndBlock(block, request);
  return { raw, block, encoded: deps.encodeBlock({ block, chainId: 56 }),
    transactionsEncoded: block.transactions.map((transaction) => deps.encodeTransaction({ transaction, chainId: 56 })) };
}
export function selectTransactions(raw, header, discovery, deps) {
  const full = prepareFull(raw, discovery.blockNumber, deps);
  if (!header || header.number !== raw.number || header.hash !== raw.hash ||
    !Array.isArray(header.transactions) || header.transactions.length !== raw.transactions.length ||
    header.transactions.length < 2 || header.transactions[0] === header.transactions.at(-1)) fail("matching_full_header_required");
  const positions = [0, header.transactions.length - 1];
  return positions.map((position) => {
    const transaction = raw.transactions[position], index = "0x" + position.toString(16);
    if (!transaction || transaction.transactionIndex !== index || header.transactions[position] !== transaction.hash ||
      !/^0x[0-9a-fA-F]{64}$/.test(transaction.hash) || (position === 0 && transaction.hash !== discovery.selectedTransactionHash))
      fail("fixed_first_and_last_transaction_binding_required");
    return { hash: transaction.hash, index, position };
  });
}

export async function compareSample(primaryIndex, discovery, values, selectedTransactions, deps) {
  const { fieldDifferences, standardTransaction } = deps;
  const sample = { primaryIndex, blockNumber: discovery.blockNumber, equivalent: false,
    selectedTransactions, selectedTransactionCount: selectedTransactions.length,
    attribution: { attributed: true, primaryIndex, reason: "exact_configured_endpoint_direct_request" },
    offlineFallbackAttempted: false, transactionComparisons: [] };
  let offlineCalls = 0;
  try {
    const [raw, headerRaw, transactionRaws] = values, full = prepareFull(raw, discovery.blockNumber, deps);
    if (!same(selectTransactions(raw, headerRaw, discovery, deps), selectedTransactions) ||
      !Array.isArray(transactionRaws) || transactionRaws.length !== 2) fail("exact_first_last_response_binding_required");
    const expectedHeader = { ...raw, transactions: raw.transactions.map((tx) => tx.hash) };
    const request = { method: "eth_getBlockByNumber", params: [raw.number, true] };
    const header = deps.standardizeBlock({ ...structuredClone(headerRaw), transactions: structuredClone(full.block.transactions) }, request);
    deps.validateTransactionsAndBlock(header, request);
    const encodedHeader = deps.encodeBlock({ block: header, chainId: 56 });
    Object.assign(sample, { blockHash: raw.hash, headerEquivalent: same(headerRaw, expectedHeader),
      headerDifferences: fieldDifferences(headerRaw, expectedHeader), standardizedBlockEquivalent: same(header, full.block),
      encodedBlockEquivalent: same(encodedHeader, full.encoded), encodedBlockDifferences: fieldDifferences(encodedHeader, full.encoded),
      fullEncodedSha256: sha(canonical(full.encoded)), headerEncodedSha256: sha(canonical(encodedHeader)),
      fullTransactionsEncodedSha256: sha(canonical(full.transactionsEncoded)),
      discoveryBlockEquivalent: sha(canonical(full.encoded)) === discovery.encodedBlockSha256 && raw.hash === discovery.blockHash,
      discoveryTransactionsEquivalent: sha(canonical(full.transactionsEncoded)) === discovery.transactionsEncodedSha256 });
    for (let i = 0; i < selectedTransactions.length; i++) {
      const selected = selectedTransactions[i], txRaw = transactionRaws[i];
      const stockRaw = raw.transactions[selected.position], stock = full.block.transactions[selected.position];
      const object = txRaw !== null && typeof txRaw === "object" && !Array.isArray(txRaw);
      const row = { requestedHash: selected.hash, requestedIndex: selected.index,
        isNull: txRaw === null, isObject: object,
        hashMatchesRequested: object && txRaw.hash === selected.hash,
        indexMatchesRequested: object && txRaw.transactionIndex === selected.index,
        blockHashMatchesHeader: object && txRaw.blockHash === headerRaw.hash,
        blockNumberMatchesHeader: object && txRaw.blockNumber === headerRaw.number,
        rawEquivalent: same(txRaw, stockRaw), rawDifferences: fieldDifferences(txRaw, stockRaw),
        standardFieldsEquivalent: object && same(standardTransaction(txRaw), standardTransaction(stockRaw)),
        standardFieldsDifferences: fieldDifferences(object ? standardTransaction(txRaw) : {}, standardTransaction(stockRaw)),
        actualSha256: sha(canonical(txRaw)), expectedSha256: sha(canonical(stockRaw)),
        encodedEquivalent: false, normalizationOutcome: "not_attempted" };
      try {
        const block = deps.standardizeBlock({ ...structuredClone(headerRaw), transactions: [structuredClone(txRaw)] }, request);
        deps.validateTransactionsAndBlock(block, request);
        const actual = deps.encodeTransaction({ transaction: block.transactions[0], chainId: 56 });
        const expected = deps.encodeTransaction({ transaction: stock, chainId: 56 });
        Object.assign(row, { normalizationOutcome: "passed", encodedEquivalent: same(actual, expected),
          encodedDifferences: fieldDifferences(actual, expected), actualEncodedSha256: sha(canonical(actual)),
          expectedEncodedSha256: sha(canonical(expected)) });
      } catch { row.normalizationOutcome = "failed"; }
      sample.transactionComparisons.push(row);
    }
    const seen = new Set();
    const sparse = await deps.fetchHistoricalLogBlock({ blockNumber: discovery.blockNumber,
      transactionHashes: selectedTransactions.map((row) => row.hash),
      standardizeBlock: deps.standardizeBlock, validateTransactionsAndBlock: deps.validateTransactionsAndBlock,
      rpc: { request: async (call) => {
        offlineCalls++;
        if (offlineCalls === 1 && call.method === "eth_getBlockByNumber" && same(call.params, [raw.number, false]))
          return structuredClone(headerRaw);
        const position = selectedTransactions.findIndex((row) => same(call.params, [raw.number, row.index]));
        if (offlineCalls > 1 && call.method === "eth_getTransactionByBlockNumberAndIndex" && position >= 0 && !seen.has(position)) {
          seen.add(position); return structuredClone(transactionRaws[position]);
        }
        sample.offlineFallbackAttempted = true;
        fail("offline_fallback_is_not_qualification");
      } } });
    if (offlineCalls !== 3 || seen.size !== 2 || sparse.transactions.length !== 2) fail("sparse_helper_call_shape");
    sample.helperEncodedBlockEquivalent = same(deps.encodeBlock({ block: sparse, chainId: 56 }), full.encoded);
    sample.helperEncodedTransactionsEquivalent = same(
      sparse.transactions.map((transaction) => deps.encodeTransaction({ transaction, chainId: 56 })),
      selectedTransactions.map((row) => full.transactionsEncoded[row.position]));
    sample.candidateHelperOutcome = "passed";
    sample.equivalent = sample.headerEquivalent && sample.standardizedBlockEquivalent && sample.encodedBlockEquivalent &&
      sample.discoveryBlockEquivalent && sample.discoveryTransactionsEquivalent && sample.helperEncodedBlockEquivalent &&
      sample.helperEncodedTransactionsEquivalent && sample.transactionComparisons.every((row) => row.rawEquivalent &&
        row.standardFieldsEquivalent && row.encodedEquivalent && row.hashMatchesRequested && row.indexMatchesRequested &&
        row.blockHashMatchesHeader && row.blockNumberMatchesHeader);
  } catch { sample.candidateHelperOutcome = "failed"; sample.failure = "strict_sample_validation_failed"; }
  sample.offlineHelperCalls = offlineCalls;
  return sample;
}

export async function probe({ transport, discoveries, deps, selected }) {
  const result = { format: FORMAT, chainId: 56, ...PINS, blocks: BLOCKS, primaryIndices: INDICES, limits: LIMITS,
    proposedRouteExecuted: false, candidateProxySelected: false, proposedHelperExecuted: false,
    helperExecution: "offline_replay_of_actual_responses", helperNetworkRequests: 0,
    endpointAttribution: "direct_existing_free_primary_index_and_url_hash", transactionRequestsSameHttpBatch: true,
    headerBeforeTransactionBatch: true, fullBlockSeparateRequest: true,
    transportShape: "full_singleton_then_header_singleton_then_first_last_block_index_batch",
    transactionSelection: "first_and_last_distinct_transaction_bound_to_full_and_header",
    lookupMethod: "eth_getTransactionByBlockNumberAndIndex",
    configurationChanged: false, rawResponsesExported: false, rawUrlsExported: false, rawPrivateValuesExported: false,
    matchingLogsQueried: false, fullHistoryVerified: false, throughputVerified: false, allFutureResponsesQualified: false,
    qualificationScope: "two_fixed_historical_blocks_first_last_block_index_lookup",
    qualifiedPrimaryIndices: [], samples: [], rpcCalls: 0, paidCalls: 0, freeOnly: false,
    diagnosticComplete: false, probeCalls: transport.traces };
  let requestId = 0;
  try {
    if (!same(discoveries.map((d) => d.blockNumber), BLOCKS) || !same(selected.map((s) => s.primaryIndex), INDICES)) fail("fixed_targets_required");
    for (const { primaryIndex, urlSha256 } of selected) for (const discovery of discoveries) {
      const blockNumber = discovery.blockNumber, hex = "0x" + blockNumber.toString(16);
      const fullCall = { jsonrpc: "2.0", id: ++requestId, method: "eth_getBlockByNumber", params: [hex, true] };
      const headerCall = { jsonrpc: "2.0", id: ++requestId, method: "eth_getBlockByNumber", params: [hex, false] };
      let full, header, transactions, selection, failure = false;
      try { [full] = await transport.exchange(primaryIndex, fullCall); } catch { failure = true; }
      try { [header] = await transport.exchange(primaryIndex, headerCall); } catch { failure = true; }
      try {
        selection = selectTransactions(full, header, discovery, deps);
        const calls = selection.map((row) => ({ jsonrpc: "2.0", id: ++requestId,
          method: "eth_getTransactionByBlockNumberAndIndex", params: [hex, row.index] }));
        transactions = await transport.exchange(primaryIndex, calls);
      } catch { failure = true; }
      const sample = failure ? { primaryIndex, blockNumber, equivalent: false, failure: "provider_request_or_binding_failed" } :
        await compareSample(primaryIndex, discovery, [full, header, transactions], selection, deps);
      sample.primaryUrlSha256 = urlSha256; result.samples.push(sample);
      if (sample.offlineHelperCalls > 0) result.proposedHelperExecuted = true;
    }
    result.diagnosticComplete = true;
    result.endpointQualifications = INDICES.map((primaryIndex) => {
      const samples = result.samples.filter((sample) => sample.primaryIndex === primaryIndex);
      return { primaryIndex, qualified: samples.length === 2 && samples.every((sample) => sample.equivalent === true),
        passingBlocks: samples.filter((sample) => sample.equivalent).map((sample) => sample.blockNumber) };
    });
    result.qualifiedPrimaryIndices = result.endpointQualifications.filter((row) => row.qualified).map((row) => row.primaryIndex);
    result.status = result.qualifiedPrimaryIndices.length ? "qualified_samples" : "no_qualified_endpoints";
  } catch { result.status = "refused_or_failed"; result.failure = "bounded_probe_failed"; }
  result.rpcCalls = transport.traces.reduce((sum, row) => sum + row.logicalCalls, 0);
  result.providerHttpRequests = transport.traces.length;
  result.elapsedMs = transport.elapsed(); result.responseBytes = transport.bytes();
  if (result.rpcCalls !== LIMITS.rpcCalls || result.providerHttpRequests !== LIMITS.providerHttpRequests ||
    result.elapsedMs > LIMITS.deadlineMs || result.responseBytes > LIMITS.totalResponseBytes) {
    result.status = "refused_or_failed"; result.failure = "probe_bound_exceeded"; result.qualifiedPrimaryIndices = [];
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
  pinned(OPS + "/source6-selective-provider-proof-v7.json", PINS.previousProofSha256);
  const comparisonPath = OPS + "/source6-selective-provider-probe-v5.mjs";
  pinned(comparisonPath, PINS.comparisonsSha256);
  const v5 = JSON.parse(pinned(OPS + "/source6-selective-provider-proof-v5.json", PINS.v5ReceiptSha256));
  const helper = OPS + "/source6-selective-historical-v3/yunipals-log-transactions.mjs";
  pinned(helper, PINS.candidateHelperSha256);
  pinned(OPS + "/source6-selective-historical-v3/manifest.json", PINS.historicalManifestSha256);
  pinned(ACTIONS, PINS.ponderActionsSha256); const encoders = join(dirname(ACTIONS), "../sync-store/encode.js"); pinned(encoders, PINS.ponderEncodersSha256);
  const deps = { ...await import(pathToFileURL(comparisonPath)), ...await import(pathToFileURL(ACTIONS)),
    ...await import(pathToFileURL(encoders)), ...await import(pathToFileURL(helper)) };
  const result = await probe({ transport: createTransport(input), discoveries: v5.discoveries, deps, selected: input.selected });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { console.log(JSON.stringify({ format: FORMAT, status: "refused_or_failed", failure: "fixed_worker_failed" })); process.exitCode = 1; });
}

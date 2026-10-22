import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Prepare/review locally. --run is an explicit, bounded production read; it
// never starts services, renews permits, writes a database, or changes routing.
const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const BASE = "/var/backups/yunipals-source6-post-renewal-ordinary-v3-20261021";
const WORKSPACE = "/var/lib/yunipals-unified-shadow/20261020-008028af-a";
const RELEASE = "/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6";
const NODE = "/opt/node-v24.18.1/bin/node";
const SOURCE_UNIT = "yunipals-unified-source6-free-v2.service";
const PROXY_UNIT = "yunipals-market-production-rpc@bnb.service";
const OLD_PROXY = OPS + "/source6-queued-source-proxy-v1/rpc-budget-proxy.mjs";
const HISTORICAL = OPS + "/source6-selective-historical-v1";
const ACTIONS = WORKSPACE + "/node_modules/.pnpm/ponder@0.17.5_patch_hash=srrmuiqb5i2rcvch3r4b6lqznm_@opentelemetry+api@1.9.1_@types+node@22.1_tdbbixbrmtn4q2y4g3krukmyfy/node_modules/ponder/dist/esm/rpc/actions.js";
const ENCODERS = join(dirname(ACTIONS), "../sync-store/encode.js");
const OUTPUT = OPS + "/source6-selective-provider-proof-v3.json";
const PROFILE = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
export const FORMAT = "yunipals-source6-selective-provider-proof-v3";
export const BLOCKS = [7_579_200, 14_826_444];
export const LIMITS = Object.freeze({ rpcCalls: 7, httpRequests: 7,
  totalResponseBytes: 32 * 1024 * 1024, perResponseBytes: 10 * 1024 * 1024,
  deadlineMs: 60_000, rpcDeadlineMs: 54_000, perRequestMs: 15_000,
  redirects: 0, clientRetries: 0, maximumConcurrentRequests: 1 });
export const PINS = Object.freeze({
  parentReceiptSha256: "1e596858c1227c0dd77d3c029e3c546157bf6e461aac5b2c00edd4d129dae7b1",
  normalProxyBaselineSha256: "5c9de2fe5b293d687ad56f6d3ab82b96a1af52c2ae4512946cd8b4790645ce97",
  sourceInvocation: "ae02afb70f0e443d81f8facff98cf6d1",
  testedProxyEntrySha256: "1fda46cc5f7c12b853664dbc0078c0e54b0aa26ecfc2304b8efb68b4cb588d41",
  candidateProxyEntrySha256: "362bea8717f63806e1e8ea6036e998443f1bb914e80c609600f224b24c457890",
  candidateProxyReceiptSha256: "d22e71920471f9ce3342d7b07c468af046dbb52b206184a0e43f50cf63664d1b",
  historicalManifestSha256: "78b4c2a47902d8b690174a3d401c2de494dbe96e9f42fec1f019f988c67de64e",
  candidateHelperSha256: "a2ad689c8c470cf2f0c1cbc7768b005676e738c6db86c8eca0d01270da4636c3",
  ponderActionsSha256: "a34e95a4d965d9156b9a5ab7106ec795083981e8efab20502830bbd47b16c70a",
  ponderEncodersSha256: "29b811adcbd3c54142e1f68fa699ab654d89332cc3f936acaef6efe46912584e"
});
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const canonical = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? { __bigint: item.toString() } : item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const fail = (code) => { throw new Error(code); };
const same = (a, b) => canonical(a) === canonical(b);
const isHash = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const allowedFields = new Set([
  "accessList", "authorizationList", "baseFeePerGas", "blobGasUsed", "blobVersionedHashes",
  "blockHash", "blockNumber", "chainId", "depositNonce", "depositReceiptVersion", "difficulty",
  "excessBlobGas", "extraData", "from", "gas", "gasLimit", "gasPrice", "gasUsed", "hash", "input",
  "isSystemTx", "logsBloom", "maxFeePerBlobGas", "maxFeePerGas", "maxPriorityFeePerGas", "miner",
  "mixHash", "nonce", "number", "parentBeaconBlockRoot", "parentHash", "r", "receiptsRoot",
  "requestsHash", "s", "sha3Uncles", "size", "sourceHash", "stateRoot", "timestamp", "to",
  "totalDifficulty", "transactionIndex", "transactions", "transactionsRoot", "type", "uncles",
  "v", "value", "withdrawals", "withdrawalsHash", "withdrawalsRoot", "yParity"
]);

export function fieldDifferences(actual, expected) {
  const changes = [];
  for (const key of [...new Set([...Object.keys(actual ?? {}), ...Object.keys(expected ?? {})])].sort()) {
    const actualPresent = Object.hasOwn(actual ?? {}, key), expectedPresent = Object.hasOwn(expected ?? {}, key);
    if (actualPresent !== expectedPresent || !same(actual?.[key], expected?.[key])) {
      changes.push({ key, kind: !actualPresent ? "missing" : !expectedPresent ? "extra" : "changed",
        actualPresent, expectedPresent, actual: actual?.[key], expected: expected?.[key] });
    }
  }
  return { count: changes.length,
    missingFields: changes.filter((row) => row.kind === "missing" && allowedFields.has(row.key)).map((row) => row.key),
    extraFields: changes.filter((row) => row.kind === "extra" && allowedFields.has(row.key)).map((row) => row.key),
    changedFields: changes.filter((row) => row.kind === "changed" && allowedFields.has(row.key)).map((row) => row.key),
    unlistedFieldCount: changes.filter((row) => !allowedFields.has(row.key)).length,
    differencesSha256: sha(canonical(changes)) };
}

function protectedFile(path, pin, maximum = 3_000_000) {
  if (!path.startsWith("/") || path.split("/").includes("..")) fail("protected_public_file");
  for (let item = path; item !== "/"; item = dirname(item)) {
    const info = lstatSync(item);
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022)) fail("protected_public_file");
  }
  const before = lstatSync(path);
  if (!before.isFile() || before.size > maximum) fail("bounded_public_file");
  const raw = readFileSync(path), after = lstatSync(path);
  if (!same([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs],
    [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]) || raw.length > maximum ||
    (pin !== undefined && sha(raw) !== pin)) fail("public_file_pin");
  return raw;
}

function bindings() {
  const parent = JSON.parse(protectedFile(BASE + "/runtime.json", PINS.parentReceiptSha256));
  const baseline = JSON.parse(protectedFile(BASE + "/normal-proxies.json", PINS.normalProxyBaselineSha256));
  if (parent.freeOnly !== true || parent.paidAuthority !== false || !same(parent.permitIds, []) ||
    parent.ordinaryRuntime?.invocation !== PINS.sourceInvocation || parent.ordinaryRuntime?.process?.pid !== 46998 ||
    parent.normalProxyBaselineFile !== BASE + "/normal-proxies.json" ||
    parent.normalProxyBaselineSha256 !== PINS.normalProxyBaselineSha256 ||
    baseline.freeOnly !== true || baseline.paidAuthority !== false || !same(baseline.permitIds, []) ||
    !same(parent.proxies, baseline.proxies)) fail("normal3_receipt_binding");
  protectedFile(OLD_PROXY, PINS.testedProxyEntrySha256);
  const manifest = JSON.parse(protectedFile(HISTORICAL + "/manifest.json", PINS.historicalManifestSha256));
  if (manifest.directory !== HISTORICAL || manifest.format !== "yunipals-source6-selective-historical-overlay-v1" ||
    !manifest.files?.some((row) => row.name === "yunipals-log-transactions.mjs" && row.sha256 === PINS.candidateHelperSha256))
    fail("historical_manifest_binding");
  protectedFile(HISTORICAL + "/yunipals-log-transactions.mjs", PINS.candidateHelperSha256);
  protectedFile(ACTIONS, PINS.ponderActionsSha256);
  protectedFile(ENCODERS, PINS.ponderEncodersSha256);
  const candidate = JSON.parse(protectedFile(OPS + "/source6-selective-source-proxy-v1/receipt.json", PINS.candidateProxyReceiptSha256));
  if (candidate.entry !== OPS + "/source6-selective-source-proxy-v1/rpc-budget-proxy.mjs" ||
    candidate.entrySha256 !== PINS.candidateProxyEntrySha256) fail("candidate_proxy_build_binding");
  protectedFile(candidate.entry, PINS.candidateProxyEntrySha256);
  return parent;
}

function identity(parent, remaining) {
  const names = ["Id", "LoadState", "ActiveState", "SubState", "InvocationID", "MainPID",
    "ExecStart", "WorkingDirectory", "User", "Group", "FragmentPath", "DropInPaths"];
  const unit = (name) => {
    const timeout = Math.min(2000, remaining());
    if (timeout <= 0) fail("identity_deadline");
    const text = execFileSync("/usr/bin/systemctl", ["show", name, ...names.map((key) => "--property=" + key)],
      { encoding: "utf8", timeout, maxBuffer: 24_000, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" } });
    const value = Object.fromEntries(text.trim().split("\n").map((line) => {
      const i = line.indexOf("=");
      if (i < 0) fail("unit_shape");
      return [line.slice(0, i), line.slice(i + 1)];
    }));
    if (!same(Object.keys(value).sort(), [...names].sort()) || value.Id !== name || value.LoadState !== "loaded" ||
      value.ActiveState !== "active" || value.SubState !== "running" || !/^[1-9][0-9]*$/.test(value.MainPID)) fail("unit_state");
    return value;
  };
  const source = unit(SOURCE_UNIT), proxy = unit(PROXY_UNIT);
  const sourceArgv = ["/usr/bin/env", "-i", NODE, "--env-file=" + WORKSPACE + "/launch.env",
    "--env-file=" + OPS + "/source6-free-runtime-v2.env", WORKSPACE + "/apps/yunipals-indexer/node_modules/ponder/dist/esm/bin/ponder.js",
    "start", "--schema", "unified_shadow_20261020_7e7375b0", "--hostname", "127.0.0.1", "--port", "9024"].join(" ");
  if (source.InvocationID !== parent.ordinaryRuntime.invocation || Number(source.MainPID) !== parent.ordinaryRuntime.process.pid ||
    source.WorkingDirectory !== WORKSPACE + "/apps/yunipals-indexer" || source.User !== "yunipals_unified_shadow" ||
    source.Group !== "yunipals_unified_shadow" || source.FragmentPath !== "/etc/systemd/system/" + SOURCE_UNIT ||
    source.DropInPaths !== "" || source.ExecStart.match(/argv\[\]=(.*?)\s+;/)?.[1] !== sourceArgv) fail("source_identity");
  protectedFile(source.FragmentPath, parent.ordinaryRuntime.definitionSha256, 50_000);
  const expected = parent.proxies.bnb.metadata;
  if (proxy.InvocationID !== expected.invocation || proxy.WorkingDirectory !== RELEASE + "/apps/yunipals-market-api" ||
    proxy.User !== "yunipals-market-prod-rpc" || proxy.Group !== "yunipals-market-prod-rpc" ||
    proxy.ExecStart.match(/argv\[\]=(.*?)\s+;/)?.[1] !== NODE + " " + OLD_PROXY) fail("proxy_identity");
  const actualDefinitions = [proxy.FragmentPath, ...proxy.DropInPaths.split(" ").filter(Boolean)].sort();
  if (!same(actualDefinitions, Object.keys(expected.definitions).sort())) fail("proxy_definitions");
  for (const path of actualDefinitions) protectedFile(path, expected.definitions[path], 100_000);
  protectedFile(OLD_PROXY, PINS.testedProxyEntrySha256);
  return { sourceInvocation: source.InvocationID, sourcePid: Number(source.MainPID),
    sourceStateSha256: sha(canonical(source)), proxyInvocation: proxy.InvocationID,
    proxyPid: Number(proxy.MainPID), proxyStateSha256: sha(canonical(proxy)) };
}

export function metricsGuard(metrics, configuration) {
  if (metrics.status !== "ready" || metrics.freeRouting !== true || metrics.paidFallbackOnFreeFailure !== false ||
    metrics.sourcePaidFallbackOnFreeFailure !== false || metrics.unified?.profileId !== PROFILE ||
    metrics.unified?.chainId !== 56 || metrics.unified?.sourceRouting !== "free_first") fail("free_source_route_required");
  const actual = Object.fromEntries(Object.keys(configuration).map((key) => [key, metrics[key]]));
  if (!same(actual, configuration)) fail("normal_proxy_configuration_changed");
  const row = metrics.traffic?.workloads?.source;
  if (![row?.paidCalls, row?.freeCalls].every((value) => Number.isSafeInteger(value) && value >= 0)) fail("source_counter_shape");
  return { paidCalls: row.paidCalls, freeCalls: row.freeCalls,
    configurationSha256: sha(canonical(actual)), fallbackDisabled: true };
}

// Does not consult HTTP_PROXY or follow redirects. Only this fixed loopback
// address is reachable. Existing proxy free-endpoint retries are not changed.
export function createExchange(clock = () => performance.now()) {
  const start = clock();
  let bytes = 0, httpCalls = 0;
  const traces = [];
  return {
    traces, elapsed: () => Math.ceil(clock() - start), bytes: () => bytes,
    async exchange(body) {
      const remaining = (body ? LIMITS.rpcDeadlineMs : LIMITS.deadlineMs) - (clock() - start);
      if (remaining <= 0 || ++httpCalls > LIMITS.httpRequests || bytes >= LIMITS.totalResponseBytes) fail("probe_budget");
      const row = { method: Array.isArray(body) ? "batch" : "metrics",
        methods: Array.isArray(body) ? body.map((call) => call.method) : undefined,
        logicalCalls: Array.isArray(body) ? body.length : 0,
        requestSha256: sha(canonical(body ?? { method: "GET", path: "/metrics" })) };
      traces.push(row);
      const began = clock();
      try {
        return await new Promise((resolve, reject) => {
          const request = httpRequest({ hostname: "127.0.0.1", port: 19204, path: body ? "/" : "/metrics",
            method: body ? "POST" : "GET", agent: false,
            headers: { "content-type": "application/json", "accept-encoding": "identity", connection: "close" } }, (response) => {
            row.httpStatus = response.statusCode;
            const chunks = []; let size = 0;
            response.on("data", (chunk) => {
              size += chunk.length; bytes += chunk.length;
              if (bytes > LIMITS.totalResponseBytes || size > LIMITS.perResponseBytes) {
                request.destroy(new Error("response_budget")); response.destroy(); return;
              }
              chunks.push(chunk);
            });
            response.on("error", () => reject(new Error("response_read_failure")));
            response.on("end", () => {
              const raw = Buffer.concat(chunks);
              row.responseBytes = size; row.responseSha256 = sha(raw);
              if (response.statusCode !== 200) { reject(new Error("http_status")); return; }
              try {
                const result = JSON.parse(raw);
                if (body) {
                  if (!Array.isArray(body) || !Array.isArray(result) || result.length !== body.length ||
                    new Set(result.map((item) => item.id)).size !== body.length) fail("rpc_response_shape");
                  const ordered = body.map((call) => {
                    const item = result.find((row) => row.id === call.id);
                    if (!item || item.jsonrpc !== "2.0" || !Object.hasOwn(item, "result") || Object.hasOwn(item, "error"))
                      fail("rpc_response_shape");
                    return item.result;
                  });
                  resolve(ordered);
                } else resolve(result);
              } catch { reject(new Error("rpc_or_json_response_invalid")); }
            });
          });
          const timer = setTimeout(() => request.destroy(new Error("request_deadline")), Math.min(LIMITS.perRequestMs, remaining));
          request.on("error", () => reject(new Error("request_failed")));
          request.on("close", () => clearTimeout(timer));
          request.end(body === undefined ? undefined : JSON.stringify(body));
        });
      } finally { row.elapsedMs = Math.ceil(clock() - began); }
    }
  };
}

export function endpointObservation(metrics) {
  const preferredSourceIndex = metrics.preferredFreeEndpoints?.source;
  const primary = metrics.freeEndpoints?.primary;
  if (!Number.isSafeInteger(preferredSourceIndex) || preferredSourceIndex < 0 || !Array.isArray(primary) ||
    primary.length > 32 || primary.some((row) => ![row.index, row.successes, row.failures].every((n) => Number.isSafeInteger(n) && n >= 0)))
    fail("endpoint_observation_shape");
  return { preferredSourceIndex, primary: primary.map(({ index, successes, failures }) => ({ index, successes, failures })) };
}

function publicSize(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fail("public_block_size_shape");
  return { hex: value, decimal: Number(BigInt(value)) };
}

export async function probe({ transport, readIdentity, configuration, fetchHistoricalLogBlock,
  standardizeBlock, validateTransactionsAndBlock, isFreeRpcCall, encodeBlock, encodeTransaction }) {
  const result = { format: FORMAT, chainId: 56, ...PINS, blocks: BLOCKS, limits: LIMITS,
    candidateProxySelected: false, configurationChanged: false, rawResponsesExported: false,
    matchingLogsQueried: false, fullHistoryVerified: false, throughputVerified: false,
    freeOnly: false, headerAndTransactionEquivalent: false, diagnosticComplete: false,
    sameUpstreamHttpBatch: true, upstreamBackendIdentityProved: false,
    endpointAttribution: "aggregate_observation_only", pairs: [], endpointObservations: [], probeCalls: transport.traces };
  let rpcCalls = 0, before, first, last, proofError;
  let stage = "identity_before";
  const batch = async (calls) => {
    if (!Array.isArray(calls) || ![2, 3].includes(calls.length)) fail("fixed_batch_shape");
    for (const call of calls) {
      if (!((call.method === "eth_getBlockByNumber" && Array.isArray(call.params) && call.params.length === 2 &&
        BLOCKS.map((n) => "0x" + n.toString(16)).includes(call.params[0]) && typeof call.params[1] === "boolean") ||
        (call.method === "eth_getTransactionByHash" && Array.isArray(call.params) && call.params.length === 1 && isHash(call.params[0]))))
        fail("free_method_allowlist");
      if (isFreeRpcCall(call, undefined) !== true) fail("installed_proxy_free_admission");
    }
    if (rpcCalls + calls.length > LIMITS.rpcCalls) fail("rpc_call_limit");
    const request = calls.map((call) => ({ jsonrpc: "2.0", id: ++rpcCalls, ...call }));
    const response = await transport.exchange(request);
    if (!Array.isArray(response) || response.length !== calls.length) fail("batch_response_shape");
    return response;
  };
  async function observe() {
    const metrics = await transport.exchange();
    last = metricsGuard(metrics, configuration);
    if (first && (last.paidCalls !== first.paidCalls || last.freeCalls < first.freeCalls + rpcCalls)) fail("source_counter_changed");
    result.endpointObservations.push({ afterLogicalCalls: rpcCalls, sourceCounters: last, ...endpointObservation(metrics) });
    return last;
  }
  function comparePair(blockNumber, fullRaw, headerRaw, label) {
    if (!fullRaw || !headerRaw || fullRaw.number !== "0x" + blockNumber.toString(16) || headerRaw.number !== fullRaw.number ||
      !Array.isArray(fullRaw.transactions) || !fullRaw.transactions.length || !Array.isArray(headerRaw.transactions)) fail("historical_pair_shape");
    const request = { method: "eth_getBlockByNumber", params: [fullRaw.number, true] };
    const full = standardizeBlock(structuredClone(fullRaw), request);
    validateTransactionsAndBlock(full, request);
    const expectedHeader = { ...fullRaw, transactions: fullRaw.transactions.map((tx) => tx.hash) };
    assert.deepEqual(headerRaw.transactions, expectedHeader.transactions);
    const header = standardizeBlock({ ...structuredClone(headerRaw), transactions: structuredClone(full.transactions) }, request);
    validateTransactionsAndBlock(header, request);
    const fullEncoded = encodeBlock({ block: full, chainId: 56 });
    const headerEncoded = encodeBlock({ block: header, chainId: 56 });
    const pair = { label, blockNumber, blockHash: fullRaw.hash, headerBlockHash: headerRaw.hash,
      fullSize: publicSize(fullRaw.size), headerSize: publicSize(headerRaw.size),
      fullTransactionCount: fullRaw.transactions.length, headerTransactionCount: headerRaw.transactions.length,
      headerEquivalent: same(headerRaw, expectedHeader), standardizedEquivalent: same(header, full),
      encodedBlockEquivalent: same(headerEncoded, fullEncoded),
      headerDifferences: fieldDifferences(headerRaw, expectedHeader),
      encodedBlockDifferences: fieldDifferences(headerEncoded, fullEncoded),
      fullBlockSha256: sha(canonical(fullRaw)), headerSha256: sha(canonical(headerRaw)),
      fullEncodedSha256: sha(canonical(fullEncoded)), headerEncodedSha256: sha(canonical(headerEncoded)) };
    result.pairs.push(pair);
    return { fullRaw, headerRaw, full, fullEncoded, pair };
  }
  const pairRequests = (n) => [true, false].map((full) => ({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), full] }));
  try {
    before = readIdentity(() => LIMITS.deadlineMs - transport.elapsed()); result.identity = before;
    stage = "metrics_before";
    first = await observe(); result.sourceCountersBefore = first;
    stage = "first_pair_batch";
    const firstValues = await batch(pairRequests(BLOCKS[0]));
    const original = comparePair(BLOCKS[0], firstValues[0], firstValues[1], "first");
    stage = "metrics_after_first_pair";
    await observe();
    const selectedHash = original.fullRaw.transactions[0].hash;
    if (!isHash(selectedHash)) fail("selected_transaction_hash");
    stage = "repeat_pair_and_transaction_batch";
    const secondValues = await batch([...pairRequests(BLOCKS[0]), { method: "eth_getTransactionByHash", params: [selectedHash] }]);
    const repeated = comparePair(BLOCKS[0], secondValues[0], secondValues[1], "repeat");
    result.repeatedFull = { equivalent: same(repeated.fullRaw, original.fullRaw),
      differences: fieldDifferences(repeated.fullRaw, original.fullRaw),
      firstSize: original.pair.fullSize, repeatedSize: repeated.pair.fullSize };
    result.repeatedHeader = { equivalent: same(repeated.headerRaw, original.headerRaw),
      differences: fieldDifferences(repeated.headerRaw, original.headerRaw),
      firstSize: original.pair.headerSize, repeatedSize: repeated.pair.headerSize };
    stage = "candidate_helper_offline";
    result.candidateHelperOutcome = "running";
    let offlineCalls = 0;
    const sparse = await fetchHistoricalLogBlock({ blockNumber: BLOCKS[0], transactionHashes: [selectedHash],
      standardizeBlock, validateTransactionsAndBlock, rpc: { request: async (call) => {
        offlineCalls++;
        if (call.method === "eth_getBlockByNumber" && same(call.params, ["0x" + BLOCKS[0].toString(16), false])) return structuredClone(secondValues[1]);
        if (call.method === "eth_getTransactionByHash" && same(call.params, [selectedHash])) return structuredClone(secondValues[2]);
        fail("offline_candidate_request_shape");
      } } });
    if (offlineCalls !== 2) fail("offline_candidate_request_count");
    result.candidateHelperOutcome = "passed";
    const expectedTransaction = repeated.fullRaw.transactions.find((tx) => tx.hash === selectedHash);
    if (!expectedTransaction) fail("selected_transaction_missing");
    const candidateTransaction = encodeTransaction({ transaction: sparse.transactions[0], chainId: 56 });
    const stockTransaction = encodeTransaction({ transaction: repeated.full.transactions.find((tx) => tx.hash === selectedHash), chainId: 56 });
    result.transaction = { equivalent: same(secondValues[2], expectedTransaction),
      differences: fieldDifferences(secondValues[2], expectedTransaction),
      encodedEquivalent: same(candidateTransaction, stockTransaction),
      encodedDifferences: fieldDifferences(candidateTransaction, stockTransaction),
      actualSha256: sha(canonical(secondValues[2])), expectedSha256: sha(canonical(expectedTransaction)),
      candidateEncodedSha256: sha(canonical(candidateTransaction)), stockEncodedSha256: sha(canonical(stockTransaction)) };
    stage = "metrics_after_repeat_pair";
    await observe();
    stage = "second_block_pair_batch";
    const thirdValues = await batch(pairRequests(BLOCKS[1]));
    comparePair(BLOCKS[1], thirdValues[0], thirdValues[1], "second_block");
    result.diagnosticComplete = true;
    // Continue all three diagnostic batches before evaluating equality. These
    // remain strict failures; a different stored size is never ignored/faked.
    stage = "strict_equality";
    if (!result.pairs.every((pair) => pair.headerEquivalent && pair.standardizedEquivalent && pair.encodedBlockEquivalent) ||
      !result.repeatedFull.equivalent || !result.repeatedHeader.equivalent || !result.transaction.equivalent || !result.transaction.encodedEquivalent)
      fail("strict_equality_mismatch");
  } catch (error) {
    proofError = "historical_capability_or_identity_check_failed";
    result.failedStage = stage;
    if (result.candidateHelperOutcome === "running") result.candidateHelperOutcome = "failed";
    result.errorClass = ["AssertionError", "Error", "TypeError", "RangeError", "RpcProviderError"].includes(error?.name) ? error.name : "other";
    result.errorSha256 = sha(String(error?.message ?? ""));
  }
  try {
    await observe();
    const after = readIdentity(() => LIMITS.deadlineMs - transport.elapsed());
    result.sourceCountersAfter = last;
    result.sourceIdentityUnchanged = before?.sourceStateSha256 === after.sourceStateSha256;
    result.proxyIdentityUnchanged = before?.proxyStateSha256 === after.proxyStateSha256;
    result.sourcePaidCallsUnchanged = first?.paidCalls === last.paidCalls;
    result.fallbackDisabledBeforeAndAfter = first?.fallbackDisabled === true && last.fallbackDisabled;
    result.sourceFreeCallsObserved = first !== undefined && last.freeCalls >= first.freeCalls + rpcCalls;
    if (!result.sourceIdentityUnchanged || !result.proxyIdentityUnchanged || !result.sourcePaidCallsUnchanged ||
      !result.fallbackDisabledBeforeAndAfter || !result.sourceFreeCallsObserved) proofError = "postcheck_failed";
  } catch { proofError = "postcheck_failed"; }
  result.rpcCalls = rpcCalls;
  result.responseBytes = transport.bytes();
  result.elapsedMs = transport.elapsed();
  if (result.elapsedMs > LIMITS.deadlineMs || result.responseBytes > LIMITS.totalResponseBytes ||
    result.pairs.length !== 3 || rpcCalls !== LIMITS.rpcCalls) proofError ??= "incomplete_or_exceeded_bound";
  result.completedAt = new Date().toISOString();
  result.status = proofError ? "refused_or_failed" : "passed";
  if (proofError) result.failure = proofError;
  else { result.headerAndTransactionEquivalent = true; result.freeOnly = true; result.paidCalls = 0; }
  return result;
}

async function main() {
  if (!["--review", "--run"].includes(process.argv[2]) || process.argv.length !== 3) fail("choose_review_or_run");
  if (process.getuid() !== 0 || hostname() !== "yunipals-main" || process.version !== "v24.18.1" || realpathSync(process.execPath) !== NODE)
    fail("fixed_host_root_node_required");
  const parent = bindings();
  if (process.argv[2] === "--review") {
    console.log(JSON.stringify({ format: FORMAT, helperSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
      pins: PINS, blocks: BLOCKS, limits: LIMITS, output: OUTPUT,
      route: "http://127.0.0.1:19204/; default source; no workload/profile/permit headers",
      providerCalls: 0, serviceChanges: false, databaseWrites: false, candidateProxySelected: false }));
    return;
  }
  try { lstatSync(OUTPUT); fail("fresh_output_required"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const { fetchHistoricalLogBlock } = await import(pathToFileURL(HISTORICAL + "/yunipals-log-transactions.mjs"));
  const actions = await import(pathToFileURL(ACTIONS));
  const encoders = await import(pathToFileURL(ENCODERS));
  const { isFreeRpcCall } = await import(pathToFileURL(OLD_PROXY));
  if (typeof isFreeRpcCall !== "function") fail("installed_proxy_admission_export_required");
  // Reserve exclusively before the first HTTP request, including metrics.
  const fd = openSync(OUTPUT, "wx", 0o644);
  let result;
  try {
    result = await probe({ transport: createExchange(), readIdentity: (remaining) => identity(parent, remaining),
      configuration: parent.proxies.bnb.configuration, fetchHistoricalLogBlock, isFreeRpcCall, ...actions, ...encoders });
    result.helperSha256 = sha(protectedFile(fileURLToPath(import.meta.url)));
    writeFileSync(fd, canonical(result) + "\n");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const directory = openSync(OPS, "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  console.log(JSON.stringify({ status: result.status, receiptFile: OUTPUT, receiptSha256: sha(readFileSync(OUTPUT)),
    rpcCalls: result.rpcCalls, responseBytes: result.responseBytes, elapsedMs: result.elapsedMs,
    freeOnly: result.freeOnly, headerAndTransactionEquivalent: result.headerAndTransactionEquivalent }));
  if (result.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main().catch(() => { console.error(JSON.stringify({ status: "refused", failure: "fixed_probe_precondition_failed" })); process.exitCode = 1; });
}

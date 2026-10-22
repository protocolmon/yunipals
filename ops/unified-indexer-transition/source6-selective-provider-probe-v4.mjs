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
const OUTPUT = OPS + "/source6-selective-provider-proof-v4.json";
const PROFILE = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
export const FORMAT = "yunipals-source6-selective-provider-proof-v4";
export const BLOCKS = [7_579_200, 14_826_444];
export const PRIMARY_INDICES = Object.freeze([0, 1, 2, 3, 4]);
export const LIMITS = Object.freeze({ rpcCalls: 32, httpRequests: 36,
  totalResponseBytes: 32 * 1024 * 1024, perResponseBytes: 10 * 1024 * 1024,
  deadlineMs: 180_000, rpcDeadlineMs: 168_000, perRequestMs: 15_000,
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
  // Opaque file digests bind the configured pool and ordering to the existing
  // private-input baseline. Private bytes are never parsed or exported.
  if (!Array.isArray(expected.environmentFileHashes) || !expected.environmentFileHashes.length)
    fail("private_input_baseline_required");
  for (const file of expected.environmentFileHashes) {
    if (file.exists === true && typeof file.path === "string" && /^[0-9a-f]{64}$/.test(file.sha256))
      protectedFile(file.path, file.sha256, 2_000_000);
    else if (file.exists === false && file.optional === true) {
      try { lstatSync(file.path); fail("optional_private_input_appeared"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    } else fail("private_input_baseline_shape");
  }
  protectedFile(OLD_PROXY, PINS.testedProxyEntrySha256);
  return { sourceInvocation: source.InvocationID, sourcePid: Number(source.MainPID),
    sourceStateSha256: sha(canonical(source)), proxyInvocation: proxy.InvocationID,
    proxyPid: Number(proxy.MainPID), proxyStateSha256: sha(canonical(proxy)),
    privateInputBaselineBindingSha256: sha(canonical({ baseline: PINS.normalProxyBaselineSha256,
      proxyInvocation: proxy.InvocationID, definitions: expected.definitions,
      privateSettings: expected.privateSettings, environmentFileHashes: expected.environmentFileHashes,
      indices: PRIMARY_INDICES })) };
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
  if (!PRIMARY_INDICES.includes(preferredSourceIndex) || !Array.isArray(primary) || primary.length !== PRIMARY_INDICES.length ||
    !same(primary.map((row) => row.index).sort((a, b) => a - b), PRIMARY_INDICES) ||
    primary.some((row) => ![row.index, row.successes, row.failures].every((n) => Number.isSafeInteger(n) && n >= 0)))
    fail("fixed_primary_pool_observation_required");
  return { preferredSourceIndex,
    primary: primary.map(({ index, successes, failures }) => ({ index, successes, failures })).sort((a, b) => a.index - b.index) };
}

// These counters are shared with other traffic. Ambiguous observations never
// select an endpoint, even when preferredSourceIndex happens to look useful.
export function attributeBatch(before, after, logicalCalls) {
  const deltas = before.primary.map((row, position) => ({ index: row.index,
    successes: after.primary[position].successes - row.successes,
    failures: after.primary[position].failures - row.failures }));
  const freeCalls = after.sourceCounters.freeCalls - before.sourceCounters.freeCalls;
  const paidCalls = after.sourceCounters.paidCalls - before.sourceCounters.paidCalls;
  const successful = deltas.filter((row) => row.successes === 1);
  const exact = before.sourceCounters.configurationSha256 === after.sourceCounters.configurationSha256 &&
    paidCalls === 0 && freeCalls === logicalCalls && successful.length === 1 &&
    deltas.every((row) => row.failures === 0 && row.successes === (row.index === successful[0].index ? 1 : 0));
  return { attributed: exact, primaryIndex: exact ? successful[0].index : null,
    sourceFreeCallsDelta: freeCalls, sourcePaidCallsDelta: paidCalls, endpointDeltas: deltas,
    reason: exact ? "one_success_exact_source_calls_no_failures" : "ambiguous_or_nonexclusive_counter_delta" };
}

// Preserve presence and raw values for all standard transaction properties.
// Unknown client-specific extensions are recorded only as hashed differences;
// the complete Ponder encoding remains a separate mandatory equality check.
export const STANDARD_TRANSACTION_FIELDS = Object.freeze([
  "hash", "nonce", "blockHash", "blockNumber", "transactionIndex", "from", "to", "value", "gas", "gasPrice",
  "input", "v", "r", "s", "type", "chainId", "maxFeePerGas", "maxPriorityFeePerGas", "accessList",
  "authorizationList", "maxFeePerBlobGas", "blobVersionedHashes", "yParity", "sourceHash", "isSystemTx",
  "mint", "depositNonce", "depositReceiptVersion"
]);
export function standardTransaction(value) {
  return Object.fromEntries(STANDARD_TRANSACTION_FIELDS.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

export function transactionArrayComparison(actual, expected) {
  const changes = [];
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (!same(actual[i], expected[i])) changes.push({ position: i, differences: fieldDifferences(actual[i], expected[i]) });
  }
  const fields = [...new Set(changes.flatMap(({ differences }) =>
    [...differences.missingFields, ...differences.extraFields, ...differences.changedFields]))].sort();
  return { equivalent: changes.length === 0, actualCount: actual.length, expectedCount: expected.length,
    changedTransactionCount: changes.length, changedFields: fields,
    unlistedFieldDifferenceCount: changes.reduce((sum, row) => sum + row.differences.unlistedFieldCount, 0),
    actualSha256: sha(canonical(actual)), expectedSha256: sha(canonical(expected)), differencesSha256: sha(canonical(changes)) };
}

function publicSize(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fail("public_block_size_shape");
  return { hex: value, decimal: Number(BigInt(value)) };
}

export function qualifications(samples) {
  return PRIMARY_INDICES.map((primaryIndex) => {
    const observations = samples.filter((sample) => sample.attribution?.primaryIndex === primaryIndex);
    const failed = observations.some((sample) => sample.equivalent !== true);
    const passingBlocks = BLOCKS.filter((block) => observations.some((sample) => sample.blockNumber === block && sample.equivalent === true));
    return { primaryIndex, qualified: !failed && passingBlocks.length === BLOCKS.length,
      disqualifiedByObservedFailure: failed, attributedTripleCount: observations.length, passingBlocks,
      scope: "two_fixed_historical_blocks_only" };
  });
}

export async function probe({ transport, readIdentity, configuration, fetchHistoricalLogBlock,
  standardizeBlock, validateTransactionsAndBlock, isFreeRpcCall, encodeBlock, encodeTransaction }) {
  const result = { format: FORMAT, chainId: 56, ...PINS, blocks: BLOCKS, primaryIndices: PRIMARY_INDICES, limits: LIMITS,
    candidateProxySelected: false, configurationChanged: false, rawResponsesExported: false,
    qualificationScope: "existing_proxy_primary_indices_two_fixed_historical_blocks",
    proposedRouteExecuted: false, proposedHelperExecuted: false,
    matchingLogsQueried: false, fullHistoryVerified: false, throughputVerified: false, allFutureResponsesQualified: false,
    freeOnly: false, diagnosticComplete: false, qualifiedPrimaryIndices: [],
    sameUpstreamHttpBatch: true, upstreamBackendIdentityProved: false,
    endpointAttribution: "exact_bracketed_counter_delta_only", discoveries: [], samples: [], probeCalls: transport.traces };
  let rpcCalls = 0, beforeIdentity, firstCounters, lastCounters, proofError;
  let stage = "identity_before";
  async function observe() {
    const metrics = await transport.exchange();
    const sourceCounters = metricsGuard(metrics, configuration);
    if (firstCounters && (sourceCounters.paidCalls !== firstCounters.paidCalls || sourceCounters.freeCalls < firstCounters.freeCalls))
      fail("source_counter_changed");
    firstCounters ??= sourceCounters; lastCounters = sourceCounters;
    return { sourceCounters, ...endpointObservation(metrics) };
  }
  async function batch(calls, label) {
    if (!Array.isArray(calls) || ![1, 3].includes(calls.length)) fail("fixed_batch_shape");
    for (const call of calls) {
      if (!((call.method === "eth_getBlockByNumber" && Array.isArray(call.params) && call.params.length === 2 &&
        BLOCKS.map((n) => "0x" + n.toString(16)).includes(call.params[0]) && typeof call.params[1] === "boolean") ||
        (call.method === "eth_getTransactionByHash" && Array.isArray(call.params) && call.params.length === 1 && isHash(call.params[0]))))
        fail("free_method_allowlist");
      if (isFreeRpcCall(call, undefined) !== true) fail("installed_proxy_free_admission");
    }
    if (rpcCalls + calls.length > LIMITS.rpcCalls) fail("rpc_call_limit");
    const before = await observe();
    let response, failure;
    const request = calls.map((call) => ({ jsonrpc: "2.0", id: ++rpcCalls, ...call }));
    try {
      response = await transport.exchange(request);
      if (!Array.isArray(response) || response.length !== calls.length) fail("batch_response_shape");
    } catch { failure = "bounded_batch_failed"; }
    // Always inspect metrics after the attempted batch, without a retry.
    const after = await observe();
    const observation = { label, logicalCalls: calls.length, before, after, attribution: attributeBatch(before, after, calls.length) };
    if (failure) observation.failure = failure;
    return { response, failure, observation };
  }
  function fullBlock(raw, blockNumber) {
    if (!raw || raw.number !== "0x" + blockNumber.toString(16) || !isHash(raw.hash) ||
      !Array.isArray(raw.transactions) || !raw.transactions.length) fail("historical_full_block_shape");
    const request = { method: "eth_getBlockByNumber", params: [raw.number, true] };
    const block = standardizeBlock(structuredClone(raw), request);
    validateTransactionsAndBlock(block, request);
    return { raw, block, encoded: encodeBlock({ block, chainId: 56 }),
      transactionsEncoded: block.transactions.map((transaction) => encodeTransaction({ transaction, chainId: 56 })) };
  }
  async function triple(blockNumber, selectedHash, values, discovery, observation) {
    const sample = { blockNumber, attribution: observation.attribution, observation, equivalent: false };
    try {
      const [fullRaw, headerRaw, transactionRaw] = values;
      const full = fullBlock(fullRaw, blockNumber);
      if (!headerRaw || !Array.isArray(headerRaw.transactions)) fail("historical_header_shape");
      const expectedHeader = { ...fullRaw, transactions: fullRaw.transactions.map((tx) => tx.hash) };
      const request = { method: "eth_getBlockByNumber", params: [fullRaw.number, true] };
      const header = standardizeBlock({ ...structuredClone(headerRaw), transactions: structuredClone(full.block.transactions) }, request);
      validateTransactionsAndBlock(header, request);
      const headerEncoded = encodeBlock({ block: header, chainId: 56 });
      sample.blockHash = fullRaw.hash;
      sample.fullSize = publicSize(fullRaw.size); sample.headerSize = publicSize(headerRaw.size);
      sample.headerEquivalent = same(headerRaw, expectedHeader);
      sample.headerDifferences = fieldDifferences(headerRaw, expectedHeader);
      sample.standardizedBlockEquivalent = same(header, full.block);
      sample.encodedBlockEquivalent = same(headerEncoded, full.encoded);
      sample.encodedBlockDifferences = fieldDifferences(headerEncoded, full.encoded);
      sample.discoveryBlockEquivalent = same(full.encoded, discovery.encoded);
      sample.discoveryBlockDifferences = fieldDifferences(full.encoded, discovery.encoded);
      sample.fullTransactions = transactionArrayComparison(full.transactionsEncoded, discovery.transactionsEncoded);
      sample.rawFullTransactions = transactionArrayComparison(fullRaw.transactions, discovery.raw.transactions);
      sample.fullEncodedSha256 = sha(canonical(full.encoded)); sample.headerEncodedSha256 = sha(canonical(headerEncoded));
      sample.fullBlockSha256 = sha(canonical(fullRaw)); sample.headerSha256 = sha(canonical(headerRaw));
      let offlineCalls = 0;
      const sparse = await fetchHistoricalLogBlock({ blockNumber, transactionHashes: [selectedHash],
        standardizeBlock, validateTransactionsAndBlock, rpc: { request: async (call) => {
          offlineCalls++;
          if (call.method === "eth_getBlockByNumber" && same(call.params, ["0x" + blockNumber.toString(16), false])) return structuredClone(headerRaw);
          if (call.method === "eth_getTransactionByHash" && same(call.params, [selectedHash])) return structuredClone(transactionRaw);
          fail("offline_candidate_request_shape");
        } } });
      if (offlineCalls !== 2) fail("offline_candidate_request_count");
      const expectedTransaction = fullRaw.transactions.find((tx) => tx.hash === selectedHash);
      const stockTransaction = full.block.transactions.find((tx) => tx.hash === selectedHash);
      if (!expectedTransaction || !stockTransaction || sparse.transactions.length !== 1) fail("selected_transaction_missing");
      const candidateEncoded = encodeTransaction({ transaction: sparse.transactions[0], chainId: 56 });
      const stockEncoded = encodeTransaction({ transaction: stockTransaction, chainId: 56 });
      const actualStandard = standardTransaction(transactionRaw), expectedStandard = standardTransaction(expectedTransaction);
      sample.transaction = { rawEquivalent: same(transactionRaw, expectedTransaction),
        rawDifferences: fieldDifferences(transactionRaw, expectedTransaction),
        standardFieldsEquivalent: same(actualStandard, expectedStandard),
        standardFieldsDifferences: fieldDifferences(actualStandard, expectedStandard),
        encodedEquivalent: same(candidateEncoded, stockEncoded), encodedDifferences: fieldDifferences(candidateEncoded, stockEncoded),
        actualSha256: sha(canonical(transactionRaw)), expectedSha256: sha(canonical(expectedTransaction)),
        candidateEncodedSha256: sha(canonical(candidateEncoded)), stockEncodedSha256: sha(canonical(stockEncoded)) };
      sample.candidateHelperOutcome = "passed";
      sample.equivalent = sample.headerEquivalent && sample.standardizedBlockEquivalent && sample.encodedBlockEquivalent &&
        sample.discoveryBlockEquivalent && sample.fullTransactions.equivalent &&
        sample.transaction.standardFieldsEquivalent && sample.transaction.encodedEquivalent;
    } catch (error) {
      sample.candidateHelperOutcome ??= "failed";
      sample.failure = "triple_validation_failed";
      sample.errorClass = ["AssertionError", "Error", "TypeError", "RangeError", "RpcProviderError"].includes(error?.name) ? error.name : "other";
      sample.errorSha256 = sha(String(error?.message ?? ""));
    }
    return sample;
  }
  try {
    beforeIdentity = readIdentity(() => LIMITS.deadlineMs - transport.elapsed()); result.identity = beforeIdentity;
    if (!/^[0-9a-f]{64}$/.test(beforeIdentity.privateInputBaselineBindingSha256)) fail("stable_primary_pool_binding_required");
    for (const blockNumber of BLOCKS) {
      stage = "discovery_" + blockNumber;
      const hex = "0x" + blockNumber.toString(16);
      const found = await batch([{ method: "eth_getBlockByNumber", params: [hex, true] }], stage);
      if (found.failure) fail("discovery_batch_failed");
      const discovery = fullBlock(found.response[0], blockNumber);
      const selectedHash = discovery.raw.transactions[0].hash;
      if (!isHash(selectedHash)) fail("selected_transaction_hash");
      result.discoveries.push({ blockNumber, blockHash: discovery.raw.hash, selectedTransactionHash: selectedHash,
        fullBlockSha256: sha(canonical(discovery.raw)), encodedBlockSha256: sha(canonical(discovery.encoded)),
        transactionsEncodedSha256: sha(canonical(discovery.transactionsEncoded)), transactionCount: discovery.raw.transactions.length,
        observation: found.observation });
      for (let attempt = 0; attempt < PRIMARY_INDICES.length; attempt++) {
        stage = "triple_" + blockNumber + "_" + attempt;
        const calls = [{ method: "eth_getBlockByNumber", params: [hex, true] },
          { method: "eth_getBlockByNumber", params: [hex, false] },
          { method: "eth_getTransactionByHash", params: [selectedHash] }];
        const current = await batch(calls, stage);
        result.samples.push(current.failure
          ? { blockNumber, attribution: current.observation.attribution, observation: current.observation,
              equivalent: false, failure: current.failure }
          : await triple(blockNumber, selectedHash, current.response, discovery, current.observation));
      }
    }
    result.diagnosticComplete = result.discoveries.length === 2 && result.samples.length === 10 && rpcCalls === LIMITS.rpcCalls;
  } catch { proofError = "bounded_qualification_or_identity_check_failed"; result.failedStage = stage; }
  try {
    const after = readIdentity(() => LIMITS.deadlineMs - transport.elapsed());
    result.sourceIdentityUnchanged = beforeIdentity?.sourceStateSha256 === after.sourceStateSha256;
    result.proxyIdentityUnchanged = beforeIdentity?.proxyStateSha256 === after.proxyStateSha256;
    result.privateInputBaselineBindingUnchanged = beforeIdentity?.privateInputBaselineBindingSha256 === after.privateInputBaselineBindingSha256;
    result.sourcePaidCallsUnchanged = firstCounters?.paidCalls === lastCounters?.paidCalls;
    result.fallbackDisabledBeforeAndAfter = firstCounters?.fallbackDisabled === true && lastCounters?.fallbackDisabled === true;
    if (!result.sourceIdentityUnchanged || !result.proxyIdentityUnchanged || !result.privateInputBaselineBindingUnchanged ||
      !result.sourcePaidCallsUnchanged || !result.fallbackDisabledBeforeAndAfter) proofError = "postcheck_failed";
  } catch { proofError = "postcheck_failed"; }
  result.sourceCountersBefore = firstCounters; result.sourceCountersAfter = lastCounters;
  result.rpcCalls = rpcCalls; result.responseBytes = transport.bytes(); result.elapsedMs = transport.elapsed();
  if (!result.diagnosticComplete || result.elapsedMs > LIMITS.deadlineMs || result.responseBytes > LIMITS.totalResponseBytes)
    proofError ??= "incomplete_or_exceeded_bound";
  result.endpointQualifications = qualifications(result.samples);
  if (!proofError) {
    result.freeOnly = true; result.paidCalls = 0;
    result.qualifiedPrimaryIndices = result.endpointQualifications.filter((row) => row.qualified).map((row) => row.primaryIndex);
  }
  result.status = proofError ? "refused_or_failed" : result.qualifiedPrimaryIndices.length ? "qualified_samples" : "no_qualified_endpoints";
  if (proofError) result.failure = proofError;
  result.completedAt = new Date().toISOString();
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
    freeOnly: result.freeOnly, qualifiedPrimaryIndices: result.qualifiedPrimaryIndices }));
  if (result.status !== "qualified_samples") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main().catch(() => { console.error(JSON.stringify({ status: "refused", failure: "fixed_probe_precondition_failed" })); process.exitCode = 1; });
}

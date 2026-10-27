// One bounded official chain observation. No receipts, scans, services or keys.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMAT = "yunipals-ypal-combined-observer-v1";
export const SOURCE_ROOT =
  "/var/lib/yunipals-booster-launch/20261022-source008";
export const PROJECT = SOURCE_ROOT + "/apps/yunipals-indexer";
export const PROFILE_FILE =
  "/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/profile.json";
export const PROFILE_SHA =
  "c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b";
export const PROFILE_ID =
  "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff";
export const RELEASE =
  "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3";
export const MANIFEST =
  "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112";
export const SCHEMA = "unified_ypal_20261023_v1";
export const BUILD = "71e2a7f3b7";
export const ROLE = "yunipals_unified_support";
export const ROLE_OID = "73036832";
export const ENDPOINTS = Object.freeze({
  1: "http://127.0.0.1:19221/unified",
  56: "http://127.0.0.1:19224/unified",
  137: "http://127.0.0.1:19223/unified",
  8453: "http://127.0.0.1:19222/unified"
});
export const LIMITS = Object.freeze({
  rpcCalls: 64,
  seconds: 120,
  responseBytes: 2097152,
  totalResponseBytes: 16777216
});
export const SOURCE_PINS = {
  "apps/yunipals-indexer/lib/abi.ts":
    "76eb9ff078b0c0a4fa0ebaf6f31eb7062955befd92542236c53b70300b53d705",
  "apps/yunipals-indexer/lib/boosters/config.ts":
    "eba43d7cb6df3bab3d4e4627523fc0984a602a4996159e1ebb6f3a08e8a34e01",
  "apps/yunipals-indexer/lib/constants.ts":
    "31d4c01cb192d54085e26d18f7d7323c82ef54168f98b9c4c916610fe13e8e7a",
  "apps/yunipals-indexer/lib/metadata/base-abi.ts":
    "51d3b976323b59057e9b0f97b22e163aa71edf45f32e907681ecc9bda760be46",
  "apps/yunipals-indexer/lib/rpc.ts":
    "7be2f6ebadd066704fbcaef3dc89ab32d92efab2048e3911a2307c7c8f83e950",
  "apps/yunipals-indexer/lib/unified/control-schema.ts":
    "75cb5591fc04cd2fdf0397d8ddcd631a3a11493c2daf4bee6eaf13b9abeb7ed4",
  "apps/yunipals-indexer/lib/unified/observer.ts":
    "5b6f4e1e4d3d1bc79589160d6fd91ffb64a97e8c8eef16258490855fbb53cc19",
  "apps/yunipals-indexer/lib/unified/releases.ts":
    "233a600717529e71859ae4e17f0c5b487b8edbdf84557c5d35645b60f3af0e5b",
  "apps/yunipals-indexer/lib/unified/rpc-preflight.ts":
    "68a0d4fd0442ecb464574434e1e349f1e4caf1c4ab2f0a70352f8b5f26afe833",
  "apps/yunipals-indexer/lib/unified/rpc.ts":
    "ae12fc143e9ed9ea0908343157865508726cfa58e87f66811cf845fe65b69acd",
  "apps/yunipals-indexer/lib/unified/sources.ts":
    "a51cb067d725029345e5c5a585bcc5dc10aa6fb18341e10615e05947d244990e",
  "packages/yunipals-indexer-client/src/ponder.ts":
    "850f53b560c45a7bb3641d90277bdda723e1abdb0fc8a29ce38ec5530f3409ba",
  "packages/yunipals-indexer-client/src/readiness.ts":
    "c23e9c2e763d3173582de8211a6bc72236654d87457cd548d445e107e457cff8",
  "packages/yunipals-indexer-client/src/sources.ts":
    "05e1ad7cdf5da6fbf7615294bf94552ac291032aadb911be65ea5d6506544b1c",
  "packages/yunipals-indexer-server/src/chain-status.ts":
    "94fbd7d957e80072dcdc2c31bdf406105fc91bbd6418a1d9bcd5bd253b3a1ca3",
  "packages/yunipals-indexer-server/src/database.ts":
    "3ff91209b43d755a9010a8ff8f6a2c99b4698c7eba57787353791d1a0299aa1b",
  "packages/yunipals-indexer-server/src/identity.ts":
    "1ec0dab250ec8b93e93dd1f864bc6257dfada2520d3fcac94e7c8697703224ae",
  "packages/yunipals-indexer-server/src/ponder-reader.ts":
    "cec123e750017b46a099dbbe2f7b155e330273c87a4757b1e4b07aed33405c4a",
  "packages/yunipals-indexer-server/src/releases.ts":
    "98d35c8ac5831ff4b4397579259ae5201caa0f662a23f8fb9ba65a76f4f464c6",
  "packages/yunipals-indexer-server/src/rpc-policy.ts":
    "f1a9061e07b83b310281add38597df5a47692be18eb64288feb12cf3ddf3fd75",
  "packages/yunipals-market-core/src/arenaAbi.ts":
    "b6d8ebfe8078ac8ada02416818c97d7468b75e072f1abf38a34f4dff70a6bc04",
  "packages/yunipals-market-core/src/boosterAbi.ts":
    "61049528cc583b2d4948a688e1c7a67c07bfd48a37785c5f11a4f22f54ed5850",
  "packages/yunipals-market-core/src/collectionAbi.ts":
    "f60d1cd6ad8e3330da2295a75b92369cb7bc0f5392758d4d88ddb76b7939b8d6",
  "packages/yunipals-market-core/src/registry.ts":
    "abd125f3b26653691bc149a9b77af7e34a569bb1476318cb17a0babc4291d4c9",
  "packages/yunipals-market-core/src/seaportEvents.ts":
    "90b4d4e56f8f8ccc4c1f558da150c2373e4453b61db7b4dfb6ed819a0fd20bdd"
};
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const json = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v
    )
  );
const fail = (code) => {
  throw Error(code);
};

export function configuration(value) {
  if (
    !value ||
    Object.keys(value).sort().join() !== "chains,readAdmissionSha256" ||
    !Array.isArray(value.chains) ||
    value.chains.length < 1 ||
    value.chains.length > 4 ||
    value.chains.some(
      (v, i) =>
        !Number.isSafeInteger(v) ||
        !(v in ENDPOINTS) ||
        (i && value.chains[i - 1] >= v)
    ) ||
    !/^[a-f0-9]{64}$/.test(value.readAdmissionSha256 ?? "")
  )
    fail("fixed_observer_configuration_required");
  return value;
}

function protectedBytes(file, pin) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    const st = lstatSync(p);
    if (st.uid !== 0 || st.isSymbolicLink() || st.mode & 0o022)
      fail("protected_observer_source_required");
    if (p === "/") break;
  }
  const st = lstatSync(file);
  if (!st.isFile() || st.size > 3000000)
    fail("bounded_public_observer_input_required");
  const raw = readFileSync(file);
  if (sha(raw) !== pin) fail("exact_observer_source_pin_required");
  return raw;
}

export function assertPeer() {
  const status = Object.fromEntries(
    readFileSync("/proc/self/status", "utf8")
      .split("\n")
      .filter((v) => v.includes(":"))
      .map((v) => [
        v.slice(0, v.indexOf(":")),
        v.slice(v.indexOf(":") + 1).trim()
      ])
  );
  if (
    !/^[1-9][0-9]*$/.test(process.env.YUNIPALS_OBSERVER_PARENT_PID ?? "") ||
    process.ppid !== Number(process.env.YUNIPALS_OBSERVER_PARENT_PID) ||
    process.getuid() !== 969 ||
    process.getgid() !== 963 ||
    !["", "963"].includes(status.Groups) ||
    status.NoNewPrivs !== "1" ||
    ["CapInh", "CapPrm", "CapEff", "CapAmb", "CapBnd"].some(
      (k) => !/^0+$/.test(status[k] ?? "")
    )
  )
    fail("existing_restricted_support_peer_required");
}

export function headers() {
  return {
    "x-yunipals-unified-rpc-profile": PROFILE_ID,
    "x-yunipals-rpc-workload": "unified_evidence"
  };
}

export function createBoundedFetch(config, fetchImpl, now = Date.now) {
  configuration(config);
  const began = now(),
    state = { rpcCalls: 0, preflights: 0, responseBytes: 0, failed: false };
  const preflighted = new Set(),
    inflight = new Set();
  const stop = (code) => {
    state.failed = true;
    fail(code);
  };
  const check = () => {
    if (state.failed || now() - began >= LIMITS.seconds * 1000)
      stop("observer_stopped_or_deadline");
  };
  const request = async (input, options = {}) => {
    check();
    if (state.responseBytes >= LIMITS.totalResponseBytes)
      stop("observer_total_response_budget_exhausted");
    const url = String(input),
      endpoint = url.replace(/\/preflight$/, ""),
      chain = config.chains.find((v) => ENDPOINTS[v] === endpoint);
    if (chain === undefined) stop("fixed_observer_endpoint_required");
    const h = new Headers(options.headers);
    if (
      h.get("x-yunipals-unified-rpc-profile") !== PROFILE_ID ||
      h.get("x-yunipals-rpc-workload") !== "unified_evidence" ||
      [...h.keys()].some(
        (k) =>
          ![
            "content-type",
            "x-yunipals-unified-rpc-profile",
            "x-yunipals-rpc-workload"
          ].includes(k)
      )
    )
      stop("fixed_free_observer_headers_required");
    if (inflight.size) stop("observer_requests_must_be_sequential");
    const preflight = url.endsWith("/preflight");
    if (preflight) {
      if (
        (options.method ?? "GET") !== "GET" ||
        options.body ||
        preflighted.has(chain)
      )
        stop("one_fixed_preflight_per_chain_required");
      preflighted.add(chain);
      state.preflights++;
    } else {
      if (
        options.method !== "POST" ||
        typeof options.body !== "string" ||
        !preflighted.has(chain)
      )
        stop("preflight_before_bounded_rpc_required");
      let body;
      try {
        body = JSON.parse(options.body);
      } catch {
        stop("bounded_rpc_envelope_required");
      }
      const calls = Array.isArray(body) ? body : [body];
      if (
        !calls.length ||
        calls.length > 10 ||
        state.rpcCalls + calls.length > LIMITS.rpcCalls
      )
        stop("observer_rpc_call_limit");
      for (const c of calls) {
        if (
          !c ||
          c.jsonrpc !== "2.0" ||
          !(typeof c.id === "number" || typeof c.id === "string") ||
          (!(
            c.method === "eth_chainId" &&
            (c.params === undefined ||
              (Array.isArray(c.params) && c.params.length === 0))
          ) &&
            !(
              c.method === "eth_getBlockByNumber" &&
              Array.isArray(c.params) &&
              c.params.length === 2 &&
              c.params[1] === false &&
              /^(?:latest|finalized|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(
                c.params[0]
              )
            ))
        )
          stop("observer_headers_only_rpc_required");
      }
      state.rpcCalls += calls.length;
    }
    inflight.add(chain);
    try {
      const signal = AbortSignal.timeout(
        Math.max(1, Math.min(15000, LIMITS.seconds * 1000 - (now() - began)))
      );
      const response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: options.signal
          ? AbortSignal.any([options.signal, signal])
          : signal
      });
      if (!response.ok || response.redirected)
        stop("free_observer_proxy_refused");
      const reader = response.body?.getReader();
      if (!reader) stop("observer_response_required");
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (
            bytes > LIMITS.responseBytes ||
            state.responseBytes + bytes > LIMITS.totalResponseBytes
          )
            stop("observer_response_bound");
          chunks.push(part.value);
          check();
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      state.responseBytes += bytes;
      const raw = Buffer.concat(chunks);
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        stop("observer_json_response_required");
      }
      if (
        !preflight &&
        (Array.isArray(value) ? value : [value]).some(
          (v) =>
            !v ||
            v.jsonrpc !== "2.0" ||
            !(typeof v.id === "number" || typeof v.id === "string") ||
            "result" in v === "error" in v ||
            ("error" in v &&
              (!v.error ||
                !Number.isInteger(v.error.code) ||
                typeof v.error.message !== "string"))
        )
      )
        stop("observer_rpc_result_error");
      return new Response(raw, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    } catch {
      state.failed = true;
      fail("bounded_observer_request_failed");
    } finally {
      inflight.delete(chain);
    }
  };
  return { fetch: request, state, check };
}

export function guardedPool(pool, mode, config) {
  if (!["inspect", "observe-once"].includes(mode))
    fail("observer_mode_required");
  configuration(config);
  const state = { writeStatements: 0 };
  const reads = new Set([
    "pg_namespace",
    "pg_roles",
    "pg_database",
    ...["release", "chain_status", "chain_anchor"].map(
      (v) => "yunipals_indexer_control." + v
    ),
    ...[
      "_ponder_meta",
      "_ponder_checkpoint",
      "chain_checkpoint",
      "indexer_source",
      "chain_block"
    ].map((v) => SCHEMA + "." + v)
  ]);
  const query = async (target, text, params) => {
    if (
      typeof text !== "string" ||
      text.includes(";") ||
      (params !== undefined && !Array.isArray(params))
    )
      fail("single_fixed_observer_statement_required");
    const sql = text.trim();
    if (/^SELECT\b/i.test(sql)) {
      for (const match of sql.matchAll(
        /\b(?:FROM|JOIN)\s+((?:"[^"]+"|[a-z_][a-z_0-9]*)(?:\.(?:"[^"]+"|[a-z_][a-z_0-9]*))?)/gi
      ))
        if (!reads.has(match[1].replaceAll('"', "")))
          fail("observer_read_table_not_admitted");
    } else if (
      /^(?:BEGIN ISOLATION LEVEL REPEATABLE READ(?: READ ONLY)?|COMMIT|ROLLBACK)$/.test(
        sql
      )
    ) {
      if (
        mode === "inspect" &&
        sql.startsWith("BEGIN") &&
        !sql.endsWith("READ ONLY")
      )
        fail("inspect_transaction_must_be_readonly");
    } else {
      if (
        mode !== "observe-once" ||
        !/^(?:INSERT INTO yunipals_indexer_control\.(?:chain_status|chain_anchor)\b|DELETE FROM yunipals_indexer_control\.chain_anchor\b)/.test(
          sql
        ) ||
        params?.[0] !== RELEASE ||
        !config.chains.includes(params?.[1])
      )
        fail("only_official_current_chain_status_anchor_writes");
      state.writeStatements++;
    }
    return target.query(text, params);
  };
  return {
    state,
    query: (text, params) => query(pool, text, params),
    connect: async () => {
      const db = await pool.connect();
      return {
        query: (text, params) => query(db, text, params),
        release: () => db.release()
      };
    }
  };
}

export function assertRelease(release, profile, identity) {
  if (
    release.id !== RELEASE ||
    release.schema !== SCHEMA ||
    release.buildId !== BUILD ||
    release.manifestHash !== MANIFEST ||
    identity.sourceManifestHash(profile.manifest) !== MANIFEST ||
    identity.unifiedRpcProfileId(profile) !== PROFILE_ID ||
    identity.manifestDigest(release.manifest) !==
      identity.manifestDigest(profile.manifest)
  )
    fail("exact_registered_combined_manifest_required");
}

export function runnable(runtime, chain, now = Date.now()) {
  const coverage = runtime.chains.find((v) => v.chainId === chain),
    witness = runtime.witnesses.find((v) => v.chainId === chain);
  return (
    runtime.running === true &&
    Number.isSafeInteger(runtime.observedAtMs) &&
    runtime.observedAtMs <= now &&
    now - runtime.observedAtMs <= 180000 &&
    coverage?.completeThroughBlock !== null &&
    coverage?.completeThroughBlock !== undefined &&
    witness !== undefined
  );
}

export async function runOnce(mode, config, dependencies) {
  configuration(config);
  if (!["inspect", "observe-once"].includes(mode))
    fail("observer_mode_required");
  const { pool, releases, observer, rpcFactory, identity, profile } =
      dependencies,
    now = dependencies.now ?? Date.now;
  const safe = guardedPool(pool, mode, config),
    realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    fail("provider_disabled_during_observer_inspection");
  let release;
  const snapshot = async () => {
    const db = await safe.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const who = (
        await db.query(
          "SELECT current_user,session_user,(SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS role_oid,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,(SELECT oid::text FROM pg_namespace WHERE nspname=$1) AS schema_oid,inet_client_addr() IS NULL AS unix_peer",
          [SCHEMA]
        )
      ).rows[0];
      if (
        who.current_user !== ROLE ||
        who.session_user !== ROLE ||
        who.role_oid !== ROLE_OID ||
        who.database_oid !== "17584" ||
        who.schema_oid !== "75963410" ||
        who.unix_peer !== true
      )
        fail("exact_support_peer_database_namespace_required");
      release = await releases.loadIndexerRelease(db, RELEASE);
      assertRelease(release, profile, identity);
      const runtime = await releases.readBoundRuntime(db, release);
      await db.query("ROLLBACK");
      return runtime;
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
    }
  };
  let bounded;
  try {
    const before = await snapshot();
    if (mode === "inspect")
      return {
        format: FORMAT,
        inspected: true,
        releaseId: RELEASE,
        manifestHash: MANIFEST,
        buildId: BUILD,
        native: json(before),
        rpcCalls: 0,
        writeStatements: 0,
        sourceReadinessQualified: false,
        rootReadAdmissionReference: config.readAdmissionSha256,
        rootReadAdmissionVerifiedHere: false
      };
    bounded = createBoundedFetch(config, dependencies.fetch ?? realFetch, now);
    globalThis.fetch = bounded.fetch;
    const results = [];
    for (const chain of config.chains) {
      bounded.check();
      if (!runnable(before, chain, now())) {
        results.push({
          chainId: chain,
          executed: false,
          reason: "native_prefix_or_witness_pending"
        });
        continue;
      }
      const response = await bounded.fetch(ENDPOINTS[chain] + "/preflight", {
          headers: headers()
        }),
        value = await response.json();
      if (
        value.profileId !== PROFILE_ID ||
        value.manifestHash !== MANIFEST ||
        value.chainId !== chain ||
        value.workload !== "unified_evidence" ||
        value.scope !== profile.scope ||
        value.coordinatorId !== profile.coordinatorId ||
        value.paid !== "explicit_bounded_permit_only" ||
        value.replay?.mode !== "free_only"
      )
        fail("actual_admitted_free_proxy_preflight_required");
      const observed = await observer.observeIndexerChain(
        safe,
        release,
        chain,
        rpcFactory(chain),
        { now }
      );
      bounded.check();
      const db = await safe.connect();
      let stored;
      try {
        await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        stored = await observer.readChainStatus(db, RELEASE, chain);
        await db.query("ROLLBACK");
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        db.release();
      }
      results.push({
        chainId: chain,
        executed: true,
        observed,
        observation: json(stored)
      });
    }
    const after = await snapshot();
    return {
      format: FORMAT,
      completed: true,
      successful: results.every((v) => v.observed === "observed"),
      releaseId: RELEASE,
      manifestHash: MANIFEST,
      buildId: BUILD,
      results,
      native: json(after),
      requests: bounded.state,
      writeStatements: safe.state.writeStatements,
      canonicalNativeWitnessCreated: false,
      nativeDataWritten: false,
      receiptQueries: 0,
      paidAuthority: false,
      sourceReadinessQualified: false,
      rootReadAdmissionReference: config.readAdmissionSha256,
      rootReadAdmissionVerifiedHere: false
    };
  } catch {
    return {
      format: FORMAT,
      completed: false,
      fixedCode: "bounded_official_observer_refused",
      rpcCalls: bounded?.state.rpcCalls ?? 0,
      writeStatements: safe.state.writeStatements,
      operationalWritesMayHaveOccurred: safe.state.writeStatements > 0,
      sourceReadinessQualified: false,
      automaticRetryAllowed: false
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

export async function loadOfficial() {
  for (const [relative, pin] of Object.entries(SOURCE_PINS))
    protectedBytes(path.join(SOURCE_ROOT, relative), pin);
  const profile = JSON.parse(protectedBytes(PROFILE_FILE, PROFILE_SHA));
  const at = (relative) =>
    import(pathToFileURL(path.join(SOURCE_ROOT, relative)).href);
  const [releases, observer, rpc, identity, policy] = await Promise.all([
    at("apps/yunipals-indexer/lib/unified/releases.ts"),
    at("apps/yunipals-indexer/lib/unified/observer.ts"),
    at("apps/yunipals-indexer/lib/unified/rpc.ts"),
    at("packages/yunipals-indexer-server/src/identity.ts"),
    at("packages/yunipals-indexer-server/src/rpc-policy.ts")
  ]);
  const require = createRequire(PROJECT + "/package.json"),
    pg = require("pg");
  const env = {
    UNIFIED_RPC_POLICY_REQUIRED: "true",
    UNIFIED_RPC_FREE_ONLY: "true",
    UNIFIED_RPC_PROFILE_FILE: PROFILE_FILE,
    UNIFIED_RPC_PROFILE_ID: PROFILE_ID,
    ...Object.fromEntries(
      Object.entries(ENDPOINTS).map(([chain, url]) => [
        "PONDER_RPC_URL_" + chain,
        url
      ])
    )
  };
  return {
    pg,
    releases,
    observer,
    identity: { ...identity, ...policy },
    profile,
    rpcFactory: (chain) => rpc.evidenceRpc(chain, env)
  };
}

export async function main() {
  const args = process.argv.slice(2),
    mode = args[0] ?? "inspect";
  if (args.length > 2 || !["inspect", "observe-once"].includes(mode))
    fail("observer_mode_and_optional_chain_list_only");
  const chains =
    args[1] === undefined ? [1, 56, 137, 8453] : args[1].split(",").map(Number);
  const config = configuration({
    chains,
    readAdmissionSha256: process.env.YUNIPALS_OBSERVER_READ_ACK_SHA
  });
  assertPeer();
  if (
    Object.keys(process.env).some((k) =>
      /PERMIT|DATABASE_URL|PGPASSWORD|PGPASSFILE/.test(k)
    )
  )
    fail("no_credentials_or_permits_in_observer_environment");
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    fail("provider_disabled_during_official_import");
  let pool;
  try {
    const dependencies = await loadOfficial();
    pool = new dependencies.pg.Pool({
      host: "/var/run/postgresql",
      port: 5432,
      database: "yunipals_backfill",
      user: ROLE,
      max: 1,
      connectionTimeoutMillis: 3000,
      statement_timeout: 8000,
      lock_timeout: 1500,
      idle_in_transaction_session_timeout: 10000,
      query_timeout: 10000,
      application_name: "yunipals-combined-official-observer",
      options: mode === "inspect" ? "-c default_transaction_read_only=on" : ""
    });
    const value = await runOnce(mode, config, {
      ...dependencies,
      pool,
      fetch: original
    });
    console.log(JSON.stringify(value));
    if (value.completed === false) process.exitCode = 1;
  } finally {
    globalThis.fetch = original;
    await pool?.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.log(
      JSON.stringify({
        format: FORMAT,
        completed: false,
        fixedCode: "observer_preflight_refused",
        automaticRetryAllowed: false
      })
    );
    process.exitCode = 1;
  }
}

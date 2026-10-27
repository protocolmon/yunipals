#!/usr/bin/env node
/** Synthetic systemd credential/read-only import qualification. No scanner call. */
import fs from "node:fs";
import net from "node:net";
import dns from "node:dns";
import os from "node:os";
import path from "node:path";
import httpModule from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

export const CHILD_SHA = "f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2";
export const UNIT = "yunipals-arena-public-rollback-reader-probe-v1.service";
export const SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24";
export const ROOT = "/opt/yunipals-unified/releases/" + SOURCE;
export const PUBLIC = "/run/yunipals-arena-public-reader-probe-v1";
export const SYNTHETIC = "ARENA_PUBLIC_ROLLBACK_DATABASE_URL=postgresql://arena_public_rollback_writer:synthetic-scanner-probe-only@127.0.0.1:5432/yunipals_arena_public_rollback";
export const PROFILE = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const need = (value, code) => { if (!value) throw new Error(code); };

export function blockNetwork() {
  const counts = { networkAttempts: 0, databaseConnections: 0, suppressedTsxParentIpc: 0 };
  const original = [];
  function replace(object, key, value) {
    original.push([object, key, object[key]]); object[key] = value;
  }
  const refuse = () => { counts.networkAttempts++; throw new Error("synthetic_probe_network_forbidden"); };
  const parentPipe = path.join(os.tmpdir(), "tsx-" + process.geteuid(), process.ppid + ".pipe");
  const refuseConnection = (...args) => {
    const destination = typeof args[0] === "string" ? args[0] : args[0]?.path;
    // tsx opportunistically checks one parent CLI pipe during import. Suppress
    // that exact Unix IPC attempt as well; no socket connection is performed.
    if (destination === parentPipe) {
      counts.suppressedTsxParentIpc++;
      throw new Error("synthetic_probe_parent_ipc_suppressed");
    }
    return refuse();
  };
  for (const key of ["connect", "createConnection"]) replace(net, key, refuseConnection);
  replace(net.Socket.prototype, "connect", refuseConnection);
  for (const [object, keys] of [[dns, ["lookup", "resolve", "resolve4", "resolve6"]], [httpModule, ["request", "get"]], [https, ["request", "get"]]]) {
    for (const key of keys) replace(object, key, refuse);
  }
  replace(globalThis, "fetch", refuse);
  syncBuiltinESMExports();
  return { counts, guardDatabase(object) { replace(object, "connect", () => { counts.databaseConnections++; throw new Error("synthetic_probe_database_forbidden"); }); }, restore() { for (const [object, key, value] of original.reverse()) object[key] = value; syncBuiltinESMExports(); } };
}

export async function qualifyRuntime(root = ROOT) {
  const guards = blockNetwork();
  let pool;
  try {
    const app = root + "/apps/yunipals-market-api", req = createRequire(app + "/package.json");
    const { tsImport } = req("tsx/esm/api"), pg = req("pg"), viem = req("viem"), { base } = req("viem/chains");
    guards.guardDatabase(pg.Pool.prototype); guards.guardDatabase(pg.Client.prototype);
    const load = (path) => tsImport(app + "/src/" + path + ".ts", { parentURL: pathToFileURL(app + "/package.json").href, tsconfig: app + "/tsconfig.json" });
    const [{ projectConfirmedArena }, confirmations, registry] = await Promise.all([load("arena/live/projector"), load("confirmations"), load("rpcBudgetProxyRegistry")]);
    const url = registry.unifiedRpcBudgetProxyUrl("base", "production");
    need(typeof projectConfirmedArena === "function" && confirmations.chainConfirmations[8453] === 3n && url === "http://127.0.0.1:19202/unified", "exact_installed_public_projector_configuration_required");
    pool = new pg.Pool({ connectionString: SYNTHETIC.slice(SYNTHETIC.indexOf("=") + 1), max: 1, application_name: "arena_isolated_public_scanner", statement_timeout: 10000, lock_timeout: 2000, connectionTimeoutMillis: 3000, idle_in_transaction_session_timeout: 15000 });
    const point = viem.createPublicClient({ chain: base, transport: viem.http(url, { retryCount: 0, timeout: 15000, fetchOptions: { headers: { "x-yunipals-unified-rpc-profile": PROFILE, "x-yunipals-rpc-workload": "unified_source" } } }) });
    need(point.chain.id === 8453 && typeof point.getBlock === "function" && pool.totalCount === 0 && pool.idleCount === 0, "unconnected_public_scanner_constructors_required");
    await pool.end(); pool = null;
    need(guards.counts.networkAttempts === 0 && guards.counts.databaseConnections === 0, "constructor_attempted_external_io");
    return { qualified: true, sourceDigest: SOURCE, installedProjectorImported: true, fallbackBaseDepth: 3, databasePoolMax: 1, databaseConnections: 0, networkAttempts: 0, suppressedTsxParentIpc: guards.counts.suppressedTsxParentIpc, freeProxyUrl: url, freeProfileId: PROFILE, proxyConstructorOnly: true, proxyReachabilityTested: false, financialAuthorityTested: false };
  } finally {
    if (pool) await pool.end();
    guards.restore();
  }
}

/** Fixed namespace metadata only. This never reads any credential content. */
export function credentialMetadata(io = fs, env = process.env) {
  const directory = "/run/credentials/" + UNIT;
  const describe = (path) => {
    try {
      const item = io.lstatSync(path);
      return { present: true, uid: item.uid, gid: item.gid, mode: (item.mode & 0o7777).toString(8), bytes: item.size, regularFile: item.isFile(), directory: item.isDirectory(), symlink: item.isSymbolicLink() };
    } catch { return { present: false }; }
  };
  let mounts = [];
  try {
    mounts = io.readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((line) => line.split(" ")).filter((row) => row[4] === directory).map((row) => {
      const separator = row.indexOf("-");
      return { mountId: row[0], filesystem: row[separator + 1], flags: row[5].split(","), optionalFields: row.slice(6, separator) };
    });
  } catch { /* A missing mount is preserved as an empty observation. */ }
  return { processUid: process.getuid(), processGid: process.getgid(), credentialDirectoryMatches: env.CREDENTIALS_DIRECTORY === directory, file: describe(directory + "/public-db.env"), directory: describe(directory), exactMounts: mounts };
}

export async function main() {
  need(process.argv.length === 2 && process.argv[1] === PUBLIC + "/probe.mjs" && process.execPath === "/opt/node-v24.18.1/bin/node" && process.cwd() === ROOT + "/apps/yunipals-market-api", "fixed_synthetic_probe_entrypoint_required");
  const child = fs.readFileSync(PUBLIC + "/child.mjs");
  need(hash(child) === CHILD_SHA, "exact_frozen_public_reader_required");
  const reader = await import("data:text/javascript;base64," + child.toString("base64"));
  const result = { format: "yunipals-arena-public-scanner-synthetic-probe-v1", childSha256: CHILD_SHA, syntheticOnly: true, credentialMetadata: credentialMetadata(), credential: { qualified: false }, runtime: { qualified: false } };
  try {
    const value = reader.readScannerCredential(undefined, UNIT);
    need(value === SYNTHETIC && reader.writerUrl(value) === SYNTHETIC.slice(SYNTHETIC.indexOf("=") + 1), "only_exact_synthetic_connection_allowed");
    result.credential = { qualified: true, expectedUnit: UNIT, syntheticSha256: hash(Buffer.from(SYNTHETIC)), realCredentialsProvided: 0, fileRoot0440DirectoryRoot0550ReadonlyTmpfsVerified: true };
  } catch {
    result.credential = { qualified: false, fixedCode: "synthetic_systemd_credential_reader_refused" };
  }
  try { result.runtime = await qualifyRuntime(); }
  catch { result.runtime = { qualified: false, fixedCode: "installed_public_import_or_constructor_refused" }; }
  result.qualified = result.credential.qualified && result.runtime.qualified;
  fs.writeSync(1, JSON.stringify(result) + "\n");
  // Keep the actual namespace alive briefly for the owner to bind manager,
  // kernel account/cgroup/start identity and exact InvocationID before stopping.
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 20000);
    process.once("SIGTERM", () => { clearTimeout(timer); resolve(); });
  });
  process.exitCode = result.qualified ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { fs.writeSync(2, "Synthetic scanner probe refused.\n"); process.exitCode = 1; });
}

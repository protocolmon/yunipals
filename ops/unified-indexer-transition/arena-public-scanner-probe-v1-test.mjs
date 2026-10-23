#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  blockNetwork,
  credentialMetadata,
  qualifyRuntime,
  CHILD_SHA,
  UNIT
} from "./arena-public-scanner-probe-v1.mjs";

test("the reader is the exact frozen child, imported without scanner execution", async () => {
  const raw = fs.readFileSync(new URL("./arena-modern-public-rollback-v1.mjs", import.meta.url));
  assert.equal(createHash("sha256").update(raw).digest("hex"), CHILD_SHA);
  const guard = blockNetwork();
  try {
    const child = await import("data:text/javascript;base64," + raw.toString("base64"));
    assert.equal(child.SCANNER_PROBE_UNIT, UNIT);
    assert.equal(typeof child.readScannerCredential, "function");
    assert.equal(guard.counts.networkAttempts, 0);
    assert.equal(guard.counts.databaseConnections, 0);
  } finally { guard.restore(); }
});

test("TCP, fetch and database connection calls fail before any I/O", async () => {
  const originalFetch = globalThis.fetch;
  const guard = blockNetwork();
  try {
    assert.throws(() => net.createConnection({ host: "127.0.0.1", port: 5432 }), /network_forbidden/);
    assert.throws(() => globalThis.fetch("http://127.0.0.1:19202/unified"), /network_forbidden/);
    const fake = { connect() { assert.fail("original database method executed"); } };
    guard.guardDatabase(fake);
    assert.throws(() => fake.connect(), /database_forbidden/);
    assert.equal(guard.counts.networkAttempts, 2);
    assert.equal(guard.counts.databaseConnections, 1);
  } finally { guard.restore(); }
  assert.equal(globalThis.fetch, originalFetch);
});

test("only the exact tsx parent Unix pipe is counted as suppressed IPC", () => {
  const guard = blockNetwork();
  try {
    const exact = path.join(os.tmpdir(), "tsx-" + process.geteuid(), process.ppid + ".pipe");
    assert.throws(() => net.createConnection(exact), /parent_ipc_suppressed/);
    assert.throws(() => net.createConnection(exact + ".foreign"), /network_forbidden/);
    assert.equal(guard.counts.suppressedTsxParentIpc, 1);
    assert.equal(guard.counts.networkAttempts, 1);
  } finally { guard.restore(); }
});

test("failure diagnostics preserve DynamicUser ownership and mount flags without content", () => {
  const reads = [];
  const directory = "/run/credentials/" + UNIT;
  const io = {
    lstatSync(name) {
      const file = name.endsWith("public-db.env");
      return { uid: 61234, gid: 61234, mode: file ? 0o100400 : 0o40500, size: file ? 175 : 40, isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false };
    },
    readFileSync(name) {
      reads.push(name);
      assert.equal(name, "/proc/self/mountinfo");
      return "912 1 0:99 / " + directory + " ro,nosuid,nodev,noexec,nosymfollow shared:42 master:17 - tmpfs tmpfs ro\n";
    }
  };
  const result = credentialMetadata(io, { CREDENTIALS_DIRECTORY: directory });
  assert.equal(result.file.uid, 61234);
  assert.equal(result.file.mode, "400");
  assert.equal(result.directory.mode, "500");
  assert.deepEqual(result.exactMounts[0].optionalFields, ["shared:42", "master:17"]);
  assert.deepEqual(reads, ["/proc/self/mountinfo"]);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
});

test("actual local public imports and unconnected constructors perform zero requests", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
  const result = await qualifyRuntime(root);
  assert.equal(result.qualified, true);
  assert.equal(result.databaseConnections, 0);
  assert.equal(result.networkAttempts, 0);
  assert.equal(result.freeProxyUrl, "http://127.0.0.1:19202/unified");
  assert.equal(result.fallbackBaseDepth, 3);
  assert.equal(result.proxyReachabilityTested, false);
  assert.equal(result.financialAuthorityTested, false);
});

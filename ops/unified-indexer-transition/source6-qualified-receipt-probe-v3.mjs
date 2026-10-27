// Synthetic OS/import qualification only. It cannot call a database or provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertPeer } from "./support-probe-runner-v6.mjs";
import { LIMITS, runReceiptLoop } from "./source6-normal-receipt-loop.mjs";
import { main } from "./source6-qualified-receipt-entry-v3.mjs";

let providerCalls = 0;
globalThis.fetch = async () => { providerCalls++; throw Error("synthetic_probe_provider_access_refused"); };
assertPeer();
const status = Object.fromEntries(readFileSync("/proc/self/status", "utf8").split("\n")
  .filter((line) => line.includes(":"))
  .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]));
assert.equal(process.getuid(), 969);
assert.equal(process.getgid(), 963);
assert.ok(status.Groups === "" || status.Groups === "963");
assert.equal(status.NoNewPrivs, "1");
for (const key of ["CapInh", "CapPrm", "CapEff", "CapAmb", "CapBnd"]) assert.equal(BigInt("0x" + status[key]), 0n);
assert.equal(readFileSync("/proc/self/cgroup", "utf8").trim(), "0::/system.slice/yunipals-qualified-receipt-v3-identity-probe.service");
assert.deepEqual(LIMITS, { seconds: 840, rpcCalls: 256, perBatchRpcCalls: 8, perBatchSeconds: 45, intervalMs: 5000, chains: [1, 56, 137, 8453] });
assert.equal(typeof runReceiptLoop, "function");
assert.equal(typeof main, "function");
const hash = (filename) => createHash("sha256").update(readFileSync(new URL(filename, import.meta.url))).digest("hex");
assert.equal(hash("./source6-normal-receipt-loop.mjs"), "477376b0a5d8b377a313c248627789af5c0f7d34f569f8ed58e0498bfe0d6691");
console.log(JSON.stringify({ format: "yunipals-qualified-receipt-v3-identity-probe-v1", qualified: true,
  uid: process.getuid(), gid: process.getgid(), groupIds: status.Groups ? [963] : [],
  noNewPrivileges: true, capabilitiesEmpty: true, importsVerified: true,
  loopSha256: hash("./source6-normal-receipt-loop.mjs"), runnerSha256: hash("./support-probe-runner-v6.mjs"),
  entrySha256: hash("./source6-qualified-receipt-entry-v3.mjs"),
  providerCalls, databaseCalls: 0, credentialReads: 0, workerStarted: false }));

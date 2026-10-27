// Genuine filesystem/compiler controls. No database, RPC, install or services.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, FORMAT } from "./ypal-native-metadata-approval-build-v1.mjs";

const args = process.argv.slice(2), options = { recoveryRoots: [] };
for (let index = 0; index < args.length; index += 2) {
  const [key, value] = args.slice(index, index + 2); assert.ok(path.isAbsolute(value));
  if (key === "--predecessor") options.predecessor = value;
  else { assert.equal(key, "--recovery-root"); options.recoveryRoots.push(value); }
}
assert.ok(options.predecessor);
const root = mkdtempSync(path.join(os.tmpdir(), "ypal-native-approval-build-controls-"));
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const first = path.join(root, "first"), second = path.join(root, "relocated");
const a = await build({ ...options, out: first }), b = await build({ ...options, out: second });
assert.deepEqual(a, b);
const names = ["manifest.json", "metafile.json", ...readdirSync(path.join(first, "dist")).map((name) => "dist/" + name)];
assert.equal(names.length, 8);
for (const name of names) assert.ok(readFileSync(path.join(first, name)).equals(readFileSync(path.join(second, name))), name);
const manifest = JSON.parse(readFileSync(path.join(first, "manifest.json")));
assert.equal(manifest.format, FORMAT); assert.equal(manifest.inputs.length, 85);
assert.equal(manifest.quietApprovalCheckSeconds, 60); assert.equal(manifest.approvalValiditySeconds, 90);
assert.equal(manifest.additionalIngestors, 0); assert.equal(manifest.sameWorkerAndPool, true);
assert.equal(manifest.newMetadataEpochRequired, true); assert.equal(manifest.runtimeCadenceQualified, false);
assert.equal(manifest.runtimeDependencyTargetVerifiedHere, false); assert.equal(existsSync(path.join(first, "node_modules")), false);
const prior = JSON.parse(readFileSync(path.join(options.predecessor, "manifest.json")));
for (const row of manifest.files.filter((row) => !row.path.includes("metadata-worker"))) {
  assert.ok(readFileSync(path.join(first, row.path)).equals(readFileSync(path.join(options.predecessor, row.path))));
}
const sourceContents = (folder) => {
  const result = new Map();
  for (const name of ["metadata-worker", "unified-base-metadata", "unified-ownership-views"]) {
    const map = JSON.parse(readFileSync(path.join(folder, "dist", name + ".mjs.map")));
    map.sources.forEach((source, index) => result.set(source, map.sourcesContent[index]));
  }
  return result;
};
const oldSources = sourceContents(options.predecessor), newSources = sourceContents(first);
for (const [name, text] of oldSources) if (!name.endsWith("/archive-worker.ts")) assert.equal(newSources.get(name), text, name);
assert.equal(sha(Buffer.from(newSources.get("../lib/metadata/native-base.ts"))), "710b77ba8035679ed74eceffd2d4e78a39b343d05613d19c7d446a388b2e8441");
assert.equal(manifest.inputs.find((row) => row.path.endsWith("/archive-worker.ts")).sha256, "44d4edddc65d103739d0d61f53a73b1048d4665554c421732311c3c8b4e926c7");
assert.equal(sha(Buffer.from(newSources.get("../lib/metadata/archive-worker.ts"))), manifest.inputTransform.compiledSha256);
await assert.rejects(build({ ...options, out: first }), /Fresh absolute output/);
const tampered = path.join(root, "tampered"); cpSync(options.predecessor, tampered, { recursive: true });
const victim = path.join(tampered, prior.files[0].path); writeFileSync(victim, Buffer.concat([readFileSync(victim), Buffer.from("\n")]));
const refused = path.join(root, "must-not-exist"); await assert.rejects(build({ ...options, predecessor: tampered, out: refused }));
assert.equal(existsSync(refused), false);
console.log(JSON.stringify({ passed: ["six_predecessor_outputs_reproduced", "relocated_repeated_eight_bytes_identical",
  "only_worker_JS_and_map_changed", "all_native_refresh_private_and_90_second_schema_sources_unchanged",
  "existing_output_refused", "tampered_predecessor_refused_before_output"],
  artifactDigest: a.artifactDigest, manifestSha256: a.manifestSha256, databaseWrites: 0, serviceActions: 0, providerCalls: 0 }));

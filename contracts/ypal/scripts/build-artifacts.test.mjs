import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  brandSource,
  runtimeCode,
  VERIFIED_INPUT_SHA256,
  VERIFIED_RECORD_SHA256
} from "./build-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const baseline = json("evidence/proto-standard-input.json");
const artifact = json("evidence/YPAL.deployment.json");
const candidate = read("src/YPAL.sol").toString();

assert.equal(
  sha(read("evidence/proto-standard-input.json")),
  VERIFIED_INPUT_SHA256
);
assert.equal(
  sha(read("evidence/verified-proto-record.json")),
  VERIFIED_RECORD_SHA256
);
assert.equal(Object.keys(baseline.sources).length, 10);
for (const [name, row] of Object.entries(baseline.sources)) {
  assert.equal(read("verified-source/" + name).toString(), row.content);
  assert.equal(
    artifact.verifiedBaseline.sources[name].sha256,
    sha(read("verified-source/" + name))
  );
}
console.log("PASS exact ten-file verified source and immutable input pins");

assert.equal(
  candidate,
  brandSource(baseline.sources["contracts/PROTO.sol"].content)
);
assert.equal(
  candidate.includes("contract YPAL is ERC20, Ownable, ReentrancyGuard"),
  true
);
assert.equal(candidate.includes('return "Yunipals";'), true);
assert.equal(candidate.includes('return "YPAL";'), true);
assert.equal(sha(Buffer.from(candidate)), artifact.sourceSha256);
assert.notEqual(
  candidate.replace(
    "_mint(msg.sender, amount)",
    "_mint(msg.sender, amount * 2)"
  ),
  brandSource(baseline.sources["contracts/PROTO.sol"].content)
);
console.log(
  "PASS branding-only transformation rejects a mint-behavior mutation"
);

assert.deepEqual(
  artifact.abi,
  JSON.parse(json("evidence/verified-proto-record.json").ABI)
);
assert.equal(artifact.constructor.owner, "msg.sender");
assert.equal(artifact.constructor.initialSupply, "0");
assert.equal(artifact.constructor.initialLocked, false);
assert.equal(artifact.runtimeBytes, 5161);
assert(artifact.runtimeBytes < 24576);
console.log(
  "PASS complete ABI and deployment constraints preserve the original"
);

const pmon = "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7";
const patched = runtimeCode(artifact, pmon);
assert.equal(patched.length, artifact.runtimeTemplate.length);
for (const row of artifact.immutableReferences) {
  assert.equal(
    patched.slice(2 + row.offset * 2, 2 + row.offset * 2 + 64),
    pmon.slice(2).toLowerCase().padStart(64, "0")
  );
}
assert.equal(artifact.immutableReferences.length, 7);
assert.throws(() => runtimeCode(artifact, "0x1234"));
assert.throws(() =>
  runtimeCode(
    {
      ...artifact,
      immutableReferences: [{ offset: 0, length: 32, value: "self" }]
    },
    pmon
  )
);
assert.throws(() =>
  runtimeCode(
    {
      ...artifact,
      immutableReferences: [{ offset: 0, length: 32, value: "pmon" }]
    },
    pmon
  )
);
console.log(
  "PASS all seven PMON immutable slots patched; malformed/foreign/nonzero slots refuse"
);

console.log(
  "4 YPAL source/artifact controls passed; no providers or transactions"
);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  OLD_CREATION_HASH,
  OLD_RUNTIME_HASH,
  OLD_SOURCE_SHA,
  preparePackage,
  runtimeCodeAt,
  validateLayouts
} from "./prepare-batch-engine-upgrade.mjs";
const require = createRequire(
  new URL("../../apps/yunipals-home-web/package.json", import.meta.url)
);
const { decodeFunctionData, getContractAddress, keccak256 } = require("viem");
const read = (name) =>
  JSON.parse(readFileSync(new URL("../../" + name, import.meta.url)));
const baseline = read(
    "contracts/boosters/test/fixtures/BoosterPacks.pre-batch.json"
  ),
  refs = read(
    "contracts/boosters/test/fixtures/BoosterPacks.pre-batch.immutable-references.json"
  ),
  artifact = read(
    "contracts/boosters/out-batch/BoosterPacks.sol/BoosterPacks.json"
  );
const prepare = (options) => preparePackage({ maxOpenPacks: 10, ...options });
test("unsigned package pins audited old engine and additive batch with no guessed nonce/address/gas", () => {
  const { package: p } = prepare();
  assert.equal(p.status, "unsigned-not-broadcast");
  assert.equal(p.chainId, 8453);
  assert.equal(
    p.currentImplementation.creationCodeKeccak256,
    OLD_CREATION_HASH
  );
  assert.equal(p.currentImplementation.runtimeCodeKeccak256, OLD_RUNTIME_HASH);
  assert.equal(p.currentImplementation.sourceSha256, OLD_SOURCE_SHA);
  assert.equal(p.upgradeTransaction, null);
  assert.equal(p.upgrade.implementationAddress, null);
  assert.equal(p.configurationCalldata, "0x");
  assert.equal(p.upgrade.initializeExistingProxy, false);
  assert(!("nonce" in p.deploymentTransaction));
  assert(!("gas" in p.deploymentTransaction));
  assert.equal(p.productionActionsPerformed, 0);
});
test("profile is explicit optimizer1 with unchanged source/storage and EIP170-sized runtime", () => {
  const { package: p, standardInput } = prepare();
  assert.equal(p.candidate.runtimeBytes, 24258);
  assert.equal(p.candidate.buildProfile, "batch");
  assert.equal(p.candidate.optimizerRuns, 1);
  assert.deepEqual(standardInput.settings.optimizer, {
    enabled: true,
    runs: 1
  });
  assert.equal(
    standardInput.sources["src/BoosterPacks.sol"].content,
    readFileSync(
      new URL("../../contracts/boosters/src/BoosterPacks.sol", import.meta.url),
      "utf8"
    )
  );
  assert.equal(p.candidate.storage.gapSlots, 41);
  assert.equal(p.candidate.storage.storageAdded, false);
});
test("explicit synthetic nonce yields two unsigned transactions and empty upgrade data", () => {
  const { package: p } = prepare({ startingNonce: "123" }),
    address = getContractAddress({ from: p.owner, nonce: 123n });
  assert.equal(p.deploymentTransaction.nonce, "0x7b");
  assert.equal(p.upgradeTransaction.nonce, "0x7c");
  const decoded = decodeFunctionData({
    abi: p.abi.upgrade,
    data: p.upgradeTransaction.data
  });
  assert.equal(decoded.functionName, "upgradeToAndCall");
  assert.deepEqual(decoded.args, [address, "0x"]);
  assert.equal(
    p.candidate.runtimeCodeKeccak256,
    keccak256(
      runtimeCodeAt(
        p.candidate.runtimeBytecodeTemplate,
        p.candidate.immutableReferences,
        address
      )
    )
  );
  assert.equal(p.nonce.freshnessVerified, false);
});
test("ambiguous invalid nonce and unreviewed batch constant are rejected", () => {
  for (const startingNonce of [
    "-1",
    "1.5",
    "0x7b",
    "0123",
    " 123",
    "18446744073709551615"
  ])
    assert.throws(() => prepare({ startingNonce }));
  for (const maxOpenPacks of [undefined, 0, 1, 11, 33])
    assert.throws(() => preparePackage({ maxOpenPacks }));
});
test("full storage equality includes original/request nested structs, pools, refunds and gap", () => {
  assert.equal(
    validateLayouts(baseline.storageLayout, artifact.storageLayout)
      .lastReservedSlot,
    48
  );
  for (const label of [
    "originals",
    "requests",
    "_pools",
    "refundCredits",
    "__gap"
  ]) {
    const changed = structuredClone(artifact.storageLayout);
    changed.storage.find((f) => f.label === label).slot = "50";
    assert.throws(
      () => validateLayouts(baseline.storageLayout, changed),
      /storage or gap/
    );
  }
  const changed = structuredClone(artifact.storageLayout),
    field = changed.storage.find((f) => f.label === "requests"),
    value = changed.types[field.type].value;
  changed.types[value].members[0].offset = 1;
  assert.throws(
    () => validateLayouts(baseline.storageLayout, changed),
    /storage or gap/
  );
});
test("historical compiler immutable offsets independently reproduce actual old runtime", () => {
  assert.equal(
    keccak256(
      runtimeCodeAt(
        baseline.runtimeBytecode,
        refs.immutableReferences,
        "0x92e2351A83b6c445c94D0b887259D2b940c82a5a"
      )
    ),
    OLD_RUNTIME_HASH
  );
  const bad = structuredClone(artifact.deployedBytecode.immutableReferences);
  Object.values(bad)[0][0].length = 20;
  assert.throws(() =>
    runtimeCodeAt(
      artifact.deployedBytecode.object,
      bad,
      "0x1111111111111111111111111111111111111111"
    )
  );
});
test("batch ABI includes total VRF price cap and quote gasPrice without changing single purchase", () => {
  const { package: p } = prepare();
  const signature = (name) => {
    const f = p.abi.batch.find((f) => f.name === name);
    return f.inputs.map((i) => i.type);
  };
  assert.deepEqual(signature("openPacks"), [
    "uint256",
    "uint32",
    "uint256",
    "uint256"
  ]);
  assert.deepEqual(signature("quoteOpenPacks"), [
    "uint256",
    "uint32",
    "uint256"
  ]);
  assert.equal(p.capability.maxOpenPacks, 10);
  assert(p.unchanged.existingSingles);
});
test("default public package bytes are reproducible and equal the reviewed public artifact", () => {
  const raw = JSON.stringify(prepare().package, null, 2) + "\n";
  assert.equal(
    raw,
    readFileSync(
      new URL(
        "../../apps/yunipals-home-web/public/boosters/engine-batch-upgrade-v1.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e"
  );
});

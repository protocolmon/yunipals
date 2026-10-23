import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  APPROVED_BATCH_SHA,
  CANDIDATE_SOURCE_SHA,
  CURRENT_IMPLEMENTATION,
  CURRENT_RUNTIME_HASH,
  CURRENT_SOURCE_SHA,
  OPEN_PERMIT_SIGNATURE,
  PERMIT_INTERFACE_SHA,
  preparePackage,
  runtimeCodeAt,
  validateCapabilities,
  validateLayouts,
  validateLegacyAbi
} from "./prepare-permit-engine-upgrade.mjs";

const require = createRequire(
  new URL("../../apps/yunipals-home-web/package.json", import.meta.url)
);
const { decodeFunctionData, getContractAddress, keccak256 } = require("viem");
const raw = (name) => readFileSync(new URL("../../" + name, import.meta.url));
const json = (name) => JSON.parse(raw(name));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const baseline = json(
  "contracts/boosters/out-batch/BoosterPacks.sol/BoosterPacks.json"
);
const artifact = json(
  "contracts/boosters/out-permit/BoosterPacks.sol/BoosterPacks.json"
);

test("default package targets the acknowledged EBA batch implementation without guessing signatures or nonce", () => {
  const { package: p } = preparePackage();
  assert.equal(p.format, "yunipals-engine-permit-upgrade-v1");
  assert.equal(p.currentImplementation.address, CURRENT_IMPLEMENTATION);
  assert.equal(
    p.currentImplementation.runtimeCodeKeccak256,
    CURRENT_RUNTIME_HASH
  );
  assert.equal(p.currentImplementation.sourceSha256, CURRENT_SOURCE_SHA);
  assert.equal(p.candidate.sourceSha256, CANDIDATE_SOURCE_SHA);
  assert.equal(p.upgradeTransaction, null);
  assert.equal(p.upgrade.implementationAddress, null);
  assert.equal(p.candidate.runtimeCodeKeccak256, null);
  assert.equal(p.configurationCalldata, "0x");
  assert.equal(p.upgrade.initializeExistingProxy, false);
  assert(!("nonce" in p.deploymentTransaction));
  assert(!("gas" in p.deploymentTransaction));
  assert.equal(p.productionActionsPerformed, 0);
});

test("explicit permit profile fits EIP170 and retains all three existing batch capabilities", () => {
  const { package: p, standardInput } = preparePackage();
  assert.equal(p.candidate.buildProfile, "permit");
  assert.equal(p.candidate.optimizerRuns, 1);
  assert.equal(p.candidate.runtimeBytes, 24569);
  assert(p.candidate.runtimeBytes <= 24576);
  assert.deepEqual(standardInput.settings.optimizer, {
    enabled: true,
    runs: 1
  });
  assert.equal(p.capability.maxOpenPacks, 10);
  assert.equal(
    p.capability.openSignature,
    "openPacks(uint256,uint32,uint256,uint256)"
  );
  assert.equal(
    p.capability.quoteSignature,
    "quoteOpenPacks(uint256,uint32,uint256)"
  );
  assert.equal(p.capability.permitVersion, 1);
  assert.equal(p.capability.openPermitSignature, OPEN_PERMIT_SIGNATURE);
  const permit = p.abi.permit.find(
    (item) => item.name === "openPacksWithPermit"
  );
  assert.equal(permit.stateMutability, "payable");
  assert.deepEqual(permit.outputs, []);
});

test("all ten storage rows, original/request structs and the 49-slot prefix remain unchanged", () => {
  const result = validateLayouts(
    baseline.storageLayout,
    artifact.storageLayout
  );
  assert.equal(result.allLayoutRowsPreserved, 10);
  assert.equal(result.gapSlots, 41);
  assert.equal(result.lastReservedSlot, 48);
  assert.equal(result.storageAdded, false);
  const changed = structuredClone(artifact.storageLayout);
  changed.storage.find((field) => field.label === "refundCredits").slot = "50";
  assert.throws(
    () => validateLayouts(baseline.storageLayout, changed),
    /storage or gap/
  );
  const nested = structuredClone(artifact.storageLayout);
  const type = nested.storage.find((field) => field.label === "requests").type;
  nested.types[nested.types[type].value].members[0].offset = 1;
  assert.throws(
    () => validateLayouts(baseline.storageLayout, nested),
    /storage or gap/
  );
});

test("all 75 old ABI entries survive exactly and malformed permit or duplicate capability is rejected", () => {
  assert.equal(baseline.abi.length, 75);
  assert.equal(artifact.abi.length, 77);
  validateLegacyAbi(baseline.abi, artifact.abi);
  const oldChanged = structuredClone(artifact.abi);
  oldChanged.find((item) => item.name === "openPack").inputs[0].type =
    "uint128";
  assert.throws(
    () => validateLegacyAbi(baseline.abi, oldChanged),
    /existing ABI changed/
  );
  const changed = structuredClone(artifact.abi);
  changed.find((item) => item.name === "openPacksWithPermit").outputs = [
    { name: "id", type: "uint256" }
  ];
  assert.throws(() => validateCapabilities(changed, 10, 1), /RequestCreated/);
  const duplicated = [
    ...artifact.abi,
    artifact.abi.find((item) => item.name === "PERMIT_OPEN_VERSION")
  ];
  assert.throws(
    () => validateLegacyAbi(baseline.abi, duplicated),
    /duplicate candidate ABI/
  );
});

test("standard input preserves every old source dependency and hashes the single new permit interface", () => {
  const { package: p, standardInput } = preparePackage();
  const prior = json(
    "docs/boosters/batch-engine-upgrade-2026-10-23/solc-standard-input.json"
  );
  assert.equal(Object.keys(prior.sources).length, 42);
  assert.equal(Object.keys(standardInput.sources).length, 43);
  for (const [name, source] of Object.entries(prior.sources))
    if (name !== "src/BoosterPacks.sol")
      assert.equal(standardInput.sources[name].content, source.content);
  const addition = "lib/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";
  assert.equal(
    sha(standardInput.sources[addition].content),
    PERMIT_INTERFACE_SHA
  );
  assert.equal(p.baseline.approvedBatchPackageSha256, APPROVED_BATCH_SHA);
  assert.equal(
    sha(raw(p.baseline.approvedBatchPackagePath)),
    APPROVED_BATCH_SHA
  );
});

test("only an explicit synthetic nonce creates two unsigned transactions with empty upgrade initialization", () => {
  const { package: p } = preparePackage({ startingNonce: "123" });
  const expected = getContractAddress({ from: p.owner, nonce: 123n });
  assert.equal(p.deploymentTransaction.nonce, "0x7b");
  assert.equal(p.upgradeTransaction.nonce, "0x7c");
  const decoded = decodeFunctionData({
    abi: p.abi.upgrade,
    data: p.upgradeTransaction.data
  });
  assert.equal(decoded.functionName, "upgradeToAndCall");
  assert.deepEqual(decoded.args, [expected, "0x"]);
  assert.equal(
    p.candidate.runtimeCodeKeccak256,
    keccak256(
      runtimeCodeAt(
        p.candidate.runtimeBytecodeTemplate,
        p.candidate.immutableReferences,
        expected
      )
    )
  );
  assert.equal(p.nonce.freshnessVerified, false);
});

test("invalid or ambiguous nonces and unreviewed constants cannot produce a package", () => {
  for (const startingNonce of [
    "-1",
    "1.5",
    "0x7b",
    "0123",
    " 123",
    "18446744073709551615",
    9007199254740992
  ])
    assert.throws(() => preparePackage({ startingNonce }));
  for (const maxOpenPacks of [0, 1, 11, 33])
    assert.throws(() => preparePackage({ maxOpenPacks }));
  for (const permitVersion of [0, 2, "1"])
    assert.throws(() => preparePackage({ permitVersion }));
});

test("address-patched runtime independently reproduces the actual activated baseline and rejects malformed spans", () => {
  assert.equal(
    keccak256(
      runtimeCodeAt(
        baseline.deployedBytecode.object,
        baseline.deployedBytecode.immutableReferences,
        CURRENT_IMPLEMENTATION
      )
    ),
    CURRENT_RUNTIME_HASH
  );
  const bad = structuredClone(artifact.deployedBytecode.immutableReferences);
  Object.values(bad)[0][0].length = 20;
  assert.throws(() =>
    runtimeCodeAt(artifact.deployedBytecode.object, bad, CURRENT_IMPLEMENTATION)
  );
});

test("default package and standard input are deterministic and equal the prepared public artifacts", () => {
  const first = preparePackage(),
    second = preparePackage();
  assert.deepEqual(first, second);
  const encoded = JSON.stringify(first.package, null, 2) + "\n";
  assert.equal(
    encoded,
    raw(
      "docs/boosters/permit-engine-upgrade-2026-10-23/upgrade.unsigned.json"
    ).toString()
  );
  assert.equal(
    sha(encoded),
    "ee7eb521a91a761192a915c64bd50ff16d03143c78ecd44452cecc87bc912afc"
  );
  assert.equal(
    JSON.stringify(first.standardInput, null, 2) + "\n",
    raw(
      "docs/boosters/permit-engine-upgrade-2026-10-23/solc-standard-input.json"
    ).toString()
  );
});

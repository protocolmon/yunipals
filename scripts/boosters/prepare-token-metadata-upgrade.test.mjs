import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  METADATA_BASE,
  OLD_RUNTIME_HASH,
  preparePackage,
  runtimeCodeAt,
  validateLayouts
} from "./prepare-token-metadata-upgrade.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(
  path.join(root, "apps/yunipals-home-web/package.json")
);
const { decodeFunctionData, getContractAddress, keccak256 } = require("viem");
const artifact = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "contracts/boosters/out/YunipalMonsters.sol/YunipalMonsters.json"
    )
  )
);
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "contracts/boosters/test/fixtures/YunipalMonsters.deployed-baseline.json"
    )
  )
);

test("wallet-prepared package has exact scope and never invents nonce, gas or implementation", () => {
  const { package: pkg } = preparePackage();
  assert.equal(pkg.chainId, 8453);
  assert.equal(pkg.metadataBaseURI, METADATA_BASE);
  assert.equal(pkg.metadataProbe.url, `${METADATA_BASE}1.json`);
  assert.equal(pkg.metadataProbe.tokenId, "1");
  assert.equal(pkg.metadataProbe.originalTokenId, "1");
  assert.equal(pkg.metadataProbe.birthDay, 0);
  assert.equal(pkg.upgradeTransaction, null);
  assert.equal(pkg.upgrade.implementationAddress, null);
  assert.equal(pkg.candidate.runtimeCodeKeccak256, null);
  assert.equal("nonce" in pkg.deploymentTransaction, false);
  assert.equal("gas" in pkg.deploymentTransaction, false);
  assert.equal(
    pkg.currentImplementation.runtimeCodeKeccak256,
    OLD_RUNTIME_HASH
  );
  assert.deepEqual(
    decodeFunctionData({
      abi: pkg.abi.configuration,
      data: pkg.configurationCalldata
    }).args,
    [METADATA_BASE]
  );
  assert.equal(pkg.productionActionsPerformed, 0);
});

test("explicit synthetic nonce produces two unsigned transactions and atomic exact-URI call", () => {
  // Synthetic offline nonce; this is not a claim about the wallet's current state.
  const { package: pkg } = preparePackage({ startingNonce: "123" });
  const address = getContractAddress({ from: pkg.owner, nonce: 123n });
  assert.equal(pkg.deploymentTransaction.nonce, "0x7b");
  assert.equal(pkg.upgradeTransaction.nonce, "0x7c");
  assert.equal(pkg.upgradeTransaction.to, pkg.proxy);
  const decoded = decodeFunctionData({
    abi: pkg.abi.upgrade,
    data: pkg.upgradeTransaction.data
  });
  assert.equal(decoded.functionName, "upgradeToAndCall");
  assert.equal(decoded.args[0], address);
  assert.equal(decoded.args[1], pkg.configurationCalldata);
  assert.equal(
    pkg.candidate.runtimeCodeKeccak256,
    keccak256(
      runtimeCodeAt(
        pkg.candidate.runtimeBytecodeTemplate,
        pkg.candidate.immutableReferences,
        address
      )
    )
  );
  assert.equal(pkg.nonce.freshnessVerified, false);
});

test("invalid or ambiguous nonce input is refused", () => {
  for (const value of [
    "-1",
    "1.1",
    "0x7b",
    "0123",
    " 123",
    "18446744073709551615"
  ]) {
    assert.throws(() => preparePackage({ startingNonce: value }));
  }
});

test("storage validator rejects provenance edits and wrong gap consumption", () => {
  assert.equal(
    validateLayouts(baseline.storageLayout, artifact.storageLayout)
      .lastReservedSlot,
    49
  );
  const changed = structuredClone(artifact.storageLayout);
  const provenance = changed.storage.find(
    (field) => field.label === "provenance"
  );
  const value = changed.types[provenance.type].value;
  changed.types[value].members[2].offset = 1;
  assert.throws(
    () => validateLayouts(baseline.storageLayout, changed),
    /existing storage/
  );
  const moved = structuredClone(artifact.storageLayout);
  moved.storage[5].slot = "6";
  assert.throws(() => validateLayouts(baseline.storageLayout, moved));
});

test("runtime verifier pins actual historical code and rejects malformed immutable references", () => {
  assert.equal(
    keccak256(
      runtimeCodeAt(
        baseline.runtimeBytecodeTemplate,
        baseline.immutableReferences,
        "0xDe0f58649B6D272E4b7AFAeE1231F2c83c1599b9"
      )
    ),
    OLD_RUNTIME_HASH
  );
  const references = structuredClone(
    artifact.deployedBytecode.immutableReferences
  );
  Object.values(references)[0][0].length = 20;
  assert.throws(() =>
    runtimeCodeAt(
      artifact.deployedBytecode.object,
      references,
      "0xDe0f58649B6D272E4b7AFAeE1231F2c83c1599b9"
    )
  );
});

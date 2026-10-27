import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runtimeCodeAt,
  UPGRADE_ABI,
  validateLayouts
} from "./prepare-batch-engine-upgrade.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(
  path.join(root, "apps/yunipals-home-web/package.json")
);
const {
  encodeFunctionData,
  getContractAddress,
  keccak256,
  toHex
} = require("viem");
export { runtimeCodeAt, validateLayouts };
export const CURRENT_IMPLEMENTATION =
  "0xeba9D4dEB6914Ab67A820Ea27C2fC3F43812E471";
export const CURRENT_RUNTIME_HASH =
  "0xa5eadd4114e6f37b1189c9729f3ea7a03ef21675ccdf69d8b3da0d6aa522ee7a";
export const CURRENT_SOURCE_SHA =
  "bd3ce4e82ac079c52bc666912178e7057cbe7e187a77a5f2cf86f7e64597250d";
export const CANDIDATE_SOURCE_SHA =
  "6006e9a0ce44302ee14ebbdb43d49ed07746a0766278885c5958783a6085cfd8";
export const APPROVED_BATCH_SHA =
  "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e";
export const ACTIVATION_SHA =
  "bfcca8966ec90efa9d084663fe759fc473c3a590cb910b4f90097304e8d7011c";
export const PRIOR_INPUT_SHA =
  "f66676caa22a03b578f154d5adf09d0e4099f001cff308aa1884aa6f8e642e9c";
export const PERMIT_INTERFACE_SHA =
  "e3e2cd98b7a5b9cba47c4ccec3685fdaf838a00e5d6f188b289907f9a6d0b58f";
export const OPEN_PERMIT_SIGNATURE =
  "openPacksWithPermit(uint256,uint32,uint256,uint256,uint8,bytes32,bytes32)";
const dir = "docs/boosters/permit-engine-upgrade-2026-10-23";
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const canonicalType = (item) =>
  item.type.startsWith("tuple")
    ? "(" +
      item.components.map(canonicalType).join(",") +
      ")" +
      item.type.slice(5)
    : item.type;
const abiKey = (item) =>
  item.type +
  ":" +
  (item.name ?? "") +
  "(" +
  (item.inputs ?? []).map(canonicalType).join(",") +
  ")";

export function validateLegacyAbi(before, after) {
  const next = new Map(after.map((item) => [abiKey(item), item]));
  assert.equal(next.size, after.length, "duplicate candidate ABI entry");
  for (const item of before)
    assert.deepEqual(
      next.get(abiKey(item)),
      item,
      "existing ABI changed: " + abiKey(item)
    );
  const selectors = after
    .filter((item) => item.type === "function")
    .map((item) =>
      keccak256(
        toHex(item.name + "(" + item.inputs.map(canonicalType).join(",") + ")")
      ).slice(0, 10)
    );
  assert.equal(
    new Set(selectors).size,
    selectors.length,
    "function selector collision"
  );
}

export function validateCapabilities(abi, maxOpenPacks, permitVersion) {
  assert.equal(maxOpenPacks, 10, "reviewed ten-pack limit required");
  assert.equal(permitVersion, 1, "reviewed permit version required");
  const signature = (name) => {
    const rows = abi.filter(
      (item) => item.type === "function" && item.name === name
    );
    assert.equal(rows.length, 1, "one capability function required: " + name);
    return {
      item: rows[0],
      signature: name + "(" + rows[0].inputs.map(canonicalType).join(",") + ")"
    };
  };
  const permit = signature("openPacksWithPermit");
  assert.equal(permit.signature, OPEN_PERMIT_SIGNATURE);
  assert.equal(permit.item.stateMutability, "payable");
  assert.deepEqual(
    permit.item.outputs,
    [],
    "permit purchase uses RequestCreated events, not return values"
  );
  const version = signature("PERMIT_OPEN_VERSION");
  assert.equal(version.signature, "PERMIT_OPEN_VERSION()");
  assert.deepEqual(
    version.item.outputs.map((item) => item.type),
    ["uint256"]
  );
  assert.equal(
    signature("openPacks").signature,
    "openPacks(uint256,uint32,uint256,uint256)"
  );
  assert.equal(
    signature("quoteOpenPacks").signature,
    "quoteOpenPacks(uint256,uint32,uint256)"
  );
  assert.equal(signature("MAX_OPEN_PACKS").signature, "MAX_OPEN_PACKS()");
  return {
    maxOpenPacks,
    openSignature: "openPacks(uint256,uint32,uint256,uint256)",
    quoteSignature: "quoteOpenPacks(uint256,uint32,uint256)",
    permitVersion,
    openPermitSignature: OPEN_PERMIT_SIGNATURE
  };
}

export function preparePackage({
  startingNonce = null,
  maxOpenPacks = 10,
  permitVersion = 1
} = {}) {
  if (startingNonce !== null) {
    assert.ok(
      typeof startingNonce === "string" ||
        typeof startingNonce === "bigint" ||
        Number.isSafeInteger(startingNonce)
    );
    assert.match(String(startingNonce), /^(0|[1-9][0-9]*)$/);
    startingNonce = BigInt(startingNonce);
    assert.ok(startingNonce < (1n << 64n) - 1n);
  }
  const oldPath =
    "docs/boosters/batch-engine-upgrade-2026-10-23/upgrade.unsigned.json";
  assert.equal(sha(read(oldPath)), APPROVED_BATCH_SHA);
  assert.equal(
    sha(
      read(
        "apps/yunipals-home-web/public/boosters/engine-batch-upgrade-v1.json"
      )
    ),
    APPROVED_BATCH_SHA
  );
  const old = json(oldPath);
  const activationPath =
    "docs/boosters/batch-engine-upgrade-2026-10-23/mainnet-activation.json";
  assert.equal(sha(read(activationPath)), ACTIVATION_SHA);
  const activation = json(activationPath);
  assert.equal(activation.format, "yunipals-batch-mainnet-activation-v1");
  assert.equal(activation.chainId, 8453);
  assert.equal(activation.implementation, CURRENT_IMPLEMENTATION);
  assert.equal(activation.implementationRuntimeKeccak256, CURRENT_RUNTIME_HASH);
  assert.equal(activation.upgradeComplete, true);
  assert.equal(activation.runtimeMatchesApprovedPackage, true);
  assert.equal(activation.existingDependenciesPreserved, true);
  assert.equal(activation.maximumPacks, 10);
  assert.equal(activation.owner, old.owner);
  assert.equal(activation.proxy, old.proxy);
  const baseline = json(
    "contracts/boosters/out-batch/BoosterPacks.sol/BoosterPacks.json"
  );
  assert.equal(
    keccak256(baseline.bytecode.object),
    old.candidate.creationCodeKeccak256
  );
  assert.equal(
    baseline.deployedBytecode.object,
    old.candidate.runtimeBytecodeTemplate
  );
  assert.deepEqual(
    baseline.deployedBytecode.immutableReferences,
    old.candidate.immutableReferences
  );
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
  const inputPath =
    "docs/boosters/batch-engine-upgrade-2026-10-23/solc-standard-input.json";
  assert.equal(sha(read(inputPath)), PRIOR_INPUT_SHA);
  const prior = json(inputPath);
  assert.equal(
    sha(prior.sources["src/BoosterPacks.sol"].content),
    CURRENT_SOURCE_SHA
  );
  const artifact = json(
    "contracts/boosters/out-permit/BoosterPacks.sol/BoosterPacks.json"
  );
  const metadata = artifact.metadata;
  assert.equal(metadata.compiler.version, "0.8.30+commit.73712a01");
  assert.equal(metadata.settings.viaIR, true);
  assert.equal(metadata.settings.evmVersion, "cancun");
  assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 1 });
  assert.deepEqual(metadata.settings.metadata, { bytecodeHash: "none" });
  assert.deepEqual(metadata.settings.libraries, {});
  assert.deepEqual(artifact.bytecode.linkReferences, {});
  assert.equal(
    sha(read("contracts/boosters/src/BoosterPacks.sol")),
    CANDIDATE_SOURCE_SHA
  );
  assert.match(
    read("contracts/boosters/src/BoosterPacks.sol").toString(),
    /uint32\s+public\s+constant\s+MAX_OPEN_PACKS\s*=\s*10\s*;/
  );
  assert.match(
    read("contracts/boosters/src/BoosterPacks.sol").toString(),
    /uint256\s+public\s+constant\s+PERMIT_OPEN_VERSION\s*=\s*1\s*;/
  );
  const capability = validateCapabilities(
    artifact.abi,
    maxOpenPacks,
    permitVersion
  );
  validateLegacyAbi(baseline.abi, artifact.abi);
  const storage = validateLayouts(
    baseline.storageLayout,
    artifact.storageLayout
  );
  const sources = {},
    additions = [];
  for (const [name, expected] of Object.entries(metadata.sources)) {
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
    const content = read("contracts/boosters/" + name).toString();
    assert.equal(
      keccak256(toHex(content)),
      expected.keccak256,
      "compiled source is stale: " + name
    );
    if (name !== "src/BoosterPacks.sol") {
      if (prior.sources[name])
        assert.equal(
          content,
          prior.sources[name].content,
          "unrelated dependency changed: " + name
        );
      else {
        assert.equal(
          name,
          "lib/openzeppelin/token/ERC20/extensions/IERC20Permit.sol"
        );
        assert.equal(sha(content), PERMIT_INTERFACE_SHA);
        additions.push({ path: name, sha256: PERMIT_INTERFACE_SHA });
      }
    }
    sources[name] = { content };
  }
  assert.equal(additions.length, 1);
  for (const name of Object.keys(prior.sources))
    assert.ok(sources[name], "old source dependency omitted: " + name);
  const settings = structuredClone(metadata.settings);
  delete settings.compilationTarget;
  settings.outputSelection = {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"]
    }
  };
  const creation = artifact.bytecode.object,
    template = artifact.deployedBytecode.object,
    refs = artifact.deployedBytecode.immutableReferences;
  const runtimeBytes = (template.length - 2) / 2;
  assert.equal(runtimeBytes, 24569);
  assert.ok(runtimeBytes <= 24576);
  assert.ok((creation.length - 2) / 2 <= 49152);
  const predicted =
    startingNonce === null
      ? null
      : getContractAddress({ from: old.owner, nonce: startingNonce });
  const data =
    predicted === null
      ? null
      : encodeFunctionData({
          abi: UPGRADE_ABI,
          functionName: "upgradeToAndCall",
          args: [predicted, "0x"]
        });
  return {
    package: {
      format: "yunipals-engine-permit-upgrade-v1",
      status: "unsigned-not-broadcast",
      chainId: 8453,
      owner: old.owner,
      proxy: old.proxy,
      proxyRuntimeCodeKeccak256: old.proxyRuntimeCodeKeccak256,
      implementationSlot: old.implementationSlot,
      roles: old.roles,
      currentImplementation: {
        address: CURRENT_IMPLEMENTATION,
        creationCodeKeccak256: keccak256(baseline.bytecode.object),
        runtimeCodeKeccak256: CURRENT_RUNTIME_HASH,
        sourceSha256: CURRENT_SOURCE_SHA
      },
      candidate: {
        sourceSha256: CANDIDATE_SOURCE_SHA,
        compiler: metadata.compiler.version,
        buildProfile: "permit",
        optimizerRuns: 1,
        creationBytecode: creation,
        creationCodeKeccak256: keccak256(creation),
        runtimeBytecodeTemplate: template,
        runtimeTemplateKeccak256: keccak256(template),
        immutableReferences: refs,
        runtimeCodeKeccak256:
          predicted === null
            ? null
            : keccak256(runtimeCodeAt(template, refs, predicted)),
        runtimeBytes,
        storage
      },
      capability,
      configurationCalldata: "0x",
      abi: {
        upgrade: UPGRADE_ABI,
        batch: artifact.abi.filter(
          (item) =>
            item.type === "function" &&
            ["openPacks", "quoteOpenPacks", "MAX_OPEN_PACKS"].includes(
              item.name
            )
        ),
        permit: artifact.abi.filter(
          (item) =>
            item.type === "function" &&
            ["openPacksWithPermit", "PERMIT_OPEN_VERSION"].includes(item.name)
        ),
        engine: artifact.abi
      },
      deploymentTransaction: {
        from: old.owner,
        chainId: "0x2105",
        value: "0x0",
        data: creation,
        ...(startingNonce === null ? {} : { nonce: toHex(startingNonce) })
      },
      upgradeTransaction:
        predicted === null
          ? null
          : {
              from: old.owner,
              to: old.proxy,
              chainId: "0x2105",
              value: "0x0",
              data,
              nonce: toHex(startingNonce + 1n)
            },
      upgrade: {
        functionName: "upgradeToAndCall",
        implementationAddress: predicted,
        calldata: data,
        atomicConfigurationCalldata: "0x",
        initializeExistingProxy: false
      },
      nonce: {
        supplied: startingNonce !== null,
        startingNonce: startingNonce?.toString() ?? null,
        freshnessVerified: false
      },
      gas: {
        estimated: false,
        limitsSupplied: false,
        note: "Use fresh wallet gas/fee estimates and the actual deployment receipt. No nonce or implementation address is guessed."
      },
      unchanged: {
        ...old.unchanged,
        existingBatches: true,
        permitExactTotalOnly: true,
        originalPayerAndRecipient: true
      },
      baseline: {
        approvedBatchPackagePath: oldPath,
        approvedBatchPackageSha256: APPROVED_BATCH_SHA,
        activationRecordPath: activationPath,
        activationRecordSha256: ACTIVATION_SHA,
        standardInputPath: inputPath,
        standardInputSha256: PRIOR_INPUT_SHA,
        interfaceAddition: additions[0]
      },
      signingPreconditions: [
        "Verify Base8453, owner/UPGRADER_ROLE, proxy/current eba9 implementation/runtime and unchanged registry/monsters/wrapper before each signature.",
        "Require actual deployment receipt, address-patched immutable runtime, proxiableUUID, MAX_OPEN_PACKS=10 and PERMIT_OPEN_VERSION=1 before upgrade.",
        "Explicitly sign upgradeToAndCall(actualImplementation,0x); never initialize the existing proxy again.",
        "Confirm the post-upgrade proxy implementation/runtime and both capability getters. Keep pack rules, pending requests, refunds and recovery state unchanged.",
        "This package neither signs a token permit nor purchases a pack. A buyer later authorizes the exact token price×count for this engine and their own address."
      ],
      productionActionsPerformed: 0
    },
    standardInput: { language: "Solidity", sources, settings }
  };
}

function writeExact(name, raw) {
  if (fs.existsSync(name))
    assert.equal(
      fs.readFileSync(name, "utf8"),
      raw,
      "refusing to overwrite a different prepared artifact"
    );
  else fs.writeFileSync(name, raw, { flag: "wx" });
}
function main() {
  const args = process.argv.slice(2);
  let output = dir,
    startingNonce = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) output = args[++i];
    else if (args[i] === "--starting-nonce" && args[i + 1])
      startingNonce = args[++i];
    else throw Error("Unknown or incomplete preparation argument: " + args[i]);
  }
  const result = preparePackage({ startingNonce });
  const destination = path.resolve(root, output);
  fs.mkdirSync(destination, { recursive: true });
  const raw = JSON.stringify(result.package, null, 2) + "\n";
  writeExact(path.join(destination, "upgrade.unsigned.json"), raw);
  writeExact(
    path.join(destination, "solc-standard-input.json"),
    JSON.stringify(result.standardInput, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      packageSha256: sha(raw),
      runtimeBytes: result.package.candidate.runtimeBytes,
      maxOpenPacks: 10,
      permitVersion: 1,
      status: result.package.status,
      productionActionsPerformed: 0
    })
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();

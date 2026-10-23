import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(
  path.join(root, "apps/yunipals-home-web/package.json")
);
const {
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  toHex
} = require("viem");
export const METADATA_BASE =
  "https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/0x105319be2182018c31fb10b1be198c3cf238a146/";
export const OLD_CREATION_HASH =
  "0xb5cd2840832687faf05dabe39f08208e527d9324802a626f9858f683fb7c47b3";
export const OLD_RUNTIME_HASH =
  "0x09e61c7fccf7ce686723d2134f7903748395df6018ccc9860ebe5661b6344b38";
export const UPGRADE_ABI = [
  {
    type: "function",
    name: "upgradeToAndCall",
    stateMutability: "payable",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" }
    ],
    outputs: []
  }
];
export const CONFIG_ABI = [
  {
    type: "function",
    name: "setTokenMetadataBaseURI",
    stateMutability: "nonpayable",
    inputs: [{ name: "baseURI", type: "string" }],
    outputs: []
  }
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (relative) => fs.readFileSync(path.join(root, relative));
const json = (relative) => JSON.parse(read(relative));

function shape(layout, type) {
  const value = layout.types[type];
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["astId", "contract"].includes(key))
      .map(([key, item]) => [
        key,
        ["key", "value", "base"].includes(key)
          ? shape(layout, item)
          : key === "members"
            ? item.map((member) => ({
                label: member.label,
                slot: member.slot,
                offset: member.offset,
                type: shape(layout, member.type)
              }))
            : item
      ])
  );
}

export function validateLayouts(previous, current) {
  const fields = (layout) =>
    layout.storage.map((field) => ({
      label: field.label,
      slot: field.slot,
      offset: field.offset,
      type: shape(layout, field.type)
    }));
  const old = fields(previous);
  const next = fields(current);
  assert.equal(old.length, 5);
  assert.equal(next.length, 6);
  assert.deepEqual(
    next.slice(0, 4),
    old.slice(0, 4),
    "existing storage or provenance changed"
  );
  assert.equal(old[4].label, "__gap");
  assert.equal(old[4].slot, "4");
  assert.equal(old[4].type.numberOfBytes, "1472");
  assert.deepEqual(next[4], {
    label: "tokenMetadataBaseURI",
    slot: "4",
    offset: 0,
    type: { encoding: "bytes", label: "string", numberOfBytes: "32" }
  });
  assert.equal(next[5].label, "__gap");
  assert.equal(next[5].slot, "5");
  assert.equal(next[5].type.numberOfBytes, "1440");
  assert.deepEqual(next[5].type.base, old[4].type.base);
  return {
    existingFieldsPreserved: 4,
    provenanceStructUnchanged: true,
    tokenMetadataBaseURISlot: 4,
    previousGapSlots: 46,
    remainingGapSlots: 45,
    lastReservedSlot: 49
  };
}

export function runtimeCodeAt(template, references, implementation) {
  assert.match(template, /^0x(?:[a-fA-F0-9]{2})+$/);
  const spans = Object.values(references)
    .flat()
    .sort((a, b) => a.start - b.start);
  assert.equal(
    Object.keys(references).length,
    1,
    "unexpected immutable variable"
  );
  assert.equal(spans.length, 2, "expected UUPS __self at two offsets");
  let result = template.slice(2);
  let previousEnd = 0;
  for (const { start, length } of spans) {
    assert.ok(
      Number.isSafeInteger(start) &&
        start >= previousEnd &&
        length === 32 &&
        (start + length) * 2 <= result.length
    );
    assert.equal(
      result.slice(start * 2, (start + length) * 2),
      "0".repeat(64),
      "immutable template not zero"
    );
    result =
      result.slice(0, start * 2) +
      getAddress(implementation).slice(2).toLowerCase().padStart(64, "0") +
      result.slice((start + length) * 2);
    previousEnd = start + length;
  }
  return `0x${result}`;
}

export function preparePackage({ startingNonce = null } = {}) {
  if (startingNonce !== null) {
    assert.match(
      String(startingNonce),
      /^(0|[1-9][0-9]*)$/,
      "nonce must be explicit unsigned decimal"
    );
    startingNonce = BigInt(startingNonce);
    assert.ok(startingNonce < (1n << 64n) - 1n, "nonce out of range");
  }
  const artifactPath =
    "contracts/boosters/out/YunipalMonsters.sol/YunipalMonsters.json";
  const baselinePath =
    "contracts/boosters/test/fixtures/YunipalMonsters.deployed-baseline.json";
  const sourcePath = "contracts/boosters/src/YunipalMonsters.sol";
  const artifact = json(artifactPath);
  const baseline = json(baselinePath);
  const oldPlan = json("docs/boosters/mainnet-smoke/deployment.unsigned.json");
  const confirmed = json(
    "docs/boosters/mainnet-smoke/deployment.confirmed.json"
  );
  const oldInput = json(
    "docs/boosters/mainnet-smoke/verification/solc-standard-input.json"
  );
  const owner = confirmed.admin;
  const proxy = confirmed.contracts.monsters.proxy;
  const oldImplementation = confirmed.contracts.monsters.implementation;
  const proxyArtifact = json(
    "contracts/boosters/out/ERC1967Proxy.sol/ERC1967Proxy.json"
  );
  assert.equal(confirmed.chainId, 8453);
  assert.equal(owner, "0xB3883Cd96d72B08b8226452305A28D65974a3727");
  assert.equal(
    proxy.toLowerCase(),
    "0x105319be2182018c31fb10b1be198c3cf238a146"
  );
  assert.equal(keccak256(baseline.creationBytecode), OLD_CREATION_HASH);
  assert.equal(
    oldPlan.transactions[2].unsigned.data,
    baseline.creationBytecode
  );
  assert.equal(
    sha(Buffer.from(oldInput.sources["src/YunipalMonsters.sol"].content)),
    baseline.sourceSha256
  );
  assert.equal(
    keccak256(
      runtimeCodeAt(
        baseline.runtimeBytecodeTemplate,
        baseline.immutableReferences,
        oldImplementation
      )
    ),
    OLD_RUNTIME_HASH
  );
  assert.equal(
    keccak256(proxyArtifact.deployedBytecode.object),
    oldPlan.transactions[3].runtimeCodeKeccak256
  );
  const storage = validateLayouts(
    baseline.storageLayout,
    artifact.storageLayout
  );
  const metadata = artifact.metadata;
  assert.equal(metadata.compiler.version, "0.8.30+commit.73712a01");
  assert.equal(metadata.settings.evmVersion, "cancun");
  assert.equal(metadata.settings.viaIR, true);
  assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 200 });
  assert.deepEqual(metadata.settings.metadata, { bytecodeHash: "none" });
  assert.deepEqual(metadata.settings.libraries, {});
  assert.deepEqual(artifact.bytecode.linkReferences, {});
  const sources = {};
  for (const [source, expectation] of Object.entries(metadata.sources)) {
    assert.ok(!source.startsWith("/") && !source.split("/").includes(".."));
    const content = read(`contracts/boosters/${source}`).toString();
    assert.equal(
      keccak256(toHex(content)),
      expectation.keccak256,
      `compiled source is stale: ${source}`
    );
    if (["src/BoosterAdmin.sol", "src/PackRegistry.sol"].includes(source)) {
      assert.equal(
        content,
        oldInput.sources[source].content,
        `unrelated contract changed: ${source}`
      );
    }
    sources[source] = { content };
  }
  const settings = structuredClone(metadata.settings);
  delete settings.compilationTarget;
  settings.outputSelection = {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"]
    }
  };
  const standardInput = { language: "Solidity", sources, settings };
  const configurationCalldata = encodeFunctionData({
    abi: CONFIG_ABI,
    functionName: "setTokenMetadataBaseURI",
    args: [METADATA_BASE]
  });
  const deploymentTransaction = {
    from: owner,
    chainId: "0x2105",
    value: "0x0",
    data: artifact.bytecode.object
  };
  const predictedImplementation =
    startingNonce === null
      ? null
      : getContractAddress({ from: owner, nonce: startingNonce });
  const upgradeTransaction =
    predictedImplementation === null
      ? null
      : {
          from: owner,
          to: proxy,
          chainId: "0x2105",
          nonce: toHex(startingNonce + 1n),
          value: "0x0",
          data: encodeFunctionData({
            abi: UPGRADE_ABI,
            functionName: "upgradeToAndCall",
            args: [predictedImplementation, configurationCalldata]
          })
        };
  if (startingNonce !== null)
    deploymentTransaction.nonce = toHex(startingNonce);
  const candidate = {
    sourceSha256: sha(read(sourcePath)),
    compiler: metadata.compiler.version,
    creationBytecode: artifact.bytecode.object,
    creationCodeKeccak256: keccak256(artifact.bytecode.object),
    runtimeBytecodeTemplate: artifact.deployedBytecode.object,
    runtimeTemplateKeccak256: keccak256(artifact.deployedBytecode.object),
    immutableReferences: artifact.deployedBytecode.immutableReferences,
    runtimeCodeKeccak256:
      predictedImplementation === null
        ? null
        : keccak256(
            runtimeCodeAt(
              artifact.deployedBytecode.object,
              artifact.deployedBytecode.immutableReferences,
              predictedImplementation
            )
          ),
    runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
    storage
  };
  assert.ok(candidate.runtimeBytes <= 24576, "EIP170 code size exceeded");
  // Validate the immutable layout even when the wallet will choose the nonce later.
  runtimeCodeAt(
    candidate.runtimeBytecodeTemplate,
    candidate.immutableReferences,
    oldImplementation
  );
  return {
    package: {
      format: "yunipals-monsters-token-metadata-upgrade-v1",
      status: "unsigned-not-broadcast",
      chainId: 8453,
      owner,
      proxy,
      proxyRuntimeCodeKeccak256: oldPlan.transactions[3].runtimeCodeKeccak256,
      implementationSlot:
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      roles: {
        upgrader: {
          name: "UPGRADER_ROLE",
          id: keccak256(toHex("UPGRADER_ROLE"))
        },
        configuration: {
          name: "CONFIG_ROLE",
          id: keccak256(toHex("CONFIG_ROLE"))
        },
        administrator: {
          name: "DEFAULT_ADMIN_ROLE",
          id: `0x${"00".repeat(32)}`
        }
      },
      currentImplementation: {
        address: oldImplementation,
        creationCodeKeccak256: OLD_CREATION_HASH,
        runtimeCodeKeccak256: OLD_RUNTIME_HASH,
        sourceSha256: baseline.sourceSha256
      },
      candidate,
      metadataBaseURI: METADATA_BASE,
      configurationCalldata,
      abi: { configuration: CONFIG_ABI, upgrade: UPGRADE_ABI },
      upgrade: {
        functionName: "upgradeToAndCall",
        implementationAddress: predictedImplementation,
        calldata: upgradeTransaction?.data ?? null,
        atomicConfigurationCalldata: configurationCalldata
      },
      deploymentTransaction,
      upgradeTransaction,
      nonce: {
        supplied: startingNonce !== null,
        startingNonce: startingNonce?.toString() ?? null,
        freshnessVerified: false
      },
      gas: {
        estimated: false,
        limitsSupplied: false,
        note: "Wallet must estimate each step from the current chain state; no gas price, fee or nonce is guessed."
      },
      unchanged: {
        registry: confirmed.contracts.registry.proxy,
        engine: confirmed.contracts.engine.proxy,
        activatedPackRules: true,
        provenanceStruct: true,
        mintingAndClaimRules: true
      },
      metadataProbe: {
        url: `${METADATA_BASE}1.json`,
        tokenId: "1",
        originalTokenId: "1",
        collection: proxy,
        birthDay: 0,
        expectedStatus: 200,
        expectedContentType: "application/json",
        requireSameArtworkForVariant: true,
        perTokenFields: [
          "actual mint timestamp",
          "whole elapsed 24-hour days from original mint to this NFT mint (original is day 0)"
        ]
      },
      baseline: {
        fixturePath: baselinePath,
        fixtureSha256: sha(read(baselinePath)),
        deploymentRecordSha256: sha(
          read("docs/boosters/mainnet-smoke/deployment.confirmed.json")
        )
      },
      signingPreconditions: [
        "Recheck chain 8453, wallet address, proxy implementation slot and old implementation runtime hash before deploying and upgrading.",
        "Recheck both UPGRADER_ROLE and CONFIG_ROLE for the signing wallet. NFT ownership or approval alone grants neither permission.",
        "Confirm a successful implementation deployment receipt, actual contract address, expected address-patched runtime bytecode hash and proxiableUUID before upgrade.",
        "Confirm the per-NFT metadata route returns correct mint timestamps and original-age days for existing original and offspring NFTs before configuration.",
        "Encode upgradeToAndCall(actualImplementation, configurationCalldata); both the upgrade and URI configuration occur atomically. Do not initialize the existing proxy again.",
        "Refresh nonce and estimate gas/fees in the wallet. Any intervening transaction invalidates an optional predicted nonce/address plan."
      ],
      productionActionsPerformed: 0
    },
    standardInput
  };
}

function main() {
  const args = process.argv.slice(2);
  let startingNonce = null;
  let output = "docs/boosters/token-metadata-upgrade-2026-10-23";
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(
      ["--starting-nonce", "--output"].includes(args[i]) &&
        args[i + 1] !== undefined,
      "usage: [--starting-nonce DECIMAL] [--output DIRECTORY]"
    );
    if (args[i] === "--starting-nonce") startingNonce = args[i + 1];
    else output = args[i + 1];
  }
  const result = preparePackage({ startingNonce });
  const directory = path.resolve(root, output);
  fs.mkdirSync(directory, { recursive: true });
  const packageBytes = JSON.stringify(result.package, null, 2) + "\n";
  fs.writeFileSync(path.join(directory, "upgrade.unsigned.json"), packageBytes);
  fs.writeFileSync(
    path.join(directory, "solc-standard-input.json"),
    JSON.stringify(result.standardInput, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      status: result.package.status,
      packagePath: path.join(directory, "upgrade.unsigned.json"),
      packageSha256: sha(packageBytes),
      nonceSupplied: startingNonce !== null,
      candidateCreationKeccak256:
        result.package.candidate.creationCodeKeccak256,
      productionActionsPerformed: 0
    })
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();

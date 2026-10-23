import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runtimeCodeAt } from "./prepare-token-metadata-upgrade.mjs";

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
export { runtimeCodeAt };
export const OLD_CREATION_HASH =
  "0x898335551f9b0a949b0e4ab235105e22ff9d283df3908e4c8da40f2b8c0e11d3";
export const OLD_RUNTIME_HASH =
  "0x5a38a2010b49e7acdf9c76659d12aefd5da62bee6ec93973c898a71452852c8a";
export const OLD_SOURCE_SHA =
  "002e18027f375ac438d4cb9f5c9171cdca6dde63903163bd792f79cdafe7d49c";
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
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
function typeShape(layout, type) {
  return Object.fromEntries(
    Object.entries(layout.types[type])
      .filter(([key]) => !["astId", "contract"].includes(key))
      .map(([key, value]) => [
        key,
        ["key", "value", "base"].includes(key)
          ? typeShape(layout, value)
          : key === "members"
            ? value.map((item) => ({
                label: item.label,
                slot: item.slot,
                offset: item.offset,
                type: typeShape(layout, item.type)
              }))
            : value
      ])
  );
}
export function validateLayouts(before, after) {
  const fields = (layout) =>
    layout.storage.map((field) => ({
      label: field.label,
      slot: field.slot,
      offset: field.offset,
      type: typeShape(layout, field.type)
    }));
  const old = fields(before),
    next = fields(after);
  assert.equal(old.length, 10, "exact deployed engine layout required");
  assert.deepEqual(next, old, "existing engine storage or gap changed");
  assert.deepEqual(
    old.map(({ label, slot, offset }) => ({ label, slot, offset })),
    [
      ["wrapper", "0", 0],
      ["registry", "1", 0],
      ["monsters", "2", 0],
      ["requestsPaused", "2", 20],
      ["originals", "3", 0],
      ["requests", "4", 0],
      ["_pools", "5", 0],
      ["refundCredits", "6", 0],
      ["totalRefundLiability", "7", 0],
      ["__gap", "8", 0]
    ].map(([label, slot, offset]) => ({ label, slot, offset }))
  );
  assert.equal(old[9].type.numberOfBytes, "1312");
  return {
    applicationFieldsPreserved: 9,
    allLayoutRowsPreserved: 10,
    originalAndRequestStructsUnchanged: true,
    gapStartSlot: 8,
    gapSlots: 41,
    lastReservedSlot: 48,
    storageAdded: false
  };
}

export function preparePackage({ startingNonce = null, maxOpenPacks } = {}) {
  assert.ok(
    Number.isInteger(maxOpenPacks) && maxOpenPacks > 1 && maxOpenPacks <= 32,
    "reviewed MAX_OPEN_PACKS is required"
  );
  if (startingNonce !== null) {
    assert.match(String(startingNonce), /^(0|[1-9][0-9]*)$/);
    startingNonce = BigInt(startingNonce);
    assert.ok(startingNonce < (1n << 64n) - 1n);
  }
  const artifact = json(
    "contracts/boosters/out-batch/BoosterPacks.sol/BoosterPacks.json"
  );
  const baselinePath =
      "contracts/boosters/test/fixtures/BoosterPacks.pre-batch.json",
    baseline = json(baselinePath);
  const confirmed = json(
    "docs/boosters/mainnet-smoke/deployment.confirmed.json"
  );
  const oldPlan = json("docs/boosters/mainnet-smoke/deployment.unsigned.json");
  const oldInput = json(
    "docs/boosters/mainnet-smoke/verification/solc-standard-input.json"
  );
  const approvedMetadata = json(
    "docs/boosters/token-metadata-upgrade-2026-10-23/solc-standard-input.json"
  );
  const owner = confirmed.admin,
    proxy = confirmed.contracts.engine.proxy,
    oldImplementation = confirmed.contracts.engine.implementation;
  assert.equal(confirmed.chainId, 8453);
  assert.equal(owner, "0xB3883Cd96d72B08b8226452305A28D65974a3727");
  assert.equal(
    proxy.toLowerCase(),
    "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609"
  );
  assert.equal(baseline.sourceSha256, OLD_SOURCE_SHA);
  assert.equal(
    sha(oldInput.sources["src/BoosterPacks.sol"].content),
    OLD_SOURCE_SHA
  );
  assert.equal(keccak256(baseline.creationBytecode), OLD_CREATION_HASH);
  assert.equal(
    baseline.creationBytecode,
    oldPlan.transactions[4].unsigned.data
  );
  assert.equal(oldPlan.transactions[4].runtimeCodeKeccak256, OLD_RUNTIME_HASH);
  // Historical immutable offsets are supplied by the actual old compilation;
  // do not infer UUPS offsets by searching arbitrary zero bytecode spans.
  const oldRefs = json(
    "contracts/boosters/test/fixtures/BoosterPacks.pre-batch.immutable-references.json"
  );
  assert.equal(oldRefs.fixtureSha256, sha(read(baselinePath)));
  assert.equal(
    oldRefs.verificationInputSha256,
    sha(
      read("docs/boosters/mainnet-smoke/verification/solc-standard-input.json")
    )
  );
  assert.equal(
    keccak256(
      runtimeCodeAt(
        baseline.runtimeBytecode,
        oldRefs.immutableReferences,
        oldImplementation
      )
    ),
    OLD_RUNTIME_HASH
  );
  const proxyArtifact = json(
    "contracts/boosters/out-batch/ERC1967Proxy.sol/ERC1967Proxy.json"
  );
  assert.equal(
    keccak256(proxyArtifact.deployedBytecode.object),
    oldPlan.transactions[5].runtimeCodeKeccak256
  );
  const storage = validateLayouts(
      baseline.storageLayout,
      artifact.storageLayout
    ),
    metadata = artifact.metadata;
  assert.equal(metadata.compiler.version, "0.8.30+commit.73712a01");
  assert.equal(metadata.settings.evmVersion, "cancun");
  assert.equal(metadata.settings.viaIR, true);
  assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 1 });
  assert.deepEqual(metadata.settings.metadata, { bytecodeHash: "none" });
  assert.deepEqual(metadata.settings.libraries, {});
  assert.deepEqual(artifact.bytecode.linkReferences, {});
  const maxConstant = read("contracts/boosters/src/BoosterPacks.sol")
    .toString()
    .match(/uint32\s+public\s+constant\s+MAX_OPEN_PACKS\s*=\s*([0-9]+)\s*;/);
  assert.ok(
    maxConstant && Number(maxConstant[1]) === maxOpenPacks,
    "reviewed batch limit differs from compiled source"
  );
  const sources = {};
  for (const [name, expected] of Object.entries(metadata.sources)) {
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
    const content = read("contracts/boosters/" + name).toString();
    assert.equal(
      keccak256(toHex(content)),
      expected.keccak256,
      "compiled source is stale: " + name
    );
    if (name !== "src/BoosterPacks.sol") {
      const previous =
        name === "src/YunipalMonsters.sol"
          ? approvedMetadata.sources[name]
          : (oldInput.sources[name] ?? approvedMetadata.sources[name]);
      assert.ok(previous, "unreviewed dependency: " + name);
      assert.equal(
        content,
        previous.content,
        "unrelated dependency changed: " + name
      );
    }
    sources[name] = { content };
  }
  for (const name of ["openPacks", "quoteOpenPacks", "MAX_OPEN_PACKS"])
    assert.equal(
      artifact.abi.filter(
        (item) => item.type === "function" && item.name === name
      ).length,
      1,
      "batch capability absent: " + name
    );
  const signature = (name) => {
    const item = artifact.abi.find(
      (entry) => entry.type === "function" && entry.name === name
    );
    return `${name}(${item.inputs.map((input) => input.type).join(",")})`;
  };
  assert.equal(
    signature("openPacks"),
    "openPacks(uint256,uint32,uint256,uint256)"
  );
  assert.equal(
    signature("quoteOpenPacks"),
    "quoteOpenPacks(uint256,uint32,uint256)"
  );
  const settings = structuredClone(metadata.settings);
  delete settings.compilationTarget;
  settings.outputSelection = {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"]
    }
  };
  const predicted =
    startingNonce === null
      ? null
      : getContractAddress({ from: owner, nonce: startingNonce });
  const creation = artifact.bytecode.object,
    template = artifact.deployedBytecode.object,
    refs = artifact.deployedBytecode.immutableReferences;
  const runtimeBytes = (template.length - 2) / 2;
  assert.ok(runtimeBytes <= 24576, "EIP170 code size exceeded");
  assert.ok(
    (creation.length - 2) / 2 <= 49152,
    "EIP3860 initcode size exceeded"
  );
  runtimeCodeAt(template, refs, oldImplementation);
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
      format: "yunipals-engine-batch-upgrade-v1",
      status: "unsigned-not-broadcast",
      chainId: 8453,
      owner,
      proxy,
      proxyRuntimeCodeKeccak256: oldPlan.transactions[5].runtimeCodeKeccak256,
      implementationSlot:
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      roles: {
        upgrader: {
          name: "UPGRADER_ROLE",
          id: keccak256(toHex("UPGRADER_ROLE"))
        }
      },
      currentImplementation: {
        address: oldImplementation,
        creationCodeKeccak256: OLD_CREATION_HASH,
        runtimeCodeKeccak256: OLD_RUNTIME_HASH,
        sourceSha256: OLD_SOURCE_SHA
      },
      candidate: {
        sourceSha256: sha(read("contracts/boosters/src/BoosterPacks.sol")),
        compiler: metadata.compiler.version,
        buildProfile: "batch",
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
      capability: {
        maxOpenPacks,
        openSignature: "openPacks(uint256,uint32,uint256,uint256)",
        quoteSignature: "quoteOpenPacks(uint256,uint32,uint256)"
      },
      configurationCalldata: "0x",
      abi: {
        upgrade: UPGRADE_ABI,
        batch: artifact.abi.filter(
          (item) =>
            item.type === "function" &&
            ["openPacks", "quoteOpenPacks", "MAX_OPEN_PACKS"].includes(
              item.name
            )
        )
      },
      deploymentTransaction: {
        from: owner,
        chainId: "0x2105",
        value: "0x0",
        data: creation,
        ...(startingNonce === null ? {} : { nonce: toHex(startingNonce) })
      },
      upgradeTransaction:
        predicted === null
          ? null
          : {
              from: owner,
              to: proxy,
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
        note: "The wallet must use fresh chain state and current gas/fees. No gas or nonce is guessed."
      },
      unchanged: {
        registry: confirmed.contracts.registry.proxy,
        monsters: confirmed.contracts.monsters.proxy,
        wrapper: confirmed.wrapper,
        activatedPackRules: true,
        storage: true,
        existingSingles: true,
        vrfRecoveryAndRefundState: true
      },
      baseline: {
        fixturePath: baselinePath,
        fixtureSha256: sha(read(baselinePath)),
        immutableFixtureSha256: sha(
          read(
            "contracts/boosters/test/fixtures/BoosterPacks.pre-batch.immutable-references.json"
          )
        ),
        deploymentRecordSha256: sha(
          read("docs/boosters/mainnet-smoke/deployment.confirmed.json")
        )
      },
      signingPreconditions: [
        "Check Base8453, approved owner/UPGRADER_ROLE, proxy/current implementation/runtime and exact registry/monsters/wrapper before each signature.",
        "Confirm actual deployment receipt and address-patched runtime/proxiableUUID/MAX_OPEN_PACKS before upgrading.",
        "Use upgradeToAndCall(actualImplementation,0x); never initialize the existing proxy again.",
        "Preserve all original/request/refund/recovery identities and settings. This flow does not buy packs or transfer tokens.",
        "Review current wallet gas/fee estimates for each explicit transaction; do not reuse stale nonce/address guesses."
      ],
      productionActionsPerformed: 0
    },
    standardInput: { language: "Solidity", sources, settings }
  };
}
function main() {
  const args = process.argv.slice(2);
  let output = "docs/boosters/batch-engine-upgrade-2026-10-23",
    maxOpenPacks,
    startingNonce = null;
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(
      ["--output", "--max-open-packs", "--starting-nonce"].includes(args[i]) &&
        args[i + 1] !== undefined
    );
    if (args[i] === "--output") output = args[i + 1];
    else if (args[i] === "--max-open-packs") maxOpenPacks = Number(args[i + 1]);
    else startingNonce = args[i + 1];
  }
  const result = preparePackage({ maxOpenPacks, startingNonce }),
    dir = path.resolve(root, output);
  fs.mkdirSync(dir, { recursive: true });
  const raw = JSON.stringify(result.package, null, 2) + "\n";
  fs.writeFileSync(path.join(dir, "upgrade.unsigned.json"), raw);
  fs.writeFileSync(
    path.join(dir, "solc-standard-input.json"),
    JSON.stringify(result.standardInput, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      packageSha256: sha(raw),
      runtimeBytes: result.package.candidate.runtimeBytes,
      maxOpenPacks,
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

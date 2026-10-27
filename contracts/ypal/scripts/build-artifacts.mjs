import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repository = path.resolve(directory, "../..");
const require = createRequire(
  path.join(repository, "apps/yunipals-home-web/package.json")
);
const { keccak256 } = require("viem");
export const COMPILER_SHA256 =
  "9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25";
export const VERIFIED_INPUT_SHA256 =
  "1f565f11b12e80a78b420472ed3f2da5d254797c35aa741b668e389b1f4c3382";
export const VERIFIED_RECORD_SHA256 =
  "e556492856e082e1e545507d1d636fded00b81e9e050a5c82ba34f1d3cad066d";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const read = (file) => fs.readFileSync(path.join(directory, file));
const document = (file) => JSON.parse(read(file));

export function brandSource(original) {
  const documented = original
    .split(/(?<=\n)/)
    .map((line) =>
      line.trimStart().startsWith("//")
        ? line
            .replaceAll("PROTO", "YPAL")
            .replaceAll("Protopals Team", "Yunipals Team")
        : line
    )
    .join("");
  assert.equal(documented.split('return "PROTO";').length, 3);
  return documented
    .replace("contract PROTO is", "contract YPAL is")
    .replace('return "PROTO";', 'return "Yunipals";')
    .replace('return "PROTO";', 'return "YPAL";');
}

export function runtimeCode(artifact, pmon) {
  assert.match(pmon, /^0x[0-9a-fA-F]{40}$/);
  let code = artifact.runtimeTemplate.slice(2);
  for (const reference of artifact.immutableReferences) {
    assert.equal(reference.value, "pmon");
    assert.equal(reference.length, 32);
    const offset = reference.offset * 2;
    assert.match(code.slice(offset, offset + 64), /^0{64}$/);
    code =
      code.slice(0, offset) +
      pmon.slice(2).toLowerCase().padStart(64, "0") +
      code.slice(offset + 64);
  }
  return "0x" + code;
}

export function compile(compiler, input) {
  assert.equal(
    sha(fs.readFileSync(compiler)),
    COMPILER_SHA256,
    "exact native Solidity 0.8.28 compiler"
  );
  const result = spawnSync(compiler, ["--standard-json"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 16_000_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.deepEqual(
    (output.errors ?? []).filter((row) => row.severity === "error"),
    []
  );
  return output;
}

export function build(compiler) {
  assert.equal(
    sha(read("evidence/proto-standard-input.json")),
    VERIFIED_INPUT_SHA256
  );
  assert.equal(
    sha(read("evidence/verified-proto-record.json")),
    VERIFIED_RECORD_SHA256
  );
  const original = document("evidence/proto-standard-input.json");
  const verified = document("evidence/verified-proto-record.json");
  assert.equal(verified.ContractName, "PROTO");
  assert.equal(verified.CompilerVersion, "v0.8.28+commit.7893614a");
  assert.equal(Object.keys(original.sources).length, 10);
  const sources = Object.fromEntries(
    Object.entries(original.sources).map(([name, row]) => {
      const bytes = read("verified-source/" + name);
      assert.equal(
        bytes.toString(),
        row.content,
        "untouched verified source: " + name
      );
      assert(
        bytes.toString().includes("SPDX-License-Identifier: MIT"),
        "verified MIT source"
      );
      return [name, { sha256: sha(bytes), bytes: bytes.length }];
    })
  );
  const candidate = read("src/YPAL.sol");
  assert.equal(
    candidate.toString(),
    brandSource(original.sources["contracts/PROTO.sol"].content),
    "only contract identity, documentation, name and symbol may differ"
  );
  const input = structuredClone(original);
  input.sources["contracts/YPAL.sol"] = { content: candidate.toString() };
  delete input.sources["contracts/PROTO.sol"];
  input.settings.outputSelection["*"]["*"].push("storageLayout");
  input.settings.outputSelection["*"][""] = ["ast"];
  const baselineInput = structuredClone(input);
  delete baselineInput.sources["contracts/YPAL.sol"];
  baselineInput.sources["contracts/PROTO.sol"] =
    original.sources["contracts/PROTO.sol"];
  const before = compile(compiler, baselineInput);
  const after = compile(compiler, input);
  const baseline = before.contracts["contracts/PROTO.sol"].PROTO;
  const deployed = after.contracts["contracts/YPAL.sol"].YPAL;
  assert.deepEqual(
    baseline.abi,
    JSON.parse(verified.ABI),
    "reproduce complete verified ABI"
  );
  assert.deepEqual(
    deployed.abi,
    baseline.abi,
    "all constructor, function, error and event ABI entries unchanged"
  );
  assert.deepEqual(
    deployed.storageLayout.storage.map(({ astId, ...row }) => row),
    baseline.storageLayout.storage.map(({ astId, ...row }) => ({
      ...row,
      contract: row.contract.replaceAll("PROTO", "YPAL")
    }))
  );
  const ids = Object.keys(deployed.evm.deployedBytecode.immutableReferences);
  assert.equal(ids.length, 1);
  const node = after.sources["contracts/YPAL.sol"].ast.nodes
    .find((row) => row.nodeType === "ContractDefinition" && row.name === "YPAL")
    .nodes.find((row) => String(row.id) === ids[0]);
  assert.equal(node.name, "pmon");
  const immutableReferences = deployed.evm.deployedBytecode.immutableReferences[
    ids[0]
  ].map(({ start, length }) => ({ offset: start, length, value: "pmon" }));
  assert(immutableReferences.length > 0);
  assert(immutableReferences.every((row) => row.length === 32));
  const artifact = {
    format: "yunipals-ypal-deployment-artifact-v1",
    contractName: "YPAL",
    sourceFile: "contracts/YPAL.sol",
    creationBytecode: "0x" + deployed.evm.bytecode.object,
    creationKeccak256: keccak256("0x" + deployed.evm.bytecode.object),
    runtimeTemplate: "0x" + deployed.evm.deployedBytecode.object,
    runtimeTemplateKeccak256: keccak256(
      "0x" + deployed.evm.deployedBytecode.object
    ),
    creationBytes: deployed.evm.bytecode.object.length / 2,
    runtimeBytes: deployed.evm.deployedBytecode.object.length / 2,
    immutableReferences,
    abi: deployed.abi,
    sourceSha256: sha(candidate),
    compiler: {
      version: verified.CompilerVersion,
      nativeSha256: COMPILER_SHA256,
      settings: input.settings
    },
    constructor: {
      signature: "constructor(address pmon_,address burnAddress_)",
      owner: "msg.sender",
      initialSupply: "0",
      initialLocked: false
    },
    branding: {
      name: "Yunipals",
      symbol: "YPAL",
      decimals: 18,
      permitVersion: "1"
    },
    verifiedBaseline: {
      address: "0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3",
      chainId: 8453,
      compiler: verified.CompilerVersion,
      sourceFile: verified.ContractFileName,
      abiEntries: baseline.abi.length,
      creationKeccak256: keccak256("0x" + baseline.evm.bytecode.object),
      runtimeTemplateKeccak256: keccak256(
        "0x" + baseline.evm.deployedBytecode.object
      ),
      sources
    },
    comparison: {
      allNineDependencySourcesUnchanged: true,
      brandingOnlyMainSource: true,
      exactVerifiedAbiReproduced: true,
      completeAbiUnchanged: true,
      storageRowsUnchanged: true,
      normalizedBrandingReconstructsExactVerifiedSource: true
    },
    writesBroadcast: 0
  };
  assert(artifact.runtimeBytes <= 24576);
  const pmon = "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7";
  artifact.expectedRuntimeWithIntendedPMON = {
    pmon,
    keccak256: keccak256(runtimeCode(artifact, pmon))
  };
  return { artifact, input, baselineInput };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const compiler = process.argv[2];
  assert(compiler, "supply the pinned Solidity 0.8.28 binary path");
  const { artifact, input, baselineInput } = build(compiler);
  const save = (name, value) =>
    fs.writeFileSync(
      path.join(directory, "evidence", name),
      JSON.stringify(value, null, 2) + "\n"
    );
  save("ypal-standard-input.json", input);
  save("proto-comparison-standard-input.json", baselineInput);
  save("YPAL.deployment.json", artifact);
  console.log(
    JSON.stringify({
      creationKeccak256: artifact.creationKeccak256,
      runtimeBytes: artifact.runtimeBytes,
      runtimeTemplateKeccak256: artifact.runtimeTemplateKeccak256,
      immutableReferences: artifact.immutableReferences
    })
  );
}

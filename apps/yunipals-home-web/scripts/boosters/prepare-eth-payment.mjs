// Generate reviewable bytecode and dependency pins; never signs or sends.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  http,
  parseAbi,
  keccak256,
  encodeDeployData
} from "viem";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const artifact = async (name) =>
  JSON.parse(
    await readFile(
      resolve(root, `contracts/boosters/out/${name}.sol/${name}.json`),
      "utf8"
    )
  );
const engine = "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e";
const owner = "0xb3883cd96d72b08b8226452305a28d65974a3727";
const ypal = "0xcd3709e84fc817b46196fa2d5b7202710ab51346";
const proto = "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3";
const weth = "0x4200000000000000000000000000000000000006";
const v2 = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const v3 = "0x2626664c2603336e57b271c5c0b26f421741e481";
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const client = createPublicClient({
  transport: http(
    process.env.BASE_FORK_RPC || "https://base-rpc.publicnode.com"
  )
});
if ((await client.getChainId()) !== 8453)
  throw new Error("Base mainnet RPC required for read-only preparation.");
const [candidate, adapter, currentSlot] = await Promise.all([
  artifact("BoosterPacks"),
  artifact("BoosterEthPayment"),
  client.getStorageAt({ address: engine, slot })
]);
const implementation = `0x${currentSlot.slice(-40)}`;
const currentCode = await client.getCode({ address: implementation });
const abi = parseAbi([
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)"
]);
const dependencies = Object.fromEntries(
  await Promise.all(
    ["registry", "monsters", "wrapper"].map(async (functionName) => [
      functionName,
      await client.readContract({ address: engine, abi, functionName })
    ])
  )
);
const runtime = candidate.deployedBytecode.object;
if ((runtime.length - 2) / 2 > 24576)
  throw new Error("Engine exceeds EIP-170 size.");
const bundle = {
  version: 1,
  chainId: 8453,
  owner,
  engine,
  ypal,
  proto,
  weth,
  v2,
  v3,
  implementationSlot: slot,
  previousImplementation: implementation,
  previousRuntimeHash: keccak256(currentCode),
  dependencies,
  engineCreation: candidate.bytecode.object,
  engineRuntime: runtime,
  engineImmutables: candidate.deployedBytecode.immutableReferences,
  adapterCreation: encodeDeployData({
    abi: adapter.abi,
    bytecode: adapter.bytecode.object,
    args: [engine, ypal, proto, weth, v2, v3]
  }),
  adapterRuntime: adapter.deployedBytecode.object,
  adapterImmutables: adapter.deployedBytecode.immutableReferences,
  compiler: "0.8.30",
  optimizerRuns: 1,
  viaIR: true
};
const output = resolve(
  process.argv[2] || "/tmp/yunipals-eth-payment-package.json"
);
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    engineRuntimeBytes: (runtime.length - 2) / 2,
    previousImplementation: implementation
  })
);

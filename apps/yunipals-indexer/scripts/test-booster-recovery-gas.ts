/** Local Anvil only: verify the wallet's estimate can exceed an old VRF gas budget. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: "http://127.0.0.1:8563" },
    plan: { type: "string" },
    output: { type: "string" }
  }
});
if (
  !values.plan ||
  !values.output ||
  !["127.0.0.1", "localhost"].includes(new URL(values.rpc!).hostname)
)
  throw new Error(
    "Use --plan PATH --output PATH and a loopback Anvil RPC only."
  );
const client = createPublicClient({
  chain: base,
  transport: http(values.rpc!)
});
assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil/i);
const plan = JSON.parse(await readFile(values.plan, "utf8")) as {
  admin: Address;
  contracts: { registry: Address; monsters: Address };
};
const wallet = createWalletClient({
  chain: base,
  account: plan.admin,
  transport: http(values.rpc!)
});
const rpc = (method: string, params: unknown[]) =>
  client.request({ method: method as never, params: params as never });
const snapshot = await rpc("evm_snapshot", []);
await rpc("anvil_impersonateAccount", [plan.admin]);
async function artifact(unit: string, name: string) {
  return JSON.parse(
    await readFile(
      new URL(
        `../../../contracts/boosters/out/${unit}/${name}.json`,
        import.meta.url
      ),
      "utf8"
    )
  ) as {
    abi: Abi;
    bytecode: { object: Hex };
    storageLayout: {
      storage: { label: string; slot: string; type: string }[];
      types: Record<
        string,
        {
          value?: string;
          members?: { label: string; slot: string; offset: number }[];
        }
      >;
    };
  };
}
async function transact(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  value = 0n,
  gas = 5_000_000n
) {
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    value,
    gas
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
}
async function deploy(
  compiled: Awaited<ReturnType<typeof artifact>>,
  args: readonly unknown[] = []
) {
  const hash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
}
try {
  const engineArtifact = await artifact("BoosterPacks.sol", "BoosterPacks");
  const registryArtifact = await artifact("PackRegistry.sol", "PackRegistry");
  const monsterArtifact = await artifact(
    "YunipalMonsters.sol",
    "YunipalMonsters"
  );
  const protoArtifact = await artifact("AuditPoC.t.sol", "AuditProto");
  const wrapperArtifact = await artifact("AuditPoC.t.sol", "AuditWrapper");
  const proto = await deploy(protoArtifact);
  const wrapper = await deploy(wrapperArtifact);
  const implementation = await deploy(engineArtifact);
  const engine = await deploy(
    await artifact("ERC1967Proxy.sol", "ERC1967Proxy"),
    [
      implementation,
      encodeFunctionData({
        abi: engineArtifact.abi,
        functionName: "initialize",
        args: [
          plan.admin,
          plan.contracts.registry,
          plan.contracts.monsters,
          wrapper
        ]
      })
    ]
  );
  const longURI = "https://example.test/".padEnd(511, "a") + "/";
  assert.equal(longURI.length, 512);
  await transact(
    plan.contracts.registry,
    registryArtifact.abi,
    "configureType",
    [
      0n,
      {
        engine,
        paymentToken: proto,
        price: 10n ** 18n,
        intervalSeconds: 86400n,
        mintsPerInterval: 1,
        maxBatch: 7,
        baseGas: 450000,
        perMintGas: 250000,
        confirmations: 3,
        supplyCap: 0n,
        artworkHash: keccak256(toHex("local-recovery-test")),
        manifestURI: longURI,
        metadataBaseURI: longURI
      },
      {
        types: Array.from({ length: 11 }, (_, i) => i + 1),
        colors: [1, 2, 3, 4, 5, 6],
        horns: [1, 2],
        glitters: [0, 1],
        allowed: []
      }
    ]
  );
  await transact(plan.contracts.registry, registryArtifact.abi, "activate", [
    1n
  ]);
  await transact(proto, protoArtifact.abi, "mint", [plan.admin, 10n ** 18n]);
  await transact(proto, protoArtifact.abi, "approve", [engine, 10n ** 18n]);
  await transact(
    engine,
    engineArtifact.abi,
    "openPack",
    [1n, 10n ** 15n, (await client.getBlock()).timestamp + 300n],
    10n ** 15n
  );
  // Local fault injection models the historical 230k estimate. No production setter exists.
  const requests = engineArtifact.storageLayout.storage.find(
    (field) => field.label === "requests"
  )!;
  const requestType = engineArtifact.storageLayout.types[requests.type].value!;
  const executionGas = engineArtifact.storageLayout.types[
    requestType
  ].members!.find((field) => field.label === "executionGas")!;
  const mappingSlot = keccak256(
    (toHex(1n, { size: 32 }) +
      toHex(BigInt(requests.slot), { size: 32 }).slice(2)) as Hex
  );
  const slot = toHex(BigInt(mappingSlot) + BigInt(executionGas.slot), {
    size: 32
  });
  const previous = BigInt(
    (await client.getStorageAt({ address: engine, slot }))!
  );
  const shift = BigInt(executionGas.offset * 8);
  const mask = ((1n << 32n) - 1n) << shift;
  await rpc("anvil_setStorageAt", [
    engine,
    slot,
    toHex((previous & ~mask) | (230000n << shift), { size: 32 })
  ]);
  await transact(wrapper, wrapperArtifact.abi, "fulfill", [1n, 123n]);
  const readRequest = () =>
    client.readContract({
      address: engine,
      abi: engineArtifact.abi,
      functionName: "getRequest",
      args: [1n]
    }) as Promise<{
      status: number;
      seed: bigint;
      originalId: bigint;
      executionGas: number;
    }>;
  const before = await readRequest();
  assert.equal(before.status, 2);
  assert.equal(before.executionGas, 230000);
  const data = encodeFunctionData({
    abi: engineArtifact.abi,
    functionName: "recover",
    args: [1n]
  });
  const transaction = {
    account: plan.admin,
    to: engine,
    data,
    value: 0n,
    ...(await client.estimateFeesPerGas())
  };
  await assert.rejects(client.call({ ...transaction, gas: 480000n }));
  await client.call(transaction);
  const estimate = await client.estimateGas(transaction);
  assert.ok(
    estimate > 480000n,
    "wallet must exceed the obsolete fixed gas limit"
  );
  const receipt = await transact(
    engine,
    engineArtifact.abi,
    "recover",
    [1n],
    0n,
    (estimate * 120n) / 100n
  );
  const after = await readRequest();
  assert.equal(after.status, 3);
  assert.equal(after.seed, before.seed);
  const owner = await client.readContract({
    address: plan.contracts.monsters,
    abi: monsterArtifact.abi,
    functionName: "ownerOf",
    args: [after.originalId]
  });
  assert.equal(String(owner).toLowerCase(), plan.admin.toLowerCase());
  const report = {
    status: "passed-local-fork-only",
    mainnetBroadcast: false,
    injectedOldExecutionGas: 230000,
    rejectedOldWalletGas: 480000,
    estimatedGas: String(estimate),
    gasUsed: String(receipt.gasUsed),
    sameSeed: true,
    originalMinted: true
  };
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rpc("anvil_stopImpersonatingAccount", [plan.admin]);
  await rpc("evm_revert", [snapshot]);
}

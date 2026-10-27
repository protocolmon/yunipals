/** Local Anvil only: exercise proof preparation, simulation, submission and completion. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { batchProofAbi } from "../lib/boosters/vrf-proof";
import { boosterPacksAbi } from "../../../packages/yunipals-market-core/src/boosterAbi.js";
import fixtures from "../../../contracts/boosters/test/fixtures/base-vrf-proofs.json" with { type: "json" };
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
  transport: http(values.rpc!, { timeout: 60000, retryCount: 0 })
});
assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil/i);
const plan = JSON.parse(await readFile(values.plan, "utf8")) as {
  admin: Address;
  contracts: { registry: Address; monsters: Address };
};
const wallet = createWalletClient({
  chain: base,
  account: plan.admin,
  transport: http(values.rpc!, { timeout: 60000, retryCount: 0 })
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
  const f = fixtures[1]!;
  const id = BigInt(f.requestId);
  const number = BigInt(f.commitment.blockNum);
  await transact(wrapper, wrapperArtifact.abi, "setNextId", [id]);
  await transact(wrapper, wrapperArtifact.abi, "setBlockhash", [
    number,
    f.requestBlockHash
  ]);
  const current = (await client.getBlock()).number;
  assert.ok(
    current < number - 1n,
    "Start the local fork at Base block 52826380 for this fixture"
  );
  await rpc("anvil_mine", [toHex(number - 1n - current)]);
  const opening = await transact(
    engine,
    engineArtifact.abi,
    "openPack",
    [1n, 10n ** 15n, (await client.getBlock()).timestamp + 300n],
    10n ** 15n
  );
  assert.equal(opening.blockNumber, number);
  // Model a consumed callback that never saved entropy.
  await transact(wrapper, wrapperArtifact.abi, "setCallbackLimit", [id, 1000]);
  await transact(wrapper, wrapperArtifact.abi, "fulfill", [id, BigInt(f.word)]);
  assert.equal(
    await client.readContract({
      address: wrapper,
      abi: wrapperArtifact.abi,
      functionName: "lastSuccess"
    }),
    false
  );
  for (let i = 0; i < 30; i++) await rpc("anvil_mine", ["0xa"]);
  const pair = (a: string[]): [bigint, bigint] => [
    BigInt(a[0]!),
    BigInt(a[1]!)
  ];
  const proof = {
    pk: pair(f.proof.pk),
    gamma: pair(f.proof.gamma),
    c: BigInt(f.proof.c),
    s: BigInt(f.proof.s),
    seed: BigInt(f.proof.seed),
    uWitness: f.proof.uWitness as Address,
    cGammaWitness: pair(f.proof.cGammaWitness),
    sHashWitness: pair(f.proof.sHashWitness),
    zInv: BigInt(f.proof.zInv)
  };
  // Local evidence transaction, not a live oracle fulfillment. The mock wrapper
  // assigns the fixture request ID and authenticates its historical block.
  const input = encodeFunctionData({
    abi: batchProofAbi,
    functionName: "fulfillRandomWords",
    args: [
      [proof],
      [
        {
          blockNum: number,
          subId: BigInt(f.commitment.subId),
          callbackGasLimit: 700000,
          numWords: 1,
          sender: wrapper,
          extraArgs: f.commitment.extraArgs as Hex
        }
      ]
    ]
  });
  const fulfillment = await wallet.sendTransaction({
    to: "0x000000000000000000000000000000000000dead",
    data: input
  });
  await client.waitForTransactionReceipt({ hash: fulfillment });
  const unsignedPath = values.output + ".unsigned.json";
  const run = promisify(execFile);
  await run(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/prepare-booster-vrf-recovery.ts",
      "--rpc",
      values.rpc!,
      "--engine",
      engine,
      "--request",
      String(id),
      "--sender",
      plan.admin,
      "--fulfillment",
      fulfillment,
      "--output",
      unsignedPath
    ],
    { cwd: new URL("../", import.meta.url).pathname }
  );
  const unsigned = JSON.parse(await readFile(unsignedPath, "utf8")) as {
    transaction: { to: Address; data: Hex; gas: Hex };
  };
  const restoredHash = await wallet.sendTransaction({
    to: unsigned.transaction.to,
    data: unsigned.transaction.data,
    gas: BigInt(unsigned.transaction.gas)
  });
  const restored = await client.waitForTransactionReceipt({
    hash: restoredHash
  });
  assert.equal(restored.status, "success");
  const seeded = await client.readContract({
    address: engine,
    abi: boosterPacksAbi,
    functionName: "getRequest",
    args: [id]
  });
  assert.equal(seeded.status, 2);
  assert.equal(seeded.seed, BigInt(f.word));
  const data = encodeFunctionData({
    abi: boosterPacksAbi,
    functionName: "recover",
    args: [id]
  });
  const gas = await client.estimateGas({
    account: plan.admin,
    to: engine,
    data
  });
  const minted = await transact(
    engine,
    boosterPacksAbi,
    "recover",
    [id],
    0n,
    (gas * 120n) / 100n
  );
  const completed = await client.readContract({
    address: engine,
    abi: boosterPacksAbi,
    functionName: "getRequest",
    args: [id]
  });
  assert.equal(completed.status, 3);
  assert.equal(completed.seed, BigInt(f.word));
  assert.equal(
    String(
      await client.readContract({
        address: plan.contracts.monsters,
        abi: monsterArtifact.abi,
        functionName: "ownerOf",
        args: [completed.originalId]
      })
    ).toLowerCase(),
    plan.admin.toLowerCase()
  );
  const report = {
    status: "passed-local-fork-only",
    mainnetBroadcast: false,
    fixture: f.transactionHash,
    lostCallback: true,
    originalProofVerified: true,
    unsignedCliSimulationPassed: true,
    restorationGas: String(restored.gasUsed),
    completionGas: String(minted.gasUsed),
    sameWord: true,
    originalMinted: true
  };
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rpc("anvil_stopImpersonatingAccount", [plan.admin]);
  await rpc("evm_revert", [snapshot]);
}

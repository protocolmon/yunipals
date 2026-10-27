import { z } from "zod";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  padHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { boosterSetupOwner } from "./boosterSetup";

// Frozen unsigned package; the wallet supplies the actual nonce and receipt address.
export const batchUpgradePackageSha256 =
  "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e";
export const batchUpgradePackagePath = "/boosters/engine-batch-upgrade-v1.json";
export const batchUpgradeProxy =
  "0x455FaBAd0ac8fF1eA4DF70ca07AA56A272cB2609" as const;
export const batchImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const batchUpgradeAbi = parseAbi([
  "function hasRole(bytes32 role,address account) view returns(bool)",
  "function proxiableUUID() view returns(bytes32)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function MAX_OPEN_PACKS() view returns(uint32)",
  "function upgradeToAndCall(address newImplementation,bytes data) payable"
]);
const bytes = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((value) => value as Hex);
const digest = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as Hex);
const address = z
  .string()
  .refine(isAddress)
  .transform((value) => getAddress(value));
const schema = z.object({
  format: z.literal("yunipals-engine-batch-upgrade-v1"),
  status: z.literal("unsigned-not-broadcast"),
  chainId: z.literal(8453),
  owner: address,
  proxy: address,
  proxyRuntimeCodeKeccak256: digest,
  implementationSlot: digest,
  roles: z.object({
    upgrader: z.object({ name: z.literal("UPGRADER_ROLE"), id: digest })
  }),
  currentImplementation: z.object({
    address,
    runtimeCodeKeccak256: digest,
    sourceSha256: z.string()
  }),
  candidate: z.object({
    compiler: z.literal("0.8.30+commit.73712a01"),
    buildProfile: z.literal("batch"),
    optimizerRuns: z.literal(1),
    creationBytecode: bytes,
    creationCodeKeccak256: digest,
    runtimeBytecodeTemplate: bytes,
    runtimeTemplateKeccak256: digest,
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    runtimeBytes: z.number().int().positive().max(24576),
    immutableReferences: z.record(
      z.array(
        z.object({
          start: z.number().int().nonnegative(),
          length: z.literal(32)
        })
      )
    ),
    storage: z.object({
      applicationFieldsPreserved: z.literal(9),
      allLayoutRowsPreserved: z.literal(10),
      originalAndRequestStructsUnchanged: z.literal(true),
      gapStartSlot: z.literal(8),
      gapSlots: z.literal(41),
      lastReservedSlot: z.literal(48),
      storageAdded: z.literal(false)
    })
  }),
  capability: z.object({
    maxOpenPacks: z.number().int().min(2).max(32),
    openSignature: z.literal("openPacks(uint256,uint32,uint256,uint256)"),
    quoteSignature: z.literal("quoteOpenPacks(uint256,uint32,uint256)")
  }),
  configurationCalldata: z.literal("0x"),
  deploymentTransaction: z
    .object({
      from: address,
      chainId: z.literal("0x2105"),
      value: z.literal("0x0"),
      data: bytes
    })
    .strict(),
  nonce: z.object({ supplied: z.literal(false), startingNonce: z.null() }),
  unchanged: z.object({
    registry: address,
    monsters: address,
    wrapper: address,
    activatedPackRules: z.literal(true),
    storage: z.literal(true),
    existingSingles: z.literal(true),
    vrfRecoveryAndRefundState: z.literal(true)
  })
});
export type BatchUpgradeBundle = z.infer<typeof schema>;
export function validateBatchUpgradePackage(
  value: unknown
): BatchUpgradeBundle {
  const b = schema.parse(value),
    same = (a: string, c: string) => a.toLowerCase() === c.toLowerCase();
  if (
    !same(b.owner, boosterSetupOwner) ||
    !same(b.proxy, batchUpgradeProxy) ||
    b.implementationSlot !== batchImplementationSlot ||
    !same(
      b.currentImplementation.address,
      "0x92e2351A83b6c445c94D0b887259D2b940c82a5a"
    ) ||
    b.currentImplementation.runtimeCodeKeccak256 !==
      "0x5a38a2010b49e7acdf9c76659d12aefd5da62bee6ec93973c898a71452852c8a" ||
    b.currentImplementation.sourceSha256 !==
      "002e18027f375ac438d4cb9f5c9171cdca6dde63903163bd792f79cdafe7d49c" ||
    b.proxyRuntimeCodeKeccak256 !==
      "0xa7022e521c634305b0b86f45a8c10af47878d58952877dac7af4a6cbbb165d34" ||
    !same(b.unchanged.registry, "0xeaeE2da120a398f21729D50672AC5d1Dd71d7274") ||
    !same(b.unchanged.monsters, "0x105319be2182018c31FB10B1bE198c3cf238a146") ||
    !same(b.unchanged.wrapper, "0xb0407dbe851f8318bd31404A49e658143C982F23") ||
    !same(b.deploymentTransaction.from, b.owner) ||
    b.deploymentTransaction.data !== b.candidate.creationBytecode ||
    keccak256(b.candidate.creationBytecode) !==
      b.candidate.creationCodeKeccak256 ||
    keccak256(b.candidate.runtimeBytecodeTemplate) !==
      b.candidate.runtimeTemplateKeccak256 ||
    (b.candidate.runtimeBytecodeTemplate.length - 2) / 2 !==
      b.candidate.runtimeBytes ||
    (b.candidate.creationBytecode.length - 2) / 2 > 49152 ||
    b.roles.upgrader.id !== keccak256(new TextEncoder().encode("UPGRADER_ROLE"))
  )
    throw new Error(
      "The batch package differs from the approved Base engine upgrade."
    );
  const groups = Object.values(b.candidate.immutableReferences),
    spans = groups.flat(),
    size = b.candidate.runtimeBytes;
  if (
    groups.length !== 1 ||
    spans.length !== 2 ||
    spans.some(
      (span, i) =>
        span.start + 32 > size ||
        b.candidate.runtimeBytecodeTemplate.slice(
          2 + span.start * 2,
          2 + (span.start + 32) * 2
        ) !== "0".repeat(64) ||
        spans.some(
          (other, j) =>
            i !== j &&
            span.start < other.start + 32 &&
            other.start < span.start + 32
        )
    )
  )
    throw new Error("Invalid UUPS implementation address references.");
  return b;
}
export async function readBatchUpgradePackage(signal?: AbortSignal) {
  if (!batchUpgradePackageSha256)
    throw new Error("The approved batch upgrade package is not ready.");
  const response = await fetch(batchUpgradePackagePath, {
    cache: "no-store",
    signal
  });
  if (!response.ok)
    throw new Error("The approved batch upgrade package could not be loaded.");
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 500000)
    throw new Error("The batch package is too large.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== batchUpgradePackageSha256)
    throw new Error(
      "The batch package checksum changed. No transaction was prepared."
    );
  return validateBatchUpgradePackage(JSON.parse(new TextDecoder().decode(raw)));
}
export function batchImplementationRuntime(
  b: BatchUpgradeBundle,
  implementation: Address
): Hex {
  let code = b.candidate.runtimeBytecodeTemplate;
  for (const span of Object.values(b.candidate.immutableReferences).flat()) {
    const start = 2 + span.start * 2;
    code = (code.slice(0, start) +
      padHex(implementation.toLowerCase() as Address, { size: 32 }).slice(2) +
      code.slice(start + span.length * 2)) as Hex;
  }
  return code;
}
export async function checkBatchImplementation(
  client: PublicClient,
  b: BatchUpgradeBundle,
  implementation: Address
) {
  if (
    implementation.toLowerCase() === b.proxy.toLowerCase() ||
    implementation.toLowerCase() ===
      b.currentImplementation.address.toLowerCase()
  )
    throw new Error("Use the newly deployed implementation address.");
  const [code, uuid, maximum] = await Promise.all([
    client.getCode({ address: implementation }),
    client.readContract({
      address: implementation,
      abi: batchUpgradeAbi,
      functionName: "proxiableUUID"
    }),
    client.readContract({
      address: implementation,
      abi: batchUpgradeAbi,
      functionName: "MAX_OPEN_PACKS"
    })
  ]);
  if (
    !code ||
    keccak256(code) !==
      keccak256(batchImplementationRuntime(b, implementation)) ||
    uuid !== batchImplementationSlot ||
    Number(maximum) !== b.capability.maxOpenPacks
  )
    throw new Error(
      "This address does not contain the approved UUPS batch implementation."
    );
  return getAddress(implementation);
}
export async function checkBatchUpgradeState(
  client: PublicClient,
  b: BatchUpgradeBundle,
  implementation?: Address
) {
  const [chain, proxyCode, stored, role, registry, monsters, wrapper] =
    await Promise.all([
      client.getChainId(),
      client.getCode({ address: b.proxy }),
      client.getStorageAt({ address: b.proxy, slot: batchImplementationSlot }),
      client.readContract({
        address: b.proxy,
        abi: batchUpgradeAbi,
        functionName: "hasRole",
        args: [b.roles.upgrader.id, b.owner]
      }),
      ...(["registry", "monsters", "wrapper"] as const).map((functionName) =>
        client.readContract({
          address: b.proxy,
          abi: batchUpgradeAbi,
          functionName
        })
      )
    ]);
  if (
    chain !== 8453 ||
    !proxyCode ||
    keccak256(proxyCode) !== b.proxyRuntimeCodeKeccak256 ||
    !stored ||
    !/^0x0{24}[0-9a-fA-F]{40}$/.test(stored)
  )
    throw new Error(
      "The Base proxy or chain differs from the approved deployment."
    );
  if (!role)
    throw new Error("The approved owner needs engine upgrade permission.");
  if (
    registry.toLowerCase() !== b.unchanged.registry.toLowerCase() ||
    monsters.toLowerCase() !== b.unchanged.monsters.toLowerCase() ||
    wrapper.toLowerCase() !== b.unchanged.wrapper.toLowerCase()
  )
    throw new Error(
      "The engine dependencies changed. Re-review before signing."
    );
  const current = getAddress(`0x${stored.slice(-40)}`);
  if (implementation) await checkBatchImplementation(client, b, implementation);
  if (
    implementation &&
    current.toLowerCase() === implementation.toLowerCase()
  ) {
    const maximum = await client.readContract({
      address: b.proxy,
      abi: batchUpgradeAbi,
      functionName: "MAX_OPEN_PACKS"
    });
    if (Number(maximum) !== b.capability.maxOpenPacks)
      throw new Error(
        "The installed engine batch limit differs from the approved package."
      );
    return { implementation: current, complete: true };
  }
  const code = await client.getCode({ address: current });
  if (
    current.toLowerCase() !== b.currentImplementation.address.toLowerCase() ||
    !code ||
    keccak256(code) !== b.currentImplementation.runtimeCodeKeccak256
  )
    throw new Error(
      "The existing implementation changed. Re-review the upgrade before signing."
    );
  return { implementation: current, complete: false };
}
export async function recoverBatchImplementation(
  client: PublicClient,
  b: BatchUpgradeBundle,
  hash: Hex
) {
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash })
  ]);
  if (
    receipt.status !== "success" ||
    !receipt.contractAddress ||
    transaction.from.toLowerCase() !== b.owner.toLowerCase() ||
    transaction.to !== null ||
    transaction.value !== 0n ||
    transaction.input.toLowerCase() !==
      b.candidate.creationBytecode.toLowerCase()
  )
    throw new Error(
      "This receipt is not a successful deployment of the approved implementation by the owner."
    );
  return checkBatchImplementation(client, b, receipt.contractAddress);
}
export function batchUpgradeCalldata(
  b: BatchUpgradeBundle,
  implementation: Address
) {
  return encodeFunctionData({
    abi: batchUpgradeAbi,
    functionName: "upgradeToAndCall",
    args: [implementation, b.configurationCalldata]
  });
}

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
export const permitUpgradePackageSha256 =
  "ee7eb521a91a761192a915c64bd50ff16d03143c78ecd44452cecc87bc912afc";
export const permitUpgradePackagePath =
  "/boosters/engine-permit-upgrade-v1.json";
export const permitUpgradeProxy =
  "0x455FaBAd0ac8fF1eA4DF70ca07AA56A272cB2609" as const;
export const permitImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const permitUpgradeAbi = parseAbi([
  "function hasRole(bytes32 role,address account) view returns(bool)",
  "function proxiableUUID() view returns(bytes32)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function MAX_OPEN_PACKS() view returns(uint32)",
  "function PERMIT_OPEN_VERSION() view returns(uint256)",
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
  format: z.literal("yunipals-engine-permit-upgrade-v1"),
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
    buildProfile: z.literal("permit"),
    optimizerRuns: z.literal(1),
    creationBytecode: bytes,
    creationCodeKeccak256: digest,
    runtimeBytecodeTemplate: bytes,
    runtimeTemplateKeccak256: digest,
    runtimeCodeKeccak256: z.null(),
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
    maxOpenPacks: z.literal(10),
    permitVersion: z.literal(1),
    openPermitSignature: z.literal(
      "openPacksWithPermit(uint256,uint32,uint256,uint256,uint8,bytes32,bytes32)"
    ),
    openSignature: z.literal("openPacks(uint256,uint32,uint256,uint256)"),
    quoteSignature: z.literal("quoteOpenPacks(uint256,uint32,uint256)")
  }),
  configurationCalldata: z.literal("0x"),
  upgradeTransaction: z.null(),
  upgrade: z.object({
    functionName: z.literal("upgradeToAndCall"),
    implementationAddress: z.null(),
    calldata: z.null(),
    atomicConfigurationCalldata: z.literal("0x"),
    initializeExistingProxy: z.literal(false)
  }),
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
    vrfRecoveryAndRefundState: z.literal(true),
    existingBatches: z.literal(true),
    permitExactTotalOnly: z.literal(true),
    originalPayerAndRecipient: z.literal(true)
  }),
  baseline: z.object({
    approvedBatchPackageSha256: z.literal(
      "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e"
    ),
    activationRecordSha256: z.literal(
      "bfcca8966ec90efa9d084663fe759fc473c3a590cb910b4f90097304e8d7011c"
    )
  })
});
export type PermitUpgradeBundle = z.infer<typeof schema>;
export function validatePermitUpgradePackage(
  value: unknown
): PermitUpgradeBundle {
  const b = schema.parse(value),
    same = (a: string, c: string) => a.toLowerCase() === c.toLowerCase();
  if (
    !same(b.owner, boosterSetupOwner) ||
    !same(b.proxy, permitUpgradeProxy) ||
    b.implementationSlot !== permitImplementationSlot ||
    !same(
      b.currentImplementation.address,
      "0xeba9D4dEB6914Ab67A820Ea27C2fC3F43812E471"
    ) ||
    b.currentImplementation.runtimeCodeKeccak256 !==
      "0xa5eadd4114e6f37b1189c9729f3ea7a03ef21675ccdf69d8b3da0d6aa522ee7a" ||
    b.currentImplementation.sourceSha256 !==
      "bd3ce4e82ac079c52bc666912178e7057cbe7e187a77a5f2cf86f7e64597250d" ||
    b.candidate.sourceSha256 !==
      "6006e9a0ce44302ee14ebbdb43d49ed07746a0766278885c5958783a6085cfd8" ||
    b.candidate.creationCodeKeccak256 !==
      "0xf023699aa88555c93441bd0a9cdecd621b1d5387a047ef704e68bf496411189c" ||
    b.candidate.runtimeTemplateKeccak256 !==
      "0x9b40d5a6910713f30cbb8c2df1197b2332b77bf98741e1c0e7711fd6a10d49e7" ||
    b.candidate.runtimeBytes !== 24569 ||
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
      "The permit package differs from the approved Base engine upgrade."
    );
  const groups = Object.values(b.candidate.immutableReferences),
    spans = groups.flat(),
    size = b.candidate.runtimeBytes;
  if (
    groups.length !== 1 ||
    spans.length !== 2 ||
    [...spans]
      .sort((a, c) => a.start - c.start)
      .some((span, i) => span.start !== [2273, 2569][i]) ||
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
export async function readPermitUpgradePackage(signal?: AbortSignal) {
  if (!permitUpgradePackageSha256)
    throw new Error("The approved permit upgrade package is not ready.");
  const response = await fetch(permitUpgradePackagePath, {
    cache: "no-store",
    signal
  });
  if (!response.ok)
    throw new Error("The approved permit upgrade package could not be loaded.");
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 500000)
    throw new Error("The permit package is too large.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== permitUpgradePackageSha256)
    throw new Error(
      "The permit package checksum changed. No transaction was prepared."
    );
  return validatePermitUpgradePackage(
    JSON.parse(new TextDecoder().decode(raw))
  );
}
export function permitImplementationRuntime(
  b: PermitUpgradeBundle,
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
export async function checkPermitImplementation(
  client: PublicClient,
  b: PermitUpgradeBundle,
  implementation: Address
) {
  if (
    implementation.toLowerCase() === b.proxy.toLowerCase() ||
    implementation.toLowerCase() ===
      b.currentImplementation.address.toLowerCase()
  )
    throw new Error("Use the newly deployed implementation address.");
  const [code, uuid, maximum, permitVersion] = await Promise.all([
    client.getCode({ address: implementation }),
    client.readContract({
      address: implementation,
      abi: permitUpgradeAbi,
      functionName: "proxiableUUID"
    }),
    client.readContract({
      address: implementation,
      abi: permitUpgradeAbi,
      functionName: "MAX_OPEN_PACKS"
    }),
    client.readContract({
      address: implementation,
      abi: permitUpgradeAbi,
      functionName: "PERMIT_OPEN_VERSION"
    })
  ]);
  if (
    !code ||
    keccak256(code) !==
      keccak256(permitImplementationRuntime(b, implementation)) ||
    uuid !== permitImplementationSlot ||
    Number(maximum) !== b.capability.maxOpenPacks ||
    permitVersion !== 1n
  )
    throw new Error(
      "This address does not contain the approved UUPS permit implementation."
    );
  return getAddress(implementation);
}
export async function checkPermitUpgradeState(
  client: PublicClient,
  b: PermitUpgradeBundle,
  implementation?: Address
) {
  const [chain, proxyCode, stored, role, registry, monsters, wrapper] =
    await Promise.all([
      client.getChainId(),
      client.getCode({ address: b.proxy }),
      client.getStorageAt({ address: b.proxy, slot: permitImplementationSlot }),
      client.readContract({
        address: b.proxy,
        abi: permitUpgradeAbi,
        functionName: "hasRole",
        args: [b.roles.upgrader.id, b.owner]
      }),
      ...(["registry", "monsters", "wrapper"] as const).map((functionName) =>
        client.readContract({
          address: b.proxy,
          abi: permitUpgradeAbi,
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
  if (implementation)
    await checkPermitImplementation(client, b, implementation);
  if (
    implementation &&
    current.toLowerCase() === implementation.toLowerCase()
  ) {
    const maximum = await client.readContract({
      address: b.proxy,
      abi: permitUpgradeAbi,
      functionName: "MAX_OPEN_PACKS"
    });
    const version = await client.readContract({
      address: b.proxy,
      abi: permitUpgradeAbi,
      functionName: "PERMIT_OPEN_VERSION"
    });
    if (Number(maximum) !== b.capability.maxOpenPacks || version !== 1n)
      throw new Error(
        "The installed engine permit limit differs from the approved package."
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
export async function recoverPermitImplementation(
  client: PublicClient,
  b: PermitUpgradeBundle,
  hash: Hex
) {
  const [chain, receipt, transaction] = await Promise.all([
    client.getChainId(),
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash })
  ]);
  if (chain !== 8453)
    throw new Error("Verify this deployment receipt on Base mainnet.");
  assertPermitReceiptIdentity(receipt, transaction, hash);
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
  return checkPermitImplementation(client, b, receipt.contractAddress);
}
export function assertPermitReceiptIdentity(
  receipt: { transactionHash: Hex; blockHash: Hex; blockNumber: bigint },
  transaction: {
    hash: Hex;
    blockHash: Hex | null;
    blockNumber: bigint | null;
  },
  expectedHash: Hex
) {
  if (
    receipt.transactionHash?.toLowerCase() !== expectedHash.toLowerCase() ||
    transaction.hash?.toLowerCase() !== expectedHash.toLowerCase() ||
    !receipt.blockHash ||
    transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    transaction.blockNumber !== receipt.blockNumber
  )
    throw new Error("The confirmed receipt does not match its transaction.");
}
export function permitUpgradeCalldata(
  b: PermitUpgradeBundle,
  implementation: Address
) {
  return encodeFunctionData({
    abi: permitUpgradeAbi,
    functionName: "upgradeToAndCall",
    args: [implementation, b.configurationCalldata]
  });
}

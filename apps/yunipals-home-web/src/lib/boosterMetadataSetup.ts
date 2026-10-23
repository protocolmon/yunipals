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

export const metadataUpgradePackageSha256 =
  "e59f7ce628c8a3ed42e432a7340f495abcb2eebf3f12a4aec0cc5420363fc966";
export const metadataUpgradePackagePath =
  "/boosters/monsters-token-metadata-upgrade-v1.json";
export const metadataUpgradeProxy =
  "0x105319be2182018c31FB10B1bE198c3cf238a146" as const;
export const metadataUpgradeBaseURI =
  "https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/0x105319be2182018c31fb10b1be198c3cf238a146/";
export const metadataImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const metadataUpgradeAbi = parseAbi([
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function proxiableUUID() view returns (bytes32)",
  "function tokenMetadataBaseURI() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function setTokenMetadataBaseURI(string baseURI)",
  "function upgradeToAndCall(address newImplementation,bytes data) payable"
]);
const hex = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((v) => v as Hex);
const digest = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);
const address = z
  .string()
  .refine(isAddress)
  .transform((v) => getAddress(v));
const role = z.object({ name: z.string(), id: digest });
const bundleSchema = z.object({
  format: z.literal("yunipals-monsters-token-metadata-upgrade-v1"),
  status: z.literal("unsigned-not-broadcast"),
  chainId: z.literal(8453),
  owner: address,
  proxy: address,
  proxyRuntimeCodeKeccak256: digest,
  implementationSlot: digest,
  roles: z.object({ upgrader: role, configuration: role, administrator: role }),
  currentImplementation: z.object({ address, runtimeCodeKeccak256: digest }),
  candidate: z.object({
    creationBytecode: hex,
    creationCodeKeccak256: digest,
    runtimeBytecodeTemplate: hex,
    runtimeTemplateKeccak256: digest,
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    immutableReferences: z.record(
      z.array(
        z.object({
          start: z.number().int().nonnegative(),
          length: z.literal(32)
        })
      )
    ),
    storage: z.object({
      existingFieldsPreserved: z.literal(4),
      provenanceStructUnchanged: z.literal(true),
      tokenMetadataBaseURISlot: z.literal(4),
      remainingGapSlots: z.literal(45)
    })
  }),
  metadataBaseURI: z.string(),
  configurationCalldata: hex,
  deploymentTransaction: z
    .object({
      from: address,
      chainId: z.literal("0x2105"),
      value: z.literal("0x0"),
      data: hex
    })
    .strict(),
  nonce: z.object({ supplied: z.literal(false), startingNonce: z.null() }),
  metadataProbe: z.object({
    url: z.string(),
    tokenId: z.literal("1"),
    originalTokenId: z.literal("1"),
    collection: address,
    birthDay: z.literal(0)
  })
});
export type MetadataUpgradeBundle = z.infer<typeof bundleSchema>;

export function validateMetadataUpgradePackage(
  value: unknown
): MetadataUpgradeBundle {
  const b = bundleSchema.parse(value);
  const same = (a: string, c: string) => a.toLowerCase() === c.toLowerCase();
  if (
    !same(b.owner, boosterSetupOwner) ||
    !same(b.proxy, metadataUpgradeProxy) ||
    b.implementationSlot !== metadataImplementationSlot ||
    b.metadataBaseURI !== metadataUpgradeBaseURI ||
    b.metadataProbe.url !== `${metadataUpgradeBaseURI}1.json` ||
    !same(b.metadataProbe.collection, b.proxy) ||
    !same(b.deploymentTransaction.from, b.owner) ||
    b.deploymentTransaction.data !== b.candidate.creationBytecode ||
    keccak256(b.candidate.creationBytecode) !==
      b.candidate.creationCodeKeccak256 ||
    keccak256(b.candidate.runtimeBytecodeTemplate) !==
      b.candidate.runtimeTemplateKeccak256 ||
    b.configurationCalldata !==
      encodeFunctionData({
        abi: metadataUpgradeAbi,
        functionName: "setTokenMetadataBaseURI",
        args: [metadataUpgradeBaseURI]
      }) ||
    b.roles.upgrader.id !==
      keccak256(new TextEncoder().encode("UPGRADER_ROLE")) ||
    b.roles.configuration.id !==
      keccak256(new TextEncoder().encode("CONFIG_ROLE")) ||
    b.roles.administrator.id !== `0x${"0".repeat(64)}`
  ) {
    throw new Error(
      "The metadata package differs from the approved Base upgrade."
    );
  }
  // UUPS embeds __self twice. Only these zero-filled spans may be address-patched.
  const groups = Object.values(b.candidate.immutableReferences);
  const spans = groups.flat();
  const size = (b.candidate.runtimeBytecodeTemplate.length - 2) / 2;
  if (
    groups.length !== 1 ||
    spans.length !== 2 ||
    spans.some(
      (span, i) =>
        span.start + span.length > size ||
        b.candidate.runtimeBytecodeTemplate.slice(
          2 + span.start * 2,
          2 + (span.start + span.length) * 2
        ) !== "0".repeat(64) ||
        spans.some(
          (other, j) =>
            i !== j &&
            span.start < other.start + other.length &&
            other.start < span.start + span.length
        )
    )
  )
    throw new Error("Invalid UUPS implementation address references.");
  return b;
}

export async function readMetadataUpgradePackage(signal?: AbortSignal) {
  const response = await fetch(metadataUpgradePackagePath, {
    cache: "no-store",
    signal
  });
  if (!response.ok)
    throw new Error(
      "The approved metadata upgrade package could not be loaded."
    );
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 500000)
    throw new Error("The metadata package is too large.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== metadataUpgradePackageSha256)
    throw new Error(
      "The metadata package checksum changed. No transaction was prepared."
    );
  return validateMetadataUpgradePackage(
    JSON.parse(new TextDecoder().decode(bytes))
  );
}

export function metadataImplementationRuntime(
  b: MetadataUpgradeBundle,
  implementation: Address
): Hex {
  let code = b.candidate.runtimeBytecodeTemplate;
  const replacement = padHex(implementation.toLowerCase() as Hex, {
    size: 32
  }).slice(2);
  for (const span of Object.values(b.candidate.immutableReferences).flat()) {
    const start = 2 + span.start * 2;
    code =
      `${code.slice(0, start)}${replacement}${code.slice(start + span.length * 2)}` as Hex;
  }
  return code;
}

export async function checkMetadataImplementation(
  client: PublicClient,
  b: MetadataUpgradeBundle,
  implementation: Address
) {
  if (
    [b.proxy, b.currentImplementation.address].some(
      (v) => v.toLowerCase() === implementation.toLowerCase()
    )
  )
    throw new Error("Use the newly deployed implementation address.");
  const [code, uuid] = await Promise.all([
    client.getCode({ address: implementation }),
    client.readContract({
      address: implementation,
      abi: metadataUpgradeAbi,
      functionName: "proxiableUUID"
    })
  ]);
  if (
    !code ||
    keccak256(code) !==
      keccak256(metadataImplementationRuntime(b, implementation)) ||
    uuid !== metadataImplementationSlot
  )
    throw new Error(
      "This address does not contain the approved UUPS implementation."
    );
  return getAddress(implementation);
}

export async function checkMetadataUpgradeState(
  client: PublicClient,
  b: MetadataUpgradeBundle,
  implementation?: Address
) {
  const [chain, proxyCode, stored, upgradeRole, configRole] = await Promise.all(
    [
      client.getChainId(),
      client.getCode({ address: b.proxy }),
      client.getStorageAt({
        address: b.proxy,
        slot: metadataImplementationSlot
      }),
      client.readContract({
        address: b.proxy,
        abi: metadataUpgradeAbi,
        functionName: "hasRole",
        args: [b.roles.upgrader.id, b.owner]
      }),
      client.readContract({
        address: b.proxy,
        abi: metadataUpgradeAbi,
        functionName: "hasRole",
        args: [b.roles.configuration.id, b.owner]
      })
    ]
  );
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
  if (!upgradeRole || !configRole)
    throw new Error(
      "The approved owner needs both upgrade and configuration permissions."
    );
  const current = getAddress(`0x${stored.slice(-40)}`);
  if (implementation)
    await checkMetadataImplementation(client, b, implementation);
  if (
    implementation &&
    current.toLowerCase() === implementation.toLowerCase()
  ) {
    const [baseURI, tokenURI] = await Promise.all([
      client.readContract({
        address: b.proxy,
        abi: metadataUpgradeAbi,
        functionName: "tokenMetadataBaseURI"
      }),
      client.readContract({
        address: b.proxy,
        abi: metadataUpgradeAbi,
        functionName: "tokenURI",
        args: [1n]
      })
    ]);
    if (
      baseURI !== b.metadataBaseURI ||
      tokenURI !== `${b.metadataBaseURI}1.json`
    )
      throw new Error(
        "The implementation is installed but its metadata configuration differs."
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

export async function checkMetadataAPI(b: MetadataUpgradeBundle) {
  const response = await fetch(b.metadataProbe.url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "The per-NFT metadata API is not ready. Publish and verify it before upgrading."
    );
  const document = await response.json();
  const proof = z
    .object({
      image: z.string().url(),
      yunipals: z.object({
        birthMetadataVersion: z.literal(1),
        chainId: z.literal(8453),
        collection: address,
        tokenId: z.literal("1"),
        originalTokenId: z.literal("1"),
        birthDay: z.literal(0),
        bornAt: z.string().regex(/^[1-9][0-9]*$/),
        originalBornAt: z.string().regex(/^[1-9][0-9]*$/),
        mint: z.object({ transactionHash: digest, blockHash: digest })
      })
    })
    .safeParse(document);
  if (
    !proof.success ||
    proof.data.yunipals.collection.toLowerCase() !== b.proxy.toLowerCase() ||
    proof.data.yunipals.bornAt !== proof.data.yunipals.originalBornAt
  )
    throw new Error(
      "The metadata API did not return the original NFT's verified birth metadata."
    );
  return proof.data;
}

export async function recoverMetadataImplementation(
  client: PublicClient,
  b: MetadataUpgradeBundle,
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
  return checkMetadataImplementation(client, b, receipt.contractAddress);
}

export function metadataUpgradeCalldata(
  b: MetadataUpgradeBundle,
  implementation: Address
) {
  return encodeFunctionData({
    abi: metadataUpgradeAbi,
    functionName: "upgradeToAndCall",
    args: [implementation, b.configurationCalldata]
  });
}

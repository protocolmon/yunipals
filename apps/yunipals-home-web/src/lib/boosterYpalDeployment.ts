import { z } from "zod";
import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  hashDomain,
  isAddress,
  keccak256,
  padHex,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { validateBoosterCatalog } from "@protopals/yunipals-market-core/boosterCatalog";

import { boosterSetupOwner } from "./boosterSetup";
import { assertPermitReceiptIdentity } from "./boosterPermitSetup";

// Frozen complete public package. Wallet nonces and actual addresses are not supplied.
export const ypalLaunchPackageSha256 =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
export const ypalLaunchPackagePath = "/boosters/ypal-fresh-launch-v1.json";
export const ypalImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const ypalPmon = "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7";
export const ypalBurnAddress = "0xff2Ba07e6F84D22730eD78D1117735a4B041c6EF";
export const ypalVrfWrapper = "0xb0407dbe851f8318bd31404A49e658143C982F23";
export const ypalMetadataPrefix =
  "https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/";
const artBase =
  "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/";
const bytes = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((v) => v.toLowerCase() as Hex);
const digest = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase() as Hex);
const address = z
  .string()
  .refine(isAddress)
  .transform((v) => getAddress(v));
const artifactSchema = z
  .object({
    contractName: z.string(),
    creationBytecode: bytes,
    creationKeccak256: digest,
    runtimeTemplate: bytes,
    runtimeTemplateKeccak256: digest,
    immutableReferences: z
      .array(
        z
          .object({
            offset: z.number().int().nonnegative(),
            length: z.literal(32),
            value: z.enum(["pmon", "self"])
          })
          .strict()
      )
      .max(16)
  })
  .strict();
const schema = z
  .object({
    format: z.literal("yunipals-ypal-fresh-launch-v1"),
    launchId: z.literal("base-ypal-v1"),
    chainId: z.literal(8453),
    owner: address,
    pmon: address,
    burnAddress: address,
    vrfWrapper: address,
    artifacts: z
      .object({
        ypal: artifactSchema,
        registry: artifactSchema,
        monsters: artifactSchema,
        engine: artifactSchema,
        proxy: artifactSchema
      })
      .strict(),
    pack: z
      .object({
        priceRaw: z.literal("1000000000000000000"),
        intervalSeconds: z.literal("86400"),
        mintsPerInterval: z.literal(1),
        maxBatch: z.literal(7),
        baseGas: z.literal(450000),
        perMintGas: z.literal(250000),
        confirmations: z.literal(3),
        supplyCap: z.literal("0"),
        artworkHash: z.literal(
          "0x29c9b8dfc3c35854a0396850a4e40da3457cf44a9901157c67564b92d61276ac"
        ),
        manifestURI: z.literal(artBase + "manifest.json"),
        metadataBaseURI: z.literal(artBase),
        catalog: z
          .object({
            types: z.array(z.number().int()),
            colors: z.array(z.number().int()),
            horns: z.array(z.number().int()),
            glitters: z.array(z.number().int()),
            allowed: z.array(z.number().int())
          })
          .strict()
      })
      .strict(),
    tokenMetadataBasePrefix: z.literal(ypalMetadataPrefix)
  })
  .strict();
export type YpalLaunchBundle = z.infer<typeof schema>;
export type YpalArtifact = z.infer<typeof artifactSchema>;
export const ypalLaunchSteps = [
  "ypal",
  "registryImplementation",
  "registry",
  "monstersImplementation",
  "monsters",
  "engineImplementation",
  "engine",
  "metadata",
  "configure",
  "activate"
] as const;
export type YpalLaunchStep = (typeof ypalLaunchSteps)[number];
export type YpalLaunchReceipts = Partial<Record<YpalLaunchStep, Hex>>;
export type YpalLaunchAddresses = Partial<
  Record<
    (typeof ypalLaunchSteps)[number] &
      (
        | "ypal"
        | "registryImplementation"
        | "registry"
        | "monstersImplementation"
        | "monsters"
        | "engineImplementation"
        | "engine"
      ),
    Address
  >
>;
export type YpalLaunchState = {
  completed: number;
  addresses: YpalLaunchAddresses;
  typeId?: bigint;
  provenance?: Partial<
    Record<
      YpalLaunchStep,
      {
        transactionHash: Hex;
        blockNumber: bigint;
        blockHash: Hex;
        status: "success";
        contractAddress: Address | null;
      }
    >
  >;
  nextStep: YpalLaunchStep | null;
  pending?: { step: YpalLaunchStep; hash: Hex };
  failed?: { step: YpalLaunchStep; hash: Hex; cancelled: boolean };
  blockNumber?: bigint;
};
export const ypalStepLabels: Record<YpalLaunchStep, string> = {
  ypal: "Deploy YPAL token",
  registryImplementation: "Deploy registry implementation",
  registry: "Deploy registry proxy",
  monstersImplementation: "Deploy NFT implementation",
  monsters: "Deploy NFT collection proxy",
  engineImplementation: "Deploy engine implementation",
  engine: "Deploy engine proxy",
  metadata: "Set NFT birth metadata",
  configure: "Configure public pack",
  activate: "Activate public pack"
};
const adminAbi = parseAbi([
  "function hasRole(bytes32,address) view returns(bool)",
  "function proxiableUUID() view returns(bytes32)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function MAX_OPEN_PACKS() view returns(uint32)",
  "function PERMIT_OPEN_VERSION() view returns(uint256)",
  "function tokenMetadataBaseURI() view returns(string)",
  "function setTokenMetadataBaseURI(string)"
]);
const tokenAbi = parseAbi([
  "function pmon() view returns(address)",
  "function burnAddress() view returns(address)",
  "function owner() view returns(address)",
  "function isLocked() view returns(bool)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function DOMAIN_SEPARATOR() view returns(bytes32)",
  "function nonces(address) view returns(uint256)"
]);
const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function validateYpalLaunchPackage(value: unknown): YpalLaunchBundle {
  const b = schema.parse(value);
  if (
    !same(b.owner, boosterSetupOwner) ||
    !same(b.pmon, ypalPmon) ||
    !same(b.burnAddress, ypalBurnAddress) ||
    !same(b.vrfWrapper, ypalVrfWrapper)
  )
    throw Error("The fresh launch wallet or Base dependencies changed.");
  const expected = {
    types: Array.from({ length: 11 }, (_, i) => i + 1),
    colors: [1, 2, 3, 4, 5, 6],
    horns: [1, 2],
    glitters: [0, 1],
    allowed: []
  };
  if (JSON.stringify(b.pack.catalog) !== JSON.stringify(expected))
    throw Error("The public pack must use the approved 264-variant catalog.");
  validateBoosterCatalog(b.pack.catalog);
  const names = {
    ypal: "YPAL",
    registry: "PackRegistry",
    monsters: "YunipalMonsters",
    engine: "BoosterPacks",
    proxy: "ERC1967Proxy"
  } as const;
  const offsets = {
    ypal: [676, 982, 1916, 2875, 3030, 3628, 3834],
    registry: [5953, 6160],
    monsters: [2470, 3225],
    engine: [2273, 2569],
    proxy: []
  };
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const a = b.artifacts[key],
      size = (a.runtimeTemplate.length - 2) / 2;
    if (
      a.contractName !== names[key] ||
      JSON.stringify(
        a.immutableReferences.map((ref) => ref.offset).sort((x, y) => x - y)
      ) !== JSON.stringify(offsets[key]) ||
      keccak256(a.creationBytecode) !== a.creationKeccak256 ||
      keccak256(a.runtimeTemplate) !== a.runtimeTemplateKeccak256 ||
      size > 24576 ||
      (a.creationBytecode.length - 2) / 2 > 49152 ||
      (key === "proxy" && a.immutableReferences.length !== 0) ||
      a.immutableReferences.some(
        (r, i) =>
          r.value !== (key === "ypal" ? "pmon" : "self") ||
          r.offset + 32 > size ||
          a.runtimeTemplate.slice(2 + r.offset * 2, 2 + (r.offset + 32) * 2) !==
            "0".repeat(64) ||
          a.immutableReferences.some(
            (other, j) =>
              i !== j &&
              r.offset < other.offset + 32 &&
              other.offset < r.offset + 32
          )
      )
    )
      throw Error(
        "A launch artifact failed its bytecode or immutable-reference checks."
      );
  }
  return b;
}
export async function readYpalLaunchPackage(signal?: AbortSignal) {
  if (!/^[0-9a-f]{64}$/.test(ypalLaunchPackageSha256))
    throw Error("The reviewed fresh YPAL launch package is not ready.");
  const response = await fetch(ypalLaunchPackagePath, {
    cache: "no-store",
    signal
  });
  if (!response.ok)
    throw Error("The reviewed fresh launch package could not be loaded.");
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 1000000) throw Error("The launch package is too large.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== ypalLaunchPackageSha256)
    throw Error(
      "The launch package checksum changed. No transaction was prepared."
    );
  return validateYpalLaunchPackage(JSON.parse(new TextDecoder().decode(raw)));
}
export function ypalRuntime(
  a: YpalArtifact,
  actual: Address,
  pmon: Address
): Hex {
  let code = a.runtimeTemplate;
  for (const ref of a.immutableReferences) {
    const start = 2 + ref.offset * 2;
    code = (code.slice(0, start) +
      padHex(ref.value === "pmon" ? pmon : actual, { size: 32 })
        .slice(2)
        .toLowerCase() +
      code.slice(start + 64)) as Hex;
  }
  return code;
}
function required(
  a: YpalLaunchAddresses,
  key: keyof YpalLaunchAddresses
): Address {
  const value = a[key];
  if (!value) throw Error("Verify each preceding deployment receipt first.");
  return value;
}
export function ypalPackArguments(b: YpalLaunchBundle, a: YpalLaunchAddresses) {
  return {
    rules: {
      engine: required(a, "engine"),
      paymentToken: required(a, "ypal"),
      price: BigInt(b.pack.priceRaw),
      intervalSeconds: BigInt(b.pack.intervalSeconds),
      mintsPerInterval: b.pack.mintsPerInterval,
      maxBatch: b.pack.maxBatch,
      baseGas: b.pack.baseGas,
      perMintGas: b.pack.perMintGas,
      confirmations: b.pack.confirmations,
      supplyCap: BigInt(b.pack.supplyCap),
      artworkHash: b.pack.artworkHash as Hex,
      manifestURI: b.pack.manifestURI,
      metadataBaseURI: b.pack.metadataBaseURI
    },
    catalog: b.pack.catalog
  };
}
export function ypalLaunchAction(
  b: YpalLaunchBundle,
  step: YpalLaunchStep,
  state: YpalLaunchState
): { to?: Address; data: Hex; value: 0n } {
  const a = state.addresses,
    creation = (data: Hex) => ({ data, value: 0n as const });
  if (step === "ypal")
    return creation(
      encodeDeployData({
        abi: parseAbi(["constructor(address pmon_,address burnAddress_)"]),
        bytecode: b.artifacts.ypal.creationBytecode,
        args: [b.pmon, b.burnAddress]
      })
    );
  const implementation = {
    registryImplementation: "registry",
    monstersImplementation: "monsters",
    engineImplementation: "engine"
  } as const;
  if (step in implementation)
    return creation(
      b.artifacts[implementation[step as keyof typeof implementation]]
        .creationBytecode
    );
  if (step === "registry" || step === "monsters" || step === "engine") {
    const data =
      step === "registry"
        ? encodeFunctionData({
            abi: parseAbi(["function initialize(address)"]),
            functionName: "initialize",
            args: [b.owner]
          })
        : step === "monsters"
          ? encodeFunctionData({
              abi: parseAbi(["function initialize(address,address)"]),
              functionName: "initialize",
              args: [b.owner, required(a, "registry")]
            })
          : encodeFunctionData({
              abi: parseAbi([
                "function initialize(address,address,address,address)"
              ]),
              functionName: "initialize",
              args: [
                b.owner,
                required(a, "registry"),
                required(a, "monsters"),
                b.vrfWrapper
              ]
            });
    return creation(
      encodeDeployData({
        abi: parseAbi(["constructor(address implementation,bytes data)"]),
        bytecode: b.artifacts.proxy.creationBytecode,
        args: [required(a, `${step}Implementation`), data]
      })
    );
  }
  if (step === "metadata")
    return {
      to: required(a, "monsters"),
      value: 0n,
      data: encodeFunctionData({
        abi: adminAbi,
        functionName: "setTokenMetadataBaseURI",
        args: [
          b.tokenMetadataBasePrefix +
            required(a, "monsters").toLowerCase() +
            "/"
        ]
      })
    };
  if (step === "configure") {
    const { rules, catalog } = ypalPackArguments(b, a);
    return {
      to: required(a, "registry"),
      value: 0n,
      data: encodeFunctionData({
        abi: packRegistryAbi,
        functionName: "configureType",
        args: [0n, rules, catalog]
      })
    };
  }
  if (state.typeId !== 1n)
    throw Error(
      "Verify the actual fresh public pack configuration receipt first."
    );
  return {
    to: required(a, "registry"),
    value: 0n,
    data: encodeFunctionData({
      abi: packRegistryAbi,
      functionName: "activate",
      args: [state.typeId]
    })
  };
}
function artifactFor(b: YpalLaunchBundle, step: YpalLaunchStep) {
  if (step === "ypal") return b.artifacts.ypal;
  if (step === "registry" || step === "monsters" || step === "engine")
    return b.artifacts.proxy;
  if (step === "registryImplementation") return b.artifacts.registry;
  if (step === "monstersImplementation") return b.artifacts.monsters;
  if (step === "engineImplementation") return b.artifacts.engine;
  return null;
}
export async function checkYpalLaunchState(
  client: PublicClient,
  b: YpalLaunchBundle,
  state: YpalLaunchState
) {
  if ((await client.getChainId()) !== 8453)
    throw Error("Read this deployment on Base mainnet.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 }),
    a = state.addresses;
  for (const step of ypalLaunchSteps.slice(0, 7)) {
    const actual = a[step as keyof YpalLaunchAddresses];
    if (!actual) continue;
    const artifact = artifactFor(b, step)!;
    const code = await client.getCode({ address: actual, blockNumber });
    if (
      !code ||
      keccak256(code) !== keccak256(ypalRuntime(artifact, actual, b.pmon))
    )
      throw Error(
        "A deployed address no longer contains the exact reviewed artifact."
      );
    if (step.endsWith("Implementation")) {
      if (
        (await client.readContract({
          address: actual,
          abi: adminAbi,
          functionName: "proxiableUUID",
          blockNumber
        })) !== ypalImplementationSlot
      )
        throw Error("The implementation is not the approved UUPS contract.");
    }
    if (step === "registry" || step === "monsters" || step === "engine") {
      const slot = await client.getStorageAt({
        address: actual,
        slot: ypalImplementationSlot,
        blockNumber
      });
      if (
        slot?.toLowerCase() !==
        padHex(required(a, `${step}Implementation`), { size: 32 }).toLowerCase()
      )
        throw Error("A fresh proxy's actual implementation changed.");
      for (const role of [
        `0x${"00".repeat(32)}`,
        ...["CONFIG_ROLE", "PAUSER_ROLE", "UPGRADER_ROLE"].map((r) =>
          keccak256(new TextEncoder().encode(r))
        )
      ] as Hex[])
        if (
          !(await client.readContract({
            address: actual,
            abi: adminAbi,
            functionName: "hasRole",
            args: [role, b.owner],
            blockNumber
          }))
        )
          throw Error("The fresh proxy's admin permissions changed.");
    }
  }
  if (a.ypal) {
    const [pmon, burn, owner, locked, name, symbol, decimals, domain] =
      await Promise.all(
        (
          [
            "pmon",
            "burnAddress",
            "owner",
            "isLocked",
            "name",
            "symbol",
            "decimals",
            "DOMAIN_SEPARATOR"
          ] as const
        ).map((functionName) =>
          client.readContract({
            address: a.ypal!,
            abi: tokenAbi,
            functionName,
            blockNumber
          })
        )
      );
    const expected = hashDomain({
      domain: {
        name: "Yunipals",
        version: "1",
        chainId: 8453n,
        verifyingContract: a.ypal
      },
      types: domainTypes
    });
    if (
      !same(String(pmon), b.pmon) ||
      !same(String(burn), b.burnAddress) ||
      !same(String(owner), b.owner) ||
      locked !== false ||
      name !== "Yunipals" ||
      symbol !== "YPAL" ||
      decimals !== 18 ||
      domain !== expected
    )
      throw Error(
        "The deployed YPAL backing, owner or permit domain differs from the reviewed token."
      );
  }
  if (
    a.monsters &&
    !same(
      await client.readContract({
        address: a.monsters,
        abi: adminAbi,
        functionName: "registry",
        blockNumber
      }),
      required(a, "registry")
    )
  )
    throw Error("The fresh NFT collection uses a different registry.");
  if (a.engine) {
    const [registry, monsters, wrapper, maximum, permit] = await Promise.all(
      (
        [
          "registry",
          "monsters",
          "wrapper",
          "MAX_OPEN_PACKS",
          "PERMIT_OPEN_VERSION"
        ] as const
      ).map((functionName) =>
        client.readContract({
          address: a.engine!,
          abi: adminAbi,
          functionName,
          blockNumber
        })
      )
    );
    if (
      !same(String(registry), required(a, "registry")) ||
      !same(String(monsters), required(a, "monsters")) ||
      !same(String(wrapper), b.vrfWrapper) ||
      maximum !== 10 ||
      permit !== 1n
    )
      throw Error(
        "The fresh engine dependencies or purchase capabilities changed."
      );
  }
  if (state.completed >= 8) {
    const uri = await client.readContract({
      address: required(a, "monsters"),
      abi: adminAbi,
      functionName: "tokenMetadataBaseURI",
      blockNumber
    });
    if (
      uri !==
      b.tokenMetadataBasePrefix + required(a, "monsters").toLowerCase() + "/"
    )
      throw Error(
        "The NFT birth metadata base differs from the verified fresh collection."
      );
  }
  if (a.registry) {
    const count = await client.readContract({
      address: a.registry,
      abi: packRegistryAbi,
      functionName: "typeCount",
      blockNumber
    });
    if (count !== (state.completed >= 9 ? 1n : 0n))
      throw Error(
        "The registry changed. Restore the actual configuration receipt before creating another pack."
      );
    if (state.completed >= 9) {
      const [pack, catalog] = await Promise.all([
        client.readContract({
          address: a.registry,
          abi: packRegistryAbi,
          functionName: "getPack",
          args: [1n],
          blockNumber
        }),
        client.readContract({
          address: a.registry,
          abi: packRegistryAbi,
          functionName: "getCatalog",
          args: [1n],
          blockNumber
        })
      ]);
      const actual = encodeFunctionData({
        abi: packRegistryAbi,
        functionName: "configureType",
        args: [0n, pack.rules, catalog]
      });
      if (
        actual !== ypalLaunchAction(b, "configure", state).data ||
        pack.catalogHash !==
          validateBoosterCatalog(b.pack.catalog).catalogHash ||
        pack.active !== (state.completed === 10) ||
        pack.salesPaused ||
        (pack.active && pack.totalVariants !== 264)
      )
        throw Error(
          "The fresh public pack rules or activation differ from the reviewed launch."
        );
    }
  }
  return { ...state, blockNumber };
}
export async function readYpalDeployment(
  client: PublicClient,
  b: YpalLaunchBundle,
  saved: YpalLaunchReceipts
): Promise<YpalLaunchState> {
  if ((await client.getChainId()) !== 8453)
    throw Error("Verify launch receipts on Base mainnet.");
  let state: YpalLaunchState = {
    completed: 0,
    addresses: {},
    provenance: {},
    nextStep: "ypal"
  };
  for (let i = 0; i < ypalLaunchSteps.length; i++) {
    const step = ypalLaunchSteps[i],
      hash = saved[step];
    if (!hash) {
      if (ypalLaunchSteps.slice(i + 1).some((key) => saved[key]))
        throw Error("Restore deployment receipts in their original order.");
      break;
    }
    if (!/^0x[0-9a-f]{64}$/i.test(hash))
      throw Error("Invalid saved deployment transaction hash.");
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "TransactionReceiptNotFoundError"
      )
        return {
          ...(await checkYpalLaunchState(client, b, state)),
          pending: { step, hash }
        };
      throw error;
    }
    const transaction = await client.getTransaction({ hash });
    assertPermitReceiptIdentity(receipt, transaction, hash);
    const header = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (header.hash?.toLowerCase() !== receipt.blockHash.toLowerCase())
      throw Error(
        "The saved receipt is no longer in the canonical Base block."
      );
    if (transaction.chainId !== 8453 || !same(transaction.from, b.owner))
      throw Error(
        "The saved receipt was not signed by the approved owner on Base."
      );
    const action = ypalLaunchAction(b, step, state);
    const cancelled =
      transaction.to !== null &&
      same(transaction.to, b.owner) &&
      transaction.value === 0n &&
      transaction.input === "0x";
    const matches =
      same(transaction.input, action.data) &&
      transaction.value === 0n &&
      (action.to
        ? transaction.to !== null && same(transaction.to, action.to)
        : transaction.to === null);
    if (!matches && !cancelled)
      throw Error(
        "The saved transaction differs from the exact reviewed deployment step."
      );
    if (cancelled || receipt.status === "reverted")
      return {
        ...(await checkYpalLaunchState(client, b, state)),
        failed: { step, hash, cancelled }
      };
    if (receipt.status !== "success")
      throw Error("The deployment transaction is not confirmed successful.");
    if (artifactFor(b, step)) {
      if (
        !receipt.contractAddress ||
        !isAddress(receipt.contractAddress) ||
        /^0x0{40}$/i.test(receipt.contractAddress) ||
        Object.values(state.addresses).some((a) =>
          same(a, receipt.contractAddress!)
        )
      )
        throw Error(
          "A unique contract address is required from the actual deployment receipt."
        );
      state.addresses[step as keyof YpalLaunchAddresses] = getAddress(
        receipt.contractAddress
      );
    }
    if (step === "configure") {
      const logs = parseEventLogs({
        abi: packRegistryAbi,
        eventName: "TypeConfigured",
        logs: receipt.logs,
        strict: true
      }).filter((log) =>
        same(log.address, required(state.addresses, "registry"))
      );
      if (
        logs.length !== 1 ||
        logs[0].args.packTypeId !== 1n ||
        !same(logs[0].args.engine, required(state.addresses, "engine")) ||
        logs[0].args.catalogHash !==
          validateBoosterCatalog(b.pack.catalog).catalogHash
      )
        throw Error(
          "The actual configuration receipt must create the single fresh public pack."
        );
      state.typeId = logs[0].args.packTypeId;
    }
    state.provenance![step] = {
      transactionHash: hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      status: "success",
      contractAddress: receipt.contractAddress
        ? getAddress(receipt.contractAddress)
        : null
    };
    state = {
      ...state,
      completed: i + 1,
      nextStep: ypalLaunchSteps[i + 1] ?? null
    };
  }
  return checkYpalLaunchState(client, b, state);
}
export function ypalDeploymentManifest(
  b: YpalLaunchBundle,
  state: YpalLaunchState
) {
  if (
    state.completed !== 10 ||
    state.nextStep !== null ||
    state.pending ||
    state.failed ||
    state.typeId !== 1n ||
    !state.provenance ||
    ypalLaunchSteps.some((step) => !state.provenance?.[step])
  )
    throw Error(
      "Verify all ten confirmed launch actions before exporting the deployment."
    );
  const a = state.addresses,
    sourceStartBlock = ["registry", "monsters", "engine"]
      .map((key) => state.provenance![key as YpalLaunchStep]!.blockNumber)
      .reduce((x, y) => (x < y ? x : y));
  return {
    format: "yunipals-ypal-fresh-deployment-confirmed-v1",
    launchId: b.launchId,
    chainId: 8453,
    owner: b.owner,
    pmon: b.pmon,
    burnAddress: b.burnAddress,
    vrfWrapper: b.vrfWrapper,
    ypal: required(a, "ypal"),
    registry: required(a, "registry"),
    monsters: required(a, "monsters"),
    engine: required(a, "engine"),
    implementations: {
      registry: required(a, "registryImplementation"),
      monsters: required(a, "monstersImplementation"),
      engine: required(a, "engineImplementation")
    },
    packTypeId: "1",
    packageSha256: ypalLaunchPackageSha256,
    sourceStartBlock: sourceStartBlock.toString(),
    metadataBaseURI:
      b.tokenMetadataBasePrefix + required(a, "monsters").toLowerCase() + "/",
    artworkHash: b.pack.artworkHash,
    catalogHash: validateBoosterCatalog(b.pack.catalog).catalogHash,
    receipts: Object.fromEntries(
      ypalLaunchSteps.map((step) => [
        step,
        {
          ...state.provenance![step]!,
          blockNumber: state.provenance![step]!.blockNumber.toString()
        }
      ])
    )
  };
}
export function ypalArtworkDescriptor(value: Record<string, unknown>) {
  function canonical(item: unknown, depth = 0): unknown {
    if (depth > 32) throw Error("The artwork descriptor is too deeply nested.");
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isSafeInteger(item)) return item;
    if (Array.isArray(item) && item.length <= 10000)
      return item.map((v) => canonical(v, depth + 1));
    if (
      typeof item === "object" &&
      item !== null &&
      Object.keys(item).length <= 10000
    )
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [
            key,
            canonical((item as Record<string, unknown>)[key], depth + 1)
          ])
      );
    throw Error("The artwork descriptor contains an unsupported value.");
  }
  // Match the producer's Python sorted recursive JSON and ensure_ascii=True.
  const descriptor = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "artworkHash")
  );
  return new TextEncoder().encode(
    JSON.stringify(canonical(descriptor)).replace(
      /[\u007f-\uffff]/g,
      (character) =>
        "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")
    )
  );
}
export async function checkYpalPublishedArtwork(b: YpalLaunchBundle) {
  const response = await fetch(b.pack.manifestURI, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok)
    throw Error(
      "The approved artwork manifest must be available before launch."
    );
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 100000)
    throw Error("The artwork descriptor is too large.");
  const value = JSON.parse(new TextDecoder().decode(raw)) as Record<
    string,
    unknown
  >;
  const commitment =
    "0x" +
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", ypalArtworkDescriptor(value))
      )
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  if (
    value.artworkHash !== b.pack.artworkHash ||
    commitment !== b.pack.artworkHash ||
    value.catalogHash !== validateBoosterCatalog(b.pack.catalog).catalogHash ||
    value.metadataBaseURI !== b.pack.metadataBaseURI
  )
    throw Error(
      "The published artwork differs from the reviewed fresh launch package."
    );
}

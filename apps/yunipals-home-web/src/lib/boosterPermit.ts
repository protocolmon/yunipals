import {
  encodeFunctionData,
  erc20Abi,
  hashDomain,
  parseAbi,
  parseSignature,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { validateBoosterPurchaseQuantity } from "./boosterPurchase";

export const boosterPermitAbi = parseAbi([
  "function PERMIT_OPEN_VERSION() view returns (uint256)",
  "function openPacksWithPermit(uint256 packTypeId,uint32 count,uint256 maxTotalVrfPrice,uint256 deadline,uint8 v,bytes32 r,bytes32 s) payable"
]);
export const boosterTokenPermitAbi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address owner) view returns (uint256)"
]);
const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const;
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const enginesWithoutPermit = new Set([
  "0x00000000000000000000000092e2351a83b6c445c94d0b887259d2b940c82a5a",
  "0x000000000000000000000000eba9d4deb6914ab67a820ea27c2fc3f43812e471"
]);
type Reader = Pick<PublicClient, "readContract" | "getStorageAt">;
export type BoosterPermit = {
  owner: Address;
  spender: Address;
  token: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  domain: {
    name: string;
    version: "1";
    chainId: 8453;
    verifyingContract: Address;
  };
};

export async function engineSupportsBoosterPermit(
  client: Reader,
  engine: Address
) {
  const implementation = await client.getStorageAt({
    address: engine,
    slot: implementationSlot
  });
  if (implementation && enginesWithoutPermit.has(implementation.toLowerCase()))
    return false;
  try {
    return (
      (await client.readContract({
        address: engine,
        abi: boosterPermitAbi,
        functionName: "PERMIT_OPEN_VERSION"
      })) === 1n
    );
  } catch {
    // Capability failure only offers the explicit separate-approval review.
    // It never submits a fallback transaction or assumes permit support.
    return false;
  }
}

export async function readBoosterPermit(
  client: Pick<PublicClient, "readContract">,
  input: Omit<BoosterPermit, "domain" | "nonce">
): Promise<BoosterPermit | null> {
  try {
    const [name, separator, nonce] = await Promise.all([
      client.readContract({
        address: input.token,
        abi: erc20Abi,
        functionName: "name"
      }),
      client.readContract({
        address: input.token,
        abi: boosterTokenPermitAbi,
        functionName: "DOMAIN_SEPARATOR"
      }),
      client.readContract({
        address: input.token,
        abi: boosterTokenPermitAbi,
        functionName: "nonces",
        args: [input.owner]
      })
    ]);
    const domain = {
      name,
      version: "1",
      chainId: 8453,
      verifyingContract: input.token
    } as const;
    if (
      !name ||
      hashDomain({
        domain: { ...domain, chainId: BigInt(domain.chainId) },
        types: domainTypes
      }).toLowerCase() !== separator.toLowerCase()
    )
      return null;
    return { ...input, domain, nonce };
  } catch {
    return null;
  }
}

export function boosterPermitTypedData(permit: BoosterPermit) {
  return {
    domain: permit.domain,
    types: permitTypes,
    primaryType: "Permit" as const,
    message: {
      owner: permit.owner,
      spender: permit.spender,
      value: permit.value,
      nonce: permit.nonce,
      deadline: permit.deadline
    }
  };
}

export function validateBoosterPermitFreshness(
  permit: BoosterPermit,
  fresh: BoosterPermit | null,
  timestamp: bigint,
  allowance: bigint
) {
  if (
    !fresh ||
    timestamp >= permit.deadline ||
    fresh.owner.toLowerCase() !== permit.owner.toLowerCase() ||
    fresh.spender.toLowerCase() !== permit.spender.toLowerCase() ||
    fresh.token.toLowerCase() !== permit.token.toLowerCase() ||
    fresh.value !== permit.value ||
    fresh.deadline !== permit.deadline ||
    fresh.domain.name !== permit.domain.name ||
    hashDomain({
      domain: { ...fresh.domain, chainId: BigInt(fresh.domain.chainId) },
      types: domainTypes
    }) !==
      hashDomain({
        domain: { ...permit.domain, chainId: BigInt(permit.domain.chainId) },
        types: domainTypes
      }) ||
    (fresh.nonce !== permit.nonce && allowance < permit.value)
  )
    throw new Error(
      "The payment permission changed or expired. Review these packs again."
    );
}

export async function boosterPermitPurchaseData(
  permit: BoosterPermit,
  signature: Hex,
  packTypeId: bigint,
  quantity: number,
  maxTotalVrfPrice: bigint
) {
  validateBoosterPurchaseQuantity(quantity);
  if (
    !/^0x[0-9a-f]{130}$/i.test(signature) ||
    (
      await recoverTypedDataAddress({
        ...boosterPermitTypedData(permit),
        signature
      })
    ).toLowerCase() !== permit.owner.toLowerCase()
  )
    throw new Error(
      "Your wallet did not sign this pack payment permission. Use separate approval instead."
    );
  const { r, s, yParity } = parseSignature(signature);
  return encodeFunctionData({
    abi: boosterPermitAbi,
    functionName: "openPacksWithPermit",
    args: [
      packTypeId,
      quantity,
      maxTotalVrfPrice,
      permit.deadline,
      27 + yParity,
      r,
      s
    ]
  });
}

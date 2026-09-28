import { getAddress, verifyTypedData, type Address, type Hex } from "viem";
import { collections, type CollectionSlug } from "../constants.js";

export const visibilitySignatureTtlSeconds = 300;
export const visibilityDomainName = "Yunipals NFT Visibility";
export const visibilityDomainVersion = "1";

export type VisibilityMessage = {
  owner: Address;
  tokenId: string;
  lifecycle: number;
  ownershipTransactionHash: Hex;
  ownershipLogIndex: number;
  hidden: boolean;
  nonce: string;
  deadline: number;
};

export const visibilityTypes = {
  SetTokenVisibility: [
    { name: "owner", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "lifecycle", type: "uint256" },
    { name: "ownershipTransactionHash", type: "bytes32" },
    { name: "ownershipLogIndex", type: "uint256" },
    { name: "hidden", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const;

export function visibilityTypedData(collection: CollectionSlug, message: VisibilityMessage) {
  const definition = collections[collection];
  return {
    domain: {
      name: visibilityDomainName,
      version: visibilityDomainVersion,
      chainId: definition.chainId,
      verifyingContract: getAddress(definition.address)
    },
    types: visibilityTypes,
    primaryType: "SetTokenVisibility" as const,
    message: {
      owner: getAddress(message.owner),
      tokenId: BigInt(message.tokenId),
      lifecycle: BigInt(message.lifecycle),
      ownershipTransactionHash: message.ownershipTransactionHash,
      ownershipLogIndex: BigInt(message.ownershipLogIndex),
      hidden: message.hidden,
      nonce: BigInt(message.nonce),
      deadline: BigInt(message.deadline)
    }
  };
}

export async function verifyVisibilitySignature(collection: CollectionSlug, message: VisibilityMessage, signature: Hex) {
  return verifyTypedData({ address: getAddress(message.owner), ...visibilityTypedData(collection, message), signature });
}

export function visibilitySigningDataJson(collection: CollectionSlug, message: VisibilityMessage) {
  const typedData = visibilityTypedData(collection, message);
  return {
    ...typedData,
    message: {
      ...message,
      owner: getAddress(message.owner)
    }
  };
}

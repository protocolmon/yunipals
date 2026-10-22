import { parseAbi } from "viem";

export { collectionAbi } from "../../../packages/yunipals-market-core/src/collectionAbi.js";

export const islandsAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function genesisLimit() view returns (uint256)",
  "function metadataStorage() view returns (address)"
]);

// The replacement Base collection has its own identity and airdrop commitment.
export const baseIslandsAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
  "event AirdropFinalized(uint256 totalSupply,uint256 sourceBlockNumber,bytes32 sourceBlockHash,bytes32 distributionSha256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)"
]);

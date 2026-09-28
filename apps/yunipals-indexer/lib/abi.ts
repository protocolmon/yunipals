import { parseAbi } from "viem";

export const collectionAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function setBaseURI(string baseURI)",
  "function setTokenURI(uint256 tokenId, string tokenURI)"
]);

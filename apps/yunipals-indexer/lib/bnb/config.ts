import { parseAbi } from "viem";

export const collectionAddress = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const collectionAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)"
]);

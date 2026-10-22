import {
  decodeEventLog,
  erc721Abi,
  isAddress,
  parseAbi,
  type Address,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { islandsContractAddress } from "@/lib/islandsIndexer";

export const islandStakingAddress =
  "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8";
export const islandStakingAbi = parseAbi([
  "function islandContract() view returns (address)",
  "function stakedIslandsOf(address wallet) view returns (uint256[])",
  "function unstakeGenesisIslands(uint256[] islandIds)"
]);

export async function prepareIslandUnstake(
  client: PublicClient,
  account: Address,
  tokenId: string
) {
  if (
    !isAddress(account) ||
    !/^[1-9]\d*$/.test(tokenId) ||
    BigInt(tokenId) > 1000n
  )
    throw new Error("Choose a valid Genesis island and staking wallet.");
  if ((await client.getChainId()) !== 1)
    throw new Error("Ethereum is required to unstake this island.");
  const block = await client.getBlock();
  const id = BigInt(tokenId);
  const [collection, owner, stakes] = await Promise.all([
    client.readContract({
      address: islandStakingAddress,
      abi: islandStakingAbi,
      functionName: "islandContract",
      blockNumber: block.number
    }),
    client.readContract({
      address: islandsContractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [id],
      blockNumber: block.number
    }),
    client.readContract({
      address: islandStakingAddress,
      abi: islandStakingAbi,
      functionName: "stakedIslandsOf",
      args: [account],
      blockNumber: block.number
    })
  ]);
  if (collection.toLowerCase() !== islandsContractAddress)
    throw new Error("The staking contract's island collection has changed.");
  if (owner.toLowerCase() !== islandStakingAddress || !stakes.includes(id))
    throw new Error(
      "This island is no longer staked by the connected wallet. Refresh your collection."
    );
  const call = {
    address: islandStakingAddress,
    abi: islandStakingAbi,
    functionName: "unstakeGenesisIslands",
    args: [[id]],
    account
  } as const;
  await client.simulateContract({ ...call, blockNumber: block.number });
  const [gas, price] = await Promise.all([
    client.estimateContractGas(call),
    client.getGasPrice()
  ]);
  return { call, estimatedFee: gas * price };
}

export function assertIslandWithdrawal(
  receipt: TransactionReceipt,
  account: Address,
  tokenId: string
) {
  if (receipt.status !== "success")
    throw new Error(
      "The unstaking transaction reverted. Your island remains staked."
    );
  const returned = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== islandsContractAddress) return false;
    try {
      const event = decodeEventLog({
        abi: erc721Abi,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics
      });
      return (
        event.args.tokenId === BigInt(tokenId) &&
        event.args.from.toLowerCase() === islandStakingAddress &&
        event.args.to.toLowerCase() === account.toLowerCase()
      );
    } catch {
      return false;
    }
  });
  if (!returned)
    throw new Error(
      "The confirmed transaction did not withdraw this island. Refresh its status before trying again."
    );
}

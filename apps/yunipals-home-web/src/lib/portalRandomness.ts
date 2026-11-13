import { parseAbi, type Address, type Hex, type PublicClient } from "viem";

const quoteAbi = parseAbi([
  "function quoteRandomness(uint256 gasPrice) view returns (uint256)"
]);

export type PortalRandomnessFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export async function preparePortalRandomness(
  client: Pick<PublicClient, "chain" | "estimateFeesPerGas" | "readContract">,
  address: Address
) {
  const fees = await client.estimateFeesPerGas({
    chain: client.chain,
    type: "eip1559"
  });
  if (
    fees.maxFeePerGas <= 0n ||
    fees.maxPriorityFeePerGas < 0n ||
    fees.maxPriorityFeePerGas > fees.maxFeePerGas
  ) {
    throw new Error("Could not prepare the randomness transaction fees.");
  }
  // Chainlink prices the request using tx.gasprice. Quote its upper bound
  // and send those same fee fields to the wallet, including its priority fee.
  const quote = await client.readContract({
    address,
    abi: quoteAbi,
    functionName: "quoteRandomness",
    args: [fees.maxFeePerGas]
  });
  return { fees, maximum: (quote * 125n + 99n) / 100n };
}

export async function preparePortalRandomnessSend(
  client: Pick<PublicClient, "call">,
  transaction: { account: Address; to: Address; data: Hex; value: bigint },
  fees: PortalRandomnessFees
) {
  // Simulate at the full cap, even if this block's effective gas price is
  // lower. Fail before recording a wallet intent if the quote is stale.
  await client.call({ ...transaction, gasPrice: fees.maxFeePerGas });
  return { ...transaction, ...fees, type: "eip1559" as const };
}

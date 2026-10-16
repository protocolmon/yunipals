type BlockReader = {
  getBlock: (
    parameters: { blockTag: "latest" } | { blockNumber: bigint }
  ) => Promise<{
    number: bigint | null;
    hash: `0x${string}` | null;
    timestamp: bigint;
  }>;
};

// These are local chain confirmations, independent of Ethereum settlement.
export const chainConfirmations: Readonly<Record<number, bigint>> = {
  1: 2n,
  8453: 3n,
  137: 5n,
  56: 5n
};

export async function readConfirmedBlock(
  client: BlockReader,
  chainId: number,
  depth = chainConfirmations[chainId]
) {
  if (depth === undefined || depth < 1n || depth > 10_000n)
    throw new Error("Invalid chain confirmation depth.");
  const latest = await client.getBlock({ blockTag: "latest" });
  if (
    latest.number === null ||
    !latest.hash ||
    latest.number < depth ||
    BigInt(Date.now()) - latest.timestamp * 1000n > 90_000n
  )
    throw new Error("Confirmed chain head is unavailable.");
  const number = latest.number - depth;
  const block = await client.getBlock({ blockNumber: number });
  if (block.number !== number || !block.hash)
    throw new Error("Confirmed chain block is unavailable.");
  return { ...block, number, hash: block.hash };
}

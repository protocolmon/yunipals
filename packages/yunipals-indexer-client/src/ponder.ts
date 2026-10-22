// Pinned to Ponder 0.17.5's 75-digit checkpoint encoding. A dependency test
// compares these offsets and block boundaries with the installed runtime.
export type PonderCheckpoint = {
  blockTimestamp: bigint;
  chainId: bigint;
  blockNumber: bigint;
  transactionIndex: bigint;
  eventType: number;
  eventIndex: bigint;
};

export function decodePonderCheckpoint(value: string): PonderCheckpoint {
  if (!/^[0-9]{75}$/.test(value)) {
    throw new Error("Unsupported Ponder checkpoint encoding.");
  }
  return {
    blockTimestamp: BigInt(value.slice(0, 10)),
    chainId: BigInt(value.slice(10, 26)),
    blockNumber: BigInt(value.slice(26, 42)),
    transactionIndex: BigInt(value.slice(42, 58)),
    eventType: Number(value.slice(58, 59)),
    eventIndex: BigInt(value.slice(59, 75))
  };
}

export function completePonderBlock(
  value: string,
  chainId: number
): bigint | null {
  const checkpoint = decodePonderCheckpoint(value);
  if (/^0{75}$/.test(value)) return null;
  if (checkpoint.chainId !== BigInt(chainId)) {
    throw new Error("Ponder checkpoint chain mismatch.");
  }
  const isBlockEnd =
    checkpoint.transactionIndex === 9999999999999999n &&
    checkpoint.eventType === 9 &&
    checkpoint.eventIndex === 9999999999999999n;
  // A mid-block checkpoint proves only the preceding whole block. This also
  // handles initial setup checkpoints, which round the start block down.
  const block = checkpoint.blockNumber - (isBlockEnd ? 0n : 1n);
  return block < 0n ? null : block;
}

export type PonderCheckpointRow = {
  chain_id: string;
  chain_name: string;
  latest_checkpoint: string;
  safe_checkpoint: string;
  finalized_checkpoint: string;
};

export function ponderChainCoverage(row: PonderCheckpointRow) {
  if (!/^[1-9][0-9]*$/.test(row.chain_id)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  return {
    chainId,
    chainName: row.chain_name,
    completeThroughBlock: completePonderBlock(row.latest_checkpoint, chainId),
    // These are Ponder recovery boundaries, never RPC/consensus finality.
    recoveryThroughBlock: completePonderBlock(row.safe_checkpoint, chainId),
    frameworkFinalizedThroughBlock: completePonderBlock(
      row.finalized_checkpoint,
      chainId
    )
  };
}

import { ZERO_ADDRESS, type CollectionId } from "../constants.js";

export type TokenState = {
  owner: string;
  burned: boolean;
  lifecycle: number;
  mintBlock: bigint;
  mintTimestamp: bigint;
};

export function transferEventId(
  collection: CollectionId,
  transactionHash: string,
  logIndex: number
) {
  return `${collection}:${transactionHash}:${logIndex}`;
}

export function transferState(
  existing: TokenState | null,
  from: `0x${string}`,
  to: `0x${string}`,
  block: { number: bigint; timestamp: bigint }
) {
  const isMint = from === ZERO_ADDRESS;
  const isBurn = to === ZERO_ADDRESS;
  const lifecycle = isMint
    ? (existing?.lifecycle ?? 0) + 1
    : existing?.lifecycle;
  if (!lifecycle) throw new Error("Transfer before mint");
  return {
    isMint,
    isBurn,
    lifecycle,
    owner: to,
    burned: isBurn,
    mintBlock: isMint ? block.number : existing!.mintBlock,
    mintTimestamp: isMint ? block.timestamp : existing!.mintTimestamp
  };
}

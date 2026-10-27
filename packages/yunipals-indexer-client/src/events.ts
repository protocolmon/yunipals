export type BlockAnchor = { number: string; hash: string };
export type EventPosition = {
  id: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: number;
  logIndex: number;
};
export type CanonicalCursor = {
  version: 1;
  releaseId: string;
  sourceId: string;
  policy: string;
  completed: BlockAnchor | null;
  target: BlockAnchor | null;
  after: EventPosition | null;
};
export type CanonicalEventRecord = {
  id: string;
  sourceId: string;
  chainId: number;
  address: string;
  name: string;
  args: unknown;
  abiHash: string;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  topics: readonly string[];
  data: string;
};

export function validateCanonicalCursor(cursor: CanonicalCursor): void {
  const decimal = /^(0|[1-9][0-9]*)$/;
  const hash = /^0x[0-9a-f]{64}$/;
  const block = (value: string) =>
    decimal.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (
    cursor.version !== 1 ||
    !hash.test(cursor.releaseId) ||
    !cursor.sourceId ||
    !cursor.policy
  )
    throw new Error("Invalid canonical cursor identity.");
  for (const anchor of [cursor.completed, cursor.target]) {
    if (anchor && (!block(anchor.number) || !hash.test(anchor.hash)))
      throw new Error("Invalid canonical cursor anchor.");
  }
  if (
    cursor.target &&
    cursor.completed &&
    BigInt(cursor.target.number) <= BigInt(cursor.completed.number)
  )
    throw new Error("Invalid canonical cursor range.");
  if (
    cursor.after &&
    (!cursor.target ||
      !block(cursor.after.blockNumber) ||
      !hash.test(cursor.after.blockHash) ||
      !cursor.after.id ||
      !Number.isSafeInteger(cursor.after.transactionIndex) ||
      cursor.after.transactionIndex < 0 ||
      !Number.isSafeInteger(cursor.after.logIndex) ||
      cursor.after.logIndex < 0 ||
      BigInt(cursor.after.blockNumber) > BigInt(cursor.target.number) ||
      (cursor.completed &&
        BigInt(cursor.after.blockNumber) <= BigInt(cursor.completed.number)))
  )
    throw new Error("Invalid canonical cursor position.");
}

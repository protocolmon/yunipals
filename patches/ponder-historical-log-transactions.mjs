// Candidate Ponder 0.17.5 historical BNB optimization. This module is copied
// into dist/esm/sync-historical by the accompanying additive dependency patch.
// RPC retries, batching, response caps and global concurrency remain Ponder's.
export async function fetchHistoricalLogBlock({
  rpc,
  blockNumber,
  transactionHashes,
  context,
  standardizeBlock,
  validateTransactionsAndBlock
}) {
  if (transactionHashes.length > 8) {
    throw new Error("Historical log transaction fetch exceeds its bound.");
  }
  const number = `0x${blockNumber.toString(16)}`;
  const headerRequest = {
    method: "eth_getBlockByNumber",
    params: [number, false]
  };
  const results = await Promise.all([
    rpc.request(headerRequest, context),
    ...transactionHashes.map((hash) =>
      rpc.request({ method: "eth_getTransactionByHash", params: [hash] }, context)
    )
  ]);
  const [header, ...transactions] = results;
  if (
    !header ||
    header.number !== number ||
    !Array.isArray(header.transactions) ||
    header.transactions.some((hash) =>
      typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)
    )
  ) {
    throw new Error("Invalid historical block header or transaction hashes.");
  }
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    if (
      !transaction ||
      transaction.hash !== transactionHashes[i] ||
      typeof transaction.transactionIndex !== "string" ||
      !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(transaction.transactionIndex)
    ) {
      throw new Error("Invalid historical transaction identity.");
    }
    const index = BigInt(transaction.transactionIndex);
    if (
      index >= BigInt(header.transactions.length) ||
      header.transactions[Number(index)] !== transaction.hash
    ) {
      throw new Error("Historical transaction is absent from its block header.");
    }
  }
  transactions.sort((a, b) =>
    BigInt(a.transactionIndex) < BigInt(b.transactionIndex) ? -1 : 1
  );
  // Reuse Ponder's full block and transaction validation/normalization. Only
  // transaction objects actually returned by RPC are used. Cache insertion
  // later retains this same matched subset in the unmodified stock path.
  const request = {
    method: "eth_getBlockByNumber",
    params: [number, true]
  };
  const block = standardizeBlock({ ...header, transactions }, request);
  validateTransactionsAndBlock(block, request);
  return block;
}

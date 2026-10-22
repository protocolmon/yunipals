// Selective RPC failure may fall back to the original full-block response.
// Never infer or overwrite size or any other field from a returned header.
export async function fetchHistoricalLogBlock(options) {
  if (options.transactionHashes.length > 8) {
    throw new Error("Historical log transaction fetch exceeds its bound.");
  }
  try {
    return await fetchSelectiveBlock(options);
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "ShutdownError") throw error;
    const { rpc, blockNumber, context, standardizeBlock,
      validateTransactionsAndBlock, transactionHashes } = options;
    const number = `0x${blockNumber.toString(16)}`;
    const request = { method: "eth_getBlockByNumber", params: [number, true] };
    const raw = await rpc.request(request, context);
    if (!raw || raw.number !== number || !Array.isArray(raw.transactions) ||
      raw.transactions.some((transaction) => !transaction || typeof transaction !== "object")) {
      throw new Error("Invalid historical fallback block.");
    }
    const block = standardizeBlock(raw, request);
    validateTransactionsAndBlock(block, request);
    const hashes = new Set(block.transactions.map((transaction) => transaction.hash));
    if (transactionHashes.some((hash) => !hashes.has(hash))) {
      throw new Error("Historical fallback block is missing a requested transaction.");
    }
    return block;
  }
}

// Candidate Ponder 0.17.5 historical BNB optimization. This module is copied
// into dist/esm/sync-historical by the accompanying additive dependency patch.
// RPC retries, batching, response caps and global concurrency remain Ponder's.
async function fetchSelectiveBlock({
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
  const header = await rpc.request(headerRequest, context);
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
  // Historical nodes may retain blocks but prune their hash lookup index.
  // Locate each requested log transaction in the real header, then read the
  // original block position. Never substitute a dense subset position.
  const indices = transactionHashes.map((hash) => {
    const index = header.transactions.indexOf(hash);
    if (index === -1) throw new Error("Historical transaction is absent from its block header.");
    return index;
  });
  const transactions = await Promise.all(indices.map((index) =>
    rpc.request({ method: "eth_getTransactionByBlockNumberAndIndex",
      params: [number, `0x${index.toString(16)}`] }, context)
  ));
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
      index !== BigInt(indices[i]) ||
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

import type { Config } from "wagmi";
import {
  getAccount,
  getPublicClient,
  sendTransaction,
  switchChain,
  waitForTransactionReceipt
} from "wagmi/actions";

import type { MarketWallet } from "@/lib/marketplace/executeTransaction";

let held = false;
export function acquireMarketplaceWallet() {
  if (held) return null;
  held = true;
  let released = false;
  return () => {
    if (!released) {
      held = false;
      released = true;
    }
  };
}

export function marketplaceWallet(
  config: Config,
  quoteExpiresAt?: bigint
): MarketWallet {
  return {
    context: () => {
      const account = getAccount(config);
      return { address: account.address, chainId: account.chainId };
    },
    switchChain: async (chainId) => {
      await switchChain(config, { chainId });
    },
    simulate: async ({ chainId, ...call }) => {
      const client = getPublicClient(config, { chainId });
      if (!client) throw new Error("The selected chain is unavailable.");
      const block = await client.getBlock();
      if (quoteExpiresAt !== undefined && block.timestamp >= quoteExpiresAt)
        throw new Error("The quote expired. Refresh it before continuing.");
      await client.call({ ...call, blockNumber: block.number });
    },
    send: (call) => sendTransaction(config, call),
    wait: (hash, chainId, onReplaced) =>
      waitForTransactionReceipt(config, {
        chainId,
        hash,
        confirmations: 1,
        timeout: 180_000,
        onReplaced: ({ transactionReceipt }) =>
          onReplaced(transactionReceipt.transactionHash)
      })
  };
}

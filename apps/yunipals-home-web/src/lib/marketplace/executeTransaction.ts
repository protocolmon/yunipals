import {
  getAddress,
  type Address,
  type Hash,
  type TransactionReceipt
} from "viem";

import {
  assertMarketReceipt,
  transactionCall,
  type MarketTransactionIntent,
  type TransactionCall
} from "@/lib/marketplace/transactionIntent";
import { analyticsOperations } from "@/lib/analytics/operations";

export type MarketExecutionStage =
  | "switching"
  | "simulating"
  | "wallet"
  | "pending"
  | "confirmed";
export type WalletContext = { address?: Address; chainId?: number };
export type MarketWallet = {
  context: () => WalletContext;
  switchChain: (chainId: number) => Promise<void>;
  simulate: (call: TransactionCall) => Promise<void>;
  send: (call: TransactionCall) => Promise<Hash>;
  wait: (
    hash: Hash,
    chainId: number,
    onReplaced: (hash: Hash) => void
  ) => Promise<TransactionReceipt>;
};

export function assertWalletContext(
  actual: WalletContext,
  expected: Pick<TransactionCall, "chainId" | "account">,
  checkChain = true
) {
  if (
    !actual.address ||
    getAddress(actual.address) !== getAddress(expected.account)
  )
    throw new Error(
      "Your connected account changed. Review the action with the current wallet."
    );
  if (checkChain && actual.chainId !== expected.chainId)
    throw new Error(
      "Your wallet is on a different network. Switch back and review the action."
    );
}

export class SubmittedTransactionError extends Error {
  readonly transactionHash: Hash;
  constructor(transactionHash: Hash, cause: unknown) {
    super(
      "The transaction was submitted, but confirmation needs checking. Do not submit the action again yet.",
      { cause }
    );
    this.name = "SubmittedTransactionError";
    this.transactionHash = transactionHash;
  }
}

export async function executeMarketTransaction(
  intent: MarketTransactionIntent,
  wallet: MarketWallet,
  options: {
    onStage: (stage: MarketExecutionStage) => void;
    onSubmitted: (hash: Hash) => void;
    revalidate?: () => Promise<void>;
    now?: () => bigint;
    signal?: AbortSignal;
  }
) {
  const now = options.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  const fresh = () => {
    options.signal?.throwIfAborted();
    if (
      (intent.kind === "buy" || intent.kind === "accept-offer") &&
      now() >= intent.quoteExpiresAt
    )
      throw new Error("The quote expired. Refresh and review it again.");
  };
  fresh();
  assertWalletContext(wallet.context(), intent, false);
  if (wallet.context().chainId !== intent.chainId) {
    options.onStage("switching");
    await wallet.switchChain(intent.chainId);
  }
  assertWalletContext(wallet.context(), intent);
  fresh();
  await options.revalidate?.();
  assertWalletContext(wallet.context(), intent);
  fresh();
  options.onStage("simulating");
  await wallet.simulate(transactionCall(intent));
  assertWalletContext(wallet.context(), intent);
  fresh();
  options.onStage("wallet");
  const hash = await wallet.send(transactionCall(intent));
  let currentHash = hash;
  // After submission, continue tracking the original action even if the user
  // switches wallets. An observation failure must never invite duplicate sends.
  try {
    options.onSubmitted(hash);
    analyticsOperations.submitted(intent, hash);
    options.onStage("pending");
    const receipt = await wallet.wait(hash, intent.chainId, (replacement) => {
      analyticsOperations.submitted(intent, replacement, currentHash);
      currentHash = replacement;
      options.onSubmitted(replacement);
    });
    currentHash = receipt.transactionHash;
    assertMarketReceipt(intent, receipt);
    analyticsOperations.confirmed(intent.chainId, receipt.transactionHash);
    options.onStage("confirmed");
    return receipt;
  } catch (error) {
    throw new SubmittedTransactionError(currentHash, error);
  }
}

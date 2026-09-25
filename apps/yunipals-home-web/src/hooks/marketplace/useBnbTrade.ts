import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Hash } from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

import { confirmSettlement } from "@/lib/marketplace/settlementReconciliation";
import { marketClient } from "@/hooks/marketplace/useMarketplace";
import {
  executeMarketTransaction,
  SubmittedTransactionError,
  type MarketExecutionStage
} from "@/lib/marketplace/executeTransaction";
import type { MarketOrder } from "@/lib/marketplace/marketApi";
import { tradeErrorMessage as errorMessage } from "@/lib/marketplace/tradeError";
import {
  pendingTransaction,
  readPendingTransactions,
  savePendingTransaction
} from "@/lib/marketplace/pendingTransactions";
import {
  buildBnbFulfillment,
  buildBnbNftApproval,
  assertMarketReceipt
} from "@/lib/marketplace/transactionIntent";
import {
  acquireMarketplaceWallet,
  marketplaceWallet
} from "@/lib/marketplace/walletExecution";

export type BnbTradeState = {
  stage:
    | "idle"
    | "checking"
    | "preparing"
    | "approval-required"
    | "approved"
    | "error"
    | "needs-confirmation"
    | MarketExecutionStage;
  message?: string;
  hash?: Hash;
};

export function useBnbTrade() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [state, setState] = useState<BnbTradeState>({ stage: "idle" });

  async function perform(order: MarketOrder, approval = false) {
    if (running.current) return;
    const releaseWallet = acquireMarketplaceWallet();
    if (!releaseWallet) {
      setState({
        stage: "error",
        message: "Finish the current wallet request before starting another."
      });
      return;
    }
    const operation = new AbortController();
    controller.current = operation;
    running.current = true;
    setState({ stage: "preparing" });
    try {
      if (!marketClient) throw new Error("Marketplace trading is not enabled.");
      const api = marketClient;
      const account = getAccount(config).address;
      if (!account) throw new Error("Connect your wallet first.");
      const publicClient = getPublicClient(config, { chainId: 56 });
      if (!publicClient) throw new Error("A BNB connection is unavailable.");
      for (const record of readPendingTransactions()) {
        const expectation = record.expectation;
        if (
          !("asset" in expectation) ||
          expectation.chainId !== 56 ||
          expectation.asset.tokenId !== order.asset.tokenId ||
          getAddress(expectation.account) !== getAddress(account)
        )
          continue;
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: record.hash
          });
          if (receipt.status === "success")
            assertMarketReceipt(expectation, receipt);
        } catch (error) {
          throw new SubmittedTransactionError(record.hash, error);
        }
      }
      const action = order.side === "listing" ? "buy" : "acceptOffer";
      const checkAsset = async () => {
        const [capabilities, market] = await Promise.all([
          api.capabilities(operation.signal),
          api.asset(order.asset, operation.signal)
        ]);
        if (
          !capabilities.bnb?.[action] ||
          market.availability.evidence !== "current"
        )
          throw new Error("Trading is temporarily unavailable for this order.");
        if (
          market.burned ||
          market.hidden ||
          market.lifecycle !== order.lifecycle
        )
          throw new Error(
            "This NFT changed or is hidden. Refresh it before trading."
          );
        const owner = order.side === "listing" ? order.maker : account;
        if (getAddress(market.owner) !== getAddress(owner))
          throw new Error(
            "The NFT owner changed. Refresh it before continuing."
          );
        const current = [...market.listings, ...market.offers].find(
          (item) =>
            item.orderHash.toLowerCase() === order.orderHash.toLowerCase()
        );
        if (
          !current ||
          current.status !== "active" ||
          current.lifecycle !== order.lifecycle
        )
          throw new Error("This order is no longer available.");
      };
      await checkAsset();
      if (approval && order.side !== "offer")
        throw new Error("This purchase does not need an NFT approval.");
      if (order.side === "offer") {
        const preflight = await api.bnbPreflight(
          order,
          account,
          operation.signal
        );
        if (preflight.needsNftApproval && !approval) {
          setState({ stage: "approval-required" });
          return;
        }
        if (!preflight.needsNftApproval && approval) {
          setState({ stage: "approved" });
          return;
        }
      }
      // A fulfillment quote is issued only after prerequisites are satisfied,
      // so its server-side simulation never needs hypothetical approval state.
      const intent = approval
        ? buildBnbNftApproval(order.asset, account)
        : await (async () => {
            const [quote, policy] = await Promise.all([
              api.fulfillment(order, account, operation.signal),
              api.bnbPolicy(operation.signal)
            ]);
            return buildBnbFulfillment(
              quote,
              order,
              account,
              policy,
              BigInt(Math.floor(Date.now() / 1000))
            );
          })();
      const wallet = marketplaceWallet(
        config,
        "quoteExpiresAt" in intent ? intent.quoteExpiresAt : undefined
      );
      let previousHash: Hash | undefined;
      const receipt = await executeMarketTransaction(intent, wallet, {
        signal: operation.signal,
        revalidate: checkAsset,
        onStage: (stage) => setState((current) => ({ ...current, stage })),
        onSubmitted: (hash) => {
          savePendingTransaction(
            pendingTransaction(hash, intent),
            previousHash
          );
          previousHash = hash;
          setState((current) => ({ ...current, hash }));
        }
      });
      confirmSettlement(
        queryClient,
        marketClient,
        intent,
        receipt,
        order.lifecycle
      );
      setState({
        stage: approval ? "approved" : "confirmed",
        hash: receipt.transactionHash
      });
      // Refresh read views after success without holding the wallet lock on
      // unrelated history/provider requests. Each new action revalidates itself.
      void Promise.allSettled(
        ["marketplace", "collection", "collector"].map((key) =>
          queryClient.invalidateQueries({
            queryKey: [key],
            predicate: (query) => query.queryKey[1] !== "catalog"
          })
        )
      );
    } catch (error) {
      setState(
        error instanceof SubmittedTransactionError
          ? {
              stage: "needs-confirmation",
              hash: error.transactionHash,
              message: error.message
            }
          : { stage: "error", message: errorMessage(error) }
      );
    } finally {
      running.current = false;
      releaseWallet();
    }
  }
  return {
    state,
    perform,
    reset: () => {
      if (!running.current) setState({ stage: "idle" });
    }
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Hash } from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient, switchChain } from "wagmi/actions";

import { confirmSettlement } from "@/lib/marketplace/settlementReconciliation";
import type { BnbTradeState } from "@/hooks/marketplace/useBnbTrade";
import { marketClient } from "@/hooks/marketplace/useMarketplace";
import {
  executeMarketTransaction,
  SubmittedTransactionError
} from "@/lib/marketplace/executeTransaction";
import type { MarketOrder } from "@/lib/marketplace/marketApi";
import { tradeErrorMessage } from "@/lib/marketplace/tradeError";
import { buildOpenSeaFulfillment } from "@/lib/marketplace/openseaFulfillment";
import { isOpenSeaChain } from "@/lib/marketplace/openseaRegistry";
import {
  inspectOpenSeaTrade,
  type OpenSeaPrerequisite
} from "@/lib/marketplace/openseaTradeState";
import {
  pendingTransaction,
  readPendingTransactions,
  savePendingTransaction
} from "@/lib/marketplace/pendingTransactions";
import {
  assertMarketReceipt,
  transactionCall,
  type MarketTransactionIntent
} from "@/lib/marketplace/transactionIntent";
import {
  acquireMarketplaceWallet,
  marketplaceWallet
} from "@/lib/marketplace/walletExecution";

function sameCall(
  left: MarketTransactionIntent,
  right: MarketTransactionIntent
) {
  const encode = (intent: MarketTransactionIntent) =>
    JSON.stringify(
      { kind: intent.kind, ...transactionCall(intent) },
      (_, value) => (typeof value === "bigint" ? value.toString() : value)
    );
  return encode(left) === encode(right);
}

export function useOpenSeaTrade() {
  const config = useConfig();
  const queries = useQueryClient();
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<
    BnbTradeState & { prerequisite?: OpenSeaPrerequisite }
  >({ stage: "idle" });
  useEffect(() => () => controller.current?.abort(), []);

  async function perform(order: MarketOrder, prerequisite = false) {
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
    const reviewedStep = prerequisite ? state.prerequisite : undefined;
    const started = performance.now();
    setState({ stage: "checking" });
    try {
      if (!marketClient || !isOpenSeaChain(order.asset.chain))
        throw new Error("OpenSea trading is not enabled for this order.");
      const api = marketClient;
      const account = getAccount(config).address;
      if (!account) throw new Error("Connect your wallet first.");
      // Network confirmation can take human time; do it before creating a quote.
      if (getAccount(config).chainId !== order.asset.chainId) {
        setState({ stage: "switching" });
        await switchChain(config, { chainId: order.asset.chainId });
        operation.signal.throwIfAborted();
        if (getAccount(config).address?.toLowerCase() !== account.toLowerCase())
          throw new Error(
            "Your connected account changed. Review the trade again."
          );
        setState({ stage: "checking" });
      }
      const client = getPublicClient(config, { chainId: order.asset.chainId });
      if (!client) throw new Error("The selected chain is unavailable.");
      for (const record of readPendingTransactions()) {
        if (
          record.expectation.chainId !== order.asset.chainId ||
          getAddress(record.expectation.account) !== getAddress(account)
        )
          continue;
        try {
          const receipt = await client.getTransactionReceipt({
            hash: record.hash
          });
          if (receipt.status === "success")
            assertMarketReceipt(record.expectation, receipt);
        } catch (error) {
          throw new SubmittedTransactionError(record.hash, error);
        }
      }
      const checkAsset = async () => {
        operation.signal.throwIfAborted();
        const [flags, market] = await Promise.all([
          api.capabilities(operation.signal),
          api.asset(order.asset, operation.signal)
        ]);
        const action = order.side === "listing" ? "buy" : "acceptOffer";
        if (
          !flags[order.asset.chain]?.read ||
          !flags[order.asset.chain]?.[action] ||
          market.availability.evidence !== "current"
        )
          throw new Error("Trading is temporarily unavailable for this order.");
        if (
          market.hidden ||
          market.burned ||
          market.lifecycle !== order.lifecycle ||
          getAddress(market.owner) !==
            getAddress(order.side === "listing" ? order.maker : account)
        )
          throw new Error(
            "This NFT changed or is hidden. Refresh it before trading."
          );
        const displayed = [...market.listings, ...market.offers].find(
          (item) =>
            item.orderHash.toLowerCase() === order.orderHash.toLowerCase()
        );
        if (displayed && displayed.status !== "active")
          throw new Error("This order is no longer available.");
        // The bounded asset arrays need not contain every order. The exact
        // provider fulfillment and direct chain checks establish this order.
      };
      await checkAsset();
      setState({ stage: "preparing" });
      const preparationStarted = performance.now();
      const quote = await api.openSeaPrepare(order, account, operation.signal);
      performance.measure("yunipals.trade.api_prepare", {
        start: preparationStarted
      });
      operation.signal.throwIfAborted();
      const trade = buildOpenSeaFulfillment(
        quote,
        order,
        account,
        BigInt(Math.floor(Date.now() / 1000))
      );
      // A prerequisite response is never executable settlement authorization.
      // Inspect it locally to build and review the exact approval/wrap action.
      const inspection =
        !quote.simulated || prerequisite
          ? await inspectOpenSeaTrade(client, trade)
          : undefined;
      operation.signal.throwIfAborted();
      if (
        inspection?.next &&
        (!prerequisite ||
          !reviewedStep ||
          !sameCall(inspection.next.intent, reviewedStep.intent))
      ) {
        setState({ stage: "approval-required", prerequisite: inspection.next });
        return;
      }
      if (prerequisite && !inspection?.next) {
        setState({
          stage: "approved",
          message:
            "The required approvals and balance are already available. Review the trade when ready."
        });
        return;
      }
      if (!prerequisite && !quote.simulated)
        throw new Error(
          "Your balance or approval changed. Review the trade again."
        );
      const intent = prerequisite ? inspection!.next!.intent : trade.intent;
      let previousHash: Hash | undefined;
      const receipt = await executeMarketTransaction(
        intent,
        marketplaceWallet(config, trade.intent.quoteExpiresAt),
        {
          signal: operation.signal,
          revalidate: async () => {
            await checkAsset();
            const current = await inspectOpenSeaTrade(client, trade);
            if (
              prerequisite
                ? !current.next || !sameCall(current.next.intent, intent)
                : Boolean(current.next)
            )
              throw new Error(
                "The required balance or approval changed. Review the action again."
              );
          },
          onStage: (stage) => {
            if (stage === "wallet")
              performance.measure("yunipals.trade.time_to_wallet", {
                start: started
              });
            setState((current) => ({ ...current, stage }));
          },
          onSubmitted: (hash) => {
            savePendingTransaction(
              pendingTransaction(hash, intent),
              previousHash
            );
            previousHash = hash;
            setState((current) => ({ ...current, hash }));
          }
        }
      );
      confirmSettlement(queries, api, intent, receipt, order.lifecycle);
      setState({
        stage: prerequisite ? "approved" : "confirmed",
        hash: receipt.transactionHash
      });
      // Refresh read views after success without holding the wallet lock on
      // unrelated history/provider requests. Each new action revalidates itself.
      void Promise.allSettled(
        ["marketplace", "collection", "collector"].map((key) =>
          queries.invalidateQueries({
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
          : {
              stage: "error",
              message: tradeErrorMessage(error)
            }
      );
    } finally {
      running.current = false;
      releaseWallet();
    }
  }
  return { state, perform };
}

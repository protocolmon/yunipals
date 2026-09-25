import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Hash } from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

import {
  executeMarketTransaction,
  SubmittedTransactionError,
  type MarketExecutionStage
} from "@/lib/marketplace/executeTransaction";
import type { RecoverableOrder } from "@/lib/marketplace/orderRecovery";
import {
  pendingTransaction,
  readPendingTransactions,
  savePendingTransaction
} from "@/lib/marketplace/pendingTransactions";
import { seaportDeployment } from "@/lib/marketplace/registry";
import { seaportReadAbi } from "@/lib/marketplace/seaport";
import {
  assertMarketReceipt,
  buildSeaportCancellation
} from "@/lib/marketplace/transactionIntent";
import {
  acquireMarketplaceWallet,
  marketplaceWallet
} from "@/lib/marketplace/walletExecution";

export function useOrderCancellation(record: RecoverableOrder) {
  const config = useConfig();
  const queries = useQueryClient();
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const [state, setState] = useState<{
    stage:
      | MarketExecutionStage
      | "idle"
      | "preparing"
      | "inactive"
      | "error"
      | "needs-confirmation";
    message?: string;
    hash?: Hash;
  }>({ stage: "idle" });
  const client = getPublicClient(config, { chainId: record.asset.chainId });
  async function readInvalidation() {
    if (!client) throw new Error("The chain connection is unavailable.");
    const block = await client.getBlock();
    const [status, counter] = await Promise.all([
      client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [record.orderHash],
        blockNumber: block.number
      }),
      client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [record.order.offerer],
        blockNumber: block.number
      })
    ]);
    if (status[1]) return "Cancelled onchain";
    if (status[3] > 0n && status[2] >= status[3]) return "Filled onchain";
    if (counter !== record.order.counter)
      return "Invalidated by a maker counter change";
    if (block.timestamp >= record.order.endTime) return "Expired";
    return null;
  }
  const status = useQuery({
    queryKey: [
      "marketplace-order-status",
      record.asset.chainId,
      record.orderHash
    ],
    queryFn: readInvalidation,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000
  });

  async function cancel() {
    const release = acquireMarketplaceWallet();
    if (!release) {
      setState({
        stage: "error",
        message: "Finish the current wallet request before starting another."
      });
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setState({ stage: "preparing" });
    try {
      if (!client) throw new Error("The chain connection is unavailable.");
      const account = getAccount(config).address;
      if (!account)
        throw new Error("Connect the wallet that signed this order.");
      const intent = buildSeaportCancellation(
        record.asset.chain,
        record.order,
        record.orderHash,
        account
      );
      for (const pending of readPendingTransactions()) {
        const expectation = pending.expectation;
        if (
          expectation.kind !== "cancel" ||
          expectation.chainId !== record.asset.chainId ||
          expectation.orderHash.toLowerCase() !==
            record.orderHash.toLowerCase() ||
          getAddress(expectation.account) !== getAddress(account)
        )
          continue;
        try {
          const receipt = await client.getTransactionReceipt({
            hash: pending.hash
          });
          if (receipt.status === "success")
            assertMarketReceipt(expectation, receipt);
        } catch (error) {
          throw new SubmittedTransactionError(pending.hash, error);
        }
      }
      const invalidation = await readInvalidation();
      if (invalidation) {
        setState({ stage: "inactive", message: invalidation });
        return;
      }
      let previousHash: Hash | undefined;
      const receipt = await executeMarketTransaction(
        intent,
        marketplaceWallet(config),
        {
          signal: controller.signal,
          onStage: (stage) => setState((current) => ({ ...current, stage })),
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
      setState({
        stage: "confirmed",
        hash: receipt.transactionHash,
        message: "Order cancelled onchain."
      });
      // Refresh read views after success without holding the wallet lock on
      // unrelated history/provider requests. Each new action revalidates itself.
      void Promise.allSettled([
        status.refetch(),
        queries.invalidateQueries({ queryKey: ["marketplace"] })
      ]);
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
              message:
                error instanceof Error &&
                /user rejected|user denied/i.test(error.message)
                  ? "Cancellation rejected in your wallet. The order has not been cancelled by this action."
                  : "Cancellation could not be confirmed. Check your wallet, gas balance and chain connection, then try again."
            }
      );
    } finally {
      release();
    }
  }
  return { state, status, cancel };
}

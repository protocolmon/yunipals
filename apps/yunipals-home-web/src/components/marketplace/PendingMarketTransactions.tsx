import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useConfig } from "wagmi";
import {
  TransactionHistory,
  TransactionRow,
  transactionActionVariants
} from "@/components/ui/transaction";
import { analyticsOperations } from "@/lib/analytics/operations";
import { getPublicClient } from "wagmi/actions";

import { marketClient } from "@/hooks/marketplace/useMarketplace";
import { confirmSettlement } from "@/lib/marketplace/settlementReconciliation";
import { forgetSettlement } from "@/lib/marketplace/confirmedSettlements";
import { chainDetails } from "@/data/chains";
import {
  dismissPendingTransaction,
  pendingMarketEvent,
  readPendingTransactions,
  type PendingMarketTransaction
} from "@/lib/marketplace/pendingTransactions";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import { assertMarketReceipt } from "@/lib/marketplace/transactionIntent";
import { onchainAnalytics } from "@/lib/analytics/onchain";

const collapsedKey = "yunipals.marketplace.receipts.collapsed";
function defaultPanelOpen() {
  try {
    if (window.sessionStorage.getItem(collapsedKey) === "true") return false;
  } catch {
    // Receipt tracking still works when browser storage is unavailable.
  }
  return window.matchMedia("(min-width: 640px)").matches;
}

function PendingTransaction({ record }: { record: PendingMarketTransaction }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const chain = (Object.keys(marketplaceChains) as MarketplaceChain[]).find(
    (chain) => marketplaceChains[chain].chainId === record.expectation.chainId
  )!;
  const query = useQuery({
    queryKey: ["marketplace-receipt", record.expectation.chainId, record.hash],
    queryFn: async () => {
      const client = getPublicClient(config, {
        chainId: record.expectation.chainId
      });
      if (!client) throw new Error("Chain connection unavailable.");
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: record.hash });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TransactionReceiptNotFoundError"
        )
          return null;
        throw error;
      }
      try {
        assertMarketReceipt(record.expectation, receipt);
        return { status: "confirmed" as const, receipt };
      } catch {
        return {
          status:
            receipt.status === "reverted"
              ? ("reverted" as const)
              : ("needs-review" as const),
          receipt
        };
      }
    },
    retry: 1,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data ? false : 10_000)
  });
  const indexed = useQuery({
    queryKey: [
      "marketplace-publication-index",
      record.expectation.chainId,
      record.expectation.kind === "validate"
        ? record.expectation.orderHash
        : record.hash
    ],
    enabled:
      record.expectation.kind === "validate" &&
      query.data?.status === "confirmed" &&
      Boolean(marketClient),
    queryFn: () =>
      marketClient!.publishedOwnOrder(
        record.expectation.kind === "validate"
          ? record.expectation.orderHash
          : record.hash,
        undefined,
        "bnb"
      ),
    retry: 1,
    refetchInterval: (query) => (query.state.data ? false : 30_000)
  });
  useEffect(() => {
    if (query.data?.status === "confirmed") {
      analyticsOperations.confirmed(
        record.expectation.chainId,
        query.data.receipt.transactionHash
      );
      onchainAnalytics.confirmed(
        record.expectation.chainId,
        query.data.receipt.transactionHash
      );
      confirmSettlement(
        queryClient,
        marketClient,
        record.expectation,
        query.data.receipt
      );
      for (const key of ["marketplace", "collection", "collector"])
        void queryClient.invalidateQueries({
          queryKey: [key],
          predicate: (query) =>
            record.expectation.kind === "cancel" ||
            query.queryKey[1] !== "catalog"
        });
    } else if (
      query.data?.status === "reverted" ||
      query.data?.status === "needs-review"
    ) {
      forgetSettlement(queryClient, record.expectation.chainId, record.hash);
      void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    }
  }, [query.data, queryClient, record]);
  const labels = {
    buy: "Purchase",
    "accept-offer": "Offer acceptance",
    validate: "Order publication",
    cancel: "Cancellation",
    "approve-nft": "NFT approval",
    "approve-currency": chain === "bnb" ? "WBNB approval" : "WETH approval",
    wrap: chain === "bnb" ? "BNB wrapping" : "ETH wrapping"
  };
  const status =
    query.data?.status === "confirmed"
      ? record.expectation.kind === "validate"
        ? indexed.data
          ? "Indexed"
          : "Confirmed · indexing"
        : "Confirmed"
      : query.data?.status === "reverted"
        ? "Reverted"
        : query.data?.status === "needs-review"
          ? "Check this transaction"
          : query.isError
            ? "Confirmation unavailable"
            : "Awaiting confirmation";
  return (
    <TransactionRow
      as="li"
      title={labels[record.expectation.kind]}
      status={status}
      tone={
        query.data?.status === "confirmed"
          ? "success"
          : query.data || query.isError
            ? "error"
            : "pending"
      }
      href={`${chainDetails[chain].explorerUrl}/tx/${record.hash}`}
      linkLabel={`${chainDetails[chain].label} transaction`}
      actions={
        query.data ? (
          <button
            type="button"
            onClick={() => dismissPendingTransaction(record.hash)}
            className={transactionActionVariants({ variant: "secondary" })}
          >
            Dismiss
          </button>
        ) : query.isError ? (
          <button
            type="button"
            onClick={() => void query.refetch()}
            className={transactionActionVariants()}
          >
            Check again
          </button>
        ) : null
      }
    />
  );
}

export function PendingMarketTransactions() {
  const [records, setRecords] = useState(readPendingTransactions);
  const [expanded, setExpanded] = useState(defaultPanelOpen);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const resize = () => setExpanded(defaultPanelOpen());
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const refresh = () => setRecords(readPendingTransactions());
    window.addEventListener("storage", refresh);
    window.addEventListener(pendingMarketEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(pendingMarketEvent, refresh);
    };
  }, []);
  if (!records.length) return null;
  return (
    <aside
      className="fixed bottom-4 right-4 z-40 max-h-[50vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-white shadow-cardHover"
      aria-label="Your transactions"
    >
      <TransactionHistory
        title="Your transactions"
        count={records.length}
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
          if (!open) {
            try {
              window.sessionStorage.setItem(collapsedKey, "true");
            } catch {
              // Closing the panel must not depend on storage access.
            }
          }
        }}
      >
        <ul className="divide-y divide-line">
          {records.map((record) => (
            <PendingTransaction key={record.hash} record={record} />
          ))}
        </ul>
      </TransactionHistory>
    </aside>
  );
}

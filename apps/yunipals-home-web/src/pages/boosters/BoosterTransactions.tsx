import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, usePublicClient } from "wagmi";
import { parseEventLogs, type Hex } from "viem";
import { useSearchParams } from "react-router-dom";
import { Gift, Layers3, Play, X } from "lucide-react";
import {
  TransactionStatus,
  TransactionHistory,
  TransactionRow,
  transactionActionVariants
} from "@/components/ui/transaction";
import { DialogSurface } from "@/components/ui/dialog";
import { environment } from "@/environment";
import { boosterEthAddress, boosterEthAbi } from "@/lib/boosterEth";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import {
  boosterTransactionExpectation,
  boosterTransactionHistory,
  confirmedBoosterRequests,
  confirmedBoosterRequestState,
  type BoosterCreatedRequest,
  type BoosterRequestState,
  type BoosterRevealExpectation
} from "@/lib/boosterReveal";
import {
  boosterAddresses,
  boosterQueryKey,
  readBoosterTransactions,
  readBoosterTransactionReceipt,
  type StoredBoosterTransaction
} from "@/lib/boosters";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterRequestOpening } from "./BoosterRequestOpening";
import { BoosterOpeningShare } from "./BoosterOpeningShare";
import { onchainAnalytics } from "@/lib/analytics/onchain";

type TrackedTransaction = StoredBoosterTransaction & {
  status: string;
  requests?: BoosterCreatedRequest[];
  states?: BoosterRequestState[];
  completed?: number;
  forfeited?: number;
};

function SubmittedOpening({
  hash,
  status,
  showRetry,
  onClose,
  onRetry
}: {
  hash: string;
  status: string;
  showRetry: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return createPortal(
    <DialogSurface
      ref={dialog}
      aria-labelledby={titleId}
      size="md"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="font-display text-2xl">
          Your pack
        </h2>
        <button
          type="button"
          aria-label="Close pack"
          onClick={onClose}
          className="rounded-full p-2 focus-visible:ring-2 focus-visible:ring-grape"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <TransactionStatus
        className="mt-6"
        title="Pack transaction"
        status={status}
        tone={showRetry ? "error" : "neutral"}
        href={`https://basescan.org/tx/${hash}`}
      />
      <p className="mt-4 text-sm text-muted">
        Safe to close. Save your opening link to return anytime, even while your
        cards are loading.
      </p>
      <BoosterOpeningShare hash={hash} linkLabel="Return to this opening" />

      {showRetry && (
        <div className="mt-5">
          <button
            type="button"
            className="rounded-full border border-line px-4 py-2 text-sm font-bold"
            onClick={onRetry}
          >
            Refresh status
          </button>
        </div>
      )}
    </DialogSurface>,
    document.body
  );
}

export function BoosterTransactions({
  autoOpenHash = null,
  onOpeningClosed,
  showHistory = true
}: {
  autoOpenHash?: Hex | null;
  onOpeningClosed?: () => void;
  showHistory?: boolean;
}) {
  const { address } = useAccount();
  const [search, setSearch] = useSearchParams();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening, setOpening] = useState<{
    hash: string;
    wallet: string;
  } | null>(null);
  const client = usePublicClient({ chainId: 8453 });
  const deployment = boosterAddresses();
  const permalink = search.get("opening");
  const selectedHash =
    opening && address && opening.wallet.toLowerCase() === address.toLowerCase()
      ? opening.hash
      : (autoOpenHash ??
        (permalink && /^0x[0-9a-f]{64}$/i.test(permalink) ? permalink : null));
  const stored =
    address && deployment
      ? readBoosterTransactions(address, deployment.engine).find(
          (row) => row.hash.toLowerCase() === selectedHash?.toLowerCase()
        )
      : undefined;
  useEffect(() => {
    // The pack page restores openings from its URL. Embedded daily-card
    // dialogs use the share link because their host pages don't restore it.
    if (!showHistory || !selectedHash || permalink === selectedHash) return;
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("opening", selectedHash);
        return next;
      },
      { replace: true }
    );
  }, [showHistory, selectedHash, permalink, setSearch]);
  const closeOpening = () => {
    setHistoryOpen(true);
    setOpening(null);
    onOpeningClosed?.();
    if (search.has("opening")) {
      const next = new URLSearchParams(search);
      next.delete("opening");
      setSearch(next, { replace: true });
    }
  };
  // Public replay derives the entire group from the actual engine calldata and
  // successful receipt. Neither a wallet nor locally saved intent grants cards.
  const selected = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "opening-transaction",
      deployment?.engine,
      selectedHash
    ],
    enabled: Boolean(selectedHash && client && deployment),
    retry: false,
    refetchInterval: (query) => (query.state.data?.requests ? false : 4000),
    queryFn: async () => {
      const hash = selectedHash as Hex;
      const receipt = await readBoosterTransactionReceipt(() =>
        client!.getTransactionReceipt({ hash })
      );
      if (!receipt)
        return {
          status: "Waiting for transaction confirmation…",
          requests: undefined
        };
      if (receipt.status !== "success")
        return {
          status: "This transaction reverted. No packs were opened.",
          requests: undefined
        };
      const transaction = await client!.getTransaction({ hash });
      let expected: BoosterRevealExpectation;
      try {
        expected = boosterTransactionExpectation(transaction, {
          hash,
          engine: deployment!.engine,
          paymentAdapter:
            boosterEthAddress(environment.boosterEthAdapter) ?? undefined,
          kind: "open"
        });
      } catch {
        expected = boosterTransactionExpectation(transaction, {
          hash,
          engine: deployment!.engine,
          paymentAdapter:
            boosterEthAddress(environment.boosterEthAdapter) ?? undefined,
          kind: "claim"
        });
      }
      const requests = confirmedBoosterRequests(receipt, expected);
      onchainAnalytics.confirmed(8453, receipt.transactionHash);
      return {
        status: "Transaction confirmed. Loading your pack requests…",
        requests
      };
    }
  });
  const refund = useQuery({
    queryKey: [...boosterQueryKey, "refund", address],
    enabled: Boolean(showHistory && address && client && deployment),
    refetchInterval: 15000,
    queryFn: () =>
      client!.readContract({
        address: deployment!.engine,
        abi: boosterPacksAbi,
        functionName: "refundCredits",
        args: [address!]
      })
  });
  const query = useQuery({
    queryKey: [...boosterQueryKey, "transactions", deployment?.engine, address],
    enabled: Boolean(showHistory && address && client && deployment),
    refetchInterval: 4000,
    queryFn: async (): Promise<TrackedTransaction[]> => {
      if (!address || !client || !deployment) return [];
      return Promise.all(
        boosterTransactionHistory(
          readBoosterTransactions(address, deployment.engine)
        ).map(async (row): Promise<TrackedTransaction> => {
          if (row.cancelled) return { ...row, status: "Cancelled" };
          try {
            const receipt = await readBoosterTransactionReceipt(() =>
              client.getTransactionReceipt({ hash: row.hash })
            );
            if (receipt === null)
              return { ...row, status: "Waiting for confirmation" };
            if (receipt.status !== "success")
              return { ...row, status: "Transaction reverted" };
            if (row.kind !== "open" && row.kind !== "claim") {
              onchainAnalytics.confirmed(8453, receipt.transactionHash);
              return { ...row, status: "Confirmed" };
            }
            const events = parseEventLogs({
              abi: boosterPacksAbi,
              eventName: "RequestCreated",
              logs: receipt.logs.filter(
                (log) => log.address.toLowerCase() === deployment.engine
              )
            });
            if (!events.length)
              return { ...row, status: "Request details unavailable" };
            let expected: BoosterRevealExpectation = {
              ...row,
              engine: deployment.engine,
              kind: row.kind
            };
            // Recover actual multi-pack count after a reload or wallet
            // replacement. Never infer missing requests from nearby IDs/payer.
            if (
              environment.boosterEthAdapter ||
              events.length > 1 ||
              (row.expectedRequestCount ?? 1) > 1 ||
              events.some(
                ({ args }) =>
                  (row.packTypeId !== undefined &&
                    row.packTypeId !== args.packTypeId.toString()) ||
                  (row.originalId !== undefined &&
                    row.originalId !== args.originalId.toString()) ||
                  (row.quantity !== undefined && row.quantity !== args.quantity)
              )
            )
              expected = boosterTransactionExpectation(
                await client.getTransaction({
                  hash: receipt.transactionHash
                }),
                {
                  ...expected,
                  paymentAdapter:
                    boosterEthAddress(environment.boosterEthAdapter) ??
                    undefined
                }
              );
            const requests = confirmedBoosterRequests(receipt, expected);
            onchainAnalytics.confirmed(8453, receipt.transactionHash);
            const states = await Promise.all(
              requests.map(async (created) =>
                confirmedBoosterRequestState(
                  await client.readContract({
                    address: deployment.engine,
                    abi: boosterPacksAbi,
                    functionName: "getRequest",
                    args: [BigInt(created.requestId)]
                  }),
                  created
                )
              )
            );
            const completed = states.filter(
              (state) => state.status === 3
            ).length;
            const forfeited = states.filter(
              (state) => state.status === 4
            ).length;
            const status =
              completed === requests.length
                ? "Revealed"
                : forfeited === requests.length
                  ? "Forfeited"
                  : completed + forfeited === requests.length
                    ? "Partly revealed"
                    : states.some((state) => state.status === 2)
                      ? "Ready for recovery"
                      : "Awaiting randomness";
            return { ...row, requests, states, completed, forfeited, status };
          } catch {
            return { ...row, status: "Request details unavailable" };
          }
        })
      );
    }
  });
  const ethAdapter = boosterEthAddress(environment.boosterEthAdapter);
  const ethRefund = useQuery({
    queryKey: [...boosterQueryKey, "eth-refund", ethAdapter, address],
    enabled: Boolean(showHistory && ethAdapter && address && client),
    refetchInterval: 15000,
    queryFn: () =>
      client!.readContract({
        address: ethAdapter!,
        abi: boosterEthAbi,
        functionName: "refundCredits",
        args: [address!]
      })
  });
  if (
    !selectedHash &&
    (!address ||
      (!query.data?.length && !refund.data && !ethRefund.data && !query.error))
  )
    return null;
  const history =
    query.data?.filter((row) => row.kind === "open" || row.kind === "claim") ??
    [];
  return (
    <>
      {showHistory &&
        (history.length > 0 ||
          query.error ||
          Boolean(refund.data) ||
          Boolean(ethRefund.data)) && (
          <TransactionHistory
            title="Your openings"
            count={history.length}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            className="mt-8"
          >
            {query.error && (
              <p role="alert" className="py-4 text-sm text-muted">
                Opening history is temporarily unavailable. Your openings are
                saved.
              </p>
            )}
            {ethRefund.data !== undefined && ethRefund.data > 0n && (
              <div className="p-4">
                <BoosterActionButton action={{ kind: "refund", source: "eth" }}>
                  Withdraw unused ETH from pack payment
                </BoosterActionButton>
              </div>
            )}
            {refund.data !== undefined && refund.data > 0n && (
              <div className="py-4">
                <BoosterActionButton action={{ kind: "refund" }}>
                  Withdraw unused ETH
                </BoosterActionButton>
              </div>
            )}
            <ul className="divide-y divide-line">
              {history.map((row) => {
                const total = row.requests?.length ?? 0;
                const canResume =
                  total > 0 || row.status === "Waiting for confirmation";
                const ready =
                  row.status === "Revealed" || row.status === "Partly revealed";
                const quantity =
                  row.requests?.reduce(
                    (sum, request) => sum + request.quantity,
                    0
                  ) ??
                  row.quantity ??
                  1;
                const label =
                  row.kind === "claim" ? "Daily cards" : "Booster opening";
                const Icon = row.kind === "claim" ? Gift : Layers3;
                return (
                  <TransactionRow
                    as="li"
                    key={row.hash}
                    title={label}
                    status={
                      <>
                        {quantity} {quantity === 1 ? "card" : "cards"} ·{" "}
                        {ready ? "Ready" : row.status}
                      </>
                    }
                    icon={Icon}
                    tone={ready ? "success" : "neutral"}
                    href={`https://basescan.org/tx/${row.hash}`}
                    linkLabel="View transaction on BaseScan"
                    actions={
                      canResume ? (
                        <>
                          {canResume && row.status !== "Forfeited" && (
                            <button
                              type="button"
                              className={transactionActionVariants()}
                              onClick={() =>
                                setOpening({ hash: row.hash, wallet: address! })
                              }
                              aria-label={`${ready ? "Replay" : "View"} ${quantity}-card ${label.toLowerCase()}`}
                            >
                              <Play size={14} aria-hidden="true" />
                              {ready ? "Replay" : "View"}
                            </button>
                          )}
                          {canResume && (
                            <BoosterOpeningShare hash={row.hash} compact />
                          )}
                          {row.requests?.map((created, index) =>
                            row.states?.[index]?.status === 2 ? (
                              <BoosterActionButton
                                key={created.requestId}
                                action={{
                                  kind: "recover",
                                  requestId: created.requestId
                                }}
                              >
                                Finish reveal
                                {total > 1 ? ` · ${index + 1}` : ""}
                              </BoosterActionButton>
                            ) : null
                          )}
                        </>
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          </TransactionHistory>
        )}
      {selectedHash && !selected.data?.requests && (
        <SubmittedOpening
          key={selectedHash}
          hash={selectedHash}
          showRetry={Boolean(selected.error)}
          status={
            selected.error
              ? "Pack transaction details are temporarily unavailable. No cards can be shown until this transaction is verified."
              : stored?.cancelled
                ? "This transaction was cancelled. No packs were opened."
                : (selected.data?.status ??
                  "Waiting for transaction confirmation…")
          }
          onClose={closeOpening}
          onRetry={() => void selected.refetch()}
        />
      )}
      {selected.data?.requests && deployment && (
        <BoosterRequestOpening
          key={selectedHash}
          requests={selected.data.requests}
          onClose={closeOpening}
        />
      )}
    </>
  );
}

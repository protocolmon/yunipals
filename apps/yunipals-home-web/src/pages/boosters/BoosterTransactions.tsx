import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, usePublicClient } from "wagmi";
import { parseEventLogs, type Hex } from "viem";
import { Link, useSearchParams } from "react-router-dom";
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
import { YunipalsLoader } from "@/components/YunipalsLoader";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterRequestOpening } from "./BoosterRequestOpening";
import { BoosterOpeningShare } from "./BoosterOpeningShare";

type TrackedTransaction = StoredBoosterTransaction & {
  status: string;
  requests?: BoosterCreatedRequest[];
  states?: BoosterRequestState[];
  completed?: number;
  forfeited?: number;
};

function SubmittedOpening({
  hash,
  quantity,
  status,
  onClose,
  onRetry
}: {
  hash: string;
  quantity: number;
  status: string;
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
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="w-full max-w-md rounded-card bg-white p-7 text-ink shadow-card backdrop:bg-ink/70"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="font-display text-2xl">
        {quantity > 1 ? `Your ${quantity} packs` : "Your pack"}
      </h2>
      <YunipalsLoader
        className="mt-6"
        label="Getting your pack ready"
        detail={status}
      />
      <p className="mt-4 text-sm text-muted">
        Your transaction is saved. You can close this and return from recent
        pack transactions. Reopening never submits another transaction.
      </p>
      <a
        href={`https://basescan.org/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-block text-sm font-bold text-grape underline"
      >
        View transaction
      </a>
      <BoosterOpeningShare hash={hash} />
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          className="rounded-full border border-line px-4 py-2 text-sm font-bold"
          onClick={onRetry}
        >
          Refresh status
        </button>
        <button
          type="button"
          className="rounded-full bg-grape px-4 py-2 text-sm font-bold text-white"
          onClick={onClose}
        >
          Close pack
        </button>
      </div>
    </dialog>,
    document.body
  );
}

export function BoosterTransactions({
  autoOpenHash = null,
  onOpeningClosed
}: {
  autoOpenHash?: Hex | null;
  onOpeningClosed?: () => void;
}) {
  const { address } = useAccount();
  const [search, setSearch] = useSearchParams();
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
  const closeOpening = () => {
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
          kind: "open"
        });
      } catch {
        expected = boosterTransactionExpectation(transaction, {
          hash,
          engine: deployment!.engine,
          kind: "claim"
        });
      }
      return {
        status: "Transaction confirmed. Loading your pack requests…",
        requests: confirmedBoosterRequests(receipt, expected)
      };
    }
  });
  const refund = useQuery({
    queryKey: [...boosterQueryKey, "refund", address],
    enabled: Boolean(address && client && deployment),
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
    enabled: Boolean(address && client && deployment),
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
            if (row.kind !== "open" && row.kind !== "claim")
              return { ...row, status: "Confirmed" };
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
                expected
              );
            const requests = confirmedBoosterRequests(receipt, expected);
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
  if (
    !selectedHash &&
    (!address || (!query.data?.length && !refund.data && !query.error))
  )
    return null;
  return (
    <div
      className="mt-7 rounded-card border border-line bg-white p-5"
      aria-live="polite"
    >
      <h3 className="font-bold">Recent pack transactions</h3>
      {query.error && (
        <p role="alert" className="mt-3 text-sm">
          Transaction status is temporarily unavailable. Your submitted requests
          remain onchain.
        </p>
      )}
      {refund.data !== undefined && refund.data > 0n && (
        <div className="mt-3">
          <BoosterActionButton action={{ kind: "refund" }}>
            Withdraw unused ETH
          </BoosterActionButton>
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {query.data?.map((row) => {
          const total = row.requests?.length ?? 0;
          const terminal =
            row.status === "Revealed" || row.status === "Partly revealed";
          const quantity = row.requests?.[0]?.quantity ?? 1;
          return (
            <li
              key={row.hash}
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <a
                href={`https://basescan.org/tx/${row.hash}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {row.kind === "approval"
                  ? "Approval"
                  : row.kind === "claim"
                    ? "Daily claim"
                    : row.kind === "open"
                      ? total > 1
                        ? `${total} pack opening`
                        : "Pack opening"
                      : "Transaction"}
              </a>
              <span>{row.status}</span>
              {total > 1 && (
                <span className="text-muted">
                  {row.completed ?? 0} of {total} packs revealed
                  {row.forfeited ? ` · ${row.forfeited} forfeited` : ""}
                </span>
              )}
              {total > 0 && row.status !== "Forfeited" && (
                <button
                  type="button"
                  className="rounded-full bg-grape px-4 py-2 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
                  onClick={() =>
                    setOpening({ hash: row.hash, wallet: address! })
                  }
                >
                  {terminal
                    ? row.kind === "claim"
                      ? `Open daily pack · ${quantity} pulls`
                      : total > 1
                        ? `View ${row.completed} cards`
                        : "View card"
                    : "View pack progress"}
                </button>
              )}
              {total > 0 && <BoosterOpeningShare hash={row.hash} />}
              {row.requests?.length === 1 && row.status === "Revealed" && (
                <Link
                  className="font-bold underline"
                  to={`/monsters/${deployment?.monsters}/${row.requests[0].originalId}`}
                >
                  View original
                </Link>
              )}
              {row.requests?.map((created, index) =>
                row.states?.[index]?.status === 2 ? (
                  <BoosterActionButton
                    key={created.requestId}
                    action={{ kind: "recover", requestId: created.requestId }}
                  >
                    {total > 1
                      ? `Finish reveal · pack ${index + 1}`
                      : "Finish reveal"}
                  </BoosterActionButton>
                ) : null
              )}
            </li>
          );
        })}
      </ul>
      {selectedHash && !selected.data?.requests && (
        <SubmittedOpening
          key={selectedHash}
          hash={selectedHash}
          quantity={stored?.expectedRequestCount ?? 1}
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
    </div>
  );
}

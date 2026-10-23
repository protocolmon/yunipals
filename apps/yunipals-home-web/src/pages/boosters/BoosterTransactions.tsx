import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseEventLogs, type Hex } from "viem";
import { Link } from "react-router-dom";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import {
  boosterAddresses,
  boosterQueryKey,
  readBoosterTransactions,
  readBoosterTransactionReceipt
} from "@/lib/boosters";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterRequestOpening } from "./BoosterRequestOpening";

export function BoosterTransactions({
  autoOpenHash = null,
  onOpeningClosed
}: {
  autoOpenHash?: Hex | null;
  onOpeningClosed?: () => void;
}) {
  const { address } = useAccount();
  const [opening, setOpening] = useState<{
    hash: string;
    wallet: string;
  } | null>(null);
  const client = usePublicClient({ chainId: 8453 });
  const deployment = boosterAddresses();
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
    queryFn: async () => {
      if (!address || !client || !deployment) return [];
      return Promise.all(
        readBoosterTransactions(address, deployment.engine)
          .slice(-5)
          .reverse()
          .map(async (row) => {
            if (row.cancelled) return { ...row, status: "Cancelled" };
            const receipt = await readBoosterTransactionReceipt(() =>
              client.getTransactionReceipt({ hash: row.hash })
            );
            if (receipt === null)
              return { ...row, status: "Waiting for confirmation" };
            if (receipt.status !== "success")
              return { ...row, status: "Transaction reverted" };
            const [request] = parseEventLogs({
              abi: boosterPacksAbi,
              eventName: "RequestCreated",
              logs: receipt.logs.filter(
                (log) => log.address.toLowerCase() === deployment.engine
              )
            });
            if (!request) return { ...row, status: "Confirmed" };
            const state = await client.readContract({
              address: deployment.engine,
              abi: boosterPacksAbi,
              functionName: "getRequest",
              args: [request.args.requestId]
            });
            return {
              ...row,
              requestId: request.args.requestId.toString(),
              originalId: state.originalId.toString(),
              opening: state.opening,
              quantity: state.quantity,
              status: [
                "Unknown",
                "Awaiting randomness",
                "Ready for recovery",
                "Revealed",
                "Forfeited"
              ][state.status]
            };
          })
      );
    }
  });
  if (!address || (!query.data?.length && !refund.data && !query.error))
    return null;
  const selected =
    opening && opening.wallet === address
      ? query.data?.find(
          (row) =>
            row.hash === opening.hash &&
            (row.kind === "open" || row.kind === "claim") &&
            "opening" in row &&
            row.opening === (row.kind === "open") &&
            "requestId" in row
        )
      : autoOpenHash
        ? query.data?.find(
            (row) =>
              row.hash === autoOpenHash &&
              (row.kind === "open" || row.kind === "claim") &&
              "requestId" in row &&
              "opening" in row &&
              row.opening === (row.kind === "open")
          )
        : undefined;
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
        {query.data?.map((row) => (
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
                    ? "Pack opening"
                    : "Transaction"}
            </a>
            <span>{row.status}</span>
            {(row.kind === "open" || row.kind === "claim") &&
              row.status === "Revealed" &&
              "opening" in row &&
              row.opening === (row.kind === "open") && (
                <button
                  type="button"
                  className="rounded-full bg-grape px-4 py-2 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
                  onClick={() =>
                    setOpening({ hash: row.hash, wallet: address })
                  }
                >
                  {row.kind === "claim"
                    ? `Open daily pack · ${"quantity" in row ? row.quantity : 1} pulls`
                    : "Reveal Yunipal"}
                </button>
              )}
            {"originalId" in row && row.status === "Revealed" && (
              <Link
                className="font-bold underline"
                to={`/monsters/${deployment?.monsters}/${row.originalId}`}
              >
                View original
              </Link>
            )}
            {"requestId" in row &&
              row.requestId &&
              row.status === "Ready for recovery" && (
                <BoosterActionButton
                  action={{ kind: "recover", requestId: row.requestId }}
                >
                  Finish reveal
                </BoosterActionButton>
              )}
          </li>
        ))}
      </ul>
      {selected &&
        "requestId" in selected &&
        typeof selected.requestId === "string" &&
        deployment && (
          <BoosterRequestOpening
            requestId={selected.requestId}
            onClose={() => {
              setOpening(null);
              onOpeningClosed?.();
            }}
          />
        )}
    </div>
  );
}

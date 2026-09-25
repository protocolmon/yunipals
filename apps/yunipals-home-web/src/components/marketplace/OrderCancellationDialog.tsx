import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import { formatUnits, getAddress } from "viem";
import { useAccount } from "wagmi";

import { chainDetails } from "@/data/chains";
import { marketClient } from "@/hooks/marketplace/useMarketplace";
import { useOrderCancellation } from "@/hooks/marketplace/useOrderCancellation";
import {
  parseCancellationOrder,
  type MarketOrder
} from "@/lib/marketplace/marketApi";
import { encodeSeaportOrder } from "@/lib/marketplace/seaportWire";
import {
  readRecoverableOrders,
  saveRecoverableOrder,
  type RecoverableOrder
} from "@/lib/marketplace/orderRecovery";

function CancelAction({ record }: { record: RecoverableOrder }) {
  const action = useOrderCancellation(record);
  const busy = [
    "preparing",
    "switching",
    "simulating",
    "wallet",
    "pending"
  ].includes(action.state.stage);
  return (
    <>
      <p className="mt-4 text-sm" role="status">
        {action.state.message ??
          action.status.data ??
          (busy
            ? "Confirm the cancellation in your wallet and wait for its receipt."
            : "Cancellation requires network gas shown by your wallet.")}
      </p>
      <button
        type="button"
        disabled={
          busy ||
          Boolean(action.status.data) ||
          ["confirmed", "inactive", "needs-confirmation"].includes(
            action.state.stage
          )
        }
        onClick={() => void action.cancel()}
        className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50"
      >
        {busy ? "Cancellation in progress…" : "Confirm cancellation"}
      </button>
      {action.state.hash && (
        <a
          className="mt-3 block text-sm font-bold text-ethereum"
          href={`${chainDetails[record.asset.chain].explorerUrl}/tx/${action.state.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View cancellation transaction
        </a>
      )}
    </>
  );
}

export function OrderCancellationDialog({
  order,
  returnFocus,
  fallbackFocus,
  onClose
}: {
  order: MarketOrder;
  returnFocus: HTMLElement;
  fallbackFocus: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const owns = address && getAddress(address) === getAddress(order.maker);
  const data = useQuery({
    queryKey: [
      "marketplace",
      "cancel-parameters",
      order.asset.chainId,
      order.orderHash,
      address
    ],
    enabled: Boolean(owns),
    retry: 1,
    queryFn: async ({ signal }): Promise<RecoverableOrder> => {
      try {
        const saved = readRecoverableOrders().find(
          (record) =>
            record.asset.chainId === order.asset.chainId &&
            record.orderHash.toLowerCase() === order.orderHash.toLowerCase() &&
            getAddress(record.order.offerer) === getAddress(order.maker)
        );
        if (saved) {
          parseCancellationOrder(
            {
              schemaVersion: 1,
              chainId: saved.asset.chainId,
              protocolAddress: order.protocolAddress,
              orderHash: saved.orderHash,
              order: encodeSeaportOrder(saved.order)
            },
            order
          );
          return saved;
        }
      } catch {
        /* Try the durable backend without replacing damaged browser data. */
      }
      if (!marketClient || !address)
        throw new Error("Order parameters are unavailable.");
      const raw = await marketClient.cancellationOrder(order, address, signal);
      const record: RecoverableOrder = {
        asset: order.asset,
        lifecycle: order.lifecycle,
        orderHash: order.orderHash,
        order: raw,
        state: "accepted",
        updatedAt: Date.now()
      };
      try {
        saveRecoverableOrder({ ...record, summary: order }, "accepted");
      } catch {
        /* Direct cancellation is still available. */
      }
      return record;
    }
  });
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      (returnFocus.isConnected ? returnFocus : fallbackFocus.current)?.focus();
    };
  }, [returnFocus, fallbackFocus]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6 text-ink shadow-cardHover backdrop:bg-ink/50 sm:p-8"
    >
      <div className="flex items-start justify-between gap-5">
        <h2 id={title} className="display text-2xl">
          Cancel {order.side}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cancellation review"
          className="rounded-full p-1 focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <p className="mt-4 font-bold">
        Token #{order.asset.tokenId} · {chainDetails[order.asset.chain].label}
      </p>
      <p className="mt-2 text-sm">
        Order price:{" "}
        {formatUnits(BigInt(order.grossAmount), order.currency.decimals)}{" "}
        {order.currency.symbol}
      </p>
      <p className="mt-2 break-all font-mono text-xs text-muted">
        {order.orderHash}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Cancel only this signed order. A competing trade may fill before
        cancellation confirms.
      </p>
      {!owns ? (
        <p className="mt-4 text-sm" role="alert">
          Connect the wallet that signed this order.
        </p>
      ) : data.isLoading ? (
        <p className="mt-4 text-sm">Loading cancellation parameters…</p>
      ) : data.data ? (
        <CancelAction record={data.data} />
      ) : (
        <p className="mt-4 text-sm" role="alert">
          Cancellation parameters could not be loaded. Try again or check your
          saved orders.
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
        >
          Close
        </button>
        <Link
          to="/orders/recovery"
          onClick={onClose}
          className="self-center rounded-full text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Order recovery
        </Link>
      </div>
    </dialog>
  );
}

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ExternalLink, Loader2, X } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import { getAddress } from "viem";
import { useAccount } from "wagmi";

import { chainDetails } from "@/data/chains";
import { useBnbTrade } from "@/hooks/marketplace/useBnbTrade";
import { useOpenSeaTrade } from "@/hooks/marketplace/useOpenSeaTrade";
import { shortAddress } from "@/lib/format";
import {
  formatMarketAmount,
  formatMarketCardAmount
} from "@/lib/marketplace/format";
import type { MarketOrder } from "@/lib/marketplace/marketApi";

const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

export function TradeReviewDialog({
  order,
  name,
  returnFocus,
  fallbackFocus,
  onClose
}: {
  order: MarketOrder;
  name: string;
  returnFocus: HTMLElement;
  fallbackFocus: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [showExactAmounts, setShowExactAmounts] = useState(false);
  const amount = showExactAmounts ? formatMarketAmount : formatMarketCardAmount;
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const bnbTrade = useBnbTrade();
  const openSeaTrade = useOpenSeaTrade();
  const viaOpenSea = order.source === "opensea";
  const trade = viaOpenSea ? openSeaTrade : bnbTrade;
  const prerequisite = viaOpenSea ? openSeaTrade.state.prerequisite : undefined;
  const buying = order.side === "listing";
  const seller = buying ? order.maker : address;
  const received = order.fees.reduce(
    (total, fee) =>
      seller && getAddress(fee.recipient) === getAddress(seller)
        ? total + BigInt(fee.amount)
        : total,
    BigInt(order.sellerProceeds)
  );
  const expiry = new Date(Number(order.endTime) * 1000);
  const stage = trade.state.stage;
  const busy = [
    "checking",
    "preparing",
    "switching",
    "simulating",
    "wallet",
    "pending"
  ].includes(stage);
  const blocked =
    busy || stage === "confirmed" || stage === "needs-confirmation";
  const approval = stage === "approval-required";
  const labels: Record<string, string> = {
    checking: "Checking the listing…",
    preparing: "Preparing your transaction…",
    switching: "Switch networks in your wallet…",
    simulating: "Checking the transaction…",
    wallet: "Confirm in your wallet…",
    pending: "Waiting for confirmation…",
    confirmed: buying ? "Purchase confirmed." : "Offer acceptance confirmed.",
    approved: viaOpenSea
      ? "Step confirmed. Review the trade when ready."
      : "NFT approval confirmed. Review and accept the offer when ready."
  };
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
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6 text-ink shadow-cardHover backdrop:bg-ink/50 sm:p-8"
    >
      <div className="flex items-start justify-between gap-5">
        <h2 id={titleId} className="display text-2xl">
          {buying ? "Review purchase" : "Review offer acceptance"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trade review"
          className="rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <p className="mt-4 font-bold">
        {name} <span className="text-muted">#{order.asset.tokenId}</span>
      </p>
      <p className="mt-1 text-sm text-muted">
        {chainDetails[order.asset.chain].label}
      </p>
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt>{buying ? "Seller" : "Buyer"}</dt>
          <dd className="font-bold" title={order.maker}>
            {shortAddress(order.maker)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{buying ? "Your total" : "Offer amount"}</dt>
          <dd className="break-all text-right font-bold">
            {amount(order.grossAmount, order)}
          </dd>
        </div>
        {order.fees.map((fee, index) => (
          <div
            key={`${fee.recipient}:${index}`}
            className="flex justify-between gap-4"
          >
            <dt>
              Fee to{" "}
              <span title={fee.recipient}>{shortAddress(fee.recipient)}</span>
            </dt>
            <dd className="break-all text-right">
              {amount(fee.amount, order)}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt>{buying ? "Seller receives" : "You receive"}</dt>
          <dd className="break-all text-right font-bold">
            {amount(received.toString(), order)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Order expires</dt>
          <dd className="text-right">
            {Number.isFinite(expiry.getTime()) ? (
              <time dateTime={expiry.toISOString()}>
                {expiry.toLocaleString()}
              </time>
            ) : (
              "Far future"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Your wallet</dt>
          <dd className="font-bold">
            {address ? shortAddress(address) : "Not connected"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>
          {showExactAmounts
            ? "Exact transaction amounts."
            : "Displayed amounts are rounded."}
        </p>
        <button
          type="button"
          aria-pressed={showExactAmounts}
          onClick={() => setShowExactAmounts((shown) => !shown)}
          className="rounded-full px-2 py-1 font-semibold text-ethereum underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          {showExactAmounts ? "Show rounded amounts" : "Show exact amounts"}
        </button>
      </div>
      <p className="mt-5 text-sm leading-relaxed text-muted">
        Network gas is additional and shown by your wallet.{" "}
        {buying
          ? "The NFT will be sent to your connected wallet."
          : `The NFT will be sent to the buyer and payment will be in ${order.currency.symbol}.`}
      </p>
      {approval && (
        <p className="mt-4 rounded-2xl bg-lavender/30 p-4 text-sm leading-relaxed">
          {prerequisite
            ? prerequisite.message
            : `Approve Seaport to transfer this NFT, then return here to accept the offer. This approval covers token #${order.asset.tokenId}.`}
        </p>
      )}
      <div
        className="mt-5 text-sm font-semibold"
        aria-live="polite"
        role="status"
      >
        {labels[stage]}
        {trade.state.message && (
          <p className="text-red-700">{trade.state.message}</p>
        )}
      </div>
      {trade.state.hash && (
        <a
          href={`${chainDetails[order.asset.chain].explorerUrl}/tx/${trade.state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-ethereum"
        >
          View transaction <ExternalLink aria-hidden="true" size={14} />
        </a>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {!address ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              openConnectModal?.();
            }}
            className={buttonClass}
          >
            Connect wallet
          </button>
        ) : (
          <button
            type="button"
            disabled={blocked}
            onClick={() => void trade.perform(order, approval)}
            className={buttonClass}
          >
            {busy && (
              <Loader2 aria-hidden="true" size={15} className="animate-spin" />
            )}
            {approval
              ? (prerequisite?.label ?? "Approve this NFT")
              : buying
                ? "Confirm purchase"
                : "Accept offer"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}

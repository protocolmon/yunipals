import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import { Link } from "react-router-dom";
import { formatUnits, getAddress, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { chainDetails } from "@/data/chains";
import { useOrderCreation } from "@/hooks/marketplace/useOrderCreation";
import { marketClient } from "@/hooks/marketplace/useMarketplace";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openseaCurrencies
} from "@/lib/marketplace/openseaRegistry";
import { shortAddress } from "@/lib/format";
import type { MarketAssetId, MarketOrder } from "@/lib/marketplace/marketApi";
import { supportedOrderDurations } from "@/lib/marketplace/orderDurations";
import { parseOrderPrice } from "@/lib/marketplace/orderPublication";
import { cn } from "@/lib/utils";

const button =
  "rounded-full border border-line px-5 py-2.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50";

export function OrderCreationDialog({
  asset,
  lifecycle,
  side,
  replacing,
  name,
  returnFocus,
  fallbackFocus,
  onClose
}: {
  asset: MarketAssetId;
  lifecycle: number;
  side: "listing" | "offer";
  replacing?: MarketOrder;
  name: string;
  returnFocus: HTMLElement;
  fallbackFocus: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const priceId = useId();
  const expiryId = useId();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const creation = useOrderCreation({ asset, lifecycle, side, replacing });
  const viaOpenSea = isOpenSeaChain(asset.chain);
  const policy = useQuery({
    queryKey: ["marketplace", "order-policy", asset.chain],
    enabled: Boolean(viaOpenSea && marketClient),
    retry: 1,
    staleTime: 15_000,
    queryFn: ({ signal }) => {
      if (!marketClient || !isOpenSeaChain(asset.chain))
        throw new Error("Order policy is unavailable.");
      return marketClient.openSeaPolicy(asset.chain, signal);
    }
  });
  const bnbPolicy = useQuery({
    queryKey: ["marketplace", "order-policy", "bnb"],
    enabled: Boolean(!viaOpenSea && marketClient),
    retry: 1,
    staleTime: 15_000,
    queryFn: ({ signal }) => marketClient!.bnbPolicy(signal)
  });
  const activePolicy = viaOpenSea ? policy : bnbPolicy;
  const durationOptions = supportedOrderDurations(
    viaOpenSea
      ? policy.data?.maxDurationSeconds
      : bnbPolicy.data?.maxDurationSeconds
  );
  const [selectedCurrency, setSelectedCurrency] = useState<Address | undefined>(
    replacing?.currency.address
  );
  const [price, setPrice] = useState(
    replacing ? formatUnits(BigInt(replacing.grossAmount), 18) : ""
  );
  const [duration, setDuration] = useState("3600");
  const selectedDuration = durationOptions.some(
    (option) => option.value === duration
  )
    ? duration
    : durationOptions[0]?.value;
  const [inputError, setInputError] = useState<string>();
  const busy = [
    "preparing",
    "switching",
    "simulating",
    "wallet",
    "pending",
    "signing",
    "submitting"
  ].includes(creation.stage);
  const showForm = !creation.intent;
  const summary = creation.intent?.summary;
  const prerequisite = creation.prerequisite;
  const paymentToken = isOpenSeaChain(asset.chain)
    ? side === "offer"
      ? openseaCurrencies[asset.chain].address
      : (selectedCurrency ??
        policy.data?.listingCurrencies[0] ??
        (asset.chain === "polygon"
          ? openseaCurrencies.polygon.address
          : zeroAddress))
    : undefined;
  const selectedPayment = (() => {
    if (!isOpenSeaChain(asset.chain) || !paymentToken) return undefined;
    try {
      return openSeaCurrency(asset.chain, paymentToken);
    } catch {
      return undefined;
    }
  })();
  const currency =
    summary?.currency.symbol ??
    (viaOpenSea
      ? (selectedPayment?.symbol ?? "unsupported currency")
      : side === "listing"
        ? "BNB"
        : "WBNB");
  const wrapSymbol = viaOpenSea ? "ETH" : "BNB";
  const spenderName = viaOpenSea ? "OpenSea's transfer conduit" : "Seaport";
  const title = replacing
    ? "Change order price"
    : side === "listing"
      ? "List your Yunipal"
      : "Make an offer";
  useLayoutEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      (returnFocus.isConnected ? returnFocus : fallbackFocus.current)?.focus();
    };
  }, [returnFocus, fallbackFocus]);
  const labels: Record<string, string> = {
    preparing: "Checking the NFT and current order requirements…",
    switching: "Switch networks in your wallet…",
    simulating: "Checking the transaction…",
    wallet: "Confirm the transaction in your wallet…",
    pending: "Waiting for transaction confirmation…",
    signing: "Review and sign the order in your wallet…",
    submitting: "Waiting for order publication…"
  };
  const action = creation.needsRequirementsRefresh
    ? "Refresh order requirements"
    : creation.stage === "publication-unknown" && !prerequisite
      ? "Retry publication"
      : prerequisite?.kind === "cancel"
        ? "Cancel previous order"
        : prerequisite?.kind === "approve-nft"
          ? "Approve this NFT"
          : prerequisite?.kind === "wrap"
            ? `Wrap ${formatUnits(prerequisite.amount, 18)} ${wrapSymbol}`
            : prerequisite?.kind === "approve-currency"
              ? `Approve ${formatUnits(prerequisite.amount, 18)} ${currency}`
              : `${creation.bnbOnchain ? "Publish on chain" : "Sign and publish"} ${side === "listing" ? "listing" : "offer"}`;
  return (
    <dialog
      ref={element}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6 text-ink shadow-cardHover backdrop:bg-ink/50 sm:p-8"
    >
      <div className="flex items-start justify-between gap-5">
        <h2 id={titleId} className="display text-2xl">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close order review"
          className="rounded-full p-1 focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <p className="mt-4 font-bold">
        {name} <span className="text-muted">#{asset.tokenId}</span>
      </p>
      <p className="mt-1 text-sm text-muted">
        {chainDetails[asset.chain].label} ·{" "}
        {address ? shortAddress(address) : "Wallet disconnected"}
      </p>
      {showForm ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              if (!selectedDuration || activePolicy.isError)
                throw new Error(
                  "Wait for the available listing durations to load."
                );
              const amount = parseOrderPrice(price);
              setInputError(undefined);
              void creation.review(
                amount,
                BigInt(selectedDuration),
                paymentToken
              );
            } catch (error) {
              setInputError(
                error instanceof Error ? error.message : "Enter a valid price."
              );
            }
          }}
        >
          {(!activePolicy.data || activePolicy.isError) && (
            <p role="status" className="text-sm text-muted">
              {activePolicy.isError
                ? "Collection order requirements could not be loaded."
                : "Loading collection order requirements…"}
              {activePolicy.isError && (
                <button
                  type="button"
                  onClick={() => void activePolicy.refetch()}
                  className="ml-2 rounded-full font-bold focus-visible:ring-2 focus-visible:ring-ink"
                >
                  Retry
                </button>
              )}
            </p>
          )}
          {viaOpenSea &&
            side === "listing" &&
            policy.data &&
            policy.data.listingCurrencies.length > 1 && (
              <div>
                <label
                  className="text-sm font-bold"
                  htmlFor={`${priceId}-currency`}
                >
                  Payment currency
                </label>
                <select
                  id={`${priceId}-currency`}
                  value={paymentToken}
                  disabled={busy}
                  onChange={(event) =>
                    setSelectedCurrency(event.target.value as Address)
                  }
                  className="mt-2 w-full rounded-2xl border border-line bg-white px-4 py-3 focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {policy.data.listingCurrencies.map((token) => (
                    <option key={token} value={token}>
                      {openSeaCurrency(policy.data!.chain, token).symbol}
                    </option>
                  ))}
                </select>
              </div>
            )}
          <div>
            <label htmlFor={priceId} className="text-sm font-bold">
              {side === "listing" ? "Buyer pays" : "Offer amount"} ({currency})
            </label>
            <input
              id={priceId}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
              inputMode="decimal"
              autoComplete="off"
              maxLength={80}
              placeholder="0.1"
              disabled={busy}
              className="mt-2 w-full rounded-2xl border border-line px-4 py-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            />
          </div>
          <div>
            <label htmlFor={expiryId} className="text-sm font-bold">
              Expires after
            </label>
            <select
              id={expiryId}
              value={selectedDuration ?? ""}
              onChange={(event) => setDuration(event.target.value)}
              disabled={busy}
              className="mt-2 w-full rounded-2xl border border-line bg-white px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              {!durationOptions.length && (
                <option value="">Loading durations…</option>
              )}
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {inputError && (
            <p className="text-sm text-red-700" role="alert">
              {inputError}
            </p>
          )}
          <button
            type="submit"
            disabled={
              busy ||
              !address ||
              !selectedDuration ||
              activePolicy.isError ||
              (viaOpenSea && (!policy.data || !selectedPayment))
            }
            className={cn(button, "bg-ink text-white")}
          >
            Review {side === "listing" ? "listing" : "offer"}
          </button>
        </form>
      ) : (
        summary && (
          <>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt>{side === "listing" ? "Buyer pays" : "Your offer"}</dt>
                <dd className="break-all text-right font-bold">
                  {formatUnits(BigInt(summary.grossAmount), 18)} {currency}
                </dd>
              </div>
              {summary.fees.map((fee) => (
                <div key={fee.recipient} className="flex justify-between gap-4">
                  <dt>
                    Fee to{" "}
                    <span title={fee.recipient}>
                      {shortAddress(fee.recipient)}
                    </span>
                  </dt>
                  <dd className="break-all text-right">
                    {formatUnits(BigInt(fee.amount), 18)} {currency}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt>{side === "listing" ? "You receive" : "Seller payment"}</dt>
                <dd className="break-all text-right font-bold">
                  {formatUnits(
                    BigInt(summary.sellerProceeds) +
                      (side === "listing"
                        ? summary.fees.reduce(
                            (total, fee) =>
                              total +
                              (getAddress(fee.recipient) ===
                              getAddress(summary.maker)
                                ? BigInt(fee.amount)
                                : 0n),
                            0n
                          )
                        : 0n),
                    18
                  )}{" "}
                  {currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Order expires</dt>
                <dd className="text-right">
                  <time
                    dateTime={new Date(
                      Number(summary.endTime) * 1000
                    ).toISOString()}
                  >
                    {new Date(Number(summary.endTime) * 1000).toLocaleString()}
                  </time>
                </dd>
              </div>
            </dl>
            <p className="mt-5 text-sm leading-relaxed text-muted">
              This order applies to this token ID even if its artwork changes or
              it is burned and recreated. Hiding or transferring the NFT does
              not cancel the order. {creation.bnbOnchain
                ? "Publishing on BNB Chain requires a network transaction; your wallet shows its gas fee before you confirm."
                : "Your wallet shows network gas for each transaction."}
            </p>
            {side === "offer" && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Payment is in {currency}. Your funds remain in your wallet until
                acceptance and are not reserved for this offer.
              </p>
            )}
            {prerequisite && (
              <div className="mt-4 rounded-2xl bg-lavender/25 p-4 text-sm leading-relaxed">
                {prerequisite.kind === "cancel" ? (
                  <p>
                    Cancel your previous {side} at{" "}
                    {formatUnits(BigInt(replacing!.grossAmount), 18)}{" "}
                    {replacing!.currency.symbol} first. Its cancellation must
                    confirm before you can publish the replacement. A competing
                    trade can fill before cancellation confirms.
                  </p>
                ) : prerequisite.kind === "approve-nft" ? (
                  <p>
                    Approve {spenderName} to transfer token #{asset.tokenId}.
                    You will review and publish the order separately.
                  </p>
                ) : prerequisite.kind === "wrap" ? (
                  <p>
                    Convert {formatUnits(prerequisite.amount, 18)} {wrapSymbol}{" "}
                    into the same amount of {currency} in your wallet, then
                    review the remaining steps.
                  </p>
                ) : prerequisite.kind === "approve-currency" ? (
                  <p>
                    Set the {currency} allowance for {spenderName} to{" "}
                    {formatUnits(prerequisite.amount, 18)} {currency}. The
                    approval can also be used by your other valid Seaport
                    orders.
                  </p>
                ) : null}
              </div>
            )}
            {creation.stage !== "published" && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={
                    busy || !address || creation.stage === "needs-confirmation"
                  }
                  onClick={() => void creation.act()}
                  className={cn(button, "bg-ink text-white")}
                >
                  {action}
                </button>
                {creation.canEdit && (
                  <button
                    type="button"
                    onClick={creation.edit}
                    className={button}
                  >
                    Edit order
                  </button>
                )}
              </div>
            )}
          </>
        )
      )}
      <div
        className="mt-4 text-sm font-semibold"
        role="status"
        aria-live="polite"
      >
        {labels[creation.stage]}
        {creation.message && <p>{creation.message}</p>}
        {creation.published && (
          <p>
            {creation.published.status === "active"
              ? `${side === "listing" ? "Listing" : "Offer"} published.`
              : creation.bnbOnchain
                ? "Publication confirmed on chain; the order is waiting for indexing."
              : `Order saved. Current status: ${creation.published.status}.`}
          </p>
        )}
      </div>
      {creation.hash && (
        <a
          href={`${chainDetails[asset.chain].explorerUrl}/tx/${creation.hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-bold text-ethereum"
        >
          View transaction
        </a>
      )}
      {!address && (
        <button
          type="button"
          className={cn(button, "mt-4")}
          onClick={() => {
            onClose();
            openConnectModal?.();
          }}
        >
          Connect wallet
        </button>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" onClick={onClose} className={button}>
          Close
        </button>
        <Link
          to="/orders/recovery"
          onClick={onClose}
          className="rounded-full text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Order recovery
        </Link>
      </div>
    </dialog>
  );
}

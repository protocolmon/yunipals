import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain } from "wagmi";
import { formatEther, formatUnits, type Hex } from "viem";
import { Loader2 } from "lucide-react";
import type { BoosterOriginal } from "@protopals/yunipals-market-core/boosters";
import { YunipalsLoader } from "@/components/YunipalsLoader";
import {
  useBoosterActions,
  type BoosterAction
} from "@/hooks/useBoosterActions";
import { cn } from "@/lib/utils";
import { formatDecimal, formatRoundedAmount } from "@/lib/format";
import { BoosterOriginalThumbnail } from "./BoosterOriginalThumbnail";

export const boosterButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

export function BoosterActionButton({
  action,
  children,
  disabled = false,
  className,
  ariaLabel,
  claimOriginal,
  onConfirmed,
  onSubmitted
}: {
  action: BoosterAction;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  claimOriginal?: BoosterOriginal;
  onConfirmed?: (hash: Hex) => void;
  onSubmitted?: (hash: Hex, replacedHash?: Hex) => void;
}) {
  const { isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const switcher = useSwitchChain();
  const actions = useBoosterActions();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [burnAcknowledged, setBurnAcknowledged] = useState(false);
  const [openingSubmitted, setOpeningSubmitted] = useState(false);
  const visible =
    !openingSubmitted &&
    (actions.review !== null ||
      actions.phase !== "idle" ||
      actions.error !== null);
  const busy = actions.phase !== "idle";
  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    else if (!visible) {
      dialog.current?.close();
      setBurnAcknowledged(false);
    }
  }, [visible]);
  const label = !isConnected
    ? "Connect wallet"
    : chainId !== 8453
      ? "Switch to Base"
      : children;
  const review = actions.review;
  const claimReview = review?.action.kind === "claim" ? review.action : null;
  return (
    <>
      <button
        type="button"
        className={cn(boosterButtonClass, className)}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled || busy || switcher.isPending}
        onClick={() => {
          if (!isConnected) openConnectModal?.();
          else if (chainId !== 8453) switcher.switchChain({ chainId: 8453 });
          else {
            setOpeningSubmitted(false);
            void actions.prepare(action);
          }
        }}
      >
        {busy && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {label}
      </button>
      {switcher.error && (
        <p role="alert" className="mt-2 text-sm text-muted">
          Could not switch networks. Select Base in your wallet.
        </p>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-card bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) actions.dismiss();
        }}
      >
        <h2 id={titleId} className="text-xl font-bold">
          {action.kind === "claim"
            ? "Your daily pack"
            : review?.permitApproval && !review.permitSigned
              ? "Approve and open"
              : review?.approval
                ? "Approve pack payment"
                : action.kind === "burn"
                  ? "Burn this Yunipal?"
                  : "Review transaction"}
        </h2>
        {review && claimReview ? (
          <>
            <div className="my-6 flex items-center gap-4 rounded-2xl bg-lavender/25 p-4">
              {claimOriginal && (
                <BoosterOriginalThumbnail original={claimOriginal} />
              )}
              <div>
                <p className="text-lg font-bold">
                  {claimReview.quantity} saved{" "}
                  {claimReview.quantity === 1 ? "card" : "cards"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  From original #{claimReview.originalId}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted">Estimated fees</span>
              <strong
                title={`${formatEther(review.vrfPrice + (review.networkFee ?? 0n))} ETH`}
              >
                {review.networkFee === null
                  ? "Calculating…"
                  : formatRoundedAmount(
                      review.vrfPrice + review.networkFee,
                      18,
                      "ETH"
                    )}
              </strong>
            </div>
            <p className="mt-3 text-sm text-muted">
              No YPAL needed. Open all {claimReview.quantity} cards together in
              one pack.
            </p>
            <details className="mt-4 text-xs text-muted">
              <summary className="cursor-pointer rounded font-semibold focus-visible:ring-2 focus-visible:ring-grape">
                Fee details
              </summary>
              <dl className="mt-3 space-y-2">
                <div className="flex justify-between gap-3">
                  <dt>Randomness</dt>
                  <dd>{formatRoundedAmount(review.vrfPrice, 18, "ETH")}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Network estimate</dt>
                  <dd>
                    {review.networkFee === null
                      ? "Calculating…"
                      : formatRoundedAmount(review.networkFee, 18, "ETH")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Maximum ETH sent, before gas</dt>
                  <dd>{formatRoundedAmount(review.value, 18, "ETH")}</dd>
                </div>
              </dl>
              <p className="mt-2">Unused ETH is returned automatically.</p>
            </details>
          </>
        ) : (
          review && (
            <>
              <dl className="my-5 space-y-3 text-sm">
                {review.action.kind === "open" && (
                  <div className="flex justify-between gap-4">
                    <dt>Originals requested</dt>
                    <dd>{review.action.quantity ?? 1}</dd>
                  </div>
                )}
                {review.action.kind === "claim" && (
                  <div className="flex justify-between gap-4">
                    <dt>Mints requested</dt>
                    <dd>{review.action.quantity}</dd>
                  </div>
                )}
                {review.tokenPrice > 0n && (
                  <div className="flex justify-between gap-4">
                    <dt>Total pack price</dt>
                    <dd>
                      {formatUnits(review.tokenPrice, review.tokenDecimals)}{" "}
                      {review.tokenSymbol}
                    </dd>
                  </div>
                )}
                {review.tokenBalance !== null && (
                  <div className="flex justify-between gap-4">
                    <dt>Your {review.tokenSymbol} balance</dt>
                    <dd
                      className="text-right"
                      title={`${formatUnits(review.tokenBalance, review.tokenDecimals)} ${review.tokenSymbol}`}
                    >
                      {formatDecimal(
                        formatUnits(review.tokenBalance, review.tokenDecimals),
                        4
                      )}{" "}
                      {review.tokenSymbol}
                    </dd>
                  </div>
                )}
                {review.approvalAmount > 0n && (
                  <div className="flex justify-between gap-4">
                    <dt>Approval amount</dt>
                    <dd
                      className="text-right"
                      title={`${formatUnits(review.approvalAmount, review.tokenDecimals)} ${review.tokenSymbol}`}
                    >
                      {formatDecimal(
                        formatUnits(review.approvalAmount, review.tokenDecimals)
                      )}{" "}
                      {review.tokenSymbol}
                    </dd>
                  </div>
                )}
                {!review.approval && review.vrfPrice > 0n && (
                  <div className="flex justify-between gap-4">
                    <dt>VRF quote</dt>
                    <dd
                      className="text-right"
                      title={`${formatEther(review.vrfPrice)} ETH`}
                    >
                      {formatRoundedAmount(review.vrfPrice, 18, "ETH")}
                    </dd>
                  </div>
                )}
                {!review.approval && review.value > 0n && (
                  <div className="flex justify-between gap-4">
                    <dt>Maximum ETH sent</dt>
                    <dd
                      className="text-right"
                      title={`${formatEther(review.value)} ETH`}
                    >
                      {formatRoundedAmount(review.value, 18, "ETH")}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt>Network gas estimate</dt>
                  <dd
                    className="text-right"
                    title={
                      review.networkFee === null
                        ? undefined
                        : `${formatEther(review.networkFee)} ETH`
                    }
                  >
                    {review.networkFee === null
                      ? "After approval signature"
                      : formatRoundedAmount(review.networkFee, 18, "ETH")}
                  </dd>
                </div>
              </dl>
              {review.permitApproval && !review.permitSigned ? (
                <p className="text-sm text-muted">
                  Sign a gas-free approval, then review one transaction that
                  includes the approval and opens your packs.
                </p>
              ) : review.approval ? (
                <p className="text-sm text-muted">
                  Approve{" "}
                  {formatDecimal(
                    formatUnits(review.approvalAmount, review.tokenDecimals)
                  )}{" "}
                  {review.tokenSymbol} for future pack purchases. Only the total
                  pack price is charged for this opening. Then review the
                  opening transaction.
                </p>
              ) : action.kind === "open" ? (
                <p className="text-sm text-muted">
                  The full price is burned when this transaction succeeds, even
                  if reveal is delayed indefinitely. Excess ETH is returned
                  immediately. The VRF charge includes callback minting and is
                  spent once requested.
                  {review.action.kind === "open" &&
                    (review.action.quantity ?? 1) > 1 &&
                    " Each purchased pack creates its own original and randomness request. All cards appear in one opening."}
                </p>
              ) : action.kind === "claim" ? (
                <p className="text-sm text-muted">
                  These pending mints follow your original if you transfer it
                  before they finish. Excess ETH is returned immediately.
                </p>
              ) : action.kind === "burn" ? (
                <label className="flex gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={burnAcknowledged}
                    onChange={(event) =>
                      setBurnAcknowledged(event.target.checked)
                    }
                  />
                  <span>
                    I understand this permanently destroys the NFT. For
                    originals, all pending mints, unused days, and future rights
                    are lost. Spent VRF fees are not refunded.
                  </span>
                </label>
              ) : action.kind === "recover" ? (
                <p className="text-sm text-muted">
                  Finish the saved VRF result. This uses the same randomness and
                  sends offspring to the original’s current owner.
                </p>
              ) : null}
            </>
          )
        )}
        {busy && action.kind === "claim" ? (
          <YunipalsLoader
            className="my-5"
            label={
              actions.phase === "quoting"
                ? "Getting your pack ready"
                : actions.phase === "signing"
                  ? "Confirm in your wallet"
                  : "Opening your pack"
            }
            detail={
              actions.phase === "quoting"
                ? "Checking your saved cards and fees…"
                : undefined
            }
          />
        ) : (
          busy && (
            <p role="status" className="my-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {actions.phase === "quoting"
                ? "Getting fees and checking the transaction…"
                : actions.phase === "signing"
                  ? "Confirm in your wallet…"
                  : "Waiting for transaction confirmation…"}
            </p>
          )
        )}
        {actions.error && (
          <p role="alert" className="my-4 break-words text-sm text-muted">
            {actions.error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {review && (
            <button
              type="button"
              className={boosterButtonClass}
              disabled={busy || (action.kind === "burn" && !burnAcknowledged)}
              onClick={async () => {
                const hash = await actions.confirm(
                  onSubmitted
                    ? (hash, replacedHash) => {
                        setOpeningSubmitted(true);
                        onSubmitted(hash, replacedHash);
                      }
                    : undefined
                );
                if (hash) onConfirmed?.(hash);
              }}
            >
              {claimReview
                ? `Open ${claimReview.quantity} ${claimReview.quantity === 1 ? "card" : "cards"}`
                : review.permitApproval
                  ? review.permitSigned
                    ? "Open packs"
                    : "Sign approval"
                  : review.approval
                    ? "Approve payment"
                    : "Confirm"}
            </button>
          )}
          {actions.error && !busy && !actions.submittedHash && (
            <button
              type="button"
              className={boosterButtonClass}
              onClick={() => void actions.prepare(action)}
            >
              Refresh review
            </button>
          )}
          {actions.error && actions.submittedHash && (
            <p className="text-sm text-muted">
              Check recent transactions for the submitted request before trying
              again.
            </p>
          )}
          <button
            type="button"
            className="rounded-full border border-line px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
            disabled={busy}
            onClick={actions.dismiss}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

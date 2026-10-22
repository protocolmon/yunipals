import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { Loader2 } from "lucide-react";
import {
  useBoosterActions,
  type BoosterAction
} from "@/hooks/useBoosterActions";
import { cn } from "@/lib/utils";

export const boosterButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

export function BoosterActionButton({
  action,
  children,
  disabled = false,
  className
}: {
  action: BoosterAction;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const switcher = useSwitchChain();
  const actions = useBoosterActions();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [burnAcknowledged, setBurnAcknowledged] = useState(false);
  const visible =
    actions.review !== null ||
    actions.phase !== "idle" ||
    actions.error !== null;
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
  return (
    <>
      <button
        type="button"
        className={cn(boosterButtonClass, className)}
        disabled={disabled || busy || switcher.isPending}
        onClick={() => {
          if (!isConnected) openConnectModal?.();
          else if (chainId !== 8453) switcher.switchChain({ chainId: 8453 });
          else void actions.prepare(action);
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
          {review?.approval
            ? "Approve pack payment"
            : action.kind === "burn"
            ? "Burn this Yunipal?"
            : "Review transaction"}
        </h2>
        {review && (
          <>
            <dl className="my-5 space-y-3 text-sm">
              {review.action.kind === "claim" && (
                <div className="flex justify-between gap-4">
                  <dt>Mints requested</dt>
                  <dd>{review.action.quantity}</dd>
                </div>
              )}
              {review.tokenPrice > 0n && (
                <div className="flex justify-between gap-4">
                  <dt>Pack price</dt>
                  <dd>
                    {formatUnits(review.tokenPrice, review.tokenDecimals)}{" "}
                    {review.tokenSymbol}
                  </dd>
                </div>
              )}
              {!review.approval && review.vrfPrice > 0n && (
                <div className="flex justify-between gap-4">
                  <dt>VRF quote</dt>
                  <dd>{formatEther(review.vrfPrice)} ETH</dd>
                </div>
              )}
              {!review.approval && review.value > 0n && (
                <div className="flex justify-between gap-4">
                  <dt>Maximum ETH sent</dt>
                  <dd className="break-all text-right">
                    {formatEther(review.value)} ETH
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt>Network gas estimate</dt>
                <dd className="break-all text-right">
                  {formatEther(review.networkFee)} ETH
                </dd>
              </div>
            </dl>
            {review.approval ? (
              <p className="text-sm text-muted">
                Approve the exact pack price, then review the opening
                transaction.
              </p>
            ) : action.kind === "open" ? (
              <p className="text-sm text-muted">
                The full pack price is burned when this request succeeds, even
                if reveal is delayed indefinitely. Excess ETH is returned
                immediately. The VRF charge includes callback minting and is
                spent once requested.
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
                  I understand this permanently destroys the NFT. For originals,
                  all pending mints, unused days, and future rights are lost.
                  Spent VRF fees are not refunded.
                </span>
              </label>
            ) : action.kind === "recover" ? (
              <p className="text-sm text-muted">
                Finish the saved VRF result. This uses the same randomness and
                sends offspring to the original’s current owner.
              </p>
            ) : null}
          </>
        )}
        {busy && (
          <p role="status" className="my-4 flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {actions.phase === "quoting"
              ? "Getting fees and checking the transaction…"
              : actions.phase === "signing"
              ? "Confirm in your wallet…"
              : "Waiting for transaction confirmation…"}
          </p>
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
              onClick={() => void actions.confirm()}
            >
              {review.approval ? "Approve payment" : "Confirm"}
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

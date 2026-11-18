import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { DialogSurface, DialogHeader } from "@/components/ui/dialog";
import { YunipalsLoader } from "@/components/YunipalsLoader";
import type { useDailyClaimAll } from "@/hooks/useDailyClaimAll";
import { cn } from "@/lib/utils";
import { formatRoundedAmount } from "@/lib/format";
import { useBoosterOpening } from "@/providers/BoosterOpeningProvider";
import { boosterButtonClass } from "./BoosterActionButton";
import { BoosterOriginalThumbnail } from "./BoosterOriginalThumbnail";

type Props = { actions: ReturnType<typeof useDailyClaimAll> };
export function BoosterDailyOpenAllDialog({ actions }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { openTransaction } = useBoosterOpening();
  const { review, phase, progress, error, visible } = actions;
  useEffect(() => {
    if (!visible) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [visible]);
  if (!visible) return null;
  const quantity =
    review?.calls.reduce((total, call) => total + call.quantity, 0) ?? 0;
  const native = Boolean(review?.nativeTransactions.length);
  const confirmations = native
    ? review!.nativeTransactions.length
    : review?.atomic
      ? 1
      : (review?.calls.length ?? 0);
  return createPortal(
    <DialogSurface
      ref={dialog}
      aria-labelledby={titleId}
      size="lg"
      onCancel={(event) => {
        event.preventDefault();
        actions.dismiss();
      }}
    >
      <DialogHeader
        id={titleId}
        eyebrow="A whole bunch of new pals"
        title="Open all daily cards"
        onClose={actions.dismiss}
        busy={Boolean(phase)}
      />
      {review ? (
        <>
          <div className="my-5 rounded-2xl bg-lavender/25 p-4">
            <p className="text-lg font-bold">
              {quantity} saved {quantity === 1 ? "card" : "cards"}
            </p>
            <p className="mt-1 text-sm text-muted">
              From {review.calls.length}{" "}
              {review.calls.length === 1 ? "Yunipal" : "Yunipals"}
            </p>
            <ul
              aria-label="Yunipals contributing saved cards"
              className="mt-4 grid max-h-72 grid-cols-3 gap-x-3 gap-y-4 overflow-y-auto p-1 sm:max-h-96 sm:grid-cols-5"
            >
              {review.calls.map(({ original, quantity: saved }) => (
                <li key={original.id} className="min-w-0 text-center">
                  <BoosterOriginalThumbnail
                    original={original}
                    variant="preview"
                  />
                  <p className="mt-2 truncate text-xs font-bold">
                    #{original.tokenId}
                  </p>
                  <p className="text-xs text-muted">
                    {saved} saved {saved === 1 ? "card" : "cards"}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Tap your Yunipals to enlarge. Your new cards will be revealed
              after opening.
            </p>
          </div>
          <p className="text-sm font-bold text-grape">
            {confirmations === 1
              ? "One bundled transaction"
              : `${confirmations} wallet confirmations`}
          </p>
          <p className="mt-2 text-sm text-muted">
            {native
              ? `The contract combines up to ${review.nativeLimit} Yunipals per transaction. No smart-account setup needed.`
              : review.atomic
                ? "Your wallet will combine these openings for you."
                : review.calls.length > 1
                  ? "This wallet cannot bundle these openings. You’ll confirm each Yunipal in order. Cancel in your wallet to stop."
                  : "Open these saved cards together in one pack."}
            {review.atomic && review.upgrade
              ? " Your wallet may first ask you to enable its smart-account feature."
              : ""}
          </p>
          <dl className="my-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Maximum randomness fees</dt>
              <dd className="text-right font-bold">
                {formatRoundedAmount(review.value, 18, "ETH")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Estimated network fees</dt>
              <dd className="text-right font-bold">
                {formatRoundedAmount(review.networkFee, 18, "ETH")}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            No YPAL needed. Unused ETH is returned automatically. The wallet
            shows the final network fee
            {review.atomic ? ", including any account setup" : ""}.
          </p>
          <p className="mt-3 text-xs text-muted">
            Up to seven saved cards per Yunipal per round. Extra cards stay
            saved until this round finishes. Pending openings are skipped.
          </p>
          <button
            type="button"
            className={cn(boosterButtonClass, "mt-4 w-full")}
            disabled={Boolean(phase)}
            onClick={() => void actions.confirm()}
          >
            {confirmations === 1
              ? `Open ${quantity} cards in one bundle`
              : `Open ${quantity} cards`}
          </button>
        </>
      ) : !phase &&
        !progress.pending &&
        !error &&
        progress.hashes.length > 0 ? (
        <p className="my-5 text-sm">
          Your daily cards are on their way. Open a reveal below.
        </p>
      ) : null}
      {phase && (
        <div role="status" className="my-5">
          <YunipalsLoader
            label={phase}
            detail="Your submitted openings remain saved."
          />
        </div>
      )}
      {error && (
        <p role="alert" className="my-4 text-sm text-muted">
          {error}
        </p>
      )}
      {progress.pending && !phase && (
        <>
          <p className="my-3 text-sm text-muted">
            An opening has been submitted. Check its status before opening more
            cards.
          </p>
          <button
            type="button"
            className={cn(boosterButtonClass, "mt-4 w-full")}
            onClick={() => void actions.resume()}
          >
            Check opening status
          </button>
        </>
      )}
      {!progress.pending && !phase && error && (
        <button
          type="button"
          className={cn(boosterButtonClass, "mt-4 w-full")}
          onClick={() => void actions.prepare()}
        >
          Refresh remaining cards
        </button>
      )}
      {progress.hashes.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-line pt-4">
          {progress.hashes.map((hash, index) => (
            <li key={hash}>
              <button
                type="button"
                disabled={Boolean(phase)}
                className="rounded-full px-3 py-2 text-sm font-bold text-grape focus-visible:ring-2 focus-visible:ring-grape disabled:opacity-50"
                onClick={() => {
                  actions.dismiss();
                  openTransaction(hash);
                }}
              >
                View daily opening {index + 1}
              </button>
            </li>
          ))}
        </ul>
      )}
    </DialogSurface>,
    document.body
  );
}

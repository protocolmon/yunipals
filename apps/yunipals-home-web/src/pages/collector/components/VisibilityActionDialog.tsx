import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import type { YunipalToken } from "@/lib/yunipalsIndexer";
import type { VisibilityStage } from "@/pages/collector/hooks/useTokenVisibility";

type VisibilityActionDialogProps = {
  token: YunipalToken;
  hidden: boolean;
  pending: boolean;
  stage: VisibilityStage;
  errorMessage?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

const STAGE_LABELS: Record<VisibilityStage, string> = {
  idle: "Confirm",
  requesting: "Preparing request…",
  switching: "Switching network…",
  signing: "Check your wallet…",
  submitting: "Saving…"
};

export function VisibilityActionDialog({
  token,
  hidden,
  pending,
  stage,
  errorMessage,
  onConfirm,
  onClose
}: VisibilityActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);
  const Icon = hidden ? EyeOff : Eye;
  const tokenLabel = token.name || `Yunipal #${token.tokenId}`;

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-ink/50 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-cardHover sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-ethereum/10 text-ethereum">
            <Icon aria-hidden="true" size={21} />
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted transition hover:bg-line/35 hover:text-ink disabled:cursor-wait disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
            aria-label="Close visibility dialog"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>

        <h2 id={titleId} className="mt-5 text-2xl font-black text-ink">
          {hidden ? "Hide" : "Unhide"} {tokenLabel}?
        </h2>
        <p
          id={descriptionId}
          className="mt-3 text-sm font-medium leading-relaxed text-muted"
        >
          {hidden
            ? "It will disappear from public Yunipals collection views, but remain in your wallet and continue contributing to your collector score."
            : "It will return to public Yunipals collection views after the indexer updates."}
        </p>
        <p className="mt-3 rounded-2xl bg-line/35 px-4 py-3 text-xs font-semibold leading-relaxed text-ink/65">
          Your wallet will request an EIP-712 signature. Smart contract wallets
          are not supported yet.
        </p>

        {errorMessage && (
          <p
            className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-full border border-line px-5 py-3 text-sm font-bold text-ink transition hover:bg-line/35 disabled:cursor-wait disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white shadow-cta transition hover:opacity-90 disabled:cursor-wait disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            {pending && (
              <Loader2 aria-hidden="true" className="animate-spin" size={15} />
            )}
            {pending
              ? STAGE_LABELS[stage]
              : `${hidden ? "Hide" : "Unhide"} NFT`}
          </button>
        </div>
      </div>
    </div>
  );
}

import { Info, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { DialogSurface } from "@/components/ui/dialog";

export function IslandCollectionInfo() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="About island collections"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-lavender/20 hover:text-grape focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
      >
        <Info size={18} aria-hidden="true" />
      </button>
      {open && (
        <DialogSurface
          ref={dialog}
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <header className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-2xl">
              About island collections
            </h2>
            <button
              type="button"
              aria-label="Close island information"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender/20 text-muted transition hover:bg-lavender/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="mt-5 space-y-4 text-sm leading-relaxed text-muted">
            <p>
              Ethereum islands are the original collection. Base islands were
              airdropped from an Ethereum ownership snapshot, including eligible
              staked islands. Each original and its Base copy are separate NFTs
              and can belong to different wallets. Transferring one does not
              transfer the other.
            </p>
            <p>
              The revealed Base collection replaces the first Base airdrop.
              Replacement islands went to Base owners at snapshot block
              52,587,044. The old Base collection is retired from this browser.
            </p>
          </div>
        </DialogSurface>
      )}
    </>
  );
}

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { BoosterCardViewer } from "@/components/BoosterCardViewer";
import type { MonsterArtwork } from "@/lib/boosters";

export function BoosterCardLightbox({
  artwork,
  label,
  onClose
}: {
  artwork: MonsterArtwork;
  label: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="booster-card-lightbox m-auto h-dvh max-h-none w-screen max-w-none bg-ink p-4 text-white backdrop:bg-ink/90 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="font-display text-lg">
          {label}
        </h2>
        <button
          type="button"
          autoFocus
          aria-label="Close large card view"
          onClick={onClose}
          className="rounded-full border border-white/30 p-2 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyanx"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="mx-auto mt-2 max-w-4xl">
        <BoosterCardViewer artwork={artwork} variant="expanded" />
      </div>
    </dialog>,
    document.body
  );
}

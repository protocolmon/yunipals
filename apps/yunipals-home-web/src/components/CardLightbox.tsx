import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  BoosterCardViewer,
  type CardArtwork
} from "@/components/BoosterCardViewer";

export function CardLightbox({
  artwork,
  label,
  subject = "card",
  onClose
}: {
  artwork: CardArtwork;
  label: string;
  subject?: "card" | "pack";
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
        event.stopPropagation();
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
          aria-label={`Close large ${subject} view`}
          onClick={onClose}
          className="rounded-full border border-white/30 p-2 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyanx"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="mx-auto mt-2 max-w-4xl">
        <BoosterCardViewer
          artwork={artwork}
          variant="expanded"
          subject={subject}
        />
        {subject === "pack" && (
          <div className="mt-3 space-y-2 text-center text-sm text-lavender">
            <p className="motion-reduce:hidden">
              Move your pointer or drag to tilt. Use arrow keys when focused;
              Home resets the view.
            </p>
            <p className="hidden motion-reduce:block">
              Tilt is paused to respect your reduced-motion preference.
            </p>
            <a
              href={artwork.image ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-full px-4 py-2 font-bold underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyanx"
            >
              Open full-resolution image
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        )}
      </div>
    </dialog>,
    document.body
  );
}

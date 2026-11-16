import { forwardRef, type DialogHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

const dialogVariants = cva(
  "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-card border border-lavender/60 bg-white p-5 text-ink shadow-cardHover backdrop:bg-ink/50 backdrop:backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape sm:p-7",
  {
    variants: { size: { md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" } },
    defaultVariants: { size: "lg" }
  }
);

interface DialogSurfaceProps
  extends DialogHTMLAttributes<HTMLDialogElement>,
    VariantProps<typeof dialogVariants> {}

// Keep the native dialog lifecycle, focus trap and Escape handling with callers.
export const DialogSurface = forwardRef<HTMLDialogElement, DialogSurfaceProps>(
  ({ className, size, ...props }, ref) => (
    <dialog
      ref={ref}
      className={cn(dialogVariants({ size }), className)}
      {...props}
    />
  )
);
DialogSurface.displayName = "DialogSurface";

export const dialogButtonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-grape text-white hover:bg-grape/90",
        secondary:
          "border border-line bg-white text-muted hover:bg-lavender/20 hover:text-ink",
        destructive: "bg-red-700 text-white hover:bg-red-800"
      }
    },
    defaultVariants: { variant: "primary" }
  }
);

export function DialogHeader({
  id,
  title,
  eyebrow,
  onClose,
  busy = false
}: {
  id: string;
  title: ReactNode;
  eyebrow: string;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-grape">
          {eyebrow}
        </p>
        <h2 id={id} className="font-display text-2xl leading-tight text-ink">
          {title}
        </h2>
      </div>
      <button
        type="button"
        aria-label="Close review"
        disabled={busy}
        onClick={onClose}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender/20 text-muted transition-colors hover:bg-lavender/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

export function DialogDetails({
  children,
  label = "Transaction details"
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="group mt-5 rounded-2xl border border-line text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

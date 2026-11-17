import { cva } from "class-variance-authority";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Layers3,
  LoaderCircle,
  type LucideIcon
} from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TransactionTone = "pending" | "success" | "error" | "neutral";

export const transactionActionVariants = cva(
  "inline-flex max-w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-grape disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-lavender/40 text-grape hover:bg-lavender/70",
        secondary: "border border-line bg-white text-ink hover:bg-lavender/40"
      }
    },
    defaultVariants: { variant: "primary" }
  }
);

interface TransactionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  compact?: boolean;
}

export function TransactionLink({
  compact = false,
  children = "View transaction",
  className,
  ...props
}: TransactionLinkProps) {
  return (
    <a
      target="_blank"
      rel="noreferrer"
      {...props}
      className={cn(
        compact
          ? "inline-flex shrink-0 items-center justify-center rounded-full p-2.5 text-muted hover:bg-lavender/40 hover:text-grape focus-visible:ring-2 focus-visible:ring-grape"
          : transactionActionVariants(),
        className
      )}
    >
      {compact ? (
        <span className="sr-only">{children}</span>
      ) : (
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {children}
        </span>
      )}
      <ArrowUpRight
        size={compact ? 17 : 14}
        aria-hidden="true"
        className="shrink-0"
      />
    </a>
  );
}

export function TransactionHistory({
  title,
  count,
  status,
  icon: Icon = Layers3,
  open,
  onOpenChange,
  className,
  children
}: {
  title: string;
  count: number;
  status?: ReactNode;
  icon?: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className={cn(
        "group rounded-2xl border border-line bg-white/80",
        className
      )}
    >
      <summary
        onClick={(event) => {
          // Keep native disclosure semantics while avoiding queued toggle events
          // overwriting a newer open state (for example, a new pending receipt).
          event.preventDefault();
          onOpenChange(!open);
        }}
        className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape [&::-webkit-details-marker]:hidden"
      >
        <Icon size={18} className="shrink-0 text-grape" aria-hidden="true" />
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {count > 0 && (
            <span className="rounded-full bg-lavender/50 px-2 py-0.5 text-xs text-grape">
              {count}
            </span>
          )}
          {status && (
            <span role="status" className="text-xs font-medium text-muted">
              {status}
            </span>
          )}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="ml-auto shrink-0 text-muted transition group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-line px-5">{children}</div>
    </details>
  );
}

export function TransactionRow({
  as: Component = "div",
  title,
  status,
  tone = "neutral",
  icon,
  href,
  linkLabel = "View transaction",
  actions,
  children,
  className
}: {
  as?: "div" | "li";
  title: ReactNode;
  status?: ReactNode;
  tone?: TransactionTone;
  icon?: LucideIcon;
  href?: string;
  linkLabel?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon =
    icon ??
    (tone === "error"
      ? CircleAlert
      : tone === "pending"
        ? LoaderCircle
        : tone === "success"
          ? Check
          : Clock3);
  return (
    <Component
      className={cn(
        "flex flex-wrap items-center gap-3 py-4 text-sm",
        className
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          tone === "error"
            ? "bg-red-50 text-red-700"
            : tone === "success"
              ? "bg-mint/50 text-green-700"
              : "bg-lavender/35 text-grape"
        )}
      >
        <Icon
          size={20}
          aria-hidden="true"
          className={cn(
            !icon && tone === "pending" && "motion-safe:animate-spin"
          )}
        />
      </span>
      <div className="min-w-0 flex-1 break-words">
        <p className="font-bold text-ink">{title}</p>
        {status && (
          <div role="status" className="mt-0.5 text-xs text-muted">
            {status}
          </div>
        )}
      </div>
      {href && (
        <TransactionLink compact href={href} title={linkLabel}>
          {linkLabel}
        </TransactionLink>
      )}
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {actions}
        </div>
      )}
      {children && (
        <div className="w-full space-y-3 text-sm leading-relaxed text-muted">
          {children}
        </div>
      )}
    </Component>
  );
}

export function TransactionStatus({
  className,
  ...props
}: Omit<Parameters<typeof TransactionRow>[0], "as">) {
  return (
    <TransactionRow
      {...props}
      className={cn(
        "rounded-2xl border border-line bg-white/80 px-5",
        className
      )}
    />
  );
}

import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  transactionLabel,
  transactionPending,
  type PendingArenaTransaction
} from "@/lib/arenaTransactions";

export function ArenaLoading({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 text-sm font-semibold text-muted"
    >
      <LoaderCircle
        aria-hidden="true"
        size={16}
        className="shrink-0 motion-safe:animate-spin"
      />
      {label}
    </span>
  );
}

export function ArenaCardsLoading({
  count = 4,
  label = "Loading fighters"
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="grid grid-cols-2 gap-4 md:grid-cols-4"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="rounded-card border border-line bg-white p-4"
        >
          <div className="aspect-square rounded-card bg-line/60 motion-safe:animate-pulse" />
          <div className="mt-4 h-4 w-3/4 rounded bg-line motion-safe:animate-pulse" />
          <div className="mt-3 h-3 w-1/2 rounded bg-line/60 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function ArenaTransactionFeedback({
  operation,
  busy,
  onCheck
}: {
  operation: PendingArenaTransaction;
  busy: boolean;
  onCheck: () => void;
}) {
  const pending = transactionPending(operation);
  const delayed = operation.state === "delayed";
  return (
    <section
      aria-label="Transaction progress"
      aria-busy={pending && !delayed}
      className={cn(
        "my-5 rounded-card border border-line p-5",
        operation.state === "indexed" ? "bg-mint/20" : "bg-panel-base"
      )}
    >
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 font-semibold"
      >
        {pending && !delayed ? (
          <LoaderCircle
            size={18}
            aria-hidden="true"
            className="shrink-0 motion-safe:animate-spin"
          />
        ) : null}
        {transactionLabel(operation)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <a
          className="rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          href={`https://basescan.org/tx/${operation.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
        {pending ? (
          <button
            disabled={busy}
            onClick={onCheck}
            className="rounded-full border border-line bg-white px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-50"
          >
            {busy ? "Checking status…" : "Check status"}
          </button>
        ) : null}
      </div>
      {delayed ? (
        <p className="mt-3 text-sm text-muted">
          You can leave this page and check again later. Your saved transaction
          will be used.
        </p>
      ) : null}
    </section>
  );
}

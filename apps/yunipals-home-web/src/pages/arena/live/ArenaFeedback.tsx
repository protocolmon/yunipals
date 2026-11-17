import {
  TransactionStatus,
  transactionActionVariants
} from "@/components/ui/transaction";
import { useArenaDeployment } from "@/lib/arenaDeployment";
import { LoaderCircle } from "lucide-react";
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
  const deployment = useArenaDeployment();
  const pending = transactionPending(operation);
  const delayed = operation.state === "delayed";
  return (
    <TransactionStatus
      className="my-5"
      title="Arena transaction"
      status={transactionLabel(operation)}
      tone={
        operation.state === "failed"
          ? "error"
          : operation.state === "indexed"
            ? "success"
            : delayed
              ? "neutral"
              : "pending"
      }
      href={`https://basescan.org/tx/${operation.hash}`}
      actions={
        pending && (
          <button
            type="button"
            disabled={busy}
            onClick={onCheck}
            className={transactionActionVariants({ variant: "secondary" })}
          >
            {busy ? "Checking status…" : "Check status"}
          </button>
        )
      }
    >
      {operation.action.kind === "approval" && operation.state !== "failed" ? (
        <p className="mt-3 text-sm text-muted">
          Approval sets your spending limit; it does not enter a fighter or
          charge the entry fee. Entry needs a separate wallet transaction.
          {(operation.state === "indexed" || operation.approvalConfirmed) &&
          !busy
            ? ` Choose your fighter below and click Enter · ${deployment.entry} USDC to continue. Your approval will be reused.`
            : null}
        </p>
      ) : null}
      {pending && !delayed ? (
        <p className="mt-3 text-sm text-muted">
          We verify your transaction on Base and wait for its indexed result.
          This page updates automatically. You can leave and return; your
          transaction is saved.
        </p>
      ) : null}
      {delayed ? (
        <p className="mt-3 text-sm text-muted">
          You can leave this page and check again later. Your saved transaction
          will be used.
        </p>
      ) : null}
    </TransactionStatus>
  );
}

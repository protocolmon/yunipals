import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  TransactionHistory,
  TransactionRow,
  transactionActionVariants
} from "@/components/ui/transaction";
import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { portalTransactionPending } from "@/lib/portalTransactions";
import { environment } from "@/environment";

const dismissedStorageKey = "yunipals/portals/dismissed-activity/v1";

function readDismissedActivity(): string[] {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(dismissedStorageKey) ?? "[]"
    );
    return Array.isArray(value)
      ? value
          .filter((key): key is string => typeof key === "string")
          .slice(-200)
      : [];
  } catch {
    return [];
  }
}

export function PortalTransactionStatus() {
  const { tracker, transactions } = usePortalTransactions();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissedActivity);
  const dismissalKey = (id: string, state: string) =>
    `${tracker?.key}/${id}/${state}`;
  const dismiss = (id: string, state: string) => {
    const next = [...dismissed, dismissalKey(id, state)].slice(-200);
    setDismissed(next);
    try {
      sessionStorage.setItem(dismissedStorageKey, JSON.stringify(next));
    } catch {
      // Dismissal still works when browser storage is unavailable.
    }
  };
  const visible = transactions
    .filter(
      (value) =>
        portalTransactionPending(value) ||
        (Date.now() - value.createdAt < 3600000 &&
          !dismissed.includes(dismissalKey(value.id, value.state)))
    )
    .slice(-8)
    .reverse();
  const pendingCount = visible.filter(portalTransactionPending).length;
  const failedCount = visible.filter(
    (value) => value.state === "failed"
  ).length;
  const attentionKey = visible
    .filter((value) => value.state !== "indexed")
    .map(
      (value) =>
        `${value.id}:${value.state === "failed" ? "failed" : "pending"}`
    )
    .join(",");
  useEffect(() => {
    if (attentionKey) setHistoryOpen(true);
  }, [attentionKey]);
  useEffect(() => {
    if (!tracker) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const value of tracker.getSnapshot()) {
        if (stopped) return;
        // Keep recent indexed results under observation for reorgs as well.
        if (
          portalTransactionPending(value) ||
          Date.now() - value.createdAt < 3600000
        )
          await tracker.check(value.id, { background: true });
      }
      if (!stopped) timer = setTimeout(() => void check(), 5000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [tracker]);
  if (!visible.length) return null;
  const explorer =
    environment.portalChainId === 8453
      ? "https://basescan.org"
      : environment.portalChainId === 84532
        ? "https://sepolia.basescan.org"
        : null;
  return (
    <section
      aria-label="Saved portal transactions"
      className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6"
    >
      <TransactionHistory
        title="Your portal activity"
        count={visible.length}
        icon={Sparkles}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        status={[
          pendingCount > 0 ? `${pendingCount} pending` : null,
          failedCount > 0 ? `${failedCount} failed` : null
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <ul className="divide-y divide-line">
          {visible.map((value) => {
            const pending = portalTransactionPending(value);
            return (
              <TransactionRow
                as="li"
                key={value.id}
                title={value.label}
                status={value.message}
                tone={
                  value.state === "failed"
                    ? "error"
                    : pending
                      ? "pending"
                      : "success"
                }
                href={explorer ? `${explorer}/tx/${value.hash}` : undefined}
                linkLabel={`View ${value.label.toLowerCase()} transaction on BaseScan`}
                actions={
                  <>
                    {value.actionKey.startsWith("grade:") && (
                      <Link
                        className={transactionActionVariants()}
                        to={`/portals/cards/${value.actionKey.slice(6)}`}
                      >
                        Card history
                      </Link>
                    )}
                    {pending ? (
                      <button
                        type="button"
                        className={transactionActionVariants({
                          variant: "secondary"
                        })}
                        onClick={() => void tracker?.check(value.id)}
                      >
                        Check status
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={transactionActionVariants({
                          variant: "secondary"
                        })}
                        onClick={() => dismiss(value.id, value.state)}
                      >
                        Dismiss
                      </button>
                    )}
                  </>
                }
              />
            );
          })}
        </ul>
      </TransactionHistory>
    </section>
  );
}

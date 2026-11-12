import { useEffect } from "react";
import { Link } from "react-router-dom";
import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { portalTransactionPending } from "@/lib/portalTransactions";
import { environment } from "@/environment";

export function PortalTransactionStatus() {
  const { tracker, transactions } = usePortalTransactions();
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
          await tracker.check(value.id);
      }
      if (!stopped) timer = setTimeout(() => void check(), 5000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [tracker]);
  if (!transactions.length) return null;
  const visible = transactions
    .filter(
      (v) => portalTransactionPending(v) || Date.now() - v.createdAt < 3600000
    )
    .slice(-8);
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
      className="mx-auto mt-6 w-full max-w-6xl rounded-card border border-line bg-white p-4"
    >
      <h2 className="font-semibold">Your portal transactions</h2>
      <ul className="mt-3 space-y-3">
        {visible.map((value) => (
          <li
            key={value.id}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <strong>{value.label}</strong>
              <p role="status">{value.message}</p>
            </div>
            {explorer && (
              <a
                className="underline"
                href={`${explorer}/tx/${value.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction
              </a>
            )}
            {value.actionKey.startsWith("grade:") && (
              <Link
                className="underline"
                to={`/portals/cards/${value.actionKey.slice(6)}`}
              >
                Card history
              </Link>
            )}
            {portalTransactionPending(value) && (
              <button
                type="button"
                className="rounded-full border border-line px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2"
                onClick={() => void tracker?.check(value.id)}
              >
                Check status
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

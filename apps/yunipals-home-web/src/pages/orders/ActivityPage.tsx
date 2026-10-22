import { useId } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { useAnalyticsConnectModal } from "@/hooks/useAnalyticsConnectModal";
import { MarketActivity } from "@/components/marketplace/MarketActivity";
import { chainDetails } from "@/data/chains";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { shortAddress } from "@/lib/format";
import { activityViews, type ActivityView } from "@/lib/marketplace/activity";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import { cn } from "@/lib/utils";

const button =
  "rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink";
const views: Record<ActivityView, string> = {
  all: "All activity",
  sales: "Sales",
  received: "Received from sales"
};

function WalletActivity({ wallet }: { wallet: Address }) {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const view =
    activityViews.find((view) => view === params.get("view")) ?? "all";
  const chain =
    (Object.keys(marketplaceChains) as MarketplaceChain[]).find(
      (chain) => chain === params.get("chain")
    ) ?? "all";
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  }
  return (
    <>
      <p className="mt-3 break-all font-mono text-sm text-muted" title={wallet}>
        <span className="sm:hidden">{shortAddress(wallet)}</span>
        <span className="hidden sm:inline">{wallet}</span>
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/orders" className={button}>
          My orders
        </Link>
        <Link to={`/collector/${wallet}`} className={button}>
          My collection
        </Link>
        <Link to="/orders/recovery" className={button}>
          Order recovery
        </Link>
      </div>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Activity views" className="flex flex-wrap gap-2">
          {activityViews.map((name) => (
            <button
              type="button"
              key={name}
              aria-current={view === name ? "page" : undefined}
              onClick={() => filter("view", name)}
              className={cn(
                button,
                view === name && "border-ink bg-ink text-white"
              )}
            >
              {views[name]}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-1 text-sm font-bold">
          <label htmlFor={id}>Network</label>
          <select
            id={id}
            value={chain}
            onChange={(event) => filter("chain", event.target.value)}
            className="rounded-full border border-line bg-white px-4 py-2 focus-visible:ring-2 focus-visible:ring-ink"
          >
            <option value="all">All networks</option>
            {(Object.keys(marketplaceChains) as MarketplaceChain[]).map(
              (name) => (
                <option key={name} value={name}>
                  {chainDetails[name].label}
                </option>
              )
            )}
          </select>
        </div>
      </div>
      <MarketActivity
        key={`${wallet}:${chain}:${view}`}
        scope={{ kind: "wallet", wallet, chain, view }}
      />
    </>
  );
}

export function ActivityPage() {
  const { address } = useAccount();
  const { openConnectModal } = useAnalyticsConnectModal("activity");
  usePageMetadata(
    "My activity | Yunipals",
    "Review confirmed Yunipals sales and NFTs received through those sales."
  );
  return (
    <main className="mx-auto min-h-[65vh] max-w-5xl px-5 py-12 sm:px-8">
      <Link to="/" className="text-sm font-bold text-ethereum">
        Back to collection
      </Link>
      <h1 className="display mt-6 text-4xl text-ink">My activity</h1>
      {address ? (
        <WalletActivity
          key={getAddress(address)}
          wallet={getAddress(address)}
        />
      ) : (
        <>
          <p className="mt-4 text-sm text-muted">
            Connect your wallet to review sales and NFTs received from sales.
          </p>
          <button
            type="button"
            className={cn(button, "mt-5")}
            onClick={openConnectModal}
          >
            Connect wallet
          </button>
        </>
      )}
    </main>
  );
}

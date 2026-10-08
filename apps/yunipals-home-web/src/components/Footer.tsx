import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import { ChainLogo } from "@/components/ui/ChainLogo";
import { environment } from "@/environment";
import { useAnalyticsConsent } from "@/providers/AnalyticsConsentProvider";

export function Footer({
  onTradingInformation,
  exomonView = false
}: {
  onTradingInformation: () => void;
  exomonView?: boolean;
}) {
  const { openSettings } = useAnalyticsConsent();
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-4 py-10 sm:flex-row sm:items-end">
        <div className="flex items-center gap-3">
          <img
            src="/images/yunipals-logo.webp"
            alt=""
            width={192}
            height={192}
            loading="lazy"
            className="h-12 w-12"
          />
          <div>
            <span className="display text-2xl text-ink">Yunipals</span>
            <p className="mt-1.5 text-sm font-medium text-muted">
              A growing universe of collectible Yunis.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:justify-end">
            {!exomonView && (
              <button
                type="button"
                onClick={onTradingInformation}
                className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
              >
                Buying and selling information
              </button>
            )}
            <Link
              to="/terms"
              className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Terms of Use
            </Link>
            <Link
              to="/privacy"
              className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Privacy Notice
            </Link>
            <button
              type="button"
              onClick={openSettings}
              className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Analytics settings
            </button>
            {environment.production && (
              <a
                href="/THIRD_PARTY_LICENSES.txt"
                className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
              >
                Software licenses
              </a>
            )}
          </div>
          {!exomonView && (
            <a
              href="https://opensea.io/collection/yunipals-islands"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4 sm:self-end"
            >
              Islands · Grassland Archipelago on OpenSea
              <ArrowUpRight aria-hidden="true" className="shrink-0" size={16} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {exomonView ? (
            <p className="text-xs font-semibold text-muted">
              Exomon · Solana Mainnet
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
              <span
                className="inline-flex items-center gap-2"
                aria-hidden="true"
              >
                <ChainLogo
                  chainId="ethereum"
                  className="h-4 w-4 text-ethereum"
                />
                <ChainLogo chainId="base" className="h-4 w-4 text-basechain" />
                <ChainLogo chainId="polygon" className="h-4 w-4 text-polygon" />
                <ChainLogo chainId="bnb" className="h-4 w-4 text-bnbchain" />
                {environment.exomonEnabled && (
                  <ChainLogo chainId="solana" className="h-4 w-4 text-grape" />
                )}
              </span>
              <span>
                {environment.exomonEnabled
                  ? "Ethereum, Base, Polygon, BNB Chain & Solana"
                  : "Ethereum, Base, Polygon & BNB Chain"}
              </span>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

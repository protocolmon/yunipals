import { Link } from "react-router-dom";

import { ChainLogo } from "@/components/ui/ChainLogo";
import { environment } from "@/environment";

export function Footer({
  onTradingInformation,
  exomonView = false
}: {
  onTradingInformation: () => void;
  exomonView?: boolean;
}) {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-4 py-6 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <img
            src="/images/yunipals-logo.webp"
            alt=""
            width={192}
            height={192}
            loading="lazy"
            className="h-10 w-10"
          />
          <div>
            <span className="display text-xl text-ink">Yunipals</span>
            <p className="mt-1 text-xs font-medium text-muted">
              A growing universe of collectible Yunis.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex flex-wrap gap-x-4 gap-y-2 md:justify-end">
            <Link
              to="/brandkit"
              className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Brandkit
            </Link>
            <Link
              to="/contracts"
              className="rounded-lg text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Contracts
            </Link>
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
          </div>
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

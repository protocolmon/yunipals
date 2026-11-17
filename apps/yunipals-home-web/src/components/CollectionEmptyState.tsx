import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import type { CollectionEdition } from "@/lib/collectionEdition";
import { cn } from "@/lib/utils";

const collectionLabels = {
  og: "OG Collection",
  airdrop: "OG Airdrop",
  tcg: "TCG Collection"
};

export function CollectionEmptyState({
  edition,
  title,
  description,
  action
}: {
  edition: CollectionEdition | "airdrop";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] overflow-hidden rounded-card border border-lavender/50 bg-white shadow-card">
      <div className="relative min-h-52 overflow-hidden bg-panel-polygon">
        <img
          src={
            edition === "tcg"
              ? "/images/boosters/yunipals-pack-v1.png"
              : edition === "airdrop"
                ? "/images/yunipals-base-banner.webp"
                : "/images/yunipals-ethereum-banner.webp"
          }
          alt=""
          width={edition === "tcg" ? 160 : 1920}
          height={edition === "tcg" ? 240 : 823}
          loading="lazy"
          className={cn(
            "absolute inset-0 h-full w-full",
            edition === "tcg"
              ? "object-contain p-5 drop-shadow-lg"
              : "object-cover"
          )}
        />
      </div>
      <div className="flex flex-col items-start justify-center p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-grape">
          {collectionLabels[edition]}
        </p>
        <h3 className="mt-3 text-balance font-display text-2xl leading-tight text-ink">
          {title}
        </h3>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          {description}
        </p>
        <div className="mt-6">
          {action ?? (
            <Link
              to={`/?edition=${edition}#collection`}
              className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full bg-grape px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-grape/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
            >
              Explore {collectionLabels[edition]}
              <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

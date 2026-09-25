import { Sparkles, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { TokenArtwork } from "@/components/TokenArtwork";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { formatDecimal } from "@/lib/format";
import {
  getDisplayedRarity,
  getTokenAttribute,
  type YunipalToken
} from "@/lib/yunipalsIndexer";

type TokenCardProps = {
  token: YunipalToken;
  eager?: boolean;
  action?: ReactNode;
  market?: ReactNode;
};

export function TokenCard({ token, eager, action, market }: TokenCardProps) {
  const type = getTokenAttribute(token, "Type");
  const rarity = getDisplayedRarity(token);
  const special = getTokenAttribute(token, "Special");
  const glitter = getTokenAttribute(token, "Glitter");
  const hasGlitter =
    typeof glitter === "string" && glitter.toLowerCase() !== "none";

  return (
    <article className="group relative overflow-hidden rounded-card border border-line bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-cardHover">
      <Link
        to={`/collection/${token.chain}/${token.tokenId}`}
        className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-badge"
        aria-label={`View ${token.name || `Yunipal ${token.tokenId}`}`}
      >
        <div className="relative aspect-square overflow-hidden bg-lavender/25">
          <TokenArtwork
            src={token.image}
            alt={token.name || `Yunipal #${token.tokenId}`}
            eager={eager}
            className="transition duration-500 group-hover:scale-[1.035]"
          />
          <ChainBadge
            chainId={token.chain}
            className="absolute left-2.5 top-2.5 px-2.5 py-1"
          />
        </div>
        <div className="p-4">
          <div className="flex flex-col items-start gap-2">
            <div className="w-full min-w-0">
              <p className="truncate text-sm font-extrabold text-ink">
                {token.name || "Unknown Yunipal"}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted">
                #{token.tokenId}
              </p>
            </div>
            {rarity !== null && (
              <span className="shrink-0 rounded-full bg-badge/10 px-2 py-1 text-[11px] font-bold text-badge">
                {formatDecimal(rarity, 1)} RP
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {typeof type === "string" && (
              <span className="rounded-full bg-line/60 px-2 py-1 text-[11px] font-semibold text-ink/65">
                {type}
              </span>
            )}
            {special === "Yes" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-grape/10 px-2 py-1 text-[11px] font-bold text-grape">
                <Star aria-hidden="true" size={10} /> Special
              </span>
            )}
            {hasGlitter && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyanx/15 px-2 py-1 text-[11px] font-bold text-bluex">
                <Sparkles aria-hidden="true" size={10} /> {glitter}
              </span>
            )}
          </div>
        </div>
      </Link>
      {market && <div className="border-t border-line p-4">{market}</div>}
      {action && (
        <div className="absolute right-2.5 top-2.5 z-10">{action}</div>
      )}
    </article>
  );
}

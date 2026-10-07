import { Link } from "react-router-dom";

import { TokenArtwork } from "@/components/TokenArtwork";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { islandDetailHref, type IslandToken } from "@/lib/islandsIndexer";

export function IslandCard({
  token,
  eager
}: {
  token: IslandToken;
  eager?: boolean;
}) {
  const name = token.metadata?.name || `${token.edition} Island`;
  return (
    <article className="group overflow-hidden rounded-card border border-line bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-cardHover">
      <Link
        to={islandDetailHref(token.tokenId)}
        aria-label={`View ${name} #${token.tokenId}`}
        className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum"
      >
        <div className="relative aspect-square overflow-hidden bg-mint/25">
          <TokenArtwork
            src={token.metadata?.image || null}
            alt={`${name} #${token.tokenId}`}
            eager={eager}
            className="transition duration-500 group-hover:scale-[1.035]"
          />
          <ChainBadge
            chainId="ethereum"
            className="absolute left-2.5 top-2.5 px-2.5 py-1"
          />
        </div>
        <div className="p-4">
          <p className="truncate text-sm font-extrabold text-ink">{name}</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            #{token.tokenId}
          </p>
          <span className="mt-3 inline-flex rounded-full bg-mint/35 px-2.5 py-1 text-[11px] font-bold text-ink">
            {token.edition}
          </span>
          {token.staking?.status === "staked" && (
            <span className="ml-2 mt-3 inline-flex rounded-full bg-lavender/40 px-2.5 py-1 text-[11px] font-bold text-ink">
              Staked
            </span>
          )}
          {token.staking?.status === "unverified" && (
            <span className="mt-2 block text-xs text-muted">
              Staking verification pending
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}

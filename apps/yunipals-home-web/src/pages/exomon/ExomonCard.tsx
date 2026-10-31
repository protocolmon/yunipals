import { Link } from "react-router-dom";

import { TokenArtwork } from "@/components/TokenArtwork";
import {
  TokenOriginBadge,
  useTokenVersion,
  versionReferenceLabel
} from "@/components/TokenVersions";
import { formatDecimal, shortAddress } from "@/lib/format";
import type { ExomonToken } from "@/lib/solanaIndexer";

export function ExomonCard({ token }: { token: ExomonToken }) {
  const info = useTokenVersion(token);
  return (
    <article className="overflow-hidden rounded-card border border-line bg-white shadow-sm transition hover:shadow-lg">
      <Link
        to={`/collection/solana/${token.tokenId}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-badge"
      >
        <div className="aspect-square overflow-hidden bg-lavender/20">
          <TokenArtwork src={token.image} alt={token.name ?? "Exomon"} />
        </div>
        <div className="space-y-2 p-4">
          <span className="inline-flex rounded-full bg-sky/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink">
            Solana
          </span>
          <h3
            className="truncate text-base font-extrabold text-ink"
            title={token.name ?? token.tokenId}
          >
            {token.name ?? "Exomon"}
          </h3>
          <TokenOriginBadge info={info} />
          <p className="text-xs font-semibold text-muted">
            Rarity{" "}
            {token.rarityPointsCapped
              ? formatDecimal(token.rarityPointsCapped)
              : "—"}
          </p>
        </div>
      </Link>
      {info && (
        <div className="border-t border-line px-4 py-3 text-xs">
          {info.versions
            .filter((v) => v.chain !== "solana" || v.tokenId !== token.tokenId)
            .map((v) => (
              <Link
                key={`${v.chain}:${v.tokenId}`}
                to={`/collection/${v.chain}/${v.tokenId}`}
                className="block rounded py-1 font-bold text-badge focus-visible:ring-2 focus-visible:ring-badge"
              >
                View {versionReferenceLabel(v)}
                {v.unavailable
                  ? " · Ownership unavailable"
                  : v.burned
                    ? " · Burned"
                    : ""}
              </Link>
            ))}
        </div>
      )}
      <div className="border-t border-line px-4 py-3 text-xs font-medium text-muted">
        {token.burned ? (
          "Burned"
        ) : token.owner ? (
          <Link
            to={`/collector/solana/${token.owner}`}
            className="hover:text-badge hover:underline"
          >
            Owner {shortAddress(token.owner)}
          </Link>
        ) : (
          "Owner unavailable"
        )}
      </div>
    </article>
  );
}

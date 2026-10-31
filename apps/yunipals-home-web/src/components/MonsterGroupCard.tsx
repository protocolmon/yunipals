import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TokenArtwork } from "@/components/TokenArtwork";
import {
  TokenOriginBadge,
  versionReferenceLabel
} from "@/components/TokenVersions";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { monsterAssetKey, type MonsterGroup } from "@/lib/monsterVersions";
import { getDisplayedRarity, type YunipalToken } from "@/lib/yunipalsIndexer";
import { formatDecimal, shortAddress } from "@/lib/format";

export function MonsterGroupCard({
  group,
  eager,
  collector,
  actionForVersion
}: {
  group: MonsterGroup;
  eager?: boolean;
  collector?: "you" | "collector";
  actionForVersion?: (token: YunipalToken) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const representative = group.members[0]!;
  const rarity = getDisplayedRarity(representative);
  const related =
    representative.versionInfo?.versions.filter(
      (v) =>
        !group.members.some((m) => monsterAssetKey(m) === monsterAssetKey(v))
    ) ?? [];
  const count = group.members.length + related.length;
  return (
    <article className="overflow-hidden rounded-card border border-line bg-white shadow-card">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((v) => !v)}
        className="block w-full rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum"
      >
        <div className="aspect-square overflow-hidden bg-lavender/25">
          <TokenArtwork
            src={representative.image}
            alt={representative.name || `Yunipal #${representative.tokenId}`}
            eager={eager}
          />
        </div>
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(group.members.map((m) => m.chain))].map((chain) => (
              <ChainBadge key={chain} chainId={chain} variant="soft" />
            ))}
          </div>
          <p className="text-sm font-extrabold text-ink">
            {representative.name || "Yunipal"}
          </p>
          {rarity !== null && (
            <p className="text-xs text-muted">
              {formatDecimal(rarity, 1)} RP · shown version
            </p>
          )}
          <p className="text-sm font-bold text-ethereum">
            {expanded ? "Hide" : "View"} {count} version{count === 1 ? "" : "s"}
          </p>
          {collector && (
            <p className="text-xs text-muted">
              {collector === "you" ? "You own" : "Collector owns"}{" "}
              {group.members.length} matching version
              {group.members.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </button>
      <div id={id} hidden={!expanded} className="border-t border-line p-4">
        <ul className="space-y-4">
          {group.members.map((m) => (
            <li key={monsterAssetKey(m)} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <ChainBadge chainId={m.chain} variant="soft" />
                <TokenOriginBadge info={m.versionInfo} />
              </div>
              {m.image !== representative.image && (
                <div className="h-16 w-16 overflow-hidden rounded-lg">
                  <TokenArtwork
                    src={m.image}
                    alt={m.name || `Version #${m.tokenId}`}
                  />
                </div>
              )}
              <Link
                to={`/collection/${m.chain}/${m.tokenId}`}
                className="block rounded text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                {m.chain === "solana"
                  ? `View mint ${shortAddress(m.tokenId)}`
                  : `View #${m.tokenId}`}
              </Link>
              {getDisplayedRarity(m) !== null && (
                <p className="text-xs text-muted">
                  {formatDecimal(getDisplayedRarity(m)!, 1)} RP
                </p>
              )}
              {m.chain !== "solana" && actionForVersion?.(m)}
            </li>
          ))}
        </ul>
        {related.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            <p className="text-xs text-muted">
              Related versions outside these results
            </p>
            {related.map((v) => (
              <Link
                key={monsterAssetKey(v)}
                to={`/collection/${v.chain}/${v.tokenId}`}
                className="block rounded text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
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
        {count > 1 && (
          <p className="mt-4 text-xs text-muted">
            Each version is a separate NFT. Buying or transferring one does not
            include the other.
          </p>
        )}
      </div>
    </article>
  );
}

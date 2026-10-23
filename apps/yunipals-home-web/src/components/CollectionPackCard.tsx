import { Link } from "react-router-dom";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";

import { ChainBadge } from "@/components/ui/ChainBadge";
import { packGridTraits } from "@/lib/boosterCollectionGrid";
import { BoosterArtwork } from "@/pages/boosters/BoosterCollection";

export function CollectionPackCard({ monster }: { monster: BoosterMonster }) {
  const traits = packGridTraits(monster);
  return (
    <article
      className="group relative overflow-hidden rounded-card border border-line bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-cardHover"
      data-collection-contract={monster.collection}
    >
      <Link
        to={`/monsters/${monster.collection}/${monster.tokenId}`}
        className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-badge"
        aria-label={`View ${traits.Type} #${monster.tokenId}`}
      >
        <div className="relative aspect-square overflow-hidden bg-lavender/25">
          <div className="mx-auto h-full w-2/3">
            <BoosterArtwork
              uri={monster.metadataUri}
              label={`${traits.Type} #${monster.tokenId}`}
            />
          </div>
          <ChainBadge
            chainId="base"
            className="absolute left-2.5 top-2.5 px-2.5 py-1"
          />
        </div>
        <div className="p-4">
          <p className="truncate text-sm font-extrabold text-ink">
            {traits.Type}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted">
            #{monster.tokenId}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-line/60 px-2 py-1 text-[11px] font-semibold text-ink/65">
              {traits.Color}
            </span>
            <span className="rounded-full bg-line/60 px-2 py-1 text-[11px] font-semibold text-ink/65">
              {traits.Horn}
            </span>
            {traits.Glitter === "Yes" && (
              <span className="rounded-full bg-cyanx/15 px-2 py-1 text-[11px] font-bold text-bluex">
                Glitter
              </span>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}

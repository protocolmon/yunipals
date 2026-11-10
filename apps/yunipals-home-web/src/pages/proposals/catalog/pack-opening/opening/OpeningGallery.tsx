import { type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";

import { environment } from "@/environment";
import { boosterQueryKey, fetchMonsterArtwork } from "@/lib/boosters";
import { cn } from "@/lib/utils";
import { OpeningLabStage } from "./OpeningLabStage";
import type { OpeningVariant } from "./variants";
import "./opening-lab.css";

// The same sample cards the public "Try the opening" preview uses.
const SAMPLE_CARDS = [81, 80, 83].map(
  (id) =>
    `${environment.yunipalsIndexerUrl}/v1/boosters/art/base-mainnet-standard-v1/${id}.json`
);

export type OpeningGalleryGroup = {
  title: string;
  note: string;
  variants: readonly OpeningVariant[];
};

/**
 * Tiles for a set of opening styles plus the full-screen player. The open
 * style lives in the `style` search parameter, so a style can be linked to.
 */
export function OpeningGallery({
  groups
}: {
  groups: readonly OpeningGalleryGroup[];
}) {
  const OPENING_VARIANTS = groups.flatMap((group) => group.variants);
  const [search, setSearch] = useSearchParams();
  const active = OPENING_VARIANTS.findIndex(
    (variant) => variant.id === search.get("style")
  );
  const cards = useQueries({
    queries: SAMPLE_CARDS.map((uri) => ({
      queryKey: [...boosterQueryKey, "artwork", uri],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchMonsterArtwork(uri, signal),
      staleTime: Infinity
    }))
  });
  const ready = cards.flatMap((query) => (query.data ? [query.data] : []));
  const open = (index: number | null) =>
    setSearch(
      index === null
        ? {}
        : {
            style:
              OPENING_VARIANTS[
                (index + OPENING_VARIANTS.length) % OPENING_VARIANTS.length
              ].id
          },
      { replace: true }
    );

  return (
    <>
      {groups.map((round) => (
        <section key={round.title} className="mt-12">
          <h2 className="font-display text-2xl text-ink">{round.title}</h2>
          <p className="mt-2 max-w-2xl text-muted">{round.note}</p>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {round.variants.map((variant) => {
              const index = OPENING_VARIANTS.indexOf(variant);
              return (
                <li key={variant.id}>
                  <button
                    type="button"
                    onClick={() => open(index)}
                    className="olab-tile group flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-white text-left shadow-card transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                    style={
                      {
                        "--olab-bg": variant.background,
                        "--olab-accent": variant.palette[0]
                      } as CSSProperties
                    }
                  >
                    <span className="olab-tile-art relative flex w-full items-center justify-center py-8">
                      <img
                        src="/images/boosters/yunipals-pack-v1.png"
                        alt=""
                        width={1024}
                        height={1536}
                        draggable={false}
                        className="w-24"
                      />
                      <span
                        className={cn(
                          "absolute left-4 top-3 text-xs font-extrabold tracking-widest",
                          variant.theme === "light"
                            ? "text-ink/70"
                            : "text-white/80"
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="absolute bottom-3 right-3 flex gap-1">
                        {variant.palette.map((color) => (
                          <span
                            key={color}
                            className="h-2.5 w-2.5 rounded-full ring-1 ring-white/40"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="flex flex-1 flex-col p-5">
                      <span className="font-display text-lg text-ink">
                        {variant.name}
                      </span>
                      <span className="mt-2 flex-1 text-sm text-muted">
                        {variant.tagline}
                      </span>
                      <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-grape">
                        <PlayCircle size={18} aria-hidden="true" />
                        Play
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {active >= 0 && (
        <OpeningLabStage
          variant={OPENING_VARIANTS[active]}
          index={active}
          total={OPENING_VARIANTS.length}
          cards={ready}
          onPrevious={() => open(active - 1)}
          onNext={() => open(active + 1)}
          onClose={() => open(null)}
        />
      )}
    </>
  );
}

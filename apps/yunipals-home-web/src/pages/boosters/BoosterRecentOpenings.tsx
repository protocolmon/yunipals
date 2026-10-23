import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { packGridTraits } from "@/lib/boosterCollectionGrid";
import { fetchRecentBoosterOpenings } from "@/lib/boosterRecentOpenings";
import { boosterAddresses, boosterQueryKey } from "@/lib/boosters";
import { formatInteger, formatUpdatedAt, shortAddress } from "@/lib/format";

import { BoosterArtwork } from "./BoosterCollection";

export function BoosterRecentOpenings() {
  const deployment = boosterAddresses();
  const query = useQuery({
    queryKey: [...boosterQueryKey, "recent-openings", deployment?.engine],
    queryFn: ({ signal }) => fetchRecentBoosterOpenings(signal),
    enabled: deployment !== null,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1
  });
  const items = query.data?.items ?? [];
  const scroller = useRef<HTMLUListElement>(null);
  const carouselId = useId();
  const [navigation, setNavigation] = useState({
    previous: false,
    next: false
  });
  const updateNavigation = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const previous = element.scrollLeft > 2;
    const next =
      element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
    setNavigation((current) =>
      current.previous === previous && current.next === next
        ? current
        : { previous, next }
    );
  }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    updateNavigation();
    const observer = new ResizeObserver(updateNavigation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length, updateNavigation]);
  function move(direction: -1 | 1) {
    const element = scroller.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(240, element.clientWidth * 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth"
    });
  }
  if (!deployment) return null;
  return (
    <section
      aria-labelledby="booster-recent-heading"
      aria-roledescription="carousel"
      className="border-b border-line bg-white px-4 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-grape">
              Fresh from the packs
            </p>
            <h2
              id="booster-recent-heading"
              className="font-display text-2xl text-ink sm:text-3xl"
            >
              Recent openings
            </h2>
            <p className="mt-3 text-muted">
              The latest reveals from booster packs and daily packs.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/?edition=tcg#collection"
              className="rounded-full px-3 py-2 text-sm font-bold text-grape underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
            >
              View collection
            </Link>
            {items.length > 1 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous openings"
                  aria-controls={carouselId}
                  disabled={!navigation.previous}
                  onClick={() => move(-1)}
                  className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-grape transition hover:border-grape/40 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                >
                  <ArrowLeft size={19} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next openings"
                  aria-controls={carouselId}
                  disabled={!navigation.next}
                  onClick={() => move(1)}
                  className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-grape transition hover:border-grape/40 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                >
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
        {query.isPending && (
          <div
            role="status"
            aria-label="Loading recent openings"
            className="mt-7 flex gap-5 overflow-hidden"
          >
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-96 w-60 shrink-0 animate-pulse rounded-card bg-lavender/20 sm:w-64"
              />
            ))}
          </div>
        )}
        {query.error && (
          <p role="alert" className="mt-6 text-sm text-muted">
            Recent openings are temporarily unavailable.{" "}
            <button
              type="button"
              className="rounded font-bold text-grape underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </p>
        )}
        {!query.isPending && !query.error && !items.length && (
          <div className="mt-7 rounded-card border border-dashed border-grape/20 bg-lavender/10 p-8 text-center">
            <Sparkles
              size={26}
              aria-hidden="true"
              className="mx-auto mb-3 text-grape"
            />
            <p className="font-bold text-ink">
              The next reveal could be yours.
            </p>
            <p className="mt-2 text-sm text-muted">
              Newly opened packs will appear here.
            </p>
          </div>
        )}
        {items.length > 0 && (
          <ul
            id={carouselId}
            ref={scroller}
            tabIndex={0}
            aria-label="Recently opened packs"
            onScroll={updateNavigation}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(event.key === "ArrowLeft" ? -1 : 1);
              }
            }}
            className="mt-7 flex snap-x snap-mandatory gap-5 overflow-x-auto rounded-card pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            {items.map((item, index) => {
              const monster = item.monster;
              const traits = packGridTraits(monster);
              const revealedAt = new Date(
                Number(item.revealedAt) * 1000
              ).toISOString();
              return (
                <li
                  key={item.requestKey}
                  aria-roledescription="slide"
                  aria-label={`Opening ${index + 1} of ${items.length}`}
                  className="w-60 shrink-0 snap-start sm:w-64"
                >
                  <article className="overflow-hidden rounded-card border border-line bg-white shadow-card">
                    <Link
                      to={`/monsters/${monster.collection}/${monster.tokenId}`}
                      aria-label={`View ${traits.Type} #${monster.tokenId}`}
                      className="block bg-lavender/15 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                    >
                      <div className="aspect-[2/3]">
                        <BoosterArtwork
                          uri={monster.metadataUri}
                          label={`${traits.Type} #${monster.tokenId}`}
                        />
                      </div>
                    </Link>
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2 text-xs font-bold">
                        <span className="text-grape">
                          {item.opening ? "Booster pack" : "Daily pack"}
                        </span>
                        <span className="rounded-full bg-lavender/25 px-2.5 py-1 text-ink">
                          {formatInteger(item.quantity)}{" "}
                          {item.quantity === 1 ? "pull" : "pulls"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-extrabold text-ink">
                        {traits.Type}{" "}
                        <span className="font-semibold text-muted">
                          #{monster.tokenId}
                        </span>
                      </h3>
                      <p className="mt-1 text-xs font-medium text-muted">
                        {traits.Color} · {traits.Horn}
                        {traits.Glitter === "Yes" ? " · Glitter" : ""}
                        {monster.burned ? " · Burned" : ""}
                      </p>
                      <p className="mt-3 text-xs text-muted">
                        Collected by{" "}
                        <Link
                          to={`/collector/${monster.mintedTo}`}
                          title={monster.mintedTo}
                          className="rounded font-semibold text-ink hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
                        >
                          {shortAddress(monster.mintedTo)}
                        </Link>
                      </p>
                      <time
                        dateTime={revealedAt}
                        title={new Date(revealedAt).toLocaleString()}
                        className="mt-1 block text-xs text-muted"
                      >
                        {formatUpdatedAt(revealedAt).replace(
                          /^Updated/,
                          "Revealed"
                        )}
                      </time>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

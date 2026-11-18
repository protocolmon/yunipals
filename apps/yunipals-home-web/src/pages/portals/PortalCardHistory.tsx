import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Sparkles } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { fetchPortalCard, portalImage } from "@/lib/portals";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";
import { PortalSpellProgress } from "./PortalSpellProgress";

export function PortalCardHistory() {
  const { tokenId = "" } = useParams();
  const [before, setBefore] = useState<string | undefined>();
  const query = useQuery({
    queryKey: ["portals", "card", tokenId, before],
    queryFn: () => fetchPortalCard(tokenId, before),
    enabled: /^[1-9][0-9]*$/.test(tokenId),
    refetchInterval: 5000
  });
  const card = query.data;
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link to="/grading" className="text-sm font-bold text-grape underline">
        Back to grading
      </Link>
      <h1 className="mt-5 font-display text-3xl">Card #{tokenId}</h1>
      <p className="mt-3 text-muted">
        Its original artwork and every completed spell stay with this NFT.
      </p>
      {query.isPending ? (
        <div
          role="status"
          className="mt-8 h-64 animate-pulse rounded-card bg-lavender/25"
        >
          <span className="sr-only">Loading artwork history…</span>
        </div>
      ) : query.error ? (
        <p role="alert" className="mt-8 text-muted">
          {query.error.message}
        </p>
      ) : (
        card && (
          <>
            {(card.pending !== "0" || card.publicationPending) && (
              <PortalSpellProgress key={card.pending} card={card} />
            )}
            <div className="mt-8 space-y-6">
              {[...card.history].reverse().map((attempt, index) => {
                const publication = card.publication.find(
                  (p) => p.requestId === attempt.id
                );
                return (
                  <article
                    key={attempt.id}
                    className="overflow-hidden rounded-card border border-line bg-white shadow-card md:grid md:grid-cols-2"
                  >
                    <div className="flex items-center justify-center bg-gradient-to-br from-lavender/30 via-sky/10 to-grape/5 p-6 sm:p-8">
                      {publication?.result.slab ? (
                        <a
                          href={publication.result.slab.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-full max-w-72 rounded-2xl transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape motion-safe:hover:-translate-y-1"
                          aria-label={`Open graded slab for artwork version ${publication.result.slab.version}`}
                        >
                          <img
                            className="h-auto w-full drop-shadow-xl"
                            src={portalImage(publication.result.slab.uri)}
                            alt={`Graded Yunipals card #${tokenId}, artwork version ${publication.result.slab.version}`}
                            width={720}
                            height={1360}
                            loading={index === 0 ? "eager" : "lazy"}
                          />
                        </a>
                      ) : (
                        <p
                          role="status"
                          className="rounded-2xl bg-lavender/20 p-4 text-sm text-muted"
                        >
                          This artwork is temporarily unavailable.
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 self-center p-6 sm:p-8">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                        {!before && index === 0
                          ? "Latest transformation"
                          : "From your card’s history"}
                      </p>
                      <h2 className="mt-3 font-display text-2xl">
                        Artwork version{" "}
                        {(BigInt(attempt.request.artVersion) + 1n).toString()}
                      </h2>
                      <p className="mt-2 text-sm text-muted">
                        Portal #{attempt.request.portalId} · Round{" "}
                        {attempt.request.roundId}
                      </p>
                      <div className="mt-6 flex items-baseline gap-2 border-b border-line pb-5">
                        <span className="font-display text-5xl text-grape">
                          {(
                            attempt.result.scores.reduce(
                              (sum, score) => sum + score,
                              0
                            ) / 4
                          ).toFixed(1)}
                        </span>
                        <span className="text-sm text-muted">
                          / 100 overall grade
                        </span>
                      </div>
                      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                        {["Creativity", "Harmony", "Craft", "Impact"].map(
                          (label, i) => (
                            <div key={label}>
                              <dt className="text-muted">{label}</dt>
                              <dd className="mt-1 text-xl font-bold">
                                {attempt.result.scores[i]}{" "}
                                <span className="text-xs font-normal text-muted">
                                  / 100
                                </span>
                              </dd>
                            </div>
                          )
                        )}
                      </dl>
                      {attempt.result.copied && (
                        <p className="mt-4 text-sm font-semibold text-grape">
                          Creativity was reduced for a copied spell.
                        </p>
                      )}
                      {publication && (
                        <details className="mt-6 border-t border-line pt-5 text-sm">
                          <summary className="cursor-pointer rounded font-semibold text-grape focus-visible:ring-2 focus-visible:ring-grape">
                            Spell and grading notes
                          </summary>
                          <p className="mt-3 whitespace-pre-wrap break-words">
                            {publication.spell}
                          </p>
                          {publication.result.gradingReason && (
                            <p className="mt-3 text-muted">
                              {publication.result.gradingReason}
                            </p>
                          )}
                          {publication.result.originality?.reason && (
                            <p className="mt-3 text-muted">
                              {publication.result.originality.reason}
                            </p>
                          )}
                          {publication.result.originality?.sources?.map(
                            (source) => (
                              <blockquote
                                key={source.requestId}
                                className="mt-3 border-l-2 border-lavender pl-3"
                              >
                                <p className="font-semibold">
                                  Earlier spell #{source.requestId}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap break-words">
                                  {source.excerpt}
                                </p>
                                <p className="mt-1 text-muted">
                                  {source.reason}
                                </p>
                              </blockquote>
                            )
                          )}
                        </details>
                      )}
                      {publication?.result.slab && (
                        <a
                          href={publication.result.slab.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-bold transition-colors hover:bg-lavender/20 focus-visible:ring-2 focus-visible:ring-grape"
                        >
                          View full-size card
                          <ArrowUpRight
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <details
              open={card.historyCount === "0"}
              className="group mt-8 rounded-card border border-line bg-lavender/10"
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 rounded-card p-4 focus-visible:ring-2 focus-visible:ring-grape [&::-webkit-details-marker]:hidden sm:px-6">
                <img
                  className="h-20 w-14 shrink-0 object-contain"
                  src={portalImage(card.originalArtwork.uri)}
                  alt=""
                  width={56}
                  height={80}
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold">Original artwork</h2>
                  <p className="mt-1 text-sm text-muted">
                    Where it all began. Always part of your card.
                  </p>
                </div>
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-grape transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-t border-line p-6 text-center">
                <img
                  className="mx-auto max-h-80 w-full max-w-56 object-contain"
                  src={portalImage(card.originalArtwork.uri)}
                  alt={`Original artwork for card #${tokenId}`}
                  width={224}
                  height={320}
                  loading="lazy"
                />
                <p className="mt-4 text-sm text-muted">
                  Preserved through every transformation.
                </p>
              </div>
            </details>
            <div className="mt-8 flex flex-wrap gap-3">
              {card.nextBefore && (
                <button
                  className={boosterButtonClass}
                  onClick={() => setBefore(card.nextBefore ?? undefined)}
                >
                  Older artwork versions
                </button>
              )}
              {before && (
                <button
                  className="rounded-full border border-line px-5 py-3 text-sm font-bold"
                  onClick={() => setBefore(undefined)}
                >
                  Latest versions
                </button>
              )}
            </div>
          </>
        )
      )}
    </main>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { fetchPortalCard, portalImage } from "@/lib/portals";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";

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
      <Link to="/portals" className="text-sm font-bold text-grape underline">
        Back to the portal
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
              <p role="status" className="mt-6 rounded-2xl bg-sky/30 p-4">
                A spell is being processed. The current artwork stays visible
                until the new image and its grades are ready together.
              </p>
            )}
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[...card.history].reverse().map((attempt) => {
                const publication = card.publication.find(
                  (p) => p.requestId === attempt.id
                );
                return (
                  <article
                    key={attempt.id}
                    className="rounded-card border border-line bg-white p-4 shadow-card"
                  >
                    {publication?.result.slab ? (
                      <a
                        href={publication.result.slab.uri}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open graded slab for artwork version ${publication.result.slab.version}`}
                      >
                        <img
                          className="mx-auto h-auto w-full"
                          src={portalImage(publication.result.slab.uri)}
                          alt={`Graded Yunipals card #${tokenId}, artwork version ${publication.result.slab.version}`}
                          loading="lazy"
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
                    <h2 className="mt-4 font-bold">
                      Artwork version{" "}
                      {(BigInt(attempt.request.artVersion) + 1n).toString()}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Portal #{attempt.request.portalId} · Round{" "}
                      {attempt.request.roundId}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      {["Creativity", "Harmony", "Craft", "Impact"].map(
                        (label, i) => (
                          <div key={label}>
                            <dt className="text-muted">{label}</dt>
                            <dd className="font-bold">
                              {attempt.result.scores[i]} / 100
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
                      <details className="mt-4 text-sm">
                        <summary className="cursor-pointer font-semibold focus-visible:ring-2 focus-visible:ring-grape">
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
                              <p className="mt-1 text-muted">{source.reason}</p>
                            </blockquote>
                          )
                        )}
                      </details>
                    )}
                  </article>
                );
              })}
              <article className="rounded-card border border-line bg-lavender/10 p-4">
                <img
                  className="mx-auto max-h-80 rounded-2xl object-contain"
                  src={portalImage(card.originalArtwork.uri)}
                  alt={`Original artwork for card #${tokenId}`}
                />
                <h2 className="mt-4 font-bold">Original artwork</h2>
                <p className="mt-2 text-sm text-muted">
                  Preserved through every transformation.
                </p>
              </article>
            </div>
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

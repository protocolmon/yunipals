import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { environment } from "@/environment";
import { arenaRequest } from "@/lib/arenaLive";
import { ArenaLoading } from "./ArenaFeedback";

type Result = {
  incarnation?: string;
  outcome: {
    matches: Array<{
      id: string;
      winnerId: string;
      verdict: string;
      whyWinner: string;
    }>;
  };
};

export function ArenaFilm({
  id,
  incarnation,
  showResults,
  fighters
}: {
  id: string;
  incarnation?: string;
  showResults: boolean;
  fighters: Array<{ id: string; name: string } | null>;
}) {
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackVersion, setPlaybackVersion] = useState(0);
  const media = useQuery({
    queryKey: ["arena-live", "media", id, incarnation ?? "legacy"],
    queryFn: ({ signal }) =>
      arenaRequest<{
        state: string;
        payoutsReleased: boolean;
        incarnation?: string;
        publication?: string | null;
      }>(`/tournaments/${id}/media`, undefined, signal),
    refetchInterval: (query) =>
      !incarnation &&
      query.state.data?.state === "ready" &&
      query.state.data.payoutsReleased
        ? false
        : 15000
  });
  const result = useQuery({
    queryKey: ["arena-live", "result", id, incarnation ?? "legacy"],
    queryFn: ({ signal }) =>
      arenaRequest<Result>(`/tournaments/${id}/result`, undefined, signal),
    enabled: showResults,
    staleTime: incarnation ? 15000 : Infinity,
    refetchInterval: incarnation ? 15000 : false
  });
  const ready =
    !media.isError &&
    media.data?.state === "ready" &&
    (!incarnation ||
      (media.data.incarnation === incarnation && !!media.data.publication));
  const selector =
    incarnation && media.data?.publication
      ? `?${new URLSearchParams({ origin: incarnation, publication: media.data.publication })}`
      : "";
  const artifact = (name: string) =>
    `${environment.arenaApiUrl}/tournaments/${id}/artifacts/${name}${selector}`;
  return (
    <section
      className="my-8 space-y-5 rounded-card border border-line p-6"
      aria-labelledby="arena-film-heading"
    >
      <h2 id="arena-film-heading" className="text-2xl font-bold">
        Watch the battles
      </h2>
      {ready ? (
        <>
          <video
            key={`${id}/${incarnation ?? "legacy"}/${media.data?.publication ?? "legacy"}/${playbackVersion}`}
            controls
            playsInline
            preload="none"
            className="aspect-video w-full rounded-card bg-ink"
            aria-label="Tournament film"
            src={artifact("film.mp4")}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onError={() => {
              setBuffering(false);
              setPlaybackError(true);
            }}
          />
          {buffering ? <ArenaLoading label="Loading battle video…" /> : null}
          {playbackError ? (
            <p role="alert" className="text-sm text-muted">
              The video could not be played.{" "}
              <button
                className="rounded font-semibold underline"
                onClick={() => {
                  setPlaybackError(false);
                  setPlaybackVersion((v) => v + 1);
                }}
              >
                Reload video
              </button>
            </p>
          ) : null}
          <p className="text-sm text-muted">
            Three fights · 24 seconds. The film includes the results.
          </p>
          <p role="status" className="text-sm text-muted">
            {media.data?.payoutsReleased
              ? "Payouts are unlocked. Recipients can claim their USDC."
              : "Video published. Payouts are unlocking on Base…"}
          </p>
          <a
            className="inline-block rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
            href={artifact("credits.txt")}
            target="_blank"
            rel="noreferrer"
          >
            Music and artwork credits
          </a>
        </>
      ) : media.isPending ? (
        <ArenaLoading label="Loading video status…" />
      ) : (
        <p role="status" className="text-muted">
          {media.error
            ? "Video status is temporarily unavailable."
            : media.data?.state === "needs-attention"
              ? "The film needs a technical fix. The result is fixed; payouts remain held until the completed film is published."
              : "Your film is being prepared. Payouts unlock after the completed film is published."}
        </p>
      )}
      {showResults && (
        <div className="space-y-4 border-t border-line pt-5">
          <h3 className="text-xl font-bold">Why each fighter won</h3>
          {result.isPending && (
            <ArenaLoading label="Loading the referee’s explanation…" />
          )}
          {result.error && (
            <p role="alert">
              The explanation could not be loaded.{" "}
              <button
                className="rounded font-semibold underline"
                onClick={() => void result.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {!result.isError &&
            (!incarnation || result.data?.incarnation === incarnation) &&
            result.data?.outcome.matches.map((match) => (
              <article key={match.id}>
                <h4 className="font-semibold">
                  {match.id === "FINAL"
                    ? "Final"
                    : match.id === "SF1"
                      ? "Semifinal 1"
                      : "Semifinal 2"}{" "}
                  ·{" "}
                  {fighters.find((f) => f?.id === match.winnerId)?.name ??
                    match.winnerId}{" "}
                  · {match.verdict.replaceAll("-", " ")}
                </h4>
                <p className="mt-2 whitespace-pre-wrap break-words text-muted">
                  {match.whyWinner}
                </p>
              </article>
            ))}
          {ready && (
            <a
              className="inline-block rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
              href={artifact("outcome.json")}
              target="_blank"
              rel="noreferrer"
            >
              Full referee result
            </a>
          )}
        </div>
      )}
    </section>
  );
}

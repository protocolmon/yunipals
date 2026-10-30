import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import { arenaArtifactPath, type ArenaMediaStatus } from "@/lib/arenaMedia";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Crown, Swords } from "lucide-react";
import type { AnimeBackground } from "@protopals/yunipals-market-core/anime";
import { ArenaLoading } from "./ArenaFeedback";
import {
  ArenaBattleReview,
  arenaMatchLabel,
  type ArenaReviewFighter,
  type ArenaReviewResult
} from "./ArenaBattleReview";

export function ArenaFilm({
  id,
  showResults,
  fighters
}: {
  id: string;
  showResults: boolean;
  fighters: Array<ArenaReviewFighter | null>;
}) {
  const deployment = useArenaDeployment();
  const arenaRequest = useArenaRequest();
  const video = useRef<HTMLVideoElement>(null);
  const [playback, setPlayback] = useState({ match: 0, winner: false });
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackVersion, setPlaybackVersion] = useState(0);
  const media = useQuery({
    queryKey: ["arena-live", deployment.scope, "media", id],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaMediaStatus>(
        `/tournaments/${id}/media`,
        undefined,
        signal
      ),
    refetchInterval: (query) =>
      query.state.data?.state === "ready" && query.state.data.payoutsReleased
        ? false
        : 15000
  });
  const artifactPath = (name: string) =>
    arenaArtifactPath(id, name, media.data);
  const clock = useQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "film-clock",
      id,
      media.data?.incarnation,
      media.data?.publication
    ],
    queryFn: ({ signal }) =>
      arenaRequest<{
        chapters: Array<{ id: string; t: number; winnerAt: number }>;
        background?: AnimeBackground;
      }>(artifactPath("film.json")!, undefined, signal),
    enabled: deployment.kind === "anime" && !!artifactPath("film.json"),
    staleTime: Infinity
  });
  const result = useQuery({
    queryKey: ["arena-live", deployment.scope, "result", id],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaReviewResult>(
        `/tournaments/${id}/result`,
        undefined,
        signal
      ),
    enabled: showResults || media.data?.state === "ready",
    staleTime: Infinity
  });
  const artifact = (name: string) =>
    `${deployment.apiUrl}${artifactPath(name)}`;
  const match = result.data?.outcome.matches[playback.match];
  const pair = match
    ? match.fighterIds.map((fid) => fighters.find((f) => f?.id === fid))
    : fighters.slice(0, 2);
  const winner = fighters.find((f) => f?.id === match?.winnerId);
  const shortName = (name: string) => name.split(" #")[0];
  function watchMoment(seconds: number) {
    const element = video.current;
    if (!element) return;
    const seek = () => {
      element.currentTime = seconds;
      void element.play().catch(() => {});
    };
    element.scrollIntoView({ block: "center", behavior: "auto" });
    if (element.readyState) seek();
    else {
      element.addEventListener("loadedmetadata", seek, { once: true });
      element.load();
    }
  }
  return (
    <section
      className="my-8 space-y-5 rounded-card border border-line p-6"
      aria-labelledby="arena-film-heading"
    >
      <h2 id="arena-film-heading" className="text-2xl font-bold">
        Watch the battles
      </h2>
      {media.data?.state === "ready" && artifactPath("film.mp4") ? (
        <>
          <div
            className="overflow-hidden rounded-card border border-line bg-white shadow-card"
            data-arena-player
          >
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b border-lavender/40 bg-panel-ethereum px-3 py-3 sm:px-5"
              aria-label="Current fight"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-grape px-3 py-1.5 text-xs font-bold text-white">
                <Swords size={13} aria-hidden="true" />
                {arenaMatchLabel(match?.id ?? "SF1")}
              </span>
              <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:flex-1 sm:justify-end sm:gap-4">
                {pair.map((fighter, index) => (
                  <div
                    key={`fighter/${index}`}
                    className="flex min-w-0 items-center gap-2"
                  >
                    {index === 1 ? (
                      <span
                        className="mr-1 text-xs font-bold text-grape"
                        aria-hidden="true"
                      >
                        VS
                      </span>
                    ) : null}
                    {fighter?.image ? (
                      <img
                        src={fighter.image}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full border-2 border-white object-cover sm:h-10 sm:w-10"
                      />
                    ) : null}
                    <span
                      className="min-w-0 truncate text-xs font-bold sm:text-sm"
                      title={fighter?.name}
                    >
                      {fighter ? shortName(fighter.name) : "Fighter"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="arena-film-picture relative overflow-hidden bg-ink">
              <video
                ref={video}
                key={`${deployment.scope}/${id}/${media.data.incarnation}/${media.data.publication}/${playbackVersion}`}
                controls
                playsInline
                preload="none"
                className="arena-film-source block w-full"
                aria-label="Tournament film"
                src={artifact("film.mp4")}
                poster={artifact("SF1.png")}
                onTimeUpdate={(event) => {
                  const time = event.currentTarget.currentTime;
                  const chapters = clock.data?.chapters;
                  const index =
                    deployment.kind === "anime"
                      ? Math.max(
                          0,
                          chapters?.findLastIndex((c) => time >= c.t) ?? 0
                        )
                      : Math.min(2, Math.floor(time / 8));
                  const settled =
                    deployment.kind === "anime"
                      ? !!chapters?.[index] && time >= chapters[index]!.winnerAt
                      : time - index * 8 >= 6;
                  setPlayback((current) =>
                    current.match === index && current.winner === settled
                      ? current
                      : { match: index, winner: settled }
                  );
                }}
                onWaiting={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={() => setBuffering(false)}
                onError={() => {
                  setBuffering(false);
                  setPlaybackError(true);
                }}
              />
              {playback.winner && winner ? (
                <div
                  className="arena-film-verdict pointer-events-none absolute flex items-center justify-center gap-1.5 rounded-full border border-white bg-mint font-bold text-ink shadow-card"
                  aria-label={`${winner.name} wins by ${match?.verdict}`}
                >
                  <Crown
                    className="h-3 w-3 shrink-0 text-grape sm:h-4 sm:w-4"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {shortName(winner.name)} wins ·{" "}
                    {match?.verdict.replaceAll("-", " ")}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {buffering ? <ArenaLoading label="Loading battle video…" /> : null}
          {playbackError ? (
            <p role="alert" className="text-sm text-muted">
              The video could not be played.{" "}
              <button
                className="rounded font-semibold underline"
                onClick={() => {
                  setPlaybackError(false);
                  setPlayback({ match: 0, winner: false });
                  setPlaybackVersion((v) => v + 1);
                }}
              >
                Reload video
              </button>
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {deployment.kind === "anime"
              ? "Three anime battles. The film includes the results."
              : "Three fights · 24 seconds. The film includes the results."}
          </p>
          <p role="status" className="text-sm text-muted">
            {clock.data?.background?.mode === "shared-preview"
              ? "Shared arena artwork · selected island rules and hosting rewards apply. "
              : ""}
            {media.data.payoutsReleased
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
      <ArenaBattleReview
        id={id}
        mediaReady={media.data?.state === "ready"}
        onWatchMoment={watchMoment}
      />
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
          {result.data?.outcome.matches.map((match) => (
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
          {media.data?.state === "ready" && (
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

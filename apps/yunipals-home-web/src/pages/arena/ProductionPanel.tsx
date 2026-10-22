import { useEffect, useState } from "react";

import { arenaRequest, type TournamentView } from "@/lib/arena";

interface ProductionStatus {
  phase: string;
  message?: string;
  reviewNotes?: string[];
  completedShots?: number;
  actualVideoCostUsd?: number;
  outcomeSha256?: string;
  updatedAt?: string;
  availableOpeningFrames?: string[];
}
interface LockedOutcome {
  outcomeSha256: string;
  outcome: {
    championId: string;
    matches: Array<{
      id: string;
      fighterIds: string[];
      winnerId: string;
      loserId: string;
      verdict: string;
      whyWinner: string;
      events: Array<{
        id: string;
        attackName: string;
        contact: number;
        visibleAction: string;
      }>;
    }>;
  };
}
const labels: Record<string, string> = {
  "not-started": "Ready for an operator-run trial",
  ready: "Input frozen",
  refereeing: "Referee resolving strategies",
  "validation-failed": "Result needs review",
  "awaiting-artwork": "Result frozen · preparing opening frames",
  "generating-video": "Animating the three battles",
  assembling: "Assembling your tournament",
  "review-ready": "Tournament film ready to review",
  "needs-attention": "Production needs attention"
};

export function ProductionPanel({
  tournament
}: {
  tournament: TournamentView;
}) {
  const [status, setStatus] = useState<ProductionStatus | null>(null);
  const [result, setResult] = useState<LockedOutcome | null>(null);
  const [error, setError] = useState("");
  const [showResult, setShowResult] = useState(false);
  const base = `tournaments/${tournament.id}`;
  const artifact = (name: string) => `/api/arena/${base}/artifacts/${name}`;
  const name = (id: string) =>
    tournament.seats.find((seat) => seat.fighter.id === id)?.fighter.name || id;

  useEffect(() => {
    const abort = new AbortController();
    let timer: number;
    const refresh = async () => {
      try {
        const next = await arenaRequest<ProductionStatus>(
          `${base}/production`,
          undefined,
          abort.signal
        );
        if (!abort.signal.aborted) {
          setStatus(next);
          setError("");
        }
        if (next.outcomeSha256) {
          const outcome = await arenaRequest<LockedOutcome>(
            `${base}/artifacts/outcome.json`,
            undefined,
            abort.signal
          );
          if (!abort.signal.aborted) setResult(outcome);
        }
      } catch (failure) {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Production status unavailable."
          );
      } finally {
        if (!abort.signal.aborted)
          timer = window.setTimeout(() => void refresh(), 4000);
      }
    };
    void refresh();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [base]);

  return (
    <section
      aria-label="Tournament production"
      className="mt-6 rounded-card border border-line bg-white p-6 sm:p-8"
    >
      <p className="text-xs font-bold uppercase tracking-widest text-grape">
        From strategy to screen
      </p>
      <h2 className="mt-2 text-2xl font-black">
        {status ? labels[status.phase] || status.phase : "Loading production…"}
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <p role="status" className="mt-3 text-sm text-muted">
        {status?.message}
      </p>
      <p className="mt-3 text-xs text-muted">
        Grok via Runware · 720p · 3 battles · 24 seconds
        {status?.completedShots !== undefined
          ? ` · ${status.completedShots}/6 clips`
          : ""}
        {status?.actualVideoCostUsd
          ? ` · $${status.actualVideoCostUsd.toFixed(2)} video generation`
          : ""}
      </p>
      {status?.reviewNotes?.length ? (
        <div className="mt-4 rounded-2xl border border-line bg-hero-lav/40 p-4 text-sm">
          <p className="font-bold">Review notes</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {status.reviewNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {status?.phase === "review-ready" && (
        <div className="mt-6">
          <video
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full rounded-2xl bg-ink"
            src={artifact("film.mp4")}
            aria-label="Full 24-second tournament"
          />
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-grape">
            <a href={artifact("film.mp4")} download>
              Download film
            </a>
            <a
              href={artifact("native-sfx.mp4")}
              target="_blank"
              rel="noreferrer"
            >
              Native effects only
            </a>
            <a href={artifact("credits.txt")} target="_blank" rel="noreferrer">
              Music credit
            </a>
          </div>
        </div>
      )}
      {result && (
        <div className="mt-6">
          <button
            className="rounded-full border border-line px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-grape"
            onClick={() => setShowResult(!showResult)}
            aria-expanded={showResult}
          >
            {showResult
              ? "Hide tournament result"
              : "Reveal result & why each fighter won"}
          </button>
          {showResult && (
            <>
              <h3 className="mt-5 text-xl font-black">
                Champion: {name(result.outcome.championId)}
              </h3>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {result.outcome.matches.map((match) => (
                  <article
                    key={match.id}
                    className="rounded-2xl bg-hero-lav/40 p-5"
                  >
                    {status?.availableOpeningFrames?.includes(match.id) && (
                      <a
                        href={artifact(`${match.id}.png`)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${match.id} first frame`}
                      >
                        <img
                          src={artifact(`${match.id}.png`)}
                          alt={`${match.fighterIds.map(name).join(" facing ")} on the selected island`}
                          className="mb-4 aspect-video w-full rounded-xl object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    <p className="text-xs font-bold text-muted">
                      {match.id === "FINAL"
                        ? "Final"
                        : `Semifinal ${match.id.slice(-1)}`}
                    </p>
                    <h4 className="mt-2 font-black">
                      {match.fighterIds.map(name).join(" vs ")}
                    </h4>
                    <p className="mt-2 text-sm font-bold text-grape">
                      {name(match.winnerId)} wins · {match.verdict}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {match.whyWinner}
                    </p>
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-bold">
                        Attack and defense sequence
                      </summary>
                      <ol className="mt-3 space-y-3">
                        {match.events.map((event) => (
                          <li key={event.id}>
                            <strong>
                              {event.contact.toFixed(2)}s · {event.attackName}
                            </strong>
                            <p className="mt-1 text-muted">
                              {event.visibleAction}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </article>
                ))}
              </div>
            </>
          )}
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer font-bold">
              Review frozen result & production prompts
            </summary>
            <div className="mt-3 flex flex-wrap gap-4 text-grape">
              <a
                href={artifact("outcome.json")}
                target="_blank"
                rel="noreferrer"
              >
                Result & checks
              </a>
              <a
                href={artifact("prompts.json")}
                target="_blank"
                rel="noreferrer"
              >
                Exact image & video prompts
              </a>
              {status?.phase === "review-ready" && (
                <a
                  href={artifact("receipts.json")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Provider costs
                </a>
              )}
            </div>
            <p className="mt-3 break-all text-xs text-muted">
              Result SHA-256: {result.outcomeSha256}
            </p>
          </details>
        </div>
      )}
    </section>
  );
}

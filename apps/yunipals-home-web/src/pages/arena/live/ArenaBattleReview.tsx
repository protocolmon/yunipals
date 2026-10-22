import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Play, ScrollText, Sparkles } from "lucide-react";
import { arenaRequest } from "@/lib/arenaLive";
import { environment } from "@/environment";
import { cn } from "@/lib/utils";
import { ArenaLoading } from "./ArenaFeedback";

export type ArenaReviewFighter = {
  id: string;
  name: string;
  image?: string;
  identity?: string;
  locomotion?: "ground" | "flight";
};
export type ArenaCombatEvent = {
  id: string;
  actorId: string;
  targetId: string;
  strategyQuote: string;
  attackClass: "heavy" | "light";
  attackName: string;
  start: number;
  release: number;
  contact: number;
  recoveryUntil: number;
  defense: string;
  defenderQuote: string;
  outcome: string;
  visibleAction: string;
  why: string;
};
export type ArenaReviewMatch = {
  id: string;
  fighterIds: string[];
  winnerId: string;
  loserId: string;
  verdict: string;
  verdictSeconds: number;
  whyWinner: string;
  openingState: string;
  continuityAtThree: string;
  victoryPose: string;
  events: ArenaCombatEvent[];
};
export type ArenaReviewResult = {
  outcomeHash: string;
  inputHash: string;
  outcome: { matches: ArenaReviewMatch[] };
  validation?: {
    valid: boolean;
    matches: Array<{
      id: string;
      health: Record<string, number>;
      energy: Record<string, number>;
      damageTimeline: Array<{
        eventId: string;
        at: number;
        damage: number;
        health: Record<string, number>;
      }>;
    }>;
    tiePriority: string[];
  };
  referee?: {
    model: string;
    reasoningEffort: string;
    instructions: string;
    input: string;
  } | null;
};
type Prompts = {
  inputSha256: string;
  outcomeSha256: string;
  shots: Array<{
    matchId: string;
    part: "opening" | "continuation";
    prompt: string;
    framePrompt: string;
  }>;
};
type FrozenInput = {
  input: {
    roster: ArenaReviewFighter[];
    strategies: Array<{ fighterId: string; text: string; source: string }>;
    rules: { combat: Record<string, unknown> };
  };
};
export const arenaMatchLabel = (id: string) =>
  id === "FINAL" ? "Final" : id === "SF1" ? "Semifinal 1" : "Semifinal 2";
const pill =
  "rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape";

function PromptText({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <details className="rounded-2xl border border-line bg-white p-4">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="my-3 flex justify-end">
        <button
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          onClick={() => {
            setError(false);
            void navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => setError(true)
            );
          }}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy exact text"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="my-2 text-sm text-muted">
          Copy is unavailable. You can select the text below.
        </p>
      ) : null}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-line/40 p-4 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </details>
  );
}

export function ArenaBattleReview({
  id,
  mediaReady,
  onWatchMoment
}: {
  id: string;
  mediaReady: boolean;
  onWatchMoment: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [matchId, setMatchId] = useState("SF1");
  const [view, setView] = useState<"judging" | "generation">("judging");
  const review = useQuery({
    queryKey: ["arena-live", "review", id, mediaReady],
    enabled: open,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const artifact = (file: string) => `/tournaments/${id}/artifacts/${file}`;
      const [result, prompts, frozen] = await Promise.all([
        arenaRequest<ArenaReviewResult>(
          `/tournaments/${id}/result`,
          undefined,
          signal
        ),
        mediaReady
          ? arenaRequest<Prompts>(artifact("prompts.json"), undefined, signal)
          : Promise.resolve(null),
        mediaReady
          ? arenaRequest<FrozenInput>(artifact("input.json"), undefined, signal)
          : Promise.resolve(null)
      ]);
      if (
        prompts &&
        (`0x${prompts.inputSha256}` !== result.inputHash ||
          `0x${prompts.outcomeSha256}` !== result.outcomeHash)
      ) {
        throw new Error(
          "The saved media prompts do not match this confirmed result."
        );
      }
      return { result, prompts, frozen };
    }
  });
  const data = review.data;
  const match = data?.result.outcome.matches.find((m) => m.id === matchId);
  const ledger = data?.result.validation?.matches.find((m) => m.id === matchId);
  const roster = data?.frozen?.input.roster ?? [];
  const fighter = (fighterId: string) => roster.find((f) => f.id === fighterId);
  const name = (fighterId: string) => fighter(fighterId)?.name ?? fighterId;
  const secondsOffset = matchId === "SF1" ? 0 : matchId === "SF2" ? 8 : 16;
  const shots = data?.prompts?.shots.filter((s) => s.matchId === matchId) ?? [];
  const image = `${environment.arenaApiUrl}/tournaments/${id}/artifacts/${matchId}.png`;
  return (
    <details
      className="rounded-card border border-lavender bg-lavender/10 p-5 sm:p-6"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <span className="inline-flex items-center gap-2 text-lg font-bold">
              <ScrollText size={20} className="text-grape" aria-hidden="true" />{" "}
              Battle review
            </span>
            <span className="mt-1 block text-sm text-muted">
              How it was judged, and the exact image and video prompts. Contains
              results.
            </span>
          </span>
          <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-grape">
            {open ? "Close review" : "Explore the battle"}
          </span>
        </span>
      </summary>
      {open && review.isPending ? (
        <div className="mt-5">
          <ArenaLoading label="Loading the saved battle review…" />
        </div>
      ) : null}
      {review.error ? (
        <p role="alert" className="mt-5 text-sm">
          {review.error.message}{" "}
          <button
            className="font-semibold underline"
            onClick={() => void review.refetch()}
          >
            Try again
          </button>
        </p>
      ) : null}
      {open && data && match ? (
        <div className="mt-6 space-y-5">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Review fight"
          >
            {data.result.outcome.matches.map((m) => (
              <button
                key={m.id}
                aria-pressed={matchId === m.id}
                className={cn(
                  pill,
                  matchId === m.id
                    ? "border-grape bg-grape text-white"
                    : "border-line bg-white text-ink"
                )}
                onClick={() => setMatchId(m.id)}
              >
                {arenaMatchLabel(m.id)}
              </button>
            ))}
          </div>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Review section"
          >
            <button
              aria-pressed={view === "judging"}
              className={cn(
                pill,
                view === "judging"
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-white"
              )}
              onClick={() => setView("judging")}
            >
              Judging & actions
            </button>
            <button
              aria-pressed={view === "generation"}
              className={cn(
                pill,
                view === "generation"
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-white"
              )}
              onClick={() => setView("generation")}
            >
              Images & generation prompts
            </button>
          </div>
          {view === "judging" ? (
            <div className="space-y-5">
              <article className="rounded-2xl border border-line bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-widest text-grape">
                  {match.verdict.replaceAll("-", " ")} · {match.verdictSeconds}s
                </p>
                <h3 className="mt-2 text-xl font-bold">
                  Why {name(match.winnerId)} won
                </h3>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {match.whyWinner}
                </p>
              </article>
              {ledger ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {match.fighterIds.map((fid) => (
                    <div
                      key={fid}
                      className="rounded-2xl border border-line bg-white p-4"
                    >
                      <div className="flex items-center gap-3">
                        {fighter(fid)?.image ? (
                          <img
                            src={fighter(fid)?.image}
                            alt=""
                            className="h-12 w-12 rounded-xl object-cover"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <p className="break-words font-semibold">
                            {name(fid)}
                          </p>
                          <p className="text-xs text-muted">
                            {fighter(fid)?.locomotion === "flight"
                              ? "Flying fighter"
                              : "Ground fighter"}
                          </p>
                        </div>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-muted">Final health</dt>
                          <dd className="font-bold">{ledger.health[fid]} HP</dd>
                        </div>
                        <div>
                          <dt className="text-muted">Energy left</dt>
                          <dd className="font-bold">{ledger.energy[fid]}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Detailed validation figures are being connected. The saved
                  referee explanation is available above.
                </p>
              )}
              <details className="rounded-2xl border border-line bg-white p-4">
                <summary className="cursor-pointer font-semibold">
                  The submitted strategies
                </summary>
                {data.frozen?.input.strategies
                  .filter((s) => match.fighterIds.includes(s.fighterId))
                  .map((s) => (
                    <div key={s.fighterId} className="mt-4">
                      <h4 className="text-sm font-bold">{name(s.fighterId)}</h4>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                        {s.text}
                      </p>
                    </div>
                  ))}
              </details>
              <div>
                <h3 className="mb-3 text-lg font-bold">
                  Attack-by-attack record
                </h3>
                <ol className="space-y-3">
                  {match.events.map((event) => {
                    const trace = ledger?.damageTimeline.find(
                      (t) => t.eventId === event.id
                    );
                    return (
                      <li
                        key={event.id}
                        className="rounded-2xl border border-line bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-bold">
                            {event.contact.toFixed(2)}s · {event.attackName}
                          </h4>
                          <span className="rounded-full bg-lavender/25 px-3 py-1 text-xs font-semibold">
                            {event.outcome.replaceAll("_", " ")}
                            {trace ? ` · ${trace.damage} damage` : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {name(event.actorId)} → {name(event.targetId)}
                        </p>
                        <p className="mt-3 text-sm leading-relaxed">
                          {event.why}
                        </p>
                        <details className="mt-3 text-sm">
                          <summary className="cursor-pointer font-semibold text-grape">
                            Strategy source, timing & visible action
                          </summary>
                          <blockquote className="mt-3 border-l-2 border-lavender pl-3 text-muted">
                            “{event.strategyQuote}”
                          </blockquote>
                          <p className="mt-3 text-muted">
                            {event.visibleAction}
                          </p>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                            <div>
                              <dt>Attack starts</dt>
                              <dd className="font-semibold">{event.start}s</dd>
                            </div>
                            <div>
                              <dt>Released</dt>
                              <dd className="font-semibold">
                                {event.release}s
                              </dd>
                            </div>
                            <div>
                              <dt>Recovered</dt>
                              <dd className="font-semibold">
                                {event.recoveryUntil}s
                              </dd>
                            </div>
                            <div>
                              <dt>Defense</dt>
                              <dd className="font-semibold">{event.defense}</dd>
                            </div>
                          </dl>
                          {event.defenderQuote ? (
                            <blockquote className="mt-3 border-l-2 border-mint pl-3 text-muted">
                              Defense strategy: “{event.defenderQuote}”
                            </blockquote>
                          ) : null}
                        </details>
                        {mediaReady ? (
                          <button
                            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-grape hover:bg-lavender/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
                            onClick={() =>
                              onWatchMoment(
                                secondsOffset + Math.max(0, event.contact - 0.3)
                              )
                            }
                          >
                            <Play size={13} aria-hidden="true" /> Watch this
                            moment
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
              {data.frozen ? (
                <PromptText
                  title="The shared combat rules"
                  text={JSON.stringify(data.frozen.input.rules.combat, null, 2)}
                />
              ) : null}
              {data.result.referee ? (
                <details className="space-y-3 rounded-2xl border border-line bg-white p-4">
                  <summary className="cursor-pointer font-semibold">
                    Exact referee request
                  </summary>
                  <p className="mt-3 text-xs text-muted">
                    {data.result.referee.model} ·{" "}
                    {data.result.referee.reasoningEffort} reasoning. This is the
                    saved request used for this result.
                  </p>
                  <PromptText
                    title="System instructions"
                    text={data.result.referee.instructions}
                  />
                  <PromptText
                    title="Complete referee input"
                    text={data.result.referee.input}
                  />
                </details>
              ) : null}
              <p className="text-xs leading-relaxed text-muted">
                The referee interprets custom strategies and physical
                situations. Validation checks the bracket, quoted strategy
                sources, timing, energy, damage and winner. The video
                illustrates that fixed result and can contain animation errors.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {!mediaReady ? (
                <p className="text-sm text-muted">
                  Exact generation prompts appear after the film is published.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-grape">
                    <Sparkles size={17} aria-hidden="true" /> Seedream 4.5
                    opening image · Grok Imagine Video 1.5 Lite · 720p
                  </div>
                  <img
                    src={image}
                    alt={`${arenaMatchLabel(matchId)} generated opening frame`}
                    loading="lazy"
                    className="aspect-video w-full rounded-2xl border border-line object-contain"
                  />
                  <PromptText
                    key={`${matchId}/frame`}
                    title="Exact opening-image prompt"
                    text={
                      shots.find((s) => s.part === "opening")?.framePrompt ??
                      "Prompt unavailable."
                    }
                  />
                  {shots.map((shot) => (
                    <PromptText
                      key={`${matchId}/${shot.part}`}
                      title={
                        shot.part === "opening"
                          ? "Exact video prompt · opening · 0–3s"
                          : "Exact video prompt · continuation · 3–8s"
                      }
                      text={shot.prompt.trim()}
                    />
                  ))}
                  <p className="text-xs text-muted">
                    The continuation starts from frame 71 of the opening clip.
                    These are the saved production prompts, including any
                    conflicting instructions; review them against the action
                    record to improve future battles.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}

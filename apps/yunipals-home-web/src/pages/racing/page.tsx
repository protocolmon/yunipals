import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  FileJson,
  LoaderCircle,
  Pause,
  Play,
  Sparkles,
  StepBack,
  StepForward,
  WandSparkles
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { loadChatExample } from "@/lib/racing/examples";
import { TEST_ISLANDS, type IslandId } from "@/lib/racing/islands";
import {
  buildPromptBundle,
  defaultRequest,
  PROMPT_VERSION,
  RACERS,
  SUPPORTED_PROMPT_VERSIONS,
  requestSchema,
  validateOutcome,
  type GeneratedRace,
  type RacerId,
  type RaceRequest
} from "@/lib/racing/llmRace";
import { cn } from "@/lib/utils";
import { PILOT_ABILITIES } from "@/lib/racing/racerProfiles";

import { RaceBoard } from "./components/RaceBoard";

const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass =
  "w-full rounded-2xl border border-line bg-white px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge";
const statusSchema = z.object({
  configured: z.boolean(),
  provider: z.string(),
  model: z.string().nullable()
});
const provenanceSchema = z.object({
  source: z.literal("live-llm"),
  model: z.string(),
  promptVersion: z.enum(SUPPORTED_PROMPT_VERSIONS),
  generatedAt: z.string(),
  responseId: z.string().nullable()
});

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RacingPage() {
  usePageMetadata(
    "Yunipals — LLM Race Studio",
    "Generate a complete monster race from island rules and every player's freeform strategy."
  );
  const [request, setRequest] = useState<RaceRequest>(() =>
    defaultRequest("M02")
  );
  const [race, setRace] = useState<GeneratedRace | null>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<z.infer<
    typeof statusSchema
  > | null>(null);
  const [imported, setImported] = useState("");
  const pending = useRef<AbortController | null>(null);
  const island = TEST_ISLANDS.find((entry) => entry.id === request.islandId)!;
  const valid = requestSchema.safeParse(request).success;
  const bundle = valid ? buildPromptBundle(request) : null;
  const beat = race?.outcome.beats[beatIndex];
  const last = race ? race.outcome.beats.length - 1 : 0;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/racing/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const parsed = statusSchema.safeParse(await response.json());
        if (parsed.success) setConnection(parsed.data);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!playing || !race || beatIndex >= last) return;
    const timer = window.setTimeout(
      () => setBeatIndex((value) => Math.min(value + 1, last)),
      3500
    );
    return () => window.clearTimeout(timer);
  }, [beatIndex, last, playing, race]);

  function reset() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setRace(null);
    setBeatIndex(0);
    setPlaying(false);
    setError(null);
  }
  function updateStrategy(id: RacerId, strategy: string) {
    reset();
    setRequest((current) => ({
      ...current,
      strategies: current.strategies.map((entry) =>
        entry.id === id ? { ...entry, strategy } : entry
      )
    }));
  }
  function accept(result: GeneratedRace) {
    setRace(result);
    setBeatIndex(0);
    setPlaying(false);
    setError(null);
  }

  async function generate() {
    if (!valid || busy || !connection?.configured) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setRace(null);
    setError(null);
    const submitted = structuredClone(request);
    try {
      const response = await fetch("/api/racing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
        signal: controller.signal
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(body);
        throw new Error(
          message.success ? message.data.error : "Race generation failed."
        );
      }
      const envelope = z
        .object({
          request: requestSchema,
          outcome: z.unknown(),
          provenance: provenanceSchema
        })
        .parse(body);
      if (JSON.stringify(envelope.request) !== JSON.stringify(submitted))
        throw new Error(
          "The returned race does not match the submitted strategies."
        );
      if (!controller.signal.aborted)
        accept({
          request: submitted,
          outcome: validateOutcome(envelope.outcome, submitted),
          provenance: envelope.provenance
        });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Race generation failed."
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function loadExample() {
    reset();
    const example = loadChatExample(request.islandId);
    setRequest(example.request);
    accept(example);
  }
  function importOutcome() {
    if (!valid) return;
    try {
      const outcome = validateOutcome(JSON.parse(imported), request);
      accept({
        request: structuredClone(request),
        outcome,
        provenance: {
          source: "imported",
          model: "External output (unverified source)",
          promptVersion: outcome.version,
          generatedAt: new Date().toISOString(),
          responseId: null
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid race JSON.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:pt-12">
      <div className="mb-8 max-w-3xl">
        <p className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-grape">
          <Sparkles size={14} aria-hidden="true" /> LLM Race Studio
        </p>
        <h1 className="display text-3xl leading-tight sm:text-5xl">
          Your plans. One race.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Every player submits a freeform strategy. The LLM receives all
          strategies and the island rules together, then generates the entire
          race: decisions, sabotage, consequences, and finishing order.
        </p>
      </div>

      <section
        aria-label="Choose an island"
        className="mb-7 grid gap-3 sm:grid-cols-3"
      >
        {TEST_ISLANDS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={request.islandId === item.id}
            onClick={() => {
              reset();
              setRequest(defaultRequest(item.id));
            }}
            className={cn(
              "flex items-center gap-3 rounded-card border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-2",
              item.id === request.islandId
                ? "border-grape/50 bg-lavender/15 shadow-card"
                : "border-line bg-white hover:border-grape/30"
            )}
          >
            <img
              src={item.image}
              alt={`${item.name} with its island resident`}
              width={96}
              height={96}
              className="h-20 w-20 shrink-0 rounded-2xl object-cover sm:h-24 sm:w-24"
            />
            <div>
              <p className="text-xs text-muted">{item.rarity}</p>
              <h2 className="mt-1 text-sm font-extrabold">{item.name}</h2>
              <p className="mt-1 text-xs text-muted">{item.traits[0]}</p>
            </div>
          </button>
        ))}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <section
          className="min-w-0 space-y-5 lg:col-span-5"
          aria-labelledby="strategies-title"
        >
          <div className="rounded-card border border-line p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="strategies-title" className="font-extrabold">
                All players' strategies
              </h2>
              <WandSparkles
                size={18}
                aria-hidden="true"
                className="text-grape"
              />
            </div>
            <p className="mb-5 text-xs leading-relaxed text-muted">
              Write intentions, conditions, tricks, and fallback plans in your
              own words. These racers are full Yunipals; the island's tiny
              resident influences the course. Ratings are equal in this pilot,
              with proposed powers specific to each racer. Try using a power to
              change the track, such as splashing water onto a stone bend.
            </p>
            {request.strategies.map((entry) => (
              <div key={entry.id} className="mb-5 last:mb-0">
                <label
                  htmlFor={`strategy-${entry.id}`}
                  className="mb-2 block text-sm font-extrabold"
                >
                  {RACERS.find((racer) => racer.id === entry.id)!.name}'s
                  strategy
                </label>
                <div className="mb-3 flex items-center gap-3">
                  <img
                    src={RACERS.find((racer) => racer.id === entry.id)!.image}
                    alt=""
                    className="h-12 w-12 rounded-xl object-cover"
                  />
                  <div className="text-xs leading-relaxed text-muted">
                    <p className="font-bold text-ink">
                      {RACERS.find((racer) => racer.id === entry.id)!.species}
                    </p>
                    <p>
                      {RACERS.find((racer) => racer.id === entry.id)!
                        .abilityIds.map(
                          (abilityId) => PILOT_ABILITIES[abilityId].name
                        )
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <textarea
                  id={`strategy-${entry.id}`}
                  value={entry.strategy}
                  onChange={(event) =>
                    updateStrategy(entry.id, event.target.value)
                  }
                  maxLength={2400}
                  rows={4}
                  className={cn(fieldClass, "resize-y text-xs leading-relaxed")}
                  aria-invalid={!entry.strategy.trim()}
                />
                <p className="mt-1 text-right text-xs text-muted">
                  {entry.strategy.length}/2400
                </p>
              </div>
            ))}
            {!valid && (
              <p role="alert" className="mt-3 text-xs text-red-700">
                Give every racer a nonempty strategy, up to 2400 characters
                each.
              </p>
            )}
            <button
              type="button"
              disabled={!valid || busy || !connection?.configured}
              onClick={generate}
              className={cn(
                buttonClass,
                "mt-3 w-full bg-grape text-white shadow-cta hover:bg-grape/90"
              )}
            >
              {busy ? (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <WandSparkles size={16} aria-hidden="true" />
              )}
              {busy ? "LLM is generating the race…" : "Generate full race"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {connection?.configured
                ? `Connected to ${connection.provider} · ${connection.model}. One generation uses all three submitted strategies.`
                : "Live generation needs a server connection. You can export this prompt or replay a stored example generated in this chat."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadExample}
                disabled={busy}
                className={cn(
                  buttonClass,
                  "border border-line bg-white text-ink"
                )}
              >
                <Play size={14} aria-hidden="true" /> Load example
              </button>
              <button
                type="button"
                disabled={!bundle || busy}
                onClick={() =>
                  download(
                    bundle,
                    `${request.islandId.toLowerCase()}-llm-prompt.json`
                  )
                }
                className={cn(
                  buttonClass,
                  "border border-line bg-white text-ink"
                )}
              >
                <ArrowDownToLine size={14} aria-hidden="true" /> Export prompt
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Loading an example restores its original three strategies.
            </p>
            {error && (
              <p
                role="alert"
                className="mt-4 break-words text-xs leading-relaxed text-red-700"
              >
                {error}
              </p>
            )}
          </div>
          <details className="rounded-card border border-line p-5">
            <summary className="cursor-pointer rounded-md text-sm font-extrabold focus-visible:ring-2 focus-visible:ring-badge">
              Island rules sent to the LLM
            </summary>
            <div className="mt-4 space-y-3">
              {island.rules.map((rule) => (
                <p key={rule} className="text-xs leading-relaxed text-muted">
                  {rule}
                </p>
              ))}
            </div>
            <p className="mt-4 text-xs font-semibold text-grape">
              {island.resident}
            </p>
          </details>
          <details className="rounded-card border border-line p-5">
            <summary className="cursor-pointer rounded-md text-sm font-extrabold focus-visible:ring-2 focus-visible:ring-badge">
              System prompt and race input
            </summary>
            {bundle && (
              <>
                <label className="mt-4 block text-xs font-bold text-muted">
                  System prompt
                  <textarea
                    aria-label="System prompt"
                    readOnly
                    value={bundle.system}
                    rows={12}
                    className={cn(
                      fieldClass,
                      "mt-2 font-mono text-xs leading-relaxed"
                    )}
                  />
                </label>
                <label className="mt-4 block text-xs font-bold text-muted">
                  Race input
                  <textarea
                    aria-label="Race input"
                    readOnly
                    value={bundle.user}
                    rows={10}
                    className={cn(
                      fieldClass,
                      "mt-2 font-mono text-xs leading-relaxed"
                    )}
                  />
                </label>
              </>
            )}
          </details>
          <details className="rounded-card border border-line p-5">
            <summary className="cursor-pointer rounded-md text-sm font-extrabold focus-visible:ring-2 focus-visible:ring-badge">
              Import output from another LLM
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Use the exported system prompt, race input and schema with your
              chosen model. Paste the returned race JSON below. The current
              strategies stay attached to this imported output.
            </p>
            <textarea
              aria-label="Generated race JSON"
              value={imported}
              onChange={(event) => setImported(event.target.value)}
              rows={7}
              maxLength={150000}
              className={cn(fieldClass, "mt-3 font-mono text-xs")}
            />
            <button
              type="button"
              onClick={importOutcome}
              disabled={!valid || !imported.trim() || busy}
              className={cn(buttonClass, "mt-3 bg-grape/10 text-grape")}
            >
              <FileJson size={14} aria-hidden="true" /> Load model output
            </button>
          </details>
        </section>

        <section
          className="min-w-0 space-y-5 lg:col-span-7"
          aria-labelledby="replay-title"
        >
          {race && beat ? (
            <>
              <div className="overflow-hidden rounded-card bg-ink shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white">
                  <div>
                    <h2 id="replay-title" className="font-extrabold">
                      {island.name}
                    </h2>
                    <p className="mt-1 text-xs text-white/65">
                      Beat {beatIndex + 1}/{race.outcome.beats.length} ·{" "}
                      {beat.title}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold">
                    {race.provenance.source === "live-llm"
                      ? "Live LLM generation"
                      : race.provenance.source === "chat-example"
                        ? "Stored chat-generated example"
                        : "Imported model output"}
                  </span>
                </div>
                <RaceBoard beat={beat} islandId={request.islandId} />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={beatIndex === 0}
                      aria-label="Previous beat"
                      onClick={() => {
                        setPlaying(false);
                        setBeatIndex((value) => Math.max(0, value - 1));
                      }}
                      className={cn(buttonClass, "bg-white/10 px-3 text-white")}
                    >
                      <StepBack size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        playing && beatIndex < last
                          ? "Pause replay"
                          : "Play replay"
                      }
                      onClick={() => {
                        if (beatIndex === last) setBeatIndex(0);
                        setPlaying(!(playing && beatIndex < last));
                      }}
                      className={cn(buttonClass, "bg-white text-ink")}
                    >
                      {playing && beatIndex < last ? (
                        <Pause size={16} aria-hidden="true" />
                      ) : (
                        <Play size={16} aria-hidden="true" />
                      )}
                      {playing && beatIndex < last ? "Pause" : "Replay"}
                    </button>
                    <button
                      type="button"
                      disabled={beatIndex === last}
                      aria-label="Next beat"
                      onClick={() => {
                        setPlaying(false);
                        setBeatIndex((value) => Math.min(value + 1, last));
                      }}
                      className={cn(buttonClass, "bg-white/10 px-3 text-white")}
                    >
                      <StepForward size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setBeatIndex(last);
                    }}
                    className={cn(buttonClass, "bg-white/10 text-white")}
                  >
                    Finish order <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {race.provenance.source === "chat-example" &&
                  "This example was generated by the assistant during design, not by a live API call. "}
                The schematic displays the reported positions; it does not
                compute race outcomes.
              </p>
              <div className="rounded-card border border-line p-5">
                <h3 className="text-lg font-extrabold">{beat.title}</h3>
                <p className="mt-3 text-sm leading-relaxed">{beat.narration}</p>
                {!!beat.worldEffects?.length && (
                  <section
                    aria-label="Track conditions"
                    className="mt-4 rounded-2xl border border-line p-4"
                  >
                    <h3 className="mb-3 text-sm font-extrabold">
                      Track conditions
                    </h3>
                    <div className="space-y-3">
                      {beat.worldEffects.map((effect) => (
                        <div
                          key={effect.id}
                          className="text-xs leading-relaxed text-muted"
                        >
                          <p className="font-bold text-ink">
                            {effect.kind.replaceAll("_", " ")} · {effect.state}{" "}
                            · {effect.location}
                          </p>
                          <p>{effect.visibleCue}</p>
                          <p>{effect.impact}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <p className="mt-4 rounded-2xl bg-lavender/20 px-3 py-3 text-xs leading-relaxed text-grape">
                  <strong>Visible island cue:</strong> {beat.landmarkCue}
                </p>
              </div>
              <div
                className="space-y-3"
                aria-label="Model-reported racer decisions"
              >
                {beat.racers.map((state) => (
                  <div
                    key={state.id}
                    className="rounded-2xl border border-line p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-extrabold">
                        {RACERS.find((racer) => racer.id === state.id)!.name}
                      </h3>
                      <span className="text-xs text-muted">
                        {state.progress}% · {state.route} · {state.status} ·
                        Energy {state.energy}
                      </span>
                    </div>
                    <progress
                      aria-label={`${state.id} reported progress`}
                      max={100}
                      value={state.progress}
                      className="race-progress mt-3 h-1.5 w-full"
                    />
                    <p className="mt-3 text-xs leading-relaxed text-muted">
                      {state.cue}
                    </p>
                    <p className="mt-2 text-sm font-bold">{state.action}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {state.consequence}
                    </p>
                  </div>
                ))}
              </div>
              {beatIndex === last && (
                <div className="rounded-card border border-grape/20 bg-lavender/10 p-5">
                  <h3 className="text-xl font-extrabold">
                    LLM finishing order
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {race.outcome.summary}
                  </p>
                  <ol className="mt-5 space-y-4">
                    {[...race.outcome.finishOrder]
                      .sort((a, b) => a.place - b.place)
                      .map((result) => (
                        <li key={result.id}>
                          <h4 className="font-extrabold">
                            {result.place}.{" "}
                            {
                              RACERS.find((racer) => racer.id === result.id)!
                                .name
                            }
                          </h4>
                          <p className="mt-1 text-xs leading-relaxed text-muted">
                            {result.explanation}
                          </p>
                        </li>
                      ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        race,
                        `${request.islandId.toLowerCase()}-generated-race.json`
                      )
                    }
                    className={cn(buttonClass, "mt-5 bg-grape text-white")}
                  >
                    <ArrowDownToLine size={14} aria-hidden="true" /> Export
                    generated race
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="overflow-hidden rounded-card border border-line">
              <img
                src={island.image}
                alt={`${island.name}: race artwork reference`}
                width={1254}
                height={1254}
                className="aspect-square w-full object-cover"
              />
              <div className="p-5">
                <h2 id="replay-title" className="font-extrabold">
                  A whole race, generated together
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {busy
                    ? "The LLM is resolving all three plans, including the island cues and rival counterplay. No local simulation is running."
                    : "Load the chat-generated example to inspect a complete race, or generate a new one after connecting a model."}
                </p>
              </div>
            </div>
          )}
          <div className="rounded-card bg-lavender/15 p-5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-grape">
              <Check size={15} aria-hidden="true" /> What makes a trait useful
              here?
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              A distinct situation, an observable cue, competing options, a
              meaningful cost, and a rival response. The LLM can judge creative
              plans inside those rules. It gets no permission to invent a new
              ability or award a win just because a strategy sounds impressive.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

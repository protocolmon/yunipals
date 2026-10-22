import {
  Check,
  Download,
  LockKeyhole,
  RefreshCw,
  Shield,
  Sparkles,
  Swords
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  arenaRequest,
  seatCredential,
  type LabCatalog,
  type TournamentView
} from "@/lib/arena";
import { cn } from "@/lib/utils";

import { ProductionPanel } from "./ProductionPanel";

const button =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

function progress(value: TournamentView) {
  return value.seats.length + value.submissionCount + (value.island ? 1 : 0);
}

export function ArenaPage() {
  usePageMetadata(
    "Yunipals — Arena Lab",
    "Four fighters, a drawn island and private custom strategies."
  );
  const [params, setParams] = useSearchParams();
  const tournamentId = params.get("tournament");
  const [catalog, setCatalog] = useState<LabCatalog | null>(null);
  const [tournament, setTournament] = useState<TournamentView | null>(null);
  const [fighterId, setFighterId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    arenaRequest<LabCatalog>("catalog", undefined, abort.signal)
      .then(setCatalog)
      .catch((failure: Error) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoaded(true);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    setTournament(null);
    setDrafts({});
    setFighterId("");
    if (!tournamentId || !catalog) return;
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const next = await arenaRequest<TournamentView>(
          `tournaments/${encodeURIComponent(tournamentId)}`,
          undefined,
          abort.signal
        );
        if (!abort.signal.aborted)
          setTournament((current) =>
            !current || progress(next) >= progress(current) ? next : current
          );
      } catch (failure) {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Tournament unavailable."
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [tournamentId, catalog]);

  async function act(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = tournament?.seats.find(
    (seat) => seat.fighter.id === fighterId
  );
  const canSubmit =
    tournament?.phase === "collecting-strategies" &&
    selected &&
    !selected.submitted;
  const text = drafts[fighterId] || "";
  const fighterName = (id: string) =>
    catalog?.fighters.find((fighter) => fighter.id === id)?.name || id;

  return (
    <main className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8">
      <div className="rounded-card bg-hero-lav p-6 sm:p-10">
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm font-bold">
          <span className="rounded-full bg-white/80 px-4 py-2 text-grape">
            ARENA LAB
          </span>
          <span className="text-muted">
            Local pilot · test randomness · no wallet entry
          </span>
        </div>
        <h1 className="display max-w-3xl text-4xl text-ink sm:text-6xl">
          FOUR YUNIPALS.
          <br />
          ONE CHAMPION.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Join first. Discover your island and opponents. Write your own battle
          plan. Everyone’s strategy stays private until all four are submitted.
        </p>
        <button
          className={cn(button, "mt-6 bg-ink text-white")}
          disabled={!catalog || busy}
          onClick={() =>
            void act(async () => {
              const created = await arenaRequest<TournamentView>(
                "tournaments",
                {}
              );
              setParams({ tournament: created.id });
            })
          }
        >
          <Swords size={18} />
          {tournament ? "Open another test tournament" : "Open test tournament"}
        </button>
        {catalog && (
          <p className="mt-4 text-sm text-muted">
            {catalog.islandCount} revealed Base islands · Genesis{" "}
            {catalog.genesisWeight} tickets each · Personal{" "}
            {catalog.personalWeight} ticket each
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-line bg-white p-5 text-ink"
        >
          {error}
        </div>
      )}
      {!loaded && (
        <div
          role="status"
          className="mt-8 animate-pulse rounded-card bg-line p-8"
        >
          Loading Arena Lab…
        </div>
      )}
      {loaded && !catalog && (
        <p className="mt-6 text-muted">
          This preview needs the local arena backend. Live tournament entry is
          not enabled.
        </p>
      )}

      {tournament && catalog && (
        <>
          <ol
            className="my-8 grid gap-3 text-sm sm:grid-cols-4"
            aria-label="Tournament progress"
          >
            {[
              [
                "Players join",
                `${tournament.seats.length}/4 in the arena`,
                tournament.seats.length === 4
              ],
              [
                "Island drawn",
                tournament.island
                  ? tournament.island.name
                  : tournament.draw
                    ? "Draw requested by first entrant"
                    : "Triggered by first entrant",
                !!tournament.island
              ],
              [
                "Private strategies",
                `${tournament.submissionCount}/4 submitted`,
                tournament.submissionCount === 4
              ],
              [
                "Together revealed",
                tournament.revealedAt
                  ? "Input frozen for the referee"
                  : "Waiting for all four strategies",
                !!tournament.revealedAt
              ]
            ].map(([title, detail, complete]) => (
              <li
                key={String(title)}
                className={cn(
                  "rounded-2xl border p-4",
                  complete ? "border-mint bg-mint/30" : "border-line bg-white"
                )}
              >
                <span className="flex items-center gap-2 font-bold">
                  {complete && <Check size={16} />}
                  {title}
                </span>
                <span className="mt-1 block text-xs text-muted">{detail}</span>
              </li>
            ))}
          </ol>

          <div className="grid items-start gap-6 lg:grid-cols-3">
            <section
              aria-label="Selected island"
              className="overflow-hidden rounded-card border border-line lg:col-span-1"
            >
              {tournament.island ? (
                <>
                  <img
                    className="aspect-video w-full object-cover"
                    src={tournament.island.image}
                    alt={tournament.island.name}
                  />
                  <div className="p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-grape">
                      {tournament.island.edition} · Base island #
                      {tournament.island.tokenId}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">
                      {tournament.island.name}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {String(tournament.island.profile.geometry || "")}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      {[
                        "ground",
                        "cover",
                        "signatureFeature",
                        "atmosphere"
                      ].map((trait) => (
                        <div key={trait}>
                          <dt className="text-xs capitalize text-muted">
                            {trait === "signatureFeature"
                              ? "Arena feature"
                              : trait}
                          </dt>
                          <dd className="mt-1 font-semibold">
                            {tournament.island!.traits[trait]}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </>
              ) : (
                <div className="flex aspect-square flex-col items-center justify-center bg-panel-base p-7 text-center">
                  <Sparkles className="mb-4 text-bluex" size={38} />
                  <h2 className="text-xl font-black">
                    {tournament.draw
                      ? "Drawing the island…"
                      : "Your first entrant starts the draw"}
                  </h2>
                  <p className="mt-3 text-sm text-muted">
                    The selected island stays fixed for both semifinals and the
                    final.
                  </p>
                </div>
              )}
              <details className="border-t border-line p-5 text-sm">
                <summary className="cursor-pointer font-bold">
                  Draw details & verification
                </summary>
                <p className="mt-3 text-muted">
                  Lab draw only. Live VRF is not connected. The weighted pool is
                  fixed before the first entry.
                </p>
                <dl className="mt-3 space-y-3 break-all text-xs">
                  <div>
                    <dt className="font-bold">Pool SHA-256</dt>
                    <dd>{tournament.pool.sha256}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Tickets</dt>
                    <dd>
                      {tournament.pool.totalWeight} total · Genesis{" "}
                      {tournament.pool.genesisWeight}: Personal{" "}
                      {tournament.pool.personalWeight}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Request</dt>
                    <dd>{tournament.draw?.requestId || "Not requested"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Test randomness word</dt>
                    <dd>{tournament.draw?.word || "Pending"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Selected ticket (zero-based)</dt>
                    <dd>{tournament.draw?.ticket ?? "Pending"}</dd>
                  </div>
                </dl>
              </details>
            </section>

            <div className="space-y-6 lg:col-span-2">
              <section
                aria-label="Fighters"
                className="rounded-card border border-line p-5 sm:p-6"
              >
                <h2 className="text-xl font-black">1. Fill the four seats</h2>
                <p className="mt-2 text-sm text-muted">
                  Real NFT references, controlled locally for this pilot. Owners
                  have not entered these NFTs.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {catalog.fighters.map((fighter) => {
                    const seatIndex = tournament.seats.findIndex(
                      (seat) => seat.fighter.id === fighter.id
                    );
                    const joined = seatIndex !== -1;
                    return (
                      <article
                        key={fighter.id}
                        className="overflow-hidden rounded-2xl border border-line"
                      >
                        <img
                          src={fighter.image}
                          alt={`${fighter.name}, ${fighter.species}`}
                          className="aspect-square w-full object-cover"
                        />
                        <div className="p-3">
                          <h3 className="font-black">{fighter.name}</h3>
                          <p className="mt-1 text-xs text-muted">
                            {fighter.species} ·{" "}
                            {fighter.locomotion === "flight"
                              ? "Flies"
                              : "Ground"}
                          </p>
                          <a
                            href={fighter.sourcePage}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block text-xs text-grape underline"
                          >
                            #{fighter.tokenId}
                          </a>
                          <button
                            className={cn(
                              button,
                              "mt-3 w-full px-2 py-2",
                              joined ? "bg-mint text-ink" : "bg-ink text-white"
                            )}
                            disabled={
                              joined || busy || tournament.seats.length === 4
                            }
                            onClick={() =>
                              void act(async () => {
                                const credential = seatCredential(
                                  tournament.id,
                                  fighter.id,
                                  true
                                )!;
                                const next = await arenaRequest<TournamentView>(
                                  `tournaments/${tournament.id}/join`,
                                  { fighterId: fighter.id, credential }
                                );
                                setTournament(next);
                                setFighterId(fighter.id);
                              })
                            }
                          >
                            {joined
                              ? `Seat ${seatIndex + 1}`
                              : `Join as ${fighter.name}`}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {tournament.semifinals.length > 0 && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {tournament.semifinals.map((pair, index) => (
                      <p
                        key={index}
                        className="rounded-2xl bg-line/50 px-4 py-3 text-sm"
                      >
                        <span className="block text-xs text-muted">
                          Semifinal {index + 1}
                        </span>
                        <strong>
                          {fighterName(pair[0])} vs {fighterName(pair[1])}
                        </strong>
                      </p>
                    ))}
                  </div>
                )}
              </section>

              <section
                aria-label="Private strategy"
                className="rounded-card border border-line p-5 sm:p-6"
              >
                <h2 className="flex items-center gap-2 text-xl font-black">
                  <LockKeyhole size={22} />
                  2. Submit private strategies
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Write any attack, defense or conditional plan. Consider your
                  semifinal opponent, either possible finalist and the island.
                  Submission locks your text.
                </p>
                {tournament.seats.length < 4 || !tournament.island ? (
                  <p className="mt-5 rounded-2xl bg-line/50 p-4 text-sm">
                    Strategies unlock when all four players have joined and the
                    island draw has finished.
                  </p>
                ) : (
                  <>
                    <div
                      className="mt-5 flex flex-wrap gap-2"
                      role="group"
                      aria-label="Lab player controls"
                    >
                      {tournament.seats.map((seat) => (
                        <button
                          key={seat.fighter.id}
                          aria-pressed={fighterId === seat.fighter.id}
                          className={cn(
                            button,
                            "px-4 py-2",
                            fighterId === seat.fighter.id
                              ? "bg-ink text-white"
                              : "bg-line/60 text-ink"
                          )}
                          onClick={() => setFighterId(seat.fighter.id)}
                        >
                          {seat.fighter.name}
                          {seat.submitted && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Lab controller: switch seats to test four players. In the
                      live app, each wallet controls its own entrant.
                    </p>
                    {selected && !selected.submitted && (
                      <form
                        className="mt-5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void act(async () => {
                            const credential = seatCredential(
                              tournament.id,
                              fighterId
                            );
                            if (!credential)
                              throw new Error(
                                "This browser tab does not control that seat."
                              );
                            const next = await arenaRequest<TournamentView>(
                              `tournaments/${tournament.id}/strategies`,
                              { fighterId, credential, strategy: text }
                            );
                            setTournament(next);
                            setDrafts((current) => ({
                              ...current,
                              [fighterId]: ""
                            }));
                          });
                        }}
                      >
                        <label
                          className="mb-2 block text-sm font-bold"
                          htmlFor="arena-strategy"
                        >
                          {selected.fighter.name}’s strategy
                        </label>
                        <textarea
                          id="arena-strategy"
                          rows={6}
                          value={text}
                          maxLength={catalog.strategyMaxLength}
                          disabled={busy || !canSubmit}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [fighterId]: event.target.value
                            }))
                          }
                          className="w-full resize-y rounded-2xl border border-line p-4 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge"
                          placeholder="If my opponent commits to a heavy attack, dodge sideways at release, then counter during recovery…"
                        />
                        <div className="mt-3 flex items-center justify-between gap-4">
                          <span className="text-xs text-muted">
                            {text.length}/{catalog.strategyMaxLength} characters
                          </span>
                          <button
                            className={cn(button, "bg-grape text-white")}
                            disabled={busy || !canSubmit || !text.trim()}
                            type="submit"
                          >
                            <LockKeyhole size={16} />
                            Lock & submit privately
                          </button>
                        </div>
                      </form>
                    )}
                    {selected?.submitted && !tournament.revealedAt && (
                      <p
                        role="status"
                        className="mt-5 rounded-2xl bg-mint/40 p-4 text-sm"
                      >
                        {selected.fighter.name}’s strategy is locked.{" "}
                        {tournament.submissionCount}/4 submitted. Everyone’s
                        text stays hidden until all four submit.
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>

          <details className="mt-6 rounded-card border border-line bg-white p-6">
            <summary className="cursor-pointer font-bold">
              How fights are judged · {tournament.rulesVersion}
            </summary>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Write any custom strategy. Every fighter uses the same health,
              energy and timing limits. Attacks need a real hit; shields, guards
              and dodges need time to work. The island and all fighters reset
              before each bout.
            </p>
            {tournament.rulesVersion === "arena-combat-lab-v2" && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Each fighter starts with 60 health and 100 energy. A heavy
                attack deals 30 damage, costs 25 energy and needs 0.5 seconds to
                charge plus 0.6 seconds recovery. A light attack deals 15, costs
                10 and needs 0.3 plus 0.35 seconds. Dodges cost 6; a half-second
                shield costs 12; a physical guard halves damage. You cannot
                actively defend during your own attack or recovery.
              </p>
            )}
            {tournament.rulesVersion === "arena-combat-lab-v2" ? (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                At the five-second combat deadline, remaining health decides a
                bout without a knockout. Only an exact tie uses this published
                priority:{" "}
                {tournament.tiePriority.length
                  ? tournament.tiePriority.map(fighterName).join(" → ")
                  : "available once the draw and roster are complete"}
                .
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                This earlier lobby has intake-only rules. Open a new tournament
                to use the complete combat rules.
              </p>
            )}
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-bold">
                Exact pinned rules
              </summary>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-hero-lav/40 p-4 text-xs">
                {JSON.stringify(tournament.rules.combat, null, 2)}
              </pre>
            </details>
          </details>

          {tournament.revealedAt && (
            <ProductionPanel key={tournament.id} tournament={tournament} />
          )}
          {tournament.revealedAt && (
            <section
              aria-label="Revealed strategies"
              className="mt-6 rounded-card border border-mint bg-mint/20 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-2xl font-black">
                    <Shield size={24} />
                    All four strategies revealed
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    The server froze this exact input. The referee resolves the
                    strategies before any battle footage is generated.
                  </p>
                </div>
                <button
                  className={cn(button, "bg-ink text-white")}
                  onClick={() =>
                    void act(async () => {
                      const bundle = await arenaRequest(
                        `tournaments/${tournament.id}/input`
                      );
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(bundle, null, 2)], {
                          type: "application/json"
                        })
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `arena-${tournament.id}-frozen-input.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                  disabled={busy}
                >
                  <Download size={16} />
                  Export frozen input
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {tournament.strategies?.map((strategy) => (
                  <article
                    key={strategy.fighterId}
                    className="rounded-2xl border border-line bg-white p-5"
                  >
                    <h3 className="font-black">
                      {fighterName(strategy.fighterId)}
                    </h3>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
                      {strategy.text}
                    </p>
                  </article>
                ))}
              </div>
              <p className="mt-4 break-all text-xs text-muted">
                Frozen input SHA-256: {tournament.inputSha256}
              </p>
            </section>
          )}
          <p className="mt-6 flex items-center gap-2 text-xs text-muted">
            <RefreshCw size={14} />
            Status refreshes automatically. Strategies are stored on the local
            server, encrypted at rest. Server operators remain trusted.
          </p>
        </>
      )}
    </main>
  );
}

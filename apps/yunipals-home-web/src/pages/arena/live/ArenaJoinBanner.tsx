import { ArrowRight, Plus, Swords, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import type { ArenaTournamentSummary } from "@protopals/yunipals-market-core/arenaViews";

export function ArenaJoinBanner({
  tournaments
}: {
  tournaments: ArenaTournamentSummary[];
}) {
  const next = tournaments.find(
    (t) =>
      t.phase === "open" &&
      t.fighters.length < 4 &&
      (!t.deadline || t.deadline * 1000 > Date.now())
  );
  if (!next) return null;
  const remaining = 4 - next.fighters.length;
  return (
    <section
      aria-labelledby="arena-join-heading"
      className="my-6 overflow-hidden rounded-card border border-lavender bg-panel-base p-5 shadow-card sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
            <Swords size={16} aria-hidden="true" /> Open for challengers
          </p>
          <h2
            id="arena-join-heading"
            className="mt-2 text-2xl font-bold sm:text-3xl"
          >
            Your next battle starts here.
          </h2>
          <p className="mt-3 text-sm text-muted sm:text-base">
            Bring your Yunipal, study the island and write your own strategy.
            Four fighters enter. One takes the crown.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="rounded-full bg-white/80 px-3 py-1.5">
              2 USDC entry
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5">
              <Trophy size={15} className="text-grape" aria-hidden="true" />6
              USDC champion prize
            </span>
          </div>
        </div>
        <div className="w-full rounded-2xl border border-white bg-white/75 p-4 sm:w-auto sm:min-w-72">
          <div className="flex items-center justify-between gap-4">
            <p className="font-bold">Tournament #{next.id}</p>
            <span className="rounded-full bg-mint/60 px-2.5 py-1 text-xs font-bold text-ink">
              {remaining} {remaining === 1 ? "spot" : "spots"} open
            </span>
          </div>
          <div
            className="my-4 flex gap-2"
            aria-label={`${next.fighters.length} of 4 fighters joined`}
          >
            {[0, 1, 2, 3].map((seat) => {
              const fighter = next.fighters.find((f) => f.seat === seat);
              return fighter?.image ? (
                <img
                  key={seat}
                  src={fighter.image}
                  alt={fighter.name}
                  className="h-12 w-12 rounded-2xl border border-white object-cover"
                />
              ) : (
                <span
                  key={seat}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-grape/30 bg-lavender/20"
                  aria-label="Open fighter spot"
                >
                  <Plus size={18} className="text-grape" aria-hidden="true" />
                </span>
              );
            })}
          </div>
          <Link
            to={`/arena/${next.id}#join`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-grape px-5 py-3 text-sm font-bold text-white shadow-cta transition hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            Join tournament #{next.id}{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

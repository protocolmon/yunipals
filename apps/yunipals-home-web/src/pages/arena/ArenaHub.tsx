import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy
} from "lucide-react";
import { Link } from "react-router-dom";
import { ArenaArtwork } from "./ArenaArtwork";

export function ArenaHub() {
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-10 text-ink sm:pt-14">
      <header className="max-w-3xl">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
          <Swords size={16} aria-hidden="true" /> Yunipals Arena
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">
          Choose your battle.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
          Your Yunipal. Your strategy. One champion. Pick the style you want to
          play.
        </p>
      </header>
      <div className="mt-9 grid gap-7 md:grid-cols-2">
        {[
          {
            kind: "video" as const,
            title: "Video battles",
            badge: "Cinematic clashes",
            entry: "2",
            prize: "6",
            description:
              "Step into a cinematic showdown. Bring your Yunipal to life and watch your strategy play out."
          },
          {
            kind: "anime" as const,
            title: "Anime battles",
            badge: "Signature attacks",
            entry: "1",
            prize: "3.20",
            description:
              "Choose your techniques. Write your battle plan. Watch your fighter take the anime stage."
          }
        ].map((mode) => (
          <Link
            key={mode.kind}
            to={`/arena/${mode.kind}`}
            className="group overflow-hidden rounded-card border border-line bg-white shadow-card transition hover:-translate-y-1 hover:border-grape/40 hover:shadow-cardHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            <div className="relative">
              <ArenaArtwork kind={mode.kind} />
              <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold shadow-sm">
                <Sparkles size={13} className="text-grape" aria-hidden="true" />{" "}
                {mode.badge}
              </span>
            </div>
            <div className="p-6 sm:p-7">
              <h2 className="text-2xl font-bold">{mode.title}</h2>
              <p className="mt-3 min-h-12 text-sm leading-relaxed text-muted">
                {mode.description}
              </p>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5">
                <div>
                  <dt className="text-xs font-medium text-muted">
                    Entry per fighter
                  </dt>
                  <dd className="mt-1 text-xl font-bold">
                    {mode.entry} <span className="text-sm">USDC</span>
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-xs font-medium text-muted">
                    <Trophy size={12} aria-hidden="true" /> Champion prize
                  </dt>
                  <dd className="mt-1 text-xl font-bold">
                    {mode.prize} <span className="text-sm">USDC</span>
                  </dd>
                </div>
              </dl>
              <span className="mt-6 flex items-center justify-between rounded-full bg-ink px-5 py-3.5 text-sm font-bold text-white transition group-hover:bg-grape">
                Explore {mode.kind} battles{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <Swords size={16} aria-hidden="true" /> 4 fighters · 3 fights · 1
          champion
        </span>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck size={16} aria-hidden="true" /> Your NFT stays in your
          wallet
        </span>
      </div>
      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted">
        Entry is paid in USDC on Base, plus network gas. The first entrant also
        pays the island draw fee, shown before confirmation. Unused draw-fee ETH
        is returned automatically.
      </p>
      <details className="mt-10 border-t border-line pt-5 text-sm text-muted">
        <summary className="cursor-pointer rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape">
          Previous video Arena
        </summary>
        <div className="mt-4 flex flex-wrap gap-5">
          <Link className="font-semibold underline" to="/arena/history">
            Earlier battles
          </Link>
          <Link className="font-semibold underline" to="/arena/rewards">
            Earlier rewards & claims
          </Link>
        </div>
      </details>
    </main>
  );
}

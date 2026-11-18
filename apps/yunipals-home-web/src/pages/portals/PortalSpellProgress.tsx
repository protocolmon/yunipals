import { Check, Clock3, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { portalImage, type PortalCard } from "@/lib/portals";
import { cn } from "@/lib/utils";

const stages = {
  queued: {
    step: 0,
    title: "Your spell is in the portal",
    detail: "Your monster is waiting for its transformation to begin."
  },
  creating: {
    step: 1,
    title: "A little magic is taking shape",
    detail: "Your spell is becoming a new piece of artwork."
  },
  grading: {
    step: 2,
    title: "Time for the finishing touches",
    detail:
      "The artwork is ready. Its creativity, harmony, craft and impact are being graded."
  },
  publishing: {
    step: 3,
    title: "Getting ready for the big reveal",
    detail: "Your artwork and grades are going through their final checks."
  }
} as const;

export function PortalSpellProgress({ card }: { card: PortalCard }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const progress = card.processing;
  const stage =
    stages[card.pending === "0" ? "publishing" : (progress?.stage ?? "queued")];
  const elapsed = progress
    ? Math.max(0, Math.floor(now / 1000 - Number(progress.acceptedAt)))
    : null;
  // A broad initial planning estimate, replaced by observed end-to-end timings.
  const estimate = progress?.estimate ?? { minSeconds: 180, maxSeconds: 600 };
  const delayed = elapsed !== null && elapsed > estimate.maxSeconds;
  const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
  const remainingMin = minutes(estimate.minSeconds - (elapsed ?? 0));
  const remainingMax = minutes(estimate.maxSeconds - (elapsed ?? 0));
  const latestAttempt = card.history.at(-1)?.id;
  const artwork =
    card.publication.find((item) => item.requestId === latestAttempt)?.result
      .slab?.uri ?? card.originalArtwork.uri;

  return (
    <section
      aria-labelledby="spell-progress-title"
      className="relative mt-6 overflow-hidden rounded-card bg-gradient-to-br from-ink via-ink to-grape p-6 text-white sm:p-8"
    >
      <div className="relative grid items-center gap-6 sm:grid-cols-[14rem_1fr]">
        <div className="relative mx-auto flex h-64 w-56 items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-4 rounded-full bg-cyanx/20 blur-2xl motion-safe:animate-pulse"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-cyanx/40 motion-safe:animate-spell-orbit"
          >
            <span className="absolute left-1/2 top-0 h-3 w-3 rounded-full bg-cyanx shadow-cta" />
            <span className="absolute bottom-0 left-1/2 h-2 w-2 rounded-full bg-lavender" />
          </div>
          <img
            src={portalImage(artwork)}
            width={1024}
            height={1536}
            alt={`Artwork for card #${card.tokenId}; a new spell is in progress`}
            className="relative max-h-56 w-36 object-contain drop-shadow-xl motion-safe:animate-float"
          />
          <span
            aria-hidden="true"
            className="absolute right-1 top-6 text-cyanx motion-safe:animate-pulse"
          >
            <Sparkles size={26} />
          </span>
          <span
            aria-hidden="true"
            className="absolute bottom-6 left-1 text-lavender motion-safe:animate-drift"
          >
            <Sparkles size={18} />
          </span>
        </div>
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyanx">
            <WandSparkles size={16} aria-hidden="true" /> Spell in progress
          </p>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h2
              id="spell-progress-title"
              className="mt-3 font-display text-2xl sm:text-3xl"
            >
              {stage.title}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80">
              {stage.detail}
            </p>
          </div>
          <div
            className="mt-5 flex flex-wrap items-center gap-3"
            aria-live="off"
          >
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold">
              <Clock3 size={16} className="text-cyanx" aria-hidden="true" />
              {delayed
                ? "Taking a little longer"
                : `Estimated ${remainingMin === remainingMax ? remainingMax : `${remainingMin}–${remainingMax}`} min${elapsed === null ? " total" : " remaining"}`}
            </p>
            {elapsed !== null && (
              <p className="text-xs tabular-nums text-white/70">
                {Math.floor(elapsed / 60)}:
                {String(elapsed % 60).padStart(2, "0")} elapsed
              </p>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/70">
            {delayed
              ? "Your spell is still pending. We’ll keep checking here; you don’t need to submit it again."
              : progress?.estimate
                ? "Estimate based on recent completed spells. Queue time and final checks can vary."
                : "Initial estimate only. Queue time and final checks can take longer."}
          </p>
          <ol
            aria-label="Spell progress"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {[
              "Spell accepted",
              "Creating artwork",
              "Grading",
              "Final checks"
            ].map((label, index) => (
              <li
                key={label}
                aria-current={index === stage.step ? "step" : undefined}
                className={cn(
                  "border-t-2 pt-3 text-xs",
                  index <= stage.step
                    ? "border-cyanx text-white"
                    : "border-white/20 text-white/60"
                )}
              >
                <span
                  className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/10"
                  aria-hidden="true"
                >
                  {index < stage.step || index === 0 ? (
                    <Check size={14} />
                  ) : index === stage.step ? (
                    <Sparkles size={14} />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="relative mt-6 border-t border-white/15 pt-4 text-xs text-white/70">
        Your current artwork is safe. This page updates automatically when your
        new artwork and grades are ready. You can leave and come back for the
        reveal.
      </p>
    </section>
  );
}

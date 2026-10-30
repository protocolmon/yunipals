import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { environment } from "@/environment";
import { usePageMetadata } from "@/hooks/usePageMetadata";

export function BoosterPhilosophyPage() {
  usePageMetadata(
    "A fairer way to open packs | Yunipals",
    "Our thinking behind Yunipals packs: a full set of 264 variants to collect over time, the fun of every reveal, and grading as the planned next layer."
  );

  return (
    <main>
      <article>
        <header className="border-b border-line bg-gradient-to-br from-lavender/30 via-white to-mint/20 px-5 py-10 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <Link
              to="/boosters"
              className="inline-flex items-center gap-2 rounded-full py-2 text-sm font-bold text-muted hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to packs
            </Link>
            <div className="mt-8 grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-grape">
                  The thinking behind packs
                </p>
                <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-ink sm:text-5xl lg:text-6xl">
                  A fairer way to open packs.
                </h1>
                <p className="mt-6 max-w-2xl text-xl leading-relaxed text-muted sm:text-2xl">
                  Everyone should get to complete the set. Every reveal should
                  still feel like a surprise.
                </p>
                <p className="mt-6 text-sm font-semibold text-muted">
                  From the Yunipals team · 3 minute read
                </p>
              </div>
              <img
                src="/images/boosters/yunipals-pack-v1.png"
                alt="Lavender Yunipals pack featuring a blue Yunidragon"
                width={1024}
                height={1536}
                className="mx-auto w-40 -rotate-6 drop-shadow-xl sm:w-48 md:w-full"
              />
            </div>
            <dl className="mt-10 grid grid-cols-1 gap-5 border-t border-grape/10 pt-7 sm:grid-cols-3 sm:gap-8">
              <div>
                <dt className="text-sm text-muted">Variants in each set</dt>
                <dd className="mt-1 font-display text-3xl text-ink">264</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">
                  Another mint unlocked every
                </dt>
                <dd className="mt-1 font-display text-3xl text-ink">
                  24 hours
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">
                  Repeat variants per original
                </dt>
                <dd className="mt-1 font-display text-3xl text-ink">Zero</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="mx-auto max-w-3xl space-y-12 px-5 py-12 text-lg leading-relaxed text-muted sm:py-16">
          <section
            aria-labelledby="packs-fairness-heading"
            className="space-y-5"
          >
            <h2
              id="packs-fairness-heading"
              className="font-display text-2xl leading-tight text-ink sm:text-3xl"
            >
              A full set for everyone.
            </h2>
            <p>
              We set out to make the fairest pack-opening experience we could
              imagine. For us, that starts with a simple idea: everyone who
              opens a pack should have a path to the whole set.
            </p>
            <p>
              Each Yunipals pack starts a collection of 264 unique variants.
              Your first Yunipal is the original, and it unlocks the rest over
              time. Keep that original and claim its daily mints, and you can
              collect every variant in its set. Each reveal adds something new;
              there are no duplicates within that original’s collection.
            </p>
            <p>
              That makes completion something you can look forward to. Every
              collector gets the same set to work towards, with their own order
              of discoveries along the way.
            </p>
          </section>

          <section aria-labelledby="packs-reveal-heading" className="space-y-5">
            <h2
              id="packs-reveal-heading"
              className="font-display text-2xl leading-tight text-ink sm:text-3xl"
            >
              The reveal is still the best part.
            </h2>
            <p>
              Tearing open a pack. Turning over a card. Meeting a Yunipal you
              haven’t seen before. We love those little moments, and we wanted
              to keep all of them.
            </p>
            <p>
              You know the full set is within reach, but you don’t know which
              variant comes next. A favorite color, a glittering card, the
              creature you’ve been waiting for: each opening has its own little
              surprise. And every card brings your collection one step closer to
              complete.
            </p>
          </section>

          <section aria-labelledby="packs-how-heading" className="space-y-6">
            <h2
              id="packs-how-heading"
              className="font-display text-2xl leading-tight text-ink sm:text-3xl"
            >
              How the packs work.
            </h2>
            <ol className="list-decimal space-y-5 pl-6 marker:font-bold marker:text-grape">
              <li className="pl-2">
                <strong className="text-ink">Open your first pack.</strong> You
                receive an original Yunipal NFT on Base. It counts as the first
                of your 264 variants and holds the right to mint the rest.
              </li>
              <li className="pl-2">
                <strong className="text-ink">
                  Let your daily mints build up.
                </strong>{" "}
                Your first extra mint unlocks 24 hours after the original is
                revealed, then another every 24 hours. Unused mints stay saved;
                you can claim up to seven together. There’s no paid speed boost.
              </li>
              <li className="pl-2">
                <strong className="text-ink">
                  Discover a new variant each time.
                </strong>{" "}
                Chainlink’s verifiable randomness chooses from the variants that
                original hasn’t minted yet. Every remaining variant has an equal
                chance, and each one is removed from its pool once drawn.
                Separate originals have separate pools, so their cards can
                match.
              </li>
              <li className="pl-2">
                <strong className="text-ink">
                  Keep collecting until the set is complete.
                </strong>{" "}
                The original plus 263 additional mints makes the full set. You
                can track your progress and claim saved mints from your
                collection.
              </li>
            </ol>
            <aside className="rounded-card border border-line bg-lavender/10 p-5 text-base sm:p-6">
              <p>
                A pack costs 1 {environment.boosterPaymentSymbol}, which is
                burned when the opening request succeeds. Opening and claiming
                also cost ETH for randomness and network fees. Daily mints don’t
                charge {environment.boosterPaymentSymbol} again.
              </p>
              <p className="mt-4">
                The mint rights belong to the original: transferring it passes
                the saved and future mints to its new owner; burning it ends
                those rights. Cards already minted stay with their owners.
              </p>
            </aside>
          </section>

          <section
            aria-labelledby="packs-grading-heading"
            className="space-y-5"
          >
            <p className="text-sm font-bold uppercase tracking-widest text-grape">
              What comes next
            </p>
            <h2
              id="packs-grading-heading"
              className="font-display text-2xl leading-tight text-ink sm:text-3xl"
            >
              Grading adds another reason to collect.
            </h2>
            <p>
              The next layer we want to add is grading. The idea is to introduce
              rarities through grading, giving collectors something extra to
              discover while keeping the full base set within everyone’s reach.
            </p>
            <p>
              Grading is planned and isn’t live yet. We’ll share how it works
              before it launches. The foundation is already here: a set you can
              complete, a collection that grows with you, and the fun of opening
              the next pack.
            </p>
          </section>

          <footer className="border-t border-line pt-8">
            <Link
              to="/boosters"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-base font-bold text-white transition-colors hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
            >
              Explore the packs
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </footer>
        </div>
      </article>
    </main>
  );
}

import { ArrowDown, ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export function PortalHero() {
  return (
    <section className="relative isolate mb-8 overflow-hidden rounded-card bg-ink text-white">
      <div className="grid lg:grid-cols-2">
        <div className="relative z-10 px-6 py-10 sm:px-10 sm:py-14 lg:pr-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-lavender/30 bg-lavender/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-sky">
            <Sparkles size={14} aria-hidden="true" /> Yunipals portals
          </p>
          <h1 className="mt-6 max-w-lg font-display text-4xl leading-tight sm:text-5xl xl:text-6xl">
            Cast your next <span className="text-sky">chapter.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/80">
            A tiny spell. A wild new look. Send your Yunipal through a portal
            and turn your imagination into a card that is unmistakably yours.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#portal-cast"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-ink shadow-cta transition hover:bg-sky focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky"
            >
              Explore the portal <ArrowDown size={16} aria-hidden="true" />
            </a>
            <a
              href="#portal-story"
              className="rounded-full px-2 py-3 text-sm font-semibold text-white underline decoration-white/40 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky"
            >
              See a transformation
            </a>
          </div>
          <p className="mt-8 text-sm text-white/65">
            One portal at a time. Eleven minutes of possibility.
          </p>
        </div>
        <div className="relative min-h-80 lg:min-h-full">
          <img
            src="/images/portals/rainbow-portal.webp"
            width={1024}
            height={1536}
            alt="A glowing rainbow portal surrounded by crystals in the Yunipals world"
            className="absolute inset-0 h-full w-full object-cover object-center"
            fetchPriority="high"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-ink via-transparent to-transparent lg:bg-gradient-to-r"
          />
          <span className="absolute bottom-5 right-5 rounded-full bg-ink/80 px-4 py-2 text-xs font-semibold backdrop-blur-sm">
            Discover the Rainbow Portal
          </span>
        </div>
      </div>
    </section>
  );
}

export function PortalStory() {
  return (
    <section
      id="portal-story"
      aria-labelledby="portal-story-title"
      className="my-12 scroll-mt-24 overflow-hidden rounded-card bg-gradient-to-br from-lavender/30 via-sky/25 to-mint/30 p-6 sm:p-10"
    >
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-grape">
            Imagine a different side
          </p>
          <h2
            id="portal-story-title"
            className="mt-3 font-display text-3xl leading-tight sm:text-4xl"
          >
            Same soul.
            <br />
            Wilder possibilities.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-muted">
            Give your gentle dragon a fearless new stance. Paint its scales with
            a rainbow. The next chapter starts with your words.
          </p>
          <ol className="mt-7 space-y-4">
            {[
              [
                "Choose your Yunipal",
                "Match your card to the open portal's gates."
              ],
              [
                "Write a spell",
                "Describe the pose, mood and magic you imagine."
              ],
              [
                "Reveal a new chapter",
                "Receive new artwork and grades for Creativity, Harmony, Craft and Impact."
              ]
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-grape">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted">
            Your NFT keeps its original artwork and every completed
            transformation. Its next spell starts from the latest completed
            version.
          </p>
        </div>
        <div>
          <div className="relative grid grid-cols-2 items-center gap-4 sm:gap-6">
            <figure className="-rotate-3 motion-safe:transition-transform motion-safe:hover:rotate-0">
              <img
                src="/images/portals/dragon-before.webp"
                width={1024}
                height={1536}
                alt="Original blue Yunidragon standing peacefully in a meadow"
                loading="lazy"
                className="w-full rounded-2xl shadow-card"
              />
              <figcaption className="mt-4 text-center text-sm font-bold">
                Before the spell
              </figcaption>
            </figure>
            <figure className="rotate-3 motion-safe:transition-transform motion-safe:hover:rotate-0">
              <img
                src="/images/portals/dragon-after.webp"
                width={1024}
                height={1536}
                alt="The same Yunidragon with rainbow scales, lunging forward through a thunderstorm"
                loading="lazy"
                className="w-full rounded-2xl shadow-cardHover"
              />
              <figcaption className="mt-4 text-center text-sm font-bold text-grape">
                A bolder chapter
              </figcaption>
            </figure>
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-grape p-2 text-white shadow-card"
            >
              <ArrowRight size={20} />
            </span>
          </div>
          <p className="mt-7 text-center text-xs leading-relaxed text-muted">
            Actual Yunipals transformation example. Artwork preview; each spell
            creates its own result.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PortalAirdropLink() {
  return (
    <Link
      to="/portals/airdrop"
      className="inline-flex items-center gap-2 rounded-full border border-lavender px-5 py-3 text-sm font-bold text-grape transition hover:bg-lavender/20"
    >
      Guided airdrop <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

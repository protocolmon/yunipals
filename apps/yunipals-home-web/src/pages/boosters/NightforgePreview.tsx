import { Gift, Layers3, Sparkles } from "lucide-react";
import { ExpandablePackArtwork } from "./ExpandablePackArtwork";

export function NightforgePreview() {
  return (
    <article
      id="nightforge"
      aria-labelledby="nightforge-heading"
      className="mt-8 grid scroll-mt-24 overflow-hidden rounded-card border border-grape/30 bg-ink text-white shadow-card md:grid-cols-2"
    >
      <figure className="flex flex-col items-center justify-center bg-gradient-to-br from-grape/30 via-ink to-grape/20 px-8 py-10 sm:py-12">
        <ExpandablePackArtwork
          image="/images/boosters/yunipals-nightforge-pack-v2.webp"
          label="Nightforge booster pack"
          alt="Nightforge booster pack in glittering violet foil, featuring Yunisingularity, Yunimantis and Yuniforge"
        />
        <figcaption className="mt-5 text-xs text-lavender">
          Pack artwork preview
        </figcaption>
      </figure>
      <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
        <p className="mb-5 w-fit rounded-full border border-lavender/30 bg-lavender/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-lavender">
          Coming soon · Collector airdrop
        </p>
        <p className="mb-2 text-sm font-bold text-lavender">Yunipals TCG</p>
        <h2
          id="nightforge-heading"
          className="font-display text-3xl sm:text-4xl"
        >
          Nightforge
        </h2>
        <p className="mt-4 text-lg font-semibold">
          A darker kind of magic is coming.
        </p>
        <p className="mt-3 leading-relaxed text-lavender">
          Meet 11 all-new Yunipals across 264 variants, with different trait
          rarities and a striking new look.
        </p>
        <ul className="my-7 space-y-5 text-sm">
          <li className="flex gap-3">
            <Layers3
              size={20}
              className="shrink-0 text-lavender"
              aria-hidden="true"
            />
            <span>
              <strong className="block">One pack. One card.</strong>
              <span className="text-lavender">
                No daily mints or additional cards every 24 hours.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <Gift
              size={20}
              className="shrink-0 text-lavender"
              aria-hidden="true"
            />
            <span>
              <strong className="block">A future gift for collectors.</strong>
              <span className="text-lavender">
                Nightforge will be airdropped to collectors. It won’t be sold,
                and no purchase or payment is required.
              </span>
            </span>
          </li>
        </ul>
        <p className="flex items-start gap-2 border-t border-lavender/20 pt-5 text-sm text-lavender">
          <Sparkles size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          Airdrop timing and eligibility will be announced later.
        </p>
      </div>
    </article>
  );
}

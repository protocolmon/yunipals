import { useState } from "react";
import {
  serumCatalogue,
  serumEssences
} from "@protopals/yunipals-market-core/serums";
import { Select, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Catalogue v1 bottle art. Presence is deliberately displayed separately. */
export function SerumArtwork({
  serumId,
  className
}: {
  serumId: number;
  className?: string;
}) {
  const serum = serumCatalogue.find((entry) => entry.id === serumId);
  if (!serum) return null;
  return (
    <img
      src={`/images/evolution/serums/${serum.id}.webp`}
      alt={`${serum.essence} ${serum.form} serum bottle`}
      width={104}
      height={104}
      loading="lazy"
      decoding="async"
      className={cn("h-24 w-24 shrink-0 rounded-xl object-contain", className)}
    />
  );
}

export function SerumCatalogue() {
  const [essence, setEssence] = useState<string>(serumEssences[0]);
  return (
    <section className="mt-12" aria-labelledby="serum-catalogue-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="serum-catalogue-title"
            className="font-display text-2xl font-bold"
          >
            A little bottle of possibility
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Explore 11 essences and 11 forms. Each found serum also carries a
            Presence, revealed separately when your companion returns.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm font-semibold">
          <label htmlFor="serum-essence">Essence</label>
          <Select id="serum-essence" value={essence} onValueChange={setEssence}>
            {serumEssences.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </Select>
        </div>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {serumCatalogue
          .filter((serum) => serum.essence === essence)
          .map((serum) => (
            <li
              key={serum.id}
              className="flex flex-col items-center rounded-2xl border border-line bg-lavender/20 p-3 text-center"
            >
              <SerumArtwork serumId={serum.id} />
              <h3 className="mt-2 font-semibold">
                {serum.essence} {serum.form}
              </h3>
              <p className="mt-1 text-sm text-muted">{serum.rarity}</p>
            </li>
          ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Serum catalogue artwork · not an inventory. Bottles represent Essence
        and Form; Presence is a separate trait.
      </p>
      <a
        href="/images/evolution/serums/catalogue.webp"
        className="mt-3 inline-block text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape"
      >
        View all 121 bottles
      </a>
    </section>
  );
}

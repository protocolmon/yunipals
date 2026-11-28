import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type MonsterActionCardsProps = {
  tokenId: string;
  canAdventure: boolean;
  canGrade: boolean;
};

export function MonsterActionCards({
  tokenId,
  canAdventure,
  canGrade
}: MonsterActionCardsProps) {
  const cards = [
    {
      visible: canAdventure,
      title: "Adventures, serums & fusion",
      description:
        "Discover adventures and new possibilities for your Yunipal.",
      action: "Explore adventures",
      href: `/adventures/cards/${tokenId}`,
      image: "adventures",
      alt: "Yunidragon discovers glowing serums in an enchanted forest."
    },
    {
      visible: canGrade,
      title: "Step into a portal",
      description: "Explore portals to give this card a new look and a grade.",
      action: "Explore grading",
      href: `/grading?card=${tokenId}`,
      image: "grading",
      alt: "Purple Yunifairy hovers beside the crystal-crowned rainbow portal."
    },
    {
      visible: true,
      title: "Artwork & grading history",
      description: "Look back through this card’s artwork and grading journey.",
      action: "View card history",
      href: `/grading/cards/${tokenId}`,
      image: "history",
      alt: "An enchanted scrapbook displays blue and red Yuniturtle artwork."
    }
  ].filter((card) => card.visible);

  return (
    <section
      aria-labelledby="monster-explore-heading"
      className="mt-12 border-t border-line pt-8"
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="monster-explore-heading" className="font-display text-xl">
          Explore this Yunipal
        </h2>
        <p className="text-xs text-muted">Illustrated previews</p>
      </div>
      <div
        className={cn(
          "grid gap-5",
          cards.length === 1 ? "max-w-sm" : "sm:grid-cols-2",
          cards.length === 3 && "lg:grid-cols-3"
        )}
      >
        {cards.map((card) => (
          <Link
            key={card.image}
            to={card.href}
            className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-cardHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape motion-reduce:transition-none"
          >
            <div className="aspect-[3/2] overflow-hidden bg-lavender/20">
              <img
                src={`/images/monster-actions/${card.image}-v1.webp`}
                alt={card.alt}
                width={768}
                height={512}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
              />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-lg font-bold leading-snug text-ink">
                {card.title}
              </h3>
              <p className="mb-5 mt-2 text-sm leading-relaxed text-muted">
                {card.description}
              </p>
              <span className="mt-auto flex items-center justify-between gap-3 text-sm font-bold text-grape">
                {card.action}
                <ArrowRight size={18} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

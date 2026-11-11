import {
  OpeningGallery,
  type OpeningGalleryGroup
} from "./opening/OpeningGallery";
import { ROUND_ONE_VARIANTS } from "./opening/variants";
import { ROUND_TWO_VARIANTS } from "./opening/variants2";

const HANDS_ON = ["scratch-foil", "foil-peel"];
const GROUPS: readonly OpeningGalleryGroup[] = [
  {
    title: "Open it yourself",
    note: "You do the opening: rub the foil away or peel it back with your finger or mouse.",
    variants: ROUND_TWO_VARIANTS.filter((variant) =>
      HANDS_ON.includes(variant.id)
    )
  },
  {
    title: "Cinematic",
    note: "One tap starts a short scene drawn in real time around the pack and the card.",
    variants: ROUND_TWO_VARIANTS.filter(
      (variant) => !HANDS_ON.includes(variant.id)
    )
  },
  {
    title: "Classic effects",
    note: "Quicker openings built on light, particles and motion.",
    variants: ROUND_ONE_VARIANTS
  }
];

export function Landing() {
  return (
    <>
      <section className="max-w-3xl space-y-4 text-lg leading-relaxed text-muted">
        <h2 className="font-display text-2xl text-ink sm:text-3xl">The idea</h2>
        <p>
          Opening a pack is the moment you meet a new Yunipal, so it should feel
          like an event. Today’s opening is a swipe and a pull. These concepts
          explore what else it could be.
        </p>
        <p>
          Every option below is playable. Pick one to open it full screen with
          sample cards, then use the arrows to move between options. Nothing
          here mints and no wallet is needed.
        </p>
      </section>
      <OpeningGallery groups={GROUPS} />
    </>
  );
}

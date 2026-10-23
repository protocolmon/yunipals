import { ChevronDown } from "lucide-react";

const questions = [
  {
    question: "What do I get when I open a pack?",
    answer:
      "You get one Yunipal NFT—your original—and unlock its own collection of 264 unique variants. Your original counts as the first of 264. Its type, color, horn and glitter are chosen at random. Only the original earns daily mints; the Yunipals minted after it don’t."
  },
  {
    question: "How much does it cost?",
    answer:
      "A pack costs 1 PROTO on Base, plus a small amount of ETH for Chainlink randomness (VRF) and network fees. The full 1 PROTO is burned when your opening request succeeds. You don’t pay PROTO again for daily mints—just ETH for randomness and network fees when you claim."
  },
  {
    question: "Do I have to mint every day?",
    answer:
      "No. Your first extra mint becomes available 24 hours after your original is revealed. After that, you earn one every 24 hours. Unused mints stack up as a daily pack on this page. Open it like a normal pack: saved mints become multiple pulls, up to seven per opening. Any extra pulls stay saved. Your cards appear in Collection. Daily mints continue until you’ve collected all 264 variants, including your original. There’s no paid speed boost."
  },
  {
    question: "Can I get duplicates?",
    answer:
      "Never within one original’s collection. Each mint picks from the variants it hasn’t minted yet, with an equal chance for each remaining variant. Each pack has its own separate collection, so Yunipals from different packs can match. Transferring a minted Yunipal doesn’t make that variant available again."
  },
  {
    question: "What happens if I transfer my original?",
    answer:
      "The new owner gets its future mints, saved mints and any Yunipals still waiting to be minted. Yunipals that have already been minted stay with their current owners."
  },
  {
    question: "What happens if I burn my original?",
    answer:
      "Burning the original permanently ends its saved, pending and future mint rights. It doesn’t burn the other Yunipals already minted from it."
  },
  {
    question: "Why is my card image still loading?",
    answer:
      "Your Yunipal is minted when its reveal completes. Artwork for a new variant may still be in preparation. Its image updates automatically when it’s ready."
  },
  {
    question: "Can I use these Yunipals in Arena or the marketplace?",
    answer:
      "These Yunipals appear in your collection and can be transferred between wallets. They aren’t eligible for Arena and aren’t included in Yunipals marketplace features."
  }
];

export function BoosterFAQ() {
  return (
    <section
      aria-labelledby="booster-faq-heading"
      className="border-b border-line bg-lavender/10 px-4 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="booster-faq-heading"
          className="font-display text-2xl text-ink sm:text-3xl"
        >
          Booster pack FAQ
        </h2>
        <p className="mt-3 text-muted">
          How your pack works, from the first reveal to the full collection.
        </p>
        <div className="mt-7 space-y-3">
          {questions.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-card border border-line bg-white open:border-grape/30"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-5 font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape sm:px-6 [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className="shrink-0 text-grape transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-5 pb-5 leading-relaxed text-muted sm:px-6">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

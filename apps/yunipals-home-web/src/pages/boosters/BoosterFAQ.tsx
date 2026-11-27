import { ChevronDown } from "lucide-react";
import { environment } from "@/environment";

const paymentSymbol = environment.boosterPaymentSymbol;

const questions = [
  {
    question: "What do I get when I open a pack?",
    answer:
      "You get one Yunipal NFT—your original—and unlock its own collection of 264 unique variants. Your original counts as the first of 264. Its type, color, horn and glitter are chosen at random. Only the original earns daily mints; the Yunipals minted after it don’t."
  },
  {
    question: "Can I open more than one pack at once?",
    answer: `Use the quantity selector to choose how many packs to buy in one opening transaction. You’ll unwrap one pack with all your cards inside. Each purchased pack gives you a separate original with its own daily mints and collection progress. The review shows the total ${paymentSymbol} price and randomness fee. Where supported, sign a gas-free approval that’s included in the opening transaction.`
  },
  {
    question: "How much does it cost?",
    answer: `A pack costs 1 ${paymentSymbol} on Base, plus a small amount of ETH for Chainlink randomness (VRF) and network fees. The full 1 ${paymentSymbol} is burned when your opening request succeeds. You don’t pay ${paymentSymbol} again for daily mints—just ETH for randomness and network fees when you claim.`
  },
  {
    question: "Do I have to mint every day?",
    answer:
      "Check the policy shown on your pack. New expiring packs offer one claim in each 24-hour window, starting 24 hours after reveal. Claim all 263 daily windows to mint the full 264-variant set. Missed windows are permanently lost, and the schedule ends 264 days after reveal. Older packs keep their original rights: unused daily mints stay saved and can be claimed later, up to seven at a time. An accepted claim still completes if randomness arrives after its window closes."
  },
  {
    question: "Can I get duplicates?",
    answer:
      "Never within one original’s collection. Each mint picks from the variants it hasn’t minted yet, with an equal chance for each remaining variant. Each pack has its own separate collection, so Yunipals from different packs can match. Transferring a minted Yunipal doesn’t make that variant available again."
  },
  {
    question: "What happens if I transfer my original?",
    answer:
      "The new owner gets its remaining mint rights under the same pack policy. Expiring windows keep their original schedule; transferring does not restore missed days. Older packs transfer their saved mints too. Yunipals that have already been minted stay with their current owners."
  },
  {
    question: "What happens if I burn my original?",
    answer:
      "Burning the original permanently ends its saved, pending and future mint rights. It doesn’t burn the other Yunipals already minted from it."
  },
  {
    question: "Why is my card image still loading?",
    answer:
      "All 264 variant artworks are already prepared. After the random draw completes, your cards load automatically. A slow connection can briefly delay the image; it doesn’t affect your NFT."
  },
  {
    question: "Can I use these Yunipals in Arena or the marketplace?",
    answer:
      "These Yunipals appear in your collection and can be transferred between wallets. They aren’t eligible for Arena and aren’t included in Yunipals marketplace features."
  }
];

if (environment.boosterLaunchId === "base-ypal-v1") {
  questions.splice(3, 0, {
    question: "What is YPAL?",
    answer:
      "YPAL (Yunipals) wraps PMON one-for-one on Base: wrapping 1 PMON gives you 1 YPAL, and unused YPAL can be unwrapped back to PMON. When a pack burns YPAL, its backing PMON is sent to the burn destination. YPAL is a separate token from PROTO."
  });
}

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
          These answers cover Yunipals booster packs and their daily mints. Each
          pack shows whether unused claims are saved or expire. Nightforge is a
          separate upcoming collector airdrop: one card per pack, no daily mints
          and no purchase or payment required. Its timing and eligibility will
          be announced later.
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

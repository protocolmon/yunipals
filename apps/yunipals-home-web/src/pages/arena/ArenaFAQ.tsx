import { ArrowRight, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";

const questions = [
  {
    question: "How does an Arena battle work?",
    answer:
      "Four Yunipal NFTs enter a tournament on a randomly selected island. You write your fighter’s strategy, then an AI referee decides two semifinals and a final. The champion wins the prize. You can watch the matches in a battle film. Your NFT stays in your wallet."
  },
  {
    question: "How do I get my Yunipal into Anime Arena?",
    answer:
      "Anime battles are for approved Base OG Yunipals. Apply from your Yunipal’s token page; applying costs only Base network gas. A curator must approve your fighter before it can enter. Fighter approval and artwork follow the NFT if it is transferred. Yunipals from booster packs are not eligible."
  },
  {
    question: "What does it cost, and what can I win?",
    answer:
      "Anime entry costs 1 USDC per fighter, with 3.20 USDC for the champion of a full tournament. Video entry costs 2 USDC, with a 6 USDC champion prize. The rest goes to the island’s hosting beneficiary and operations. You also need Base ETH for gas. The first entrant pays the island draw fee shown before confirmation; unused draw-fee ETH is returned automatically."
  },
  {
    question: "How do strategies and anime techniques work?",
    answer:
      "Once all four fighters and the island are ready, you have up to 24 hours to submit a strategy of up to 2,400 characters, including plans for the final. Anime fighters have three signature techniques: choose two, or use the default pair. Techniques shape the attacks and their appearance in the film; they do not add bonus stats. Submitting locks your strategy and technique choices. Missing the deadline uses an automatic legal attack and the default techniques."
  },
  {
    question: "What decides who wins?",
    answer:
      "A central AI referee interprets the strategies under shared combat limits, taking the selected island’s terrain into account. Fighters reset between matches. Exact ties use the priority published before strategy submission. The result is fixed before the film is made, so animation imperfections do not change the winner."
  },
  {
    question: "How long does a tournament take?",
    answer:
      "A lobby has up to seven days to fill after its first entry. Once the fighters and island are ready, the strategy window lasts up to 24 hours; ready tournaments advance immediately. After the inputs are frozen, the referee has up to 24 hours to resolve the result. Film production follows, so a technical video delay can keep rewards pending."
  },
  {
    question: "Can I leave a battle or get a refund?",
    answer:
      "There are no early withdrawals. If the lobby does not fill in time, entry fees are refundable. Missed input-freezing or referee deadlines also allow entry-fee refunds under the published rules. Missing your own strategy deadline does not refund your entry; your fighter uses an automatic attack. Network gas and an island draw fee already spent are not refunded."
  },
  {
    question: "Where do I claim my prize or refund?",
    answer:
      "Open Rewards & claims inside your chosen arena. Prizes become available after the completed film is published and the payout transaction is confirmed and indexed. Refunds appear after their transactions are indexed. A claim withdraws your combined available USDC balance. The entering wallet keeps its entry and prize rights even if the NFT is later sold or gifted."
  }
];

export function ArenaFAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="arena-faq-heading"
      className="mt-12 border-t border-line pt-10 sm:mt-16 sm:pt-12"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="arena-faq-heading"
          className="font-display text-2xl sm:text-3xl"
        >
          Arena FAQ
        </h2>
        <p className="mt-3 text-muted">
          Entry, strategies, rewards and refunds.
        </p>
        <div className="mt-7 space-y-3">
          {questions.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-card border border-line bg-white open:border-grape/30"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape sm:px-6 [&::-webkit-details-marker]:hidden">
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
        <nav
          aria-label="Full Arena rules"
          className="mt-6 flex flex-wrap gap-x-6 gap-y-4"
        >
          {[
            { path: "/arena/anime/rules", label: "Full anime rules" },
            { path: "/arena/video/rules", label: "Full video rules" }
          ].map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className="inline-flex min-h-11 items-center gap-2 rounded font-semibold text-grape underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
            >
              {label} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}

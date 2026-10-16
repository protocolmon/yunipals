import { useQuery } from "@tanstack/react-query";
import { environment } from "@/environment";
import { arenaRequest } from "@/lib/arenaLive";
import { ArenaNavigation } from "./ArenaNavigation";
import { ArenaLoading } from "./ArenaFeedback";

export function ArenaRulesPage() {
  const rules = useQuery({
    queryKey: ["arena-live", "rules"],
    queryFn: ({ signal }) =>
      arenaRequest<{ rulesHash: string; manifest: unknown }>(
        "/rules",
        undefined,
        signal
      ),
    enabled: !!environment.arenaApiUrl,
    staleTime: 60000
  });
  return (
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-12 text-ink">
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Yunipals Arena
      </p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl">
        How the Arena works
      </h1>
      <ArenaNavigation />
      <div className="space-y-6">
        <section className="rounded-card border border-line bg-white p-6">
          <h2 className="text-xl font-bold">Enter with your Yunipal</h2>
          <p className="mt-3 text-muted">
            Four different Yunipal NFTs fight two semifinals and a final. The
            bracket follows entry order: seats 1–2 and seats 3–4. A wallet can
            enter multiple NFTs. Each NFT can occupy one active seat and stays
            in your wallet.
          </p>
          <p className="mt-3 text-muted">
            Entry costs 2 USDC on Base. The eight-USDC pool pays 6 USDC to the
            champion, 0.40 USDC to the island hosting beneficiary and 1.60 USDC
            to operations. Wallet transactions also require Base ETH for gas.
          </p>
        </section>
        <section className="rounded-card border border-line bg-white p-6">
          <h2 className="text-xl font-bold">An island selected by VRF</h2>
          <p className="mt-3 text-muted">
            The first entry requests one verifiable island draw. All 898
            revealed Base islands are eligible. Each Genesis island has three
            tickets and each Personal island has one: 1,948 tickets in total.
            The island is never rerolled.
          </p>
          <p className="mt-3 text-muted">
            Terrain, cover and the island's published combat profile affect how
            actions can work. Cosmetic rarity grants no free damage or new
            powers. The island resident stays off the fighting surface and does
            not attack.
          </p>
        </section>
        <section className="rounded-card border border-line bg-white p-6">
          <h2 className="text-xl font-bold">Write your own strategy</h2>
          <p className="mt-3 text-muted">
            Once all four fighters and the island are ready, you have up to 24
            hours to submit a custom strategy of up to 2,400 characters. Include
            attacks, defenses and conditional plans for the final. Each
            submission locks.
          </p>
          <p className="mt-3 text-muted">
            The server stores strategies privately until the complete input is
            frozen. Its operator can read them. Missing the deadline assigns
            your fighter an automatic legal attack; your full entry stays in the
            pool. Player and automatic strategies are revealed together after
            confirmation.
          </p>
        </section>
        <section className="rounded-card border border-line bg-white p-6">
          <h2 className="text-xl font-bold">One result, then a battle film</h2>
          <p className="mt-3 text-muted">
            The central AI referee interprets both players' strategies under the
            same health, energy, damage, range and timing limits. Winged
            fighters fly. Fighters and the island reset between matches. Exact
            ties use the published priority shown before strategy submission.
          </p>
          <p className="mt-3 text-muted">
            The bracket and champion are fixed before producing the 24-second
            film. Video imperfections do not change the result. All rewards
            unlock after the completed film is published and the payout
            transaction is confirmed. A technical video delay keeps those
            rewards pending.
          </p>
          <p className="mt-3 text-muted">
            VRF proves the island draw. AI adjudication is centralized. Results
            are public onchain; hiding them on the website is a viewing
            preference.
          </p>
        </section>
        <section className="rounded-card border border-line bg-white p-6">
          <h2 className="text-xl font-bold">
            Deadlines, ownership and refunds
          </h2>
          <ul className="mt-3 list-disc space-y-3 pl-5 text-muted">
            <li>
              The first entry starts a seven-day joining window. An unfilled
              lobby refunds every entrant in full. An empty lobby has no running
              deadline.
            </li>
            <li>
              There are no early withdrawals. A missed strategy uses an
              automatic attack and continues the tournament.
            </li>
            <li>
              The server has a fixed 24-hour recovery window after the strategy
              deadline to freeze input. Failure to advance within it allows full
              refunds. Once frozen, the referee has 24 hours to settle a result;
              a missed referee deadline also allows full refunds.
            </li>
            <li>
              The entering wallet keeps its entry and prize if the NFT is later
              sold or gifted.
            </li>
            <li>
              The hosting beneficiary is the island owner when selection is
              finalized. Later transfers do not move that tournament's reward. A
              burned or unavailable island keeps the same draw and sends its
              hosting share to the recorded operations treasury.
            </li>
            <li>
              Refunds and rewards become available after their transactions are
              indexed. A claim withdraws your combined available USDC balance.
            </li>
          </ul>
        </section>
        <details className="rounded-card border border-line p-6">
          <summary className="cursor-pointer font-semibold">
            Published rules version
          </summary>
          {environment.arenaApiUrl && rules.isPending ? (
            <div className="mt-4">
              <ArenaLoading label="Loading published rules…" />
            </div>
          ) : environment.arenaApiUrl && rules.isError ? (
            <p role="alert" className="mt-4">
              The live rules service is unavailable. The published launch copy
              is available below.{" "}
              <button
                className="font-semibold underline"
                onClick={() => void rules.refetch()}
              >
                Try again
              </button>
            </p>
          ) : rules.data ? (
            <>
              <p className="mt-4 break-all font-mono text-xs text-muted">
                {rules.data?.rulesHash}
              </p>
              <a
                href={`${environment.arenaApiUrl}/rules`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-semibold underline"
              >
                View complete rules manifest
              </a>
            </>
          ) : null}
          <a
            href="/arena/rules-v1.json"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block font-semibold underline"
          >
            Read the published launch manifest
          </a>
          <p className="mt-2 text-sm text-muted">
            Compare its rules hash with the hash recorded for your tournament.
          </p>
        </details>
      </div>
    </main>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import { ArenaArtwork } from "../ArenaArtwork";
import { ArenaLoading } from "./ArenaFeedback";
import { ArenaPageHeader } from "./ArenaPageHeader";

const approvalReasons = [
  {
    title: "Artwork not ready",
    description: "The NFT is unrevealed or still uses placeholder artwork."
  },
  {
    title: "Fighter needs another attempt",
    description:
      "A consistent fighter could not be created. Reapply after the creation process is updated."
  },
  {
    title: "Artwork already queued",
    description: "The same artwork is already waiting for review."
  },
  {
    title: "Applications paused",
    description: "The queue is closed for now."
  },
  {
    title: "Traits changed",
    description:
      "The NFT’s traits changed after approval and need a new review."
  },
  {
    title: "Another reason",
    description: "Read the curator’s note on your application for details."
  }
];

function RuleDetails({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-line bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="shrink-0 text-grape transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-4 px-5 pb-5 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </details>
  );
}

function RuleStep({
  number,
  title,
  children
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b border-line py-8 sm:grid-cols-[2.5rem_1fr] sm:gap-6 sm:py-10">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-lavender/25 text-sm font-bold text-grape"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
        <div className="mt-4 space-y-4 leading-relaxed text-muted">
          {children}
        </div>
      </div>
    </section>
  );
}

export function ArenaRulesPage() {
  const deployment = useArenaDeployment();
  const isAnime = deployment.kind === "anime";
  const arenaRequest = useArenaRequest();
  const rules = useQuery({
    queryKey: ["arena-live", deployment.scope, "rules"],
    queryFn: ({ signal }) =>
      arenaRequest<{ rulesHash: string; manifest: unknown }>(
        "/rules",
        undefined,
        signal
      ),
    enabled: !!deployment.apiUrl,
    staleTime: 60000
  });
  const manifestUrl = deployment.apiUrl
    ? `${deployment.apiUrl}/rules`
    : isAnime
      ? null
      : "/arena/rules-v1.json";

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <ArenaPageHeader
        title="How the Arena works"
        description="Four fighters, two semifinals, one champion. Here’s how to enter and play."
      />
      <section
        aria-labelledby="arena-start-heading"
        className="overflow-hidden rounded-card border border-line bg-lavender/10"
      >
        <div className="grid items-center lg:grid-cols-2">
          <div className="p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest text-grape">
              Before your first battle
            </p>
            <h2
              id="arena-start-heading"
              className="mt-3 font-display text-2xl sm:text-3xl"
            >
              {isAnime ? "Get your fighter ready" : "Bring your Yunipal"}
            </h2>
            <p className="mt-4 max-w-lg leading-relaxed text-muted">
              {isAnime
                ? "Anime battles are for approved Base OG Yunipals. Apply from your NFT’s page, then wait for a curator to approve your fighter. Applying costs only Base gas."
                : "Choose an eligible Yunipal from your wallet and join a four-fighter tournament. Your NFT stays in your wallet throughout the battle."}
            </p>
            <Link
              to={deployment.basePath}
              className="mt-6 inline-flex min-h-12 items-center gap-3 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape motion-reduce:transition-none"
            >
              {isAnime ? "Explore anime battles" : "Explore video battles"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <figure className="min-w-0 p-4 pt-0 sm:p-6 lg:pl-0">
            <ArenaArtwork kind={deployment.kind} className="rounded-2xl" />
            <figcaption className="mt-2 text-center text-xs text-muted">
              Arena artwork preview
            </figcaption>
          </figure>
        </div>
        {isAnime && (
          <div className="px-6 pb-6 sm:px-8 sm:pb-8">
            <RuleDetails title="Fighter approval and application issues">
              <p>
                Approval and fighter artwork stay with the NFT when it is sold.
                Changed traits need a new review. If approval is revoked, a
                curator must approve the fighter again before it can enter.
              </p>
              <p>
                If your application is rejected, check the public reason and
                curator note. You can reapply. These are the possible reasons:
              </p>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {approvalReasons.map(({ title, description }) => (
                  <div key={title} className="border-t border-line py-4">
                    <dt className="font-semibold text-ink">{title}</dt>
                    <dd className="mt-1">{description}</dd>
                  </div>
                ))}
              </dl>
            </RuleDetails>
          </div>
        )}
      </section>

      <div className="mx-auto mt-4 max-w-3xl">
        <RuleStep number="01" title="Join a tournament">
          <p>
            Four different NFTs compete. Entry order sets the semifinals: seats
            1–2 and seats 3–4. You can enter more than one NFT, but each NFT can
            hold only one active seat. Your NFTs stay in your wallet.
          </p>
          <div className="rounded-2xl bg-lavender/15 p-5 sm:p-6">
            <p className="text-sm font-semibold text-ink">
              Entry: {deployment.entry} USDC per fighter on Base
            </p>
            <dl className="mt-4 grid gap-4 border-t border-grape/10 pt-4 sm:grid-cols-3">
              {[
                { label: "Champion", value: deployment.champion },
                { label: "Island host", value: isAnime ? "0.20" : "0.40" },
                { label: "Operations", value: isAnime ? "0.60" : "1.60" }
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs">{label}</dt>
                  <dd className="mt-1 text-lg font-bold text-ink">
                    {value} <span className="text-xs font-medium">USDC</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs">Payouts shown for a full tournament.</p>
          </div>
          <p>
            You also need Base ETH for network gas.
            {deployment.shared &&
              " The first entrant pays the island draw fee shown before confirmation. Later entrants do not pay that fee. Unused ETH is returned automatically; if your wallet rejects the transfer, you can claim it separately."}
          </p>
          <RuleDetails title="How the island is chosen">
            <p>
              The first entry requests a verifiable random draw (VRF). All 898
              revealed Base islands are eligible. Genesis islands have three
              tickets each; Personal islands have one, for 1,948 tickets in
              total. The draw is never repeated.
            </p>
            <p>
              Terrain, cover and the island’s combat profile affect the fight.
              Cosmetic rarity adds no damage or powers. The island’s resident
              does not fight.
            </p>
            {isAnime && (
              <p>
                Anime films currently share one backdrop. The drawn island still
                sets the terrain rules and determines who receives the hosting
                reward.
              </p>
            )}
          </RuleDetails>
        </RuleStep>

        <RuleStep number="02" title="Write your battle plan">
          <p>
            Once all four fighters and the island are ready, you have up to 24
            hours to submit a strategy of up to 2,400 characters. Describe your
            attacks, defenses and plans for the final. You cannot edit a
            strategy after submitting it.
          </p>
          {isAnime && (
            <p>
              Pick two of your fighter’s three signature techniques, or keep the
              default pair. Their names and descriptions guide the referee and
              their effects appear in the film. They add no extra damage,
              energy, speed or defense. Your choices lock with your strategy.
            </p>
          )}
          <RuleDetails title="Missed deadlines and strategy privacy">
            <p>
              If you miss the deadline, your fighter uses an automatic legal
              attack{isAnime ? " and the default techniques" : ""}. Your entry
              fee stays in the prize pool.
            </p>
            <p>
              Other players cannot see your strategy until all battle inputs are
              locked and confirmed. The server operator can read it. Submitted
              and automatic strategies are then revealed together.
            </p>
          </RuleDetails>
        </RuleStep>

        <RuleStep number="03" title="Watch the fight">
          <p>
            A central AI referee judges the strategies using the same health,
            energy, damage, range and timing limits for every fighter. Winged
            fighters can fly. Fighters and the island reset between matches.
            Exact ties use the priority shown before you submit your strategy.
          </p>
          <p>
            The result is decided before the{" "}
            {isAnime ? "full tournament" : "24-second"} film is made. Animation
            errors do not change the winner. Results are recorded onchain; the
            AI judging is centralized.
          </p>
        </RuleStep>

        <RuleStep number="04" title="Claim your rewards">
          <p>
            Rewards unlock after the finished film is published and the payout
            transaction is confirmed and indexed. A delay in film production
            keeps rewards pending.
          </p>
          <p>
            Open{" "}
            <Link
              to={`${deployment.basePath}/rewards`}
              className="rounded font-semibold text-grape underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
            >
              Rewards &amp; claims
            </Link>{" "}
            to withdraw your available USDC, including any refunds, in one
            claim.
          </p>
          <RuleDetails title="Deadlines and refunds">
            <p>
              There are no early withdrawals. Ready tournaments advance
              immediately; these are the maximum waiting times.
            </p>
            <dl className="divide-y divide-line">
              {[
                {
                  title: "Lobby · 7 days",
                  text: "Starts with the first entry. If all four seats do not fill, every entrant can recover their full entry fee. Empty lobbies have no deadline."
                },
                {
                  title: "Strategies · 24 hours",
                  text: "Starts when the fighters and island are ready. A missed strategy uses an automatic attack; it does not qualify for a refund."
                },
                {
                  title: "Input recovery · 24 hours",
                  text: "After the strategy deadline, the server has 24 hours to lock the battle inputs. If it fails, full entry-fee refunds become available."
                },
                {
                  title: "Referee · 24 hours",
                  text: "Starts when the inputs are locked. If the referee misses this deadline, full entry-fee refunds become available."
                }
              ].map(({ title, text }) => (
                <div key={title} className="py-4 first:pt-0">
                  <dt className="font-semibold text-ink">{title}</dt>
                  <dd className="mt-1">{text}</dd>
                </div>
              ))}
            </dl>
            <p>
              Network gas and the island draw fee already spent are not
              refundable. Refunds appear after the refund transaction is
              indexed.
            </p>
          </RuleDetails>
          <RuleDetails title="Selling a fighter or island during a battle">
            <p>
              The wallet that entered keeps its entry and prize rights if the
              fighter is sold or gifted.
            </p>
            <p>
              The island owner when the draw is finalized receives the hosting
              reward, even if the island is later transferred. A burned or
              unavailable island keeps the same draw; its hosting share goes to
              the recorded operations treasury.
            </p>
          </RuleDetails>
        </RuleStep>

        <div className="mt-8">
          <RuleDetails title="Published rules and verification">
            {deployment.apiUrl && rules.isPending ? (
              <ArenaLoading label="Loading published rules…" />
            ) : deployment.apiUrl && rules.isError ? (
              <p role="alert">
                Could not load the published rules.{" "}
                <button
                  className="rounded font-semibold text-grape underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                  onClick={() => void rules.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : rules.data ? (
              <div>
                <p className="font-semibold text-ink">Rules hash</p>
                <p className="mt-2 break-all font-mono text-xs">
                  {rules.data.rulesHash}
                </p>
                <p className="mt-3">
                  Compare this with the rules hash recorded for your tournament.
                </p>
              </div>
            ) : (
              <p>Live rules are not connected in this environment.</p>
            )}
            {manifestUrl && (
              <a
                href={manifestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded font-semibold text-grape underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
              >
                {deployment.apiUrl
                  ? "Read the complete rules"
                  : "Read the launch rules"}
              </a>
            )}
          </RuleDetails>
        </div>
      </div>
    </main>
  );
}

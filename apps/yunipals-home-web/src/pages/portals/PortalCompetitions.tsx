import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  BaseError,
  encodeFunctionData,
  isAddress,
  zeroAddress,
  type Address
} from "viem";
import { z } from "zod";
import { ArrowRight, ChevronDown, Gift, Sparkles, Trophy } from "lucide-react";
import {
  portalCompetitionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { cn } from "@/lib/utils";
import { environment } from "@/environment";
import { portalPrice, portalRequest } from "@/lib/portals";
import { readPortalContracts } from "@/lib/portalClaims";

const uint = z.string().regex(/^\d+$/);
const walletAddress = z.string().refine(isAddress);
const schema = z.object({
  competition: z
    .object({
      address: walletAddress,
      fee: uint,
      batchSize: uint,
      nextBatch: uint,
      accepting: z.boolean(),
      phase: z.enum(["open", "grading", "theme"]),
      theme: z.object({
        title: z.string(),
        brief: z.string(),
        hash: z.string()
      })
    })
    .passthrough()
    .nullable(),
  batches: z.array(
    z.object({
      id: uint,
      funded: z.number(),
      completed: z.number(),
      settled: z.boolean(),
      ready: z.boolean(),
      pool: uint,
      theme: z.object({ title: z.string(), brief: z.string() }),
      leaders: z.array(
        z
          .object({
            entryId: uint,
            requestId: uint,
            submitter: walletAddress,
            score: z.number(),
            rank: z.number(),
            amount: uint,
            paid: z.boolean()
          })
          .nullable()
      )
    })
  ),
  nextBefore: uint.nullable().optional()
});

export function PortalCompetitions() {
  const { tracker } = usePortalTransactions();
  const [before, setBefore] = useState<string>();
  const query = useQuery({
    queryKey: ["portals", "competitions", before],
    queryFn: async ({ signal }) =>
      schema.parse(
        await portalRequest(
          `/competitions${before ? `?before=${before}` : ""}`,
          { signal }
        )
      ),
    refetchInterval: 8000
  });
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const signer = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualBatch, setManualBatch] = useState("");
  const competition = query.data?.competition;
  const batchSize = competition?.batchSize;
  const contribution = query.data?.competition?.fee;
  const fullPool =
    batchSize && contribution
      ? (BigInt(batchSize) * BigInt(contribution)).toString()
      : undefined;
  const busyRef = useRef(false);
  const current = useRef({ address, chainId });
  current.current = { address, chainId };
  async function settle(batchId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (
        !address ||
        !client ||
        !signer.data ||
        chainId !== environment.portalChainId
      )
        throw new Error(
          "Connect your wallet on the portal network to settle prizes."
        );
      if (!/^[1-9][0-9]*$/.test(batchId) || BigInt(batchId) >= 2n ** 256n)
        throw new Error("Enter a valid competition number.");
      const guard = () => {
        if (
          current.current.address !== address ||
          current.current.chainId !== chainId
        )
          throw new Error("Your wallet changed. Please try again.");
      };
      const { deployment, block } = await readPortalContracts(client);
      const pool = await client.readContract({
        address: deployment.grading,
        abi: portalGradingAbi,
        functionName: "competition",
        blockNumber: block.number
      });
      guard();
      if (pool === zeroAddress)
        throw new Error("Competitions are being prepared.");
      if (
        query.data?.competition &&
        pool.toLowerCase() !== query.data.competition.address.toLowerCase()
      )
        throw new Error("Competition changed. Refresh this page.");
      if (!tracker) throw new Error("Transaction tracking is unavailable.");
      tracker.assertAvailable(`settle:${pool.toLowerCase()}:${batchId}`);
      const simulation = await client.simulateContract({
        address: pool as Address,
        abi: portalCompetitionAbi,
        functionName: "settle",
        args: [BigInt(batchId)],
        account: address
      });
      guard();
      const hash = await signer.data.writeContract({
        ...simulation.request,
        chain: client.chain
      });
      const tracked = tracker.add(hash, {
        to: pool,
        data: encodeFunctionData({
          abi: portalCompetitionAbi,
          functionName: "settle",
          args: [BigInt(batchId)]
        }),
        value: "0",
        actionKey: `settle:${pool.toLowerCase()}:${batchId}`,
        label: `Settle challenge #${batchId}`
      });
      const receipt = await tracker.wait(tracked.id, setMessage);
      guard();
      if (receipt.status !== "success")
        throw new Error("Prize settlement did not complete. Please retry.");
      await query.refetch();
      setMessage(
        "Settlement confirmed and indexed. Each successful transfer is marked paid; any unpaid prize can be retried."
      );
    } catch (e) {
      setError(
        e instanceof BaseError
          ? e.shortMessage
          : e instanceof Error
            ? e.message
            : "Unable to settle prizes."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="mb-8 overflow-hidden rounded-card border border-lavender/40 bg-white shadow-card"
      aria-labelledby="competition-title"
    >
      <div className="p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
              <Trophy size={16} aria-hidden="true" /> The spell challenge
            </p>
            <h2
              id="competition-title"
              className="mt-3 text-balance font-display text-2xl leading-tight text-ink sm:text-3xl"
            >
              Your imagination. A winning spell.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Create a standout transformation. The three highest grades in each
              competition share the prize pool.
            </p>
          </div>
          {batchSize && (
            <span className="rounded-full border border-lavender/50 bg-lavender/15 px-4 py-2 text-xs font-bold text-grape">
              {batchSize} spells per competition
            </span>
          )}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-lavender/30 via-lavender/10 to-sky/25 p-5 sm:p-6">
            <div className="relative flex flex-col items-center gap-6 sm:flex-row">
              <div className="min-w-0 flex-1" aria-live="polite">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-grape">
                  <Sparkles size={15} aria-hidden="true" />
                  {competition?.accepting
                    ? `Challenge #${competition.nextBatch}`
                    : competition
                      ? "Between challenges"
                      : "Made for your imagination"}
                </p>
                <h3 className="mt-3 text-balance font-display text-xl text-ink">
                  {competition?.accepting
                    ? competition.theme.title
                    : competition?.phase === "grading"
                      ? "Great spells take a little time."
                      : competition
                        ? "A new challenge is taking shape."
                        : "Every transformation tells a story."}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink">
                  {competition?.accepting
                    ? competition.theme.brief
                    : competition?.phase === "grading"
                      ? "This challenge is full. The final cards are being graded before the next theme is revealed."
                      : competition
                        ? "The next theme is inspired by the three winners. Entries reopen when it is published."
                        : "Bring your own idea, cast a spell, and see what your Yunipal becomes."}
                </p>
                {competition && (
                  <p className="mt-3 text-xs leading-relaxed text-muted">
                    {competition.accepting
                      ? "Theme fit counts toward Harmony. Make the spell your own."
                      : "No entry payment is taken while waiting. Portal windows continue on their usual schedule."}
                  </p>
                )}
                <a
                  href="#portal-cast"
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-grape px-5 py-2.5 text-sm font-bold text-white transition hover:bg-grape/90 focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
                >
                  {competition?.accepting
                    ? "Create your spell"
                    : "Explore the portal"}
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
              <figure className="flex w-full shrink-0 items-center gap-4 sm:block sm:w-32 xl:w-36">
                <img
                  src="/images/portals/dragon-after.webp"
                  width={1024}
                  height={1536}
                  loading="lazy"
                  alt="Example transformation: a Yunidragon with rainbow scales"
                  className="w-24 shrink-0 rotate-3 rounded-xl shadow-card sm:w-full"
                />
                <figcaption className="text-xs leading-relaxed text-muted sm:mt-4 sm:text-center">
                  Transformation example
                  <br />
                  Not a competition entry
                </figcaption>
              </figure>
            </div>
          </div>

          <aside
            className="relative overflow-hidden rounded-2xl bg-ink p-6 text-white"
            aria-label="Competition prizes"
          >
            <Trophy
              size={100}
              strokeWidth={1}
              aria-hidden="true"
              className="pointer-events-none absolute -right-3 -top-3 rotate-12 text-lavender/10"
            />
            <p className="relative text-xs font-bold uppercase tracking-widest text-sky">
              Full-batch prize pool
            </p>
            <p className="relative mt-4 flex flex-wrap items-baseline gap-2">
              <span className="font-display text-4xl">
                {fullPool ? portalPrice(fullPool) : "—"}
              </span>
              <span className="text-sm font-semibold text-white/70">USDC</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">
              {contribution
                ? `${portalPrice(contribution)} USDC added by every paid spell.`
                : "Paid spells fund each competition."}
            </p>
            <ol
              className="mt-6 grid grid-cols-3 gap-2 border-t border-white/15 pt-5"
              aria-label="Prize split"
            >
              {[
                { place: "1st", share: "50%" },
                { place: "2nd", share: "30%" },
                { place: "3rd", share: "20%" }
              ].map(({ place, share }) => (
                <li key={place} className="text-center">
                  <span
                    className={cn(
                      "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                      place === "1st"
                        ? "bg-sky text-ink"
                        : "bg-white/10 text-white/80"
                    )}
                  >
                    {place}
                  </span>
                  <span className="mt-2 block text-lg font-bold">{share}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-xs leading-relaxed text-white/60">
              Top three grades win. Your grade appears as soon as your card is
              ready.
            </p>
          </aside>
        </div>

        <details className="group mt-5 rounded-2xl border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape [&::-webkit-details-marker]:hidden">
            How the competition works
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="shrink-0 text-muted transition group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="space-y-3 border-t border-line px-5 py-4 text-sm leading-relaxed text-muted">
            <p>
              {batchSize && contribution && fullPool
                ? `Each paid spell adds ${portalPrice(contribution)} USDC. The best three grades in each group of ${batchSize} share ${portalPrice(fullPool)} USDC: 50% / 30% / 20%.`
                : "Paid spells contribute to an onchain prize pool, shared by the top three grades: 50% / 30% / 20%."}
            </p>
            <p>
              Entries follow submission order across all portals. Four final
              scores determine rank; earlier entries win ties. Prizes go to the
              submitting wallet. Separate paid attempts can win multiple places.
            </p>
            <p>
              Write your own interpretation. Theme fit contributes to Harmony.
              Shared theme ideas are allowed; copying another player's
              distinctive spell still reduces Creativity.
            </p>
            <p>
              Once every entry in a batch is graded, any player can settle the
              competition and pay all three winners in one transaction. The
              caller pays network gas; the full prize pool goes to the recorded
              winners.
            </p>
            <p>
              Entries reopen after all grades are complete and a theme inspired
              by the three winners is published.
            </p>
          </div>
        </details>
        {query.isPending && (
          <p role="status" className="mt-4 animate-pulse">
            Loading competitions…
          </p>
        )}
        {query.isError && (
          <p role="alert" className="mt-4 text-grape">
            Competition results are temporarily unavailable.
          </p>
        )}
        <div
          className={cn(
            "grid gap-4 md:grid-cols-2",
            Boolean(query.data?.batches.length) && "mt-5"
          )}
        >
          {query.data?.batches.map((batch) => (
            <article
              key={batch.id}
              className="rounded-2xl border border-line bg-white p-5"
            >
              <h3 className="font-bold">
                Competition #{batch.id} · {portalPrice(batch.pool)} USDC
              </h3>
              <p className="mt-1 text-sm font-semibold">{batch.theme.title}</p>
              <p className="mt-1 text-sm">
                {batch.funded}/{batchSize} entered · {batch.completed}/
                {batchSize} graded
              </p>
              <progress
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-lavender/30 [&::-webkit-progress-value]:bg-grape [&::-moz-progress-bar]:bg-grape"
                value={batch.completed}
                max={Number(batchSize) || Math.max(batch.funded, 1)}
                aria-label={`Graded entries in competition ${batch.id}`}
              />
              <p className="mt-2 text-xs text-muted">
                {batch.settled
                  ? "Winners finalized"
                  : batch.ready
                    ? "Ready for prize settlement"
                    : "Prizes wait for every entry in the batch to be graded"}
              </p>
              <ol className="mt-3 space-y-2 text-sm">
                {batch.leaders.map(
                  (leader, i) =>
                    leader && (
                      <li
                        key={leader.entryId}
                        className="rounded-xl bg-lavender/15 p-3"
                      >
                        <span className="font-bold">
                          #{i + 1} · {(leader.score / 4).toFixed(2)}/100
                        </span>
                        <span className="ml-2">
                          {portalPrice(leader.amount)} USDC
                          {batch.settled
                            ? leader.paid
                              ? " · Paid"
                              : " · Unpaid"
                            : " · Projected prize"}
                        </span>
                        <span className="mt-1 block break-all text-xs">
                          Entry #{leader.entryId} · {leader.submitter}
                        </span>
                      </li>
                    )
                )}
              </ol>
              {batch.ready &&
                batch.leaders.some((leader) => leader && !leader.paid) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void settle(batch.id)}
                    className="mt-4 rounded-full bg-grape px-4 py-2 text-sm font-bold text-white hover:bg-grape/90 focus-visible:outline-grape disabled:opacity-50"
                  >
                    {busy
                      ? "Confirming…"
                      : batch.settled
                        ? "Retry unpaid prizes"
                        : "Settle competition"}
                  </button>
                )}
            </article>
          ))}
        </div>
        <div
          className={cn(
            "flex flex-wrap gap-4 text-sm",
            (before || query.data?.nextBefore) && "mt-4"
          )}
        >
          {before && (
            <button
              type="button"
              className="font-bold underline"
              onClick={() => setBefore(undefined)}
            >
              Latest competitions
            </button>
          )}
          {query.data?.nextBefore && (
            <button
              type="button"
              className="font-bold underline"
              onClick={() => setBefore(query.data!.nextBefore!)}
            >
              Earlier competitions
            </button>
          )}
        </div>
        <details className="group mt-5 border-t border-line pt-1">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl py-4 text-sm font-bold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape [&::-webkit-details-marker]:hidden">
            <Gift size={16} aria-hidden="true" /> Settle prizes by competition
            number
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="ml-auto shrink-0 transition group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <form
            className="flex flex-wrap items-end gap-3 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              void settle(manualBatch);
            }}
          >
            <label className="text-sm font-semibold">
              Competition number
              <input
                type="text"
                inputMode="numeric"
                value={manualBatch}
                onChange={(event) => setManualBatch(event.target.value)}
                className="mt-1 block w-40 rounded-full border border-line px-4 py-2 focus-visible:outline-grape"
                placeholder="e.g. 1"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !manualBatch}
              className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:outline-grape disabled:opacity-50"
            >
              Settle or retry prizes
            </button>
            <p className="w-full text-xs text-muted">
              Anyone can submit this transaction for a ready competition. It
              pays the recorded winners and also works when the leaderboard is
              unavailable.
            </p>
          </form>
        </details>
        {error && (
          <p role="alert" className="mt-3 text-sm text-grape">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

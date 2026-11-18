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
import { PortalCompetitionLeader } from "./PortalCompetitionLeader";
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
      id="competition"
      className="mb-8 scroll-mt-24 overflow-hidden rounded-card border border-lavender/40 bg-white shadow-card"
      aria-labelledby="competition-title"
    >
      <div className="relative isolate overflow-hidden bg-gradient-to-br from-ink via-ink to-grape px-5 py-7 text-white sm:p-8">
        <img
          src="/images/portals/rainbow-portal.webp"
          width={1024}
          height={1536}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-2/3 object-cover opacity-20 [mask-image:linear-gradient(to_right,transparent,black)]"
        />
        <div className="grid items-center gap-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12">
          <div>
            <p className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-widest text-sky">
              <span className="flex items-center gap-2">
                <Trophy size={16} aria-hidden="true" /> Yunipals grading
              </span>
              {competition && (
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-white">
                  {competition.accepting
                    ? "Open for entries"
                    : competition.phase === "grading"
                      ? "Grading in progress"
                      : "Next theme coming soon"}
                </span>
              )}
            </p>
            <h1
              id="competition-title"
              className="mt-4 font-display text-3xl leading-tight sm:text-4xl"
            >
              The spell challenge
            </h1>
            <p className="mt-3 text-lg font-bold text-sky">
              {competition?.accepting
                ? `Competition #${competition.nextBatch} · ${competition.theme.title}`
                : competition?.phase === "grading"
                  ? "The final grades are coming in"
                  : competition
                    ? "A new challenge is on its way"
                    : "Your imagination. A winning spell."}
            </p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80">
              {competition?.accepting
                ? competition.theme.brief
                : competition?.phase === "grading"
                  ? "The final cards are being graded. The three highest grades will take the podium."
                  : competition
                    ? "A new theme inspired by the winners is taking shape. Entries reopen when it is ready."
                    : "Transform your Yunipal with a spell of your own. The three highest grades share the prize pool."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <a
                href="#portal-cast"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-ink transition-colors hover:bg-sky focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky"
              >
                {competition?.accepting
                  ? "Enter the challenge"
                  : "Explore the portals"}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a
                href="#competition-standings"
                className="rounded text-sm font-bold text-white underline decoration-white/40 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky"
              >
                View standings
              </a>
            </div>
          </div>
          <aside
            aria-label="Competition prizes"
            className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-sm sm:p-6"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-sky">
              {batchSize
                ? `Prize pool at ${batchSize} entries`
                : "Full competition prize pool"}
            </p>
            <p className="mt-3 flex flex-wrap items-baseline gap-2">
              <span className="font-display text-5xl sm:text-6xl">
                {fullPool ? portalPrice(fullPool) : "—"}
              </span>
              <span className="text-lg font-semibold text-white/80">USDC</span>
            </p>
            <ol
              className="mt-5 grid grid-cols-3 gap-3 border-t border-white/20 pt-4"
              aria-label="Prize split"
            >
              {[
                { place: "1st", share: 50 },
                { place: "2nd", share: 30 },
                { place: "3rd", share: 20 }
              ].map(({ place, share }) => (
                <li key={place}>
                  <p className="text-xs font-semibold text-white/70">
                    {place} · {share}%
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {fullPool
                      ? portalPrice(
                          ((BigInt(fullPool) * BigInt(share)) / 100n).toString()
                        )
                      : "—"}
                    <span className="block text-xs font-normal text-white/70">
                      USDC
                    </span>
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-white/70">
              {contribution
                ? `${portalPrice(contribution)} USDC from each paid spell funds the pool. Prizes unlock when every entry is graded.`
                : "Paid spells fund the pool. Prizes unlock when every entry is graded."}
            </p>
          </aside>
        </div>
      </div>
      <div className="p-5 sm:p-8">
        <div id="competition-standings" className="scroll-mt-24">
          {query.isPending && (
            <p
              role="status"
              className="rounded-2xl bg-lavender/15 p-6 text-sm text-muted motion-safe:animate-pulse"
            >
              Loading the standings…
            </p>
          )}
          {query.isError && (
            <p
              role="alert"
              className="rounded-2xl bg-lavender/15 p-5 text-sm text-muted"
            >
              Standings are temporarily unavailable.{" "}
              <button
                type="button"
                className="font-bold text-grape underline"
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {query.data && query.data.batches.length === 0 && (
            <div className="flex items-center gap-4 rounded-2xl bg-lavender/15 p-5">
              <Sparkles className="shrink-0 text-grape" aria-hidden="true" />
              <div>
                <h2 className="font-display text-xl">The podium is waiting</h2>
                <p className="mt-1 text-sm text-muted">
                  {competition?.accepting
                    ? "Be the first to enter. Your card appears here once its grade is ready."
                    : "Standings will appear when the first spells are graded."}
                </p>
              </div>
            </div>
          )}
          <div className="space-y-8">
            {query.data?.batches.map((batch) => (
              <article
                key={batch.id}
                aria-label={`Competition ${batch.id} standings`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
                      <Trophy size={15} aria-hidden="true" />
                      {batch.settled ? "Final standings" : "Live standings"} ·
                      Competition #{batch.id}
                    </p>
                    <h2 className="mt-2 font-display text-xl">
                      {batch.theme.title}
                    </h2>
                  </div>
                  <p className="rounded-full bg-lavender/20 px-4 py-2 text-sm">
                    <strong>
                      {batch.funded} / {batchSize ?? "—"}
                    </strong>{" "}
                    entries{" "}
                    <span className="ml-2 text-muted">
                      · {portalPrice(batch.pool)} USDC funded
                    </span>
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <progress
                    className="h-2 flex-1 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-lavender/30 [&::-webkit-progress-value]:bg-grape [&::-moz-progress-bar]:bg-grape"
                    value={batch.funded}
                    max={Number(batchSize) || Math.max(batch.funded, 1)}
                    aria-label={`Entries in competition ${batch.id}`}
                  />
                  <span className="shrink-0 text-xs text-muted">
                    {batch.completed} graded
                  </span>
                </div>
                <ol
                  className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3"
                  aria-label={`Top three in competition ${batch.id}`}
                >
                  {[0, 1, 2].map((index) => (
                    <PortalCompetitionLeader
                      key={index}
                      rank={index + 1}
                      leader={batch.leaders[index] ?? null}
                      settled={batch.settled}
                      owner={address}
                    />
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-relaxed text-muted">
                    {batch.settled
                      ? "Final results. Prizes go to the wallets that submitted the winning spells."
                      : batch.ready
                        ? "All grades are in. The winners are ready for prize settlement."
                        : `Standings can change. Projected prizes unlock after all ${batchSize ?? "competition"} entries are graded.`}
                  </p>
                  {batch.ready &&
                    batch.leaders.some((leader) => leader && !leader.paid) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void settle(batch.id)}
                        className="rounded-full bg-grape px-4 py-2 text-sm font-bold text-white hover:bg-grape/90 focus-visible:outline-grape disabled:opacity-50"
                      >
                        {busy
                          ? "Confirming…"
                          : batch.settled
                            ? "Retry unpaid prizes"
                            : "Settle competition"}
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
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

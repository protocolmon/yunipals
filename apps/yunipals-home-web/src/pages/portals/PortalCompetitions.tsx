import { usePortalTransactions } from "@/hooks/usePortalTransactions";
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
import {
  portalCompetitionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
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
  const batchSize = query.data?.competition?.batchSize;
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
      className="mb-8 rounded-card border border-line bg-white p-5 sm:p-6"
      aria-labelledby="competition-title"
    >
      <h2 id="competition-title" className="font-display text-2xl text-ink">
        {batchSize ? `${batchSize} spells · ` : ""}grading competition
      </h2>
      <p className="mt-2 text-sm text-muted">
        {batchSize && contribution && fullPool
          ? `Each paid spell adds ${portalPrice(contribution)} USDC. The best three grades in each group of ${batchSize} share ${portalPrice(fullPool)} USDC: 50% / 30% / 20%.`
          : "Paid spells contribute to an onchain prize pool, shared by the top three grades: 50% / 30% / 20%."}{" "}
        Your grade appears as soon as your own card is ready.
      </p>
      <p className="mt-2 text-sm text-muted">
        Entries follow submission order across all portals. Four final scores
        determine rank; earlier entries win ties. Prizes go to the submitting
        wallet. Separate paid attempts can win multiple places.
      </p>
      <p className="mt-2 text-sm text-muted">
        Once every entry in a batch is graded, any player can settle the
        competition and pay all three winners in one transaction. The caller
        pays network gas; the full prize pool goes to the recorded winners.
      </p>
      {query.data?.competition && (
        <div className="mt-4 rounded-2xl bg-lavender/15 p-4" aria-live="polite">
          {query.data.competition.accepting ? (
            <>
              <h3 className="font-bold">
                Challenge #{query.data.competition.nextBatch} ·{" "}
                {query.data.competition.theme.title}
              </h3>
              <p className="mt-2 text-sm">
                {query.data.competition.theme.brief}
              </p>
              <p className="mt-2 text-sm text-muted">
                Write your own interpretation. Theme fit contributes to Harmony.
                Shared theme ideas are allowed; copying another player's
                distinctive spell still reduces Creativity.
              </p>
            </>
          ) : (
            <>
              <h3 className="font-bold">
                {query.data.competition.phase === "grading"
                  ? "Challenge full · finishing the grades"
                  : "Preparing the next challenge theme"}
              </h3>
              <p className="mt-2 text-sm">
                Entries reopen after all grades are complete and a theme
                inspired by the three winners is published. No entry payment is
                taken while waiting. Portal windows continue on their usual
                schedule.
              </p>
            </>
          )}
        </div>
      )}
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
      {query.data && query.data.batches.length === 0 && (
        <p className="mt-4 text-sm">
          The first competition starts with its first paid spell.
        </p>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {query.data?.batches.map((batch) => (
          <article
            key={batch.id}
            className="rounded-2xl border border-line p-4"
          >
            <h3 className="font-bold">
              Competition #{batch.id} · {portalPrice(batch.pool)} USDC
            </h3>
            <p className="mt-1 text-sm font-semibold">{batch.theme.title}</p>
            <p className="mt-1 text-sm">
              {batch.funded}/{batchSize} entered · {batch.completed}/{batchSize}{" "}
              graded
            </p>
            <p className="mt-1 text-sm text-muted">
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
                  className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:outline-grape disabled:opacity-50"
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
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
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
      <form
        className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4"
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
          Anyone can submit this transaction for a ready competition. It pays
          the recorded winners and also works when the leaderboard is
          unavailable.
        </p>
      </form>
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
    </section>
  );
}

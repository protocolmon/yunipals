import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, Coins, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { formatUnits, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { arenaMode } from "@protopals/yunipals-market-core/arenaProtocol";
import type {
  ArenaRewardsPage as RewardsPage,
  ArenaWalletSummary
} from "@protopals/yunipals-market-core/arenaViews";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import type { ArenaConfig } from "@/lib/arenaLive";
import { formatRoundedAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArenaConnectPrompt } from "./ArenaConnectPrompt";
import { ArenaPageHeader } from "./ArenaPageHeader";
import { ArenaLoading, ArenaTransactionFeedback } from "./ArenaFeedback";
import { ArenaRewardList } from "./ArenaHistory";
import { useArenaWallet } from "./useArenaWallet";

const button =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white transition hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-40";

export function ArenaRewardsPage() {
  const deployment = useArenaDeployment(),
    request = useArenaRequest();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: 8453 });
  const client = useQueryClient();
  const [recipient, setRecipient] = useState("");
  useEffect(() => setRecipient(""), [address, deployment.scope]);
  const config = useQuery({
    queryKey: ["arena-live", deployment.scope, "config"],
    queryFn: ({ signal }) => request<ArenaConfig>("/config", undefined, signal),
    enabled: !!deployment.apiUrl,
    staleTime: 60000
  });
  const wallet = useArenaWallet(config.data, () =>
    client.invalidateQueries({ queryKey: ["arena-live", deployment.scope] })
  );
  const summary = useQuery({
    queryKey: ["arena-live", deployment.scope, "summary", address],
    queryFn: ({ signal }) =>
      request<ArenaWalletSummary>(
        `/wallets/${address}/summary`,
        undefined,
        signal
      ),
    enabled: !!deployment.apiUrl && !!address,
    refetchInterval: 15000
  });
  const rewards = useInfiniteQuery({
    queryKey: ["arena-live", deployment.scope, "rewards", address],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      request<RewardsPage>(
        `/wallets/${address}/rewards?limit=12${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!deployment.apiUrl && !!address,
    refetchInterval: 15000
  });
  const refund = useQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "eth-refund",
      config.data?.contract,
      address
    ],
    queryFn: () =>
      publicClient!.readContract({
        address: config.data!.contract,
        abi: arenaV2Abi,
        functionName: "randomnessRefund",
        args: [arenaMode(deployment.kind), address!]
      }),
    enabled: !!publicClient && !!address && config.data?.contractVersion === 2,
    refetchInterval: 15000
  });
  const available =
    !summary.isError &&
    summary.data?.wallet.toLowerCase() === address?.toLowerCase()
      ? (summary.data?.available ?? null)
      : null;
  const rewardItems = rewards.data?.pages.flatMap((p) => p.items) ?? [];
  const blocked =
    !!wallet.busy ||
    wallet.pendingTransaction ||
    config.isError ||
    !config.data;
  const pendingAction = wallet.operation?.action;
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <ArenaPageHeader
        title="Rewards & claims"
        description="Your winnings, hosting rewards and refunds. Check your balance and claim it to your wallet."
        section="rewards"
      />
      {!deployment.apiUrl ? (
        <p role="status" className="rounded-card border border-line p-6">
          This Arena is being prepared.
        </p>
      ) : !address ? (
        <ArenaConnectPrompt description="Connect your wallet to see available rewards, claim refunds and review your withdrawals." />
      ) : (
        <>
          {config.isError && (
            <p
              role="alert"
              className="mb-5 rounded-card border border-line p-4 text-sm"
            >
              Claim settings could not be loaded.{" "}
              <button
                className="font-semibold underline"
                onClick={() => void config.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {wallet.error && (
            <p
              role="alert"
              className="mb-5 rounded-card border border-line p-4"
            >
              {wallet.error}
            </p>
          )}
          {wallet.busy && (
            <div className="mb-5">
              <ArenaLoading label={`${wallet.busy}…`} />
            </div>
          )}
          {wallet.batchPending && (
            <div
              role="status"
              className="mb-5 rounded-card border border-line p-5 text-sm"
            >
              <p>
                Your wallet is handling a combined approval and entry. Check its
                status before starting another transaction.
              </p>
              <button
                className="mt-3 rounded font-semibold text-grape underline disabled:opacity-50"
                disabled={!!wallet.busy}
                onClick={() => void wallet.checkStatus()}
              >
                Check entry status
              </button>
            </div>
          )}
          {wallet.operation && (
            <ArenaTransactionFeedback
              operation={wallet.operation}
              busy={!!wallet.busy}
              onCheck={() => void wallet.checkStatus()}
            />
          )}
          {wallet.pendingTransaction &&
            pendingAction &&
            pendingAction.kind !== "claim" && (
              <p className="mb-5 text-sm text-muted">
                Finish your saved entry transaction before starting a claim.{" "}
                <Link
                  to={`${deployment.basePath}/${pendingAction.tournamentId}`}
                  className="font-semibold underline"
                >
                  Return to your battle
                </Link>
              </p>
            )}
          <section
            aria-labelledby="arena-balance-heading"
            className="rounded-card border border-lavender bg-panel-base p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2
                  id="arena-balance-heading"
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <Wallet size={17} aria-hidden="true" /> Available to claim
                </h2>
                {summary.isPending ? (
                  <div className="mt-4">
                    <ArenaLoading label="Checking your balance…" />
                  </div>
                ) : available === null ? (
                  <p role="alert" className="mt-4 text-sm">
                    Your reward balance could not be loaded.{" "}
                    <button
                      className="font-semibold underline"
                      onClick={() => void summary.refetch()}
                    >
                      Try again
                    </button>
                  </p>
                ) : (
                  <p className="mt-3 text-4xl font-bold tabular-nums sm:text-5xl">
                    {formatUnits(BigInt(available), 6)}{" "}
                    <span className="text-lg font-semibold text-muted">
                      USDC
                    </span>
                  </p>
                )}
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
                  Confirmed rewards and entry refunds in {deployment.label}.
                  Claiming sends the available balance to your connected wallet
                  on Base.
                </p>
              </div>
              <button
                className={button}
                disabled={
                  blocked ||
                  available === null ||
                  BigInt(available) === 0n ||
                  !!config.error ||
                  !config.data
                }
                onClick={() => void wallet.claim()}
              >
                Claim USDC <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            </div>
            {available === "0" && (
              <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-muted">
                <CheckCircle2 size={16} aria-hidden="true" /> You’re all caught
                up. New rewards will appear here.
              </p>
            )}
            {summary.data &&
              available !== null &&
              BigInt(summary.data.pending) > 0n && (
                <p className="mt-5 rounded-2xl bg-white/70 p-4 text-sm">
                  <strong>
                    {formatUnits(BigInt(summary.data.pending), 6)} USDC
                  </strong>{" "}
                  is awaiting film publication. It will move into your available
                  balance when payouts unlock.
                </p>
              )}
          </section>
          {summary.data && available !== null && (
            <dl className="my-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Battle winnings", summary.data.winnings],
                ["Hosting rewards", summary.data.hostingRewards],
                ["Entry refunds", summary.data.refunds],
                ["Withdrawn", summary.data.withdrawals]
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-line p-4">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-2 text-lg font-bold tabular-nums">
                    {formatUnits(BigInt(value!), 6)}{" "}
                    <span className="text-xs font-medium text-muted">USDC</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {config.data?.contractVersion === 2 && (
            <section
              aria-labelledby="arena-eth-refund-heading"
              className="my-7 rounded-card border border-line p-6"
            >
              <h2
                id="arena-eth-refund-heading"
                className="flex items-center gap-2 text-lg font-bold"
              >
                <Coins size={19} className="text-grape" aria-hidden="true" />{" "}
                Draw-fee ETH refunds
              </h2>
              {refund.isPending ? (
                <div className="mt-3">
                  <ArenaLoading label="Checking draw-fee refunds…" />
                </div>
              ) : refund.isError ? (
                <p role="alert" className="mt-3 text-sm">
                  ETH refunds could not be checked.{" "}
                  <button
                    className="font-semibold underline"
                    onClick={() => void refund.refetch()}
                  >
                    Try again
                  </button>
                </p>
              ) : refund.data && refund.data > 0n ? (
                <>
                  <p className="mt-3 font-bold">
                    {formatRoundedAmount(refund.data, 18, "ETH")} available
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Your wallet could not receive the automatic return of unused
                    island draw fees. Claim it here, or choose another address
                    you control.
                  </p>
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape">
                      Choose another receiving address
                    </summary>
                    <label
                      htmlFor="arena-refund-recipient"
                      className="mt-4 block font-semibold"
                    >
                      ETH recipient
                    </label>
                    <input
                      id="arena-refund-recipient"
                      className="mt-2 w-full rounded-full border border-line px-4 py-3"
                      value={recipient}
                      placeholder={address}
                      onChange={(event) => setRecipient(event.target.value)}
                    />
                  </details>
                  <button
                    className={cn(button, "mt-4")}
                    disabled={blocked}
                    onClick={() =>
                      void wallet.claim(
                        true,
                        (recipient.trim() || address) as Address
                      )
                    }
                  >
                    Claim ETH refund
                  </button>
                </>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Unused draw-fee ETH is normally returned automatically. You
                  have no ETH refund waiting to be claimed.
                </p>
              )}
            </section>
          )}
          <section aria-labelledby="arena-rewards-heading" className="mt-9">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 id="arena-rewards-heading" className="text-2xl font-bold">
                Rewards & withdrawal history
              </h2>
              <Link
                to={`${deployment.basePath}/hosting`}
                className="text-sm font-semibold text-grape underline"
              >
                Hosting history
              </Link>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-muted">
              Rewards are credited per tournament. Each USDC withdrawal combines
              your available balance in this Arena.
            </p>
            {rewards.isPending ? (
              <ArenaLoading label="Loading reward records…" />
            ) : rewards.isError ? (
              <p role="alert">
                Your reward records could not be loaded.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void rewards.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : rewardItems.length ? (
              <ArenaRewardList items={rewardItems} />
            ) : (
              <p
                role="status"
                className="rounded-card border border-dashed border-line p-6 text-sm text-muted"
              >
                No rewards or withdrawals yet. Your Arena activity will appear
                here.
              </p>
            )}
            {rewards.hasNextPage && (
              <button
                className="mt-5 rounded-full border border-line px-5 py-3 text-sm font-semibold disabled:opacity-50"
                disabled={rewards.isFetchingNextPage}
                onClick={() => void rewards.fetchNextPage()}
              >
                {rewards.isFetchingNextPage
                  ? "Loading more…"
                  : "Load more records"}
              </button>
            )}
          </section>
        </>
      )}
      {deployment.shared && deployment.kind === "video" && (
        <p className="mt-10 border-t border-line pt-5 text-sm text-muted">
          Looking for an earlier video Arena balance?{" "}
          <Link to="/arena/rewards" className="font-semibold underline">
            Previous rewards & claims
          </Link>
        </p>
      )}
    </main>
  );
}

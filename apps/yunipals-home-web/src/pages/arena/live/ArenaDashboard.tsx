import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useSearchParams } from "react-router-dom";
import { formatUnits } from "viem";
import type {
  ArenaHistoryPage,
  ArenaListStatus,
  ArenaWalletSummary,
  ArenaRewardsPage
} from "@protopals/yunipals-market-core/arenaViews";
import { Select, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type ArenaConfig } from "@/lib/arenaLive";
import { ArenaNavigation } from "./ArenaNavigation";
import {
  ArenaCardsLoading,
  ArenaLoading,
  ArenaTransactionFeedback
} from "./ArenaFeedback";
import { ArenaTournamentCard, ArenaRewardList } from "./ArenaHistory";
import { useArenaWallet } from "./useArenaWallet";

const button =
  "rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape disabled:opacity-50";
export function ArenaDashboard({ role }: { role: "entrant" | "host" }) {
  const deployment = useArenaDeployment();
  const arenaRequest = useArenaRequest();
  const { address } = useAccount();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status") ?? "all";
  const status: ArenaListStatus = [
    "all",
    "active",
    "completed",
    "refunded"
  ].includes(rawStatus)
    ? (rawStatus as ArenaListStatus)
    : "all";
  const configured = !!deployment.apiUrl;
  const config = useQuery({
    queryKey: ["arena-live", deployment.scope, "config"],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaConfig>("/config", undefined, signal),
    enabled: configured,
    staleTime: 60000
  });
  const wallet = useArenaWallet(config.data, () =>
    client.invalidateQueries({ queryKey: ["arena-live", deployment.scope] })
  );
  const summary = useQuery({
    queryKey: ["arena-live", deployment.scope, "summary", address],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaWalletSummary>(
        `/wallets/${address}/summary`,
        undefined,
        signal
      ),
    enabled: configured && !!address,
    refetchInterval: 30000
  });
  const history = useInfiniteQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "history",
      address,
      role,
      status
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({
        wallet: address!,
        role,
        status,
        limit: "12"
      });
      if (pageParam) query.set("cursor", pageParam);
      return arenaRequest<ArenaHistoryPage>(
        `/tournaments?${query}`,
        undefined,
        signal
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: configured && !!address,
    refetchInterval: 60000
  });
  const rewards = useInfiniteQuery({
    queryKey: ["arena-live", deployment.scope, "rewards", address],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      arenaRequest<ArenaRewardsPage>(
        `/wallets/${address}/rewards?limit=12${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: configured && !!address
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const rewardItems = rewards.data?.pages.flatMap((p) => p.items) ?? [];
  const available =
    summary.data &&
    address &&
    summary.data.wallet.toLowerCase() === address.toLowerCase()
      ? summary.data.available
      : null;
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-12 text-ink">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-grape">
            Yunipals Arena
          </p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl">
            {role === "host" ? "Your islands. Their battles." : "Your Arena"}
          </h1>
          <p className="mt-4 max-w-2xl text-muted">
            {role === "host"
              ? "Follow the tournaments your islands have hosted and the rewards credited to your wallet."
              : "Find your fighters, submit your strategies and return for the battles."}
          </p>
        </div>
      </header>
      <ArenaNavigation />
      {!configured ? (
        <p role="status" className="rounded-card border border-line p-6">
          Mainnet tournaments are being prepared. Paid entry is not open yet.
        </p>
      ) : !address ? (
        <p className="rounded-card border border-line p-6">
          Connect your wallet to find your tournaments and hosting rewards.
        </p>
      ) : (
        <>
          {wallet.error ? (
            <p
              role="alert"
              className="my-4 rounded-card border border-line p-4"
            >
              {wallet.error}
            </p>
          ) : null}
          {wallet.busy ? <ArenaLoading label={`${wallet.busy}…`} /> : null}
          {wallet.operation ? (
            <ArenaTransactionFeedback
              operation={wallet.operation}
              busy={!!wallet.busy}
              onCheck={() => void wallet.checkStatus()}
            />
          ) : null}
          <section
            aria-label="Wallet rewards"
            className="my-6 rounded-card border border-line bg-panel-base p-6"
          >
            {summary.isPending ? (
              <ArenaLoading label="Loading rewards…" />
            ) : summary.isError ? (
              <p role="alert">
                Rewards could not be loaded.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void summary.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : summary.data ? (
              <>
                <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
                  {(role === "host"
                    ? [
                        [
                          "Tournaments hosted",
                          String(summary.data.hostedTournaments)
                        ],
                        [
                          "Hosting rewards credited",
                          `${formatUnits(BigInt(summary.data.hostingRewards), 6)} USDC`
                        ]
                      ]
                    : [
                        ["NFT entries", String(summary.data.enteredSeats)],
                        [
                          "Battle winnings credited",
                          `${formatUnits(BigInt(summary.data.winnings), 6)} USDC`
                        ]
                      ]
                  )
                    .concat([
                      [
                        "Pending publication",
                        `${formatUnits(BigInt(summary.data.pending), 6)} USDC`
                      ],
                      [
                        "Available to claim",
                        `${formatUnits(BigInt(summary.data.available), 6)} USDC`
                      ]
                    ])
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-sm text-muted">{label}</dt>
                        <dd className="mt-1 text-xl font-bold tabular-nums">
                          {value}
                        </dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-5 text-sm text-muted">
                  Available USDC is your combined confirmed balance, including
                  battle rewards, hosting and refunds. Pending rewards unlock
                  after video publication and confirmation.
                </p>
                <button
                  className={cn(button, "mt-4")}
                  disabled={
                    !!wallet.busy ||
                    wallet.pendingTransaction ||
                    available === null ||
                    available === "0"
                  }
                  onClick={() => void wallet.claim()}
                >
                  Claim available USDC
                </button>
              </>
            ) : null}
          </section>
          <section aria-labelledby="arena-history-heading" className="mt-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <h2 id="arena-history-heading" className="text-2xl font-bold">
                {role === "host" ? "Hosting history" : "Your tournaments"}
              </h2>
              <Select
                value={status}
                aria-label="Tournament status"
                onValueChange={(value) => {
                  const next = new URLSearchParams(params);
                  next.set("status", value);
                  setParams(next);
                }}
              >
                <SelectItem value="all">All tournaments</SelectItem>
                <SelectItem value="active">In progress</SelectItem>
                <SelectItem value="completed">Battles decided</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </Select>
            </div>
            {history.isPending ? (
              <ArenaCardsLoading label="Loading tournament history" />
            ) : history.isError && !items.length ? (
              <p role="alert" className="rounded-card border border-line p-5">
                History could not be loaded.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void history.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : !items.length ? (
              <p role="status" className="rounded-card border border-line p-5">
                {role === "host"
                  ? "No hosting tournaments match this filter yet."
                  : "No tournaments match this filter yet."}
              </p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {items.map((t) => (
                  <ArenaTournamentCard
                    key={t.id}
                    tournament={t}
                    wallet={address}
                  />
                ))}
              </div>
            )}
            {history.isFetching &&
            !history.isPending &&
            !history.isFetchingNextPage ? (
              <div className="mt-3">
                <ArenaLoading label="Refreshing history…" />
              </div>
            ) : null}
            {history.hasNextPage ? (
              <button
                className={cn(button, "mt-5")}
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage
                  ? "Loading more…"
                  : "Load more tournaments"}
              </button>
            ) : null}
          </section>
          {address ? (
            <section className="mt-10" aria-labelledby="arena-rewards-heading">
              <h2
                id="arena-rewards-heading"
                className="mb-4 text-2xl font-bold"
              >
                Wallet rewards and withdrawals
              </h2>
              <p className="mb-5 text-sm text-muted">
                Rewards are credited per tournament. Withdrawals claim the
                wallet's combined balance and are shown separately.
              </p>
              {rewards.isPending ? (
                <ArenaLoading label="Loading reward records…" />
              ) : rewards.isError && !rewardItems.length ? (
                <p role="alert">
                  Reward records could not be loaded.{" "}
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
                <p role="status" className="text-muted">
                  No reward or withdrawal records yet.
                </p>
              )}
              {rewards.hasNextPage ? (
                <button
                  className={cn(button, "mt-5")}
                  disabled={rewards.isFetchingNextPage}
                  onClick={() => void rewards.fetchNextPage()}
                >
                  {rewards.isFetchingNextPage
                    ? "Loading more…"
                    : "Load more records"}
                </button>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

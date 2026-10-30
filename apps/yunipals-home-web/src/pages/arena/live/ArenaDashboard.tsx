import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import type { ArenaConfig } from "@/lib/arenaLive";
import { cn } from "@/lib/utils";
import { ArenaConnectPrompt } from "./ArenaConnectPrompt";
import { ArenaPageHeader } from "./ArenaPageHeader";
import {
  ArenaCardsLoading,
  ArenaLoading,
  ArenaTransactionFeedback
} from "./ArenaFeedback";
import { ArenaTournamentCard } from "./ArenaHistory";
import {
  useArenaTournaments,
  type ArenaBattleView
} from "./useArenaTournaments";
import { useArenaWallet } from "./useArenaWallet";

export function ArenaDashboard({ role }: { role: "entrant" | "host" }) {
  const deployment = useArenaDeployment(),
    request = useArenaRequest();
  const { address } = useAccount();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") ?? (role === "host" ? "all" : "ongoing");
  const view: ArenaBattleView =
    raw === "active"
      ? "ongoing"
      : ["ongoing", "completed", "refunded", "all"].includes(raw)
        ? (raw as ArenaBattleView)
        : "ongoing";
  const config = useQuery({
    queryKey: ["arena-live", deployment.scope, "config"],
    queryFn: ({ signal }) => request<ArenaConfig>("/config", undefined, signal),
    enabled: !!deployment.apiUrl,
    staleTime: 60000
  });
  const wallet = useArenaWallet(config.data, () =>
    client.invalidateQueries({ queryKey: ["arena-live", deployment.scope] })
  );
  const { query, items } = useArenaTournaments({
    view,
    wallet: address,
    role,
    enabled: !!address
  });
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <ArenaPageHeader
        title={role === "host" ? "Hosting history" : "My battles"}
        description={
          role === "host"
            ? "Follow the battles your islands have hosted. Hosting rewards are managed in Rewards & claims."
            : "Follow your fighters, lock your strategies and come back for the films."
        }
        section={role === "host" ? "rewards" : "battles"}
      />
      {!deployment.apiUrl ? (
        <p role="status" className="rounded-card border border-line p-6">
          This Arena is being prepared.
        </p>
      ) : !address ? (
        <ArenaConnectPrompt description="Connect your wallet to see your fighters, strategy deadlines and completed battle films." />
      ) : (
        <>
          {wallet.error && (
            <p
              role="alert"
              className="mb-5 rounded-card border border-line p-4"
            >
              {wallet.error}
            </p>
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
          {wallet.operation &&
            (wallet.pendingTransaction ||
              wallet.operation.state === "failed") && (
              <ArenaTransactionFeedback
                operation={wallet.operation}
                busy={!!wallet.busy}
                onCheck={() => void wallet.checkStatus()}
              />
            )}
          <div
            role="group"
            aria-label="Filter your battles"
            className="mb-6 flex flex-wrap gap-2"
          >
            {[
              ["ongoing", "In progress"],
              ["completed", "Completed"],
              ["refunded", "Refunded"],
              ["all", "All battles"]
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={view === value}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape",
                  view === value
                    ? "border-grape bg-grape text-white"
                    : "border-line bg-white text-muted hover:bg-lavender/10"
                )}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("status", value!);
                  setParams(next);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {query.isPending ||
          (!items.length &&
            !query.isError &&
            (query.isFetching || query.hasNextPage)) ? (
            <ArenaCardsLoading label="Finding your battles…" />
          ) : query.isError ? (
            <p role="alert" className="rounded-card border border-line p-6">
              Your battles could not be loaded.{" "}
              <button
                className="font-semibold underline"
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            </p>
          ) : !items.length ? (
            <section className="rounded-card border border-dashed border-line px-6 py-12 text-center">
              <Clapperboard
                className="mx-auto text-grape"
                size={28}
                aria-hidden="true"
              />
              <h2 className="mt-4 text-xl font-bold">
                {view === "ongoing"
                  ? "No battles in progress"
                  : "No battles here yet"}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                {role === "host"
                  ? "Battles will appear here when your island is drawn as a host."
                  : view === "ongoing"
                    ? "Your active fighters and films in production will appear here. Ready for another round?"
                    : "Try another filter to find your earlier battles."}
              </p>
              {role === "entrant" && (
                <Link
                  to={deployment.basePath}
                  className="mt-6 inline-block rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
                >
                  Find a battle
                </Link>
              )}
            </section>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <ArenaTournamentCard
                  key={t.id}
                  tournament={t}
                  wallet={address}
                  intent="track"
                />
              ))}
            </div>
          )}
          {query.hasNextPage && items.length > 0 && (
            <button
              className="mt-5 rounded-full border border-line px-5 py-3 text-sm font-semibold disabled:opacity-50"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <ArenaLoading label="Loading more battles…" />
              ) : (
                "Load more battles"
              )}
            </button>
          )}
        </>
      )}
    </main>
  );
}

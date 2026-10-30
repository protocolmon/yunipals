import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Swords, Trophy, Users } from "lucide-react";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import type { ArenaConfig } from "@/lib/arenaLive";
import { ArenaPageHeader } from "./ArenaPageHeader";
import { ArenaCardsLoading, ArenaLoading } from "./ArenaFeedback";
import { ArenaTournamentCard } from "./ArenaHistory";
import { useArenaTournaments } from "./useArenaTournaments";

export function ArenaQueuePage() {
  const deployment = useArenaDeployment(),
    request = useArenaRequest();
  const { query, items } = useArenaTournaments({ view: "queues" });
  const config = useQuery({
    queryKey: ["arena-live", deployment.scope, "config"],
    queryFn: ({ signal }) => request<ArenaConfig>("/config", undefined, signal),
    enabled: !!deployment.apiUrl,
    staleTime: 60000
  });
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <ArenaPageHeader
        title="Join a battle"
        description="Find an open queue, choose your Yunipal and take your place. Four fighters make a battle."
        section="join"
      />
      <div className="mb-7 flex flex-wrap gap-x-7 gap-y-3 rounded-card bg-panel-base p-5 text-sm font-semibold">
        <span className="inline-flex items-center gap-2">
          <Swords size={17} aria-hidden="true" /> {deployment.entry} USDC per
          fighter
        </span>
        <span className="inline-flex items-center gap-2">
          <Trophy size={17} aria-hidden="true" /> {deployment.champion} USDC
          champion prize
        </span>
        <span className="inline-flex items-center gap-2">
          <Users size={17} aria-hidden="true" /> 4 fighters per battle
        </span>
      </div>
      {config.data?.entryMode === "pilot" && (
        <p
          role="status"
          className="mb-6 rounded-2xl border border-lavender bg-lavender/10 p-4 text-sm text-muted"
        >
          Controlled launch · entry is currently limited to the pilot wallets.
          Everyone can watch published battles.
        </p>
      )}
      {config.data && !config.data.entriesEnabled && (
        <p
          role="status"
          className="mb-6 rounded-2xl border border-line p-4 text-sm text-muted"
        >
          New entries are paused. Your battles and rewards remain available.
        </p>
      )}
      <section aria-labelledby="arena-queues-heading">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="arena-queues-heading" className="text-2xl font-bold">
            Open queues
          </h2>
          <p className="text-sm text-muted">
            Choose a queue to pick your fighter
          </p>
        </div>
        {!deployment.apiUrl ? (
          <p role="status" className="rounded-card border border-line p-6">
            This Arena is being prepared. Please check back soon.
          </p>
        ) : query.isPending ||
          (!items.length &&
            !query.isError &&
            (query.isFetching || query.hasNextPage)) ? (
          <ArenaCardsLoading label="Finding open queues…" />
        ) : query.isError ? (
          <p role="alert" className="rounded-card border border-line p-6">
            Queues could not be loaded.{" "}
            <button
              className="font-semibold underline"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </p>
        ) : !items.length ? (
          <div className="rounded-card border border-dashed border-line px-6 py-12 text-center">
            <Swords
              className="mx-auto text-grape"
              size={28}
              aria-hidden="true"
            />
            <h3 className="mt-4 text-lg font-bold">
              The next battle is on its way
            </h3>
            <p className="mt-2 text-sm text-muted">
              There are no open queues right now. This page updates
              automatically.
            </p>
            <Link
              to={`${deployment.basePath}/watch`}
              className="mt-5 inline-block rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
            >
              Watch recent battles
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <ArenaTournamentCard key={t.id} tournament={t} intent="join" />
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
              <ArenaLoading label="Finding more queues…" />
            ) : (
              "More open queues"
            )}
          </button>
        )}
      </section>
      <details className="mt-8 rounded-card border border-line p-5 text-sm">
        <summary className="cursor-pointer rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape">
          First battle? Here’s what happens next
        </summary>
        <ol className="mt-4 list-inside list-decimal space-y-3 leading-relaxed text-muted">
          <li>
            Choose a queue and enter with{" "}
            {deployment.kind === "anime"
              ? "an approved Base OG Yunipal"
              : "your Yunipal"}
            . Your NFT stays in your wallet.
          </li>
          <li>
            Once all four fighters are in, study the island and lock your
            strategy in My battles.
          </li>
          <li>
            Watch two semifinals and a final. Collect winnings, hosting rewards
            and refunds in Rewards & claims.
          </li>
        </ol>
        {deployment.kind === "anime" && (
          <Link
            to="/arena/anime/studio"
            className="mt-4 inline-block font-semibold text-grape underline"
          >
            Check fighter approvals
          </Link>
        )}
      </details>
    </main>
  );
}

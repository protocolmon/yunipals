import { useArenaDeployment } from "@/lib/arenaDeployment";
import { Clapperboard } from "lucide-react";
import { ArenaPageHeader } from "./ArenaPageHeader";
import { ArenaCardsLoading, ArenaLoading } from "./ArenaFeedback";
import { ArenaTournamentCard } from "./ArenaHistory";
import { useArenaTournaments } from "./useArenaTournaments";

export function ArenaWatchPage() {
  const deployment = useArenaDeployment();
  const { query, items } = useArenaTournaments({ view: "completed" });
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <ArenaPageHeader
        title="Watch the battles"
        description="Two semifinals. One final. Catch the action from completed tournaments."
      />
      {!deployment.apiUrl ? (
        <p role="status">This Arena is being prepared.</p>
      ) : query.isPending ||
        (!items.length &&
          !query.isError &&
          (query.isFetching || query.hasNextPage)) ? (
        <ArenaCardsLoading label="Loading battle films…" />
      ) : query.isError ? (
        <p role="alert">
          Battle films could not be loaded.{" "}
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
          <h2 className="mt-4 text-xl font-bold">The stage is set</h2>
          <p className="mt-2 text-muted">
            The first completed films will appear here.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <ArenaTournamentCard key={t.id} tournament={t} intent="watch" />
          ))}
        </div>
      )}
      {query.hasNextPage && items.length > 0 && (
        <button
          className="mt-5 rounded-full border border-line px-5 py-3 font-semibold disabled:opacity-50"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <ArenaLoading label="Loading more films…" />
          ) : (
            "More battles"
          )}
        </button>
      )}
    </main>
  );
}

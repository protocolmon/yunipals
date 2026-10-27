import type { useBoosterCollectionCards } from "@/hooks/useBoosterCollectionCards";

export function CollectionPackPagination({
  cards
}: {
  cards: ReturnType<typeof useBoosterCollectionCards>;
}) {
  if (!cards.enabled) return null;
  return (
    <>
      {cards.query.isFetching && !cards.query.data && (
        <p role="status" className="mt-4 animate-pulse text-sm text-muted">
          Loading collection cards…
        </p>
      )}
      {cards.query.error && (
        <p role="alert" className="mt-4 text-sm text-muted">
          {cards.query.error.message}{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => void cards.query.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {cards.query.hasNextPage && (
        <div className="mt-5 text-center">
          <button
            type="button"
            disabled={cards.query.isFetching}
            onClick={() => void cards.query.fetchNextPage()}
            className="rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ink"
          >
            {cards.query.isFetchingNextPage
              ? "Loading…"
              : "Load more pack cards"}
          </button>
        </div>
      )}
    </>
  );
}

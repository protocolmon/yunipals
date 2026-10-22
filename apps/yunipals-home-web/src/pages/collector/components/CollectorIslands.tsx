import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import {
  fetchIslands,
  isIslandOwner,
  islandsCollectionId,
  type IslandsFilters
} from "@/lib/islandsIndexer";
import { fetchOwnerTokens } from "@/lib/yunipalsIndexer";
import { IslandCard } from "@/pages/collection/islands/IslandCard";
import { cn } from "@/lib/utils";

export function CollectorIslands({ ownerInput }: { ownerInput: string }) {
  const [params, setParams] = useSearchParams();
  const resolution = useQuery({
    queryKey: ["collector-islands-owner", ownerInput],
    queryFn: ({ signal }) =>
      fetchOwnerTokens(ownerInput, { chain: "ethereum", limit: 1 }, signal),
    enabled: !isIslandOwner(ownerInput),
    retry: 1
  });
  const owner = isIslandOwner(ownerInput)
    ? ownerInput
    : resolution.data?.resolvedAddresses?.ethereum;
  const rawHolding = params.get("holding") || "all";
  const validHolding = ["all", "wallet", "staked"].includes(rawHolding);
  const holding = (
    validHolding ? rawHolding : "all"
  ) as IslandsFilters["holding"];
  const tokens = useInfiniteQuery({
    queryKey: [islandsCollectionId, "collector", owner, holding],
    queryFn: ({ pageParam, signal }) =>
      fetchIslands({ owner, holding, sort: "token-id-asc" }, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: Boolean(owner) && validHolding,
    staleTime: 15_000,
    refetchInterval: 30_000
  });
  const items = tokens.data?.pages.flatMap((page) => page.items) ?? [];
  const first = tokens.data?.pages[0];
  const incomplete = first?.complete === false;
  usePageMetadata(
    "Islands — Your collection",
    "Your Ethereum islands, including islands held in legacy staking."
  );
  return (
    <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
      <h1 className="display text-5xl text-ink">Island collection</h1>
      <p className="mt-4 break-all text-sm text-muted">{ownerInput}</p>
      <p className="mt-3 text-sm text-muted">
        Includes islands in your wallet and verified staked islands.
      </p>
      <div
        role="group"
        aria-label="Island holdings"
        className="mt-6 flex flex-wrap gap-2"
      >
        {(
          [
            ["all", "All"],
            ["wallet", "In wallet"],
            ["staked", "Staked"]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={holding === value}
            className={cn(
              "rounded-full border border-line px-5 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ethereum",
              holding === value ? "bg-ink text-white" : "bg-white text-ink"
            )}
            onClick={() => setParams({ collection: "islands", holding: value })}
          >
            {label}
          </button>
        ))}
      </div>
      {first && (
        <p className="mt-4 text-sm text-muted">
          {first.total ?? items.length}{" "}
          {holding === "all"
            ? "islands"
            : holding === "staked"
              ? "staked islands"
              : "islands in wallet"}
          {incomplete ? " verified so far" : ""}
        </p>
      )}
      {incomplete && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-ink"
        >
          Staking verification is updating. Some staked islands may be missing
          temporarily.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => void tokens.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      <div className="mt-7">
        {!validHolding ? (
          <QueryError message="Choose All, In wallet or Staked to browse your islands." />
        ) : resolution.isError ? (
          <QueryError
            message="This Ethereum wallet could not be resolved."
            onRetry={() => void resolution.refetch()}
          />
        ) : !owner && !resolution.isPending ? (
          <QueryError message="This name has no Ethereum wallet address." />
        ) : !owner || tokens.isLoading ? (
          <TokenGridSkeleton count={8} />
        ) : tokens.isError && !first ? (
          <QueryError
            message="Your island collection is temporarily unavailable."
            onRetry={() => void tokens.refetch()}
          />
        ) : !items.length ? (
          <p className="rounded-card border border-line p-8 text-center text-muted">
            {incomplete
              ? "Waiting for verified staking holdings…"
              : "No islands in this view."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((token, index) => (
              <IslandCard
                key={`${token.collectionId}:${token.tokenId}`}
                token={token}
                eager={index < 4}
              />
            ))}
          </div>
        )}
      </div>
      {tokens.isError && first && (
        <QueryError
          message="Could not refresh your islands. Previous results are shown."
          onRetry={() => void tokens.refetch()}
        />
      )}
      {tokens.hasNextPage && (
        <button
          type="button"
          disabled={tokens.isFetching}
          onClick={() => void tokens.fetchNextPage()}
          className="mt-6 rounded-full bg-ink px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          Load more islands
        </button>
      )}
    </main>
  );
}

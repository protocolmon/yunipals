import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ArenaIslandHistory } from "@protopals/yunipals-market-core/arenaViews";
import { formatUnits } from "viem";
import { environment } from "@/environment";
import {
  ArenaDeploymentProvider,
  useArenaDeployment,
  useArenaRequest
} from "@/lib/arenaDeployment";
import { cn } from "@/lib/utils";
import { ArenaTournamentCard } from "./ArenaHistory";
import { ArenaCardsLoading } from "./ArenaFeedback";

const islands = "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168";
type HistoryProps = {
  chainId: number;
  collection: string;
  tokenId: string;
};
export function IslandHostingHistory(props: HistoryProps) {
  const [mode, setMode] = useState<"video" | "anime" | "previous">("video");
  const shared = !!environment.sharedArenaApiUrl;
  return (
    <ArenaDeploymentProvider
      kind={mode === "anime" ? "anime" : "video"}
      shared={shared && mode !== "previous"}
    >
      <IslandModeHostingHistory
        {...props}
        picker={
          shared ? (
            <div
              className="my-4 flex flex-wrap gap-2"
              role="group"
              aria-label="Arena history mode"
            >
              {(
                [
                  ["video", "Video"],
                  ["anime", "Anime"],
                  ["previous", "Previous arena"]
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape",
                    mode === value
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-white text-ink"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null
        }
      />
    </ArenaDeploymentProvider>
  );
}
function IslandModeHostingHistory({
  chainId,
  collection,
  tokenId,
  picker
}: HistoryProps & { picker: ReactNode }) {
  const deployment = useArenaDeployment();
  const arenaRequest = useArenaRequest();
  const supported = chainId === 8453 && collection.toLowerCase() === islands;
  const query = useInfiniteQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "island-history",
      chainId,
      collection,
      tokenId
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      arenaRequest<ArenaIslandHistory>(
        `/islands/${chainId}/${collection}/${tokenId}/arena?limit=6${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: supported && !!deployment.apiUrl,
    refetchInterval: 60000
  });
  if (!supported || !deployment.apiUrl) return null;
  const first = query.data?.pages[0],
    items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="mt-12" aria-labelledby="island-battles-heading">
      <h2
        id="island-battles-heading"
        className="display text-2xl text-ink sm:text-3xl"
      >
        Arena battles
      </h2>
      {picker}
      <p className="mb-5 mt-3 text-sm text-muted">
        Hosting rewards belong to the beneficiary recorded when each island draw
        was finalized. Historical rewards stay with that wallet after an island
        transfer.
      </p>
      {query.isPending ? (
        <ArenaCardsLoading count={2} label="Loading island battles" />
      ) : query.isError && !first ? (
        <p role="alert">
          Hosting history is temporarily unavailable.{" "}
          <button
            className="font-semibold underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : first ? (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-4 rounded-card border border-line bg-white p-5 md:grid-cols-3">
            <div>
              <dt className="text-sm text-muted">Tournaments hosted</dt>
              <dd className="mt-1 text-xl font-bold">
                {first.hostedTournaments}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Hosting rewards credited</dt>
              <dd className="mt-1 text-xl font-bold">
                {formatUnits(BigInt(first.releasedRewards), 6)} USDC
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Awaiting publication</dt>
              <dd className="mt-1 text-xl font-bold">
                {formatUnits(BigInt(first.pendingRewards), 6)} USDC
              </dd>
            </div>
          </dl>
          {items.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              {items.map((t) => (
                <ArenaTournamentCard key={t.id} tournament={t} />
              ))}
            </div>
          ) : (
            <p role="status" className="text-muted">
              This island has not hosted an Arena tournament yet.
            </p>
          )}
          {query.hasNextPage ? (
            <button
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="mt-5 rounded-full border border-line bg-white px-5 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-50"
            >
              {query.isFetchingNextPage
                ? "Loading more battles…"
                : "Load more battles"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

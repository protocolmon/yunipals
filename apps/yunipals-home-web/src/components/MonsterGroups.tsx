import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { TokenCard } from "@/components/TokenCard";
import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import { MonsterGroupCard } from "@/components/MonsterGroupCard";
import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import {
  fetchMonsterGroups,
  applyVersionSettlements,
  type MonsterGroupPage
} from "@/lib/monsterVersions";
import { IndexerError, type YunipalToken } from "@/lib/yunipalsIndexer";
import { formatInteger } from "@/lib/format";

export function MonsterGroups({
  params,
  revision,
  collector,
  actionForVersion
}: {
  params: URLSearchParams;
  revision: string;
  collector?: "you" | "collector";
  actionForVersion?: (token: YunipalToken) => ReactNode;
}) {
  const scope = `${revision}:${params}`;
  type PageCursor = string;
  const [navigation, setNavigation] = useState<{
    scope: string;
    cursor: PageCursor;
  }>({ scope, cursor: "" });
  const cursor = navigation.scope === scope ? navigation.cursor : "";
  const queries = useQueryClient();
  const key = ["monster-groups", scope, cursor] as const;
  const query = useQuery<MonsterGroupPage>({
    queryKey: key,
    queryFn: ({ signal }) => {
      const p = new URLSearchParams(params);
      if (typeof cursor === "string" && cursor) p.set("cursor", cursor);
      return fetchMonsterGroups(p, signal);
    },
    staleTime: 15_000,
    gcTime: 60_000,
    retry: (count, error) =>
      !(error instanceof IndexerError && error.status < 500) && count < 1
  });
  useEffect(() => {
    const pages = queries
      .getQueryCache()
      .findAll({ queryKey: ["monster-groups"] })
      .filter((q) => q.getObserversCount() === 0)
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    for (const page of pages.slice(4))
      queries.removeQueries({ queryKey: page.queryKey, exact: true });
  }, [queries, scope, cursor, query.dataUpdatedAt]);
  const settlements = useConfirmedSettlements();
  const settlementKey = settlements.map((s) => `${s.id}:${s.synced}`).join(",");
  useEffect(() => {
    if (settlementKey) {
      setNavigation({ scope, cursor: "" });
      void queries.invalidateQueries({ queryKey: ["monster-groups"] });
    }
  }, [settlementKey, queries, scope]);
  const go = (next: PageCursor | null) => {
    if (next === "") {
      void queries.invalidateQueries({
        queryKey: ["monster-groups", scope],
        refetchType: "none"
      });
      if (!cursor) void query.refetch();
    }
    if (next !== null)
      setNavigation({
        scope,
        cursor: next
      });
  };
  if (query.isPending) return <TokenGridSkeleton count={12} />;
  if (query.isError)
    return (
      <div className="space-y-3">
        <QueryError onRetry={() => void query.refetch()} />
        <button
          type="button"
          onClick={() => go("")}
          className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Start from first page
        </button>
      </div>
    );
  const data = query.data;
  if (query.isFetching && collector) return <TokenGridSkeleton count={12} />;
  const groups = data.groups.flatMap((g): typeof data.groups => {
    if (!collector) return [g];
    const current = applyVersionSettlements(g, settlements);
    return current ? [current] : [];
  });
  const ownershipPending = Boolean(
    collector && settlements.some((s) => !s.synced)
  );
  return (
    <div className="space-y-5" aria-busy={query.isFetching}>
      <p className="text-sm text-muted" role="status">
        {ownershipPending
          ? "Updating ownership after a confirmed trade."
          : `${formatInteger(data.groupTotal)} groups · ${formatInteger(data.nftTotal)} NFTs.`}{" "}
        Verified airdrop versions are grouped; other NFTs appear individually.
      </p>
      {data.unavailableNfts > 0 && (
        <p className="text-sm text-muted" role="status">
          {formatInteger(data.unavailableNfts)} Solana NFT
          {data.unavailableNfts === 1 ? " is" : "s are"} unavailable in the
          latest scan. Totals include verified current holdings.
        </p>
      )}
      {!groups.length ? (
        <p className="py-8 text-center font-bold text-ink">
          No monsters match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {groups.map((g, i) =>
            g.members.length === 1 && !g.members[0]!.versionInfo ? (
              <TokenCard
                key={g.id}
                token={g.members[0]!}
                eager={i < 6}
                action={
                  query.isFetching
                    ? undefined
                    : g.members[0]!.chain !== "solana"
                      ? actionForVersion?.(g.members[0]!)
                      : undefined
                }
              />
            ) : (
              <MonsterGroupCard
                key={g.id}
                group={g}
                eager={i < 6}
                collector={query.isFetching ? undefined : collector}
                actionForVersion={
                  query.isFetching ? undefined : actionForVersion
                }
              />
            )
          )}
        </div>
      )}
      <nav
        aria-label="Monster group pages"
        className="flex flex-wrap justify-center gap-3"
      >
        <button
          type="button"
          disabled={(!data.previousCursor && !cursor) || query.isFetching}
          onClick={() => go(data.previousCursor)}
          className="rounded-full border border-line px-5 py-3 text-sm font-bold disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => {
            if (cursor) go("");
            else void query.refetch();
          }}
          className="rounded-full border border-line px-5 py-3 text-sm font-bold disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Refresh
        </button>
        <button
          type="button"
          disabled={!data.nextCursor || query.isFetching}
          onClick={() => go(data.nextCursor)}
          className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Next
        </button>
      </nav>
    </div>
  );
}

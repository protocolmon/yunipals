import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  formatDecimal,
  formatInteger,
  formatUpdatedAt,
  shortAddress
} from "@/lib/format";
import {
  fetchExomonOwnerStats,
  fetchExomonOwnerTokens,
  isSolanaAddress,
  retrySolanaQuery,
  SolanaApiError,
  solanaCacheVersion
} from "@/lib/solanaIndexer";
import { ExomonCard } from "@/pages/exomon/ExomonCard";
import { useExomonPagination } from "@/pages/exomon/useExomonPagination";

function CollectorContent({ address }: { address: string }) {
  const stats = useQuery({
    queryKey: [solanaCacheVersion, "owner-stats", address],
    queryFn: ({ signal }) => fetchExomonOwnerStats(address, signal),
    staleTime: 60_000,
    retry: retrySolanaQuery
  });
  const { query, next, previous, canPrevious, pageNumber } =
    useExomonPagination(`owner:${address}`, (cursor, signal) =>
      fetchExomonOwnerTokens(address, cursor, signal)
    );
  return (
    <>
      {stats.data && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Active Exomon
            </p>
            <p className="mt-1 text-2xl font-black text-ink">
              {formatInteger(stats.data.monsterCount)}
            </p>
            <p className="text-xs text-muted">
              Rank #{formatInteger(stats.data.monsterCountRank)}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Total rarity
            </p>
            <p className="mt-1 text-2xl font-black text-ink">
              {formatDecimal(stats.data.totalRarity, 0)}
            </p>
            <p className="text-xs text-muted">
              Rank #{formatInteger(stats.data.totalRarityRank)}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Unique types
            </p>
            <p className="mt-1 text-2xl font-black text-ink">
              {formatInteger(stats.data.uniqueTypes)}
            </p>
            <p className="text-xs text-muted">
              Rank #{formatInteger(stats.data.uniqueTypesRank)}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Collector score
            </p>
            <p className="mt-1 text-2xl font-black text-ink">
              {formatDecimal(stats.data.collectorScore, 0)}
            </p>
            <p className="text-xs text-muted">
              Rank #{formatInteger(stats.data.collectorScoreRank)}
            </p>
          </div>
        </div>
      )}
      {stats.isError &&
        !(
          stats.error instanceof SolanaApiError && stats.error.status === 404
        ) && (
          <div className="mb-6">
            <QueryError
              message="Collector rankings are temporarily unavailable."
              onRetry={() => void stats.refetch()}
            />
          </div>
        )}
      {query.isPending ? (
        <TokenGridSkeleton />
      ) : query.isError ? (
        <QueryError
          message="This wallet's Exomon could not be loaded."
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="display text-2xl text-ink">Exomon held</h2>
            <p className="text-xs font-semibold text-muted">
              Page {pageNumber}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {query.data.items.map((token) => (
              <ExomonCard key={token.tokenId} token={token} />
            ))}
          </div>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={previous}
              disabled={!canPrevious || query.isFetching}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-bold text-ink disabled:opacity-40"
            >
              <ArrowLeft size={16} /> Previous
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!query.data.nextCursor || query.isFetching}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-card border border-line bg-white p-8 text-center text-sm text-muted">
          This wallet has no active Exomon in the latest scan.
        </div>
      )}
      {query.data?.ownershipObservedAt && (
        <p className="mt-5 text-center text-xs text-muted">
          Ownership {formatUpdatedAt(query.data.ownershipObservedAt)}
        </p>
      )}
    </>
  );
}

export function ExomonCollectorPage() {
  const { address = "" } = useParams();
  const valid = isSolanaAddress(address);
  usePageMetadata(
    `Exomon collector ${valid ? shortAddress(address) : ""} — Yunipals`,
    "View a Solana wallet's indexed Exomon holdings and collector rankings."
  );
  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-sky/20 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/?chain=solana"
          className="text-sm font-bold text-badge hover:underline"
        >
          ← Exomon collection
        </Link>
        <h1 className="display mt-4 text-4xl text-ink">Solana collector</h1>
        <p className="mt-2 break-all text-sm text-muted">{address}</p>
        {valid && (
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <a
              href={`https://solscan.io/account/${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-badge hover:underline"
            >
              View wallet on Solscan <ExternalLink size={14} />
            </a>
            <Link
              to="/leaderboard?chain=solana"
              className="font-bold text-badge hover:underline"
            >
              Exomon leaderboard →
            </Link>
          </div>
        )}
        <div className="mt-8">
          {valid ? (
            <CollectorContent key={address} address={address} />
          ) : (
            <QueryError message="This Solana wallet address is invalid." />
          )}
        </div>
      </div>
    </main>
  );
}

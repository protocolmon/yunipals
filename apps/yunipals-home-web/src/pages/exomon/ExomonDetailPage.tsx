import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { QueryError } from "@/components/QueryState";
import { TokenArtwork } from "@/components/TokenArtwork";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { formatDecimal, formatUpdatedAt, shortAddress } from "@/lib/format";
import {
  fetchExomonToken,
  isSolanaAddress,
  retrySolanaQuery,
  SolanaApiError,
  solanaCacheVersion
} from "@/lib/solanaIndexer";

function attributeValue(value: unknown, displayType?: string) {
  if (displayType === "date" && typeof value === "number")
    return new Date(value * 1000).toLocaleDateString();
  return value === null || value === undefined ? "—" : String(value);
}

export function ExomonDetailPage() {
  const { tokenId = "" } = useParams();
  const valid = isSolanaAddress(tokenId);
  const detail = useQuery({
    enabled: valid,
    queryKey: [solanaCacheVersion, "token", tokenId],
    queryFn: ({ signal }) => fetchExomonToken(tokenId, signal),
    staleTime: 60_000,
    retry: retrySolanaQuery
  });
  usePageMetadata(
    detail.data?.token.name
      ? `${detail.data.token.name} — Exomon on Solana`
      : "Exomon on Solana — Yunipals"
  );

  if (!valid)
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <QueryError message="This Solana mint address is invalid." />
        <Link to="/exomon" className="mt-5 inline-block font-bold text-badge">
          Back to Exomon
        </Link>
      </main>
    );
  if (detail.isPending)
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-card bg-line" />
          <div className="h-64 animate-pulse rounded-card bg-line" />
        </div>
      </main>
    );
  if (detail.isError) {
    const message =
      detail.error instanceof SolanaApiError && detail.error.status === 404
        ? "This mint is not in the Exomon collection."
        : detail.error instanceof SolanaApiError && detail.error.status === 503
          ? "Ownership for this Exomon is temporarily unavailable. Please try again after the next index scan."
          : "Exomon details are temporarily unavailable.";
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <QueryError message={message} onRetry={() => void detail.refetch()} />
        <Link to="/exomon" className="mt-5 inline-block font-bold text-badge">
          Back to Exomon
        </Link>
      </main>
    );
  }

  const { token, observedChanges } = detail.data;
  const attributes = (token.attributes ?? []).filter(
    (attribute) =>
      !["rarity points", "rarity points capped", "rarity capped"].includes(
        attribute.trait_type.toLowerCase()
      )
  );
  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-sky/20 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/exomon"
          className="text-sm font-bold text-badge hover:underline"
        >
          ← Exomon collection
        </Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="aspect-square overflow-hidden rounded-card border border-line bg-white">
            <TokenArtwork
              src={token.image}
              alt={token.name ?? "Exomon"}
              eager
            />
          </div>
          <div>
            <span className="rounded-full bg-sky/50 px-3 py-1 text-xs font-extrabold uppercase text-ink">
              Solana · Exomon
            </span>
            <h1 className="display mt-4 text-4xl text-ink sm:text-5xl">
              {token.name ?? "Exomon"}
            </h1>
            <p className="mt-3 break-all text-sm text-muted">
              Mint {token.tokenId}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <div className="rounded-card border border-line bg-white px-5 py-4">
                <p className="text-xs font-bold uppercase text-muted">
                  Capped rarity
                </p>
                <p className="mt-1 text-2xl font-black text-ink">
                  {token.rarityPointsCapped
                    ? formatDecimal(token.rarityPointsCapped)
                    : "—"}
                </p>
              </div>
              <div className="rounded-card border border-line bg-white px-5 py-4">
                <p className="text-xs font-bold uppercase text-muted">
                  Raw rarity
                </p>
                <p className="mt-1 text-2xl font-black text-ink">
                  {token.rarityPoints ? formatDecimal(token.rarityPoints) : "—"}
                </p>
              </div>
            </div>
            {token.document?.description && (
              <p className="mt-5 leading-relaxed text-muted">
                {token.document.description}
              </p>
            )}
            <div className="mt-6 rounded-card border border-line bg-white p-5">
              <h2 className="font-extrabold text-ink">Current status</h2>
              <p className="mt-2 text-sm text-muted">
                {token.burned ? (
                  "Burned · no current owner"
                ) : token.owner ? (
                  <>
                    Owned by{" "}
                    <Link
                      to={`/collector/solana/${token.owner}`}
                      className="font-bold text-badge hover:underline"
                      title={token.owner}
                    >
                      {shortAddress(token.owner)}
                    </Link>
                  </>
                ) : (
                  "Owner unavailable"
                )}
              </p>
              <p className="mt-2 text-xs text-muted">
                {formatUpdatedAt(token.ownershipObservedAt)}
              </p>
            </div>
            <a
              href={`https://solscan.io/token/${encodeURIComponent(token.tokenId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-badge hover:underline"
            >
              View mint on Solscan <ExternalLink size={15} />
            </a>
          </div>
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="display text-2xl text-ink">Traits</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {attributes.length ? (
                attributes.map((attribute, index) => (
                  <div
                    key={`${attribute.trait_type}-${index}`}
                    className="min-w-0 rounded-card border border-line bg-white p-4"
                  >
                    <p
                      className="truncate text-xs font-bold uppercase text-muted"
                      title={attribute.trait_type}
                    >
                      {attribute.trait_type}
                    </p>
                    <p className="mt-1 break-words text-sm font-bold text-ink">
                      {attributeValue(attribute.value, attribute.display_type)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">Traits unavailable.</p>
              )}
            </div>
          </section>
          <section>
            <h2 className="display text-2xl text-ink">
              Observed ownership changes
            </h2>
            <p className="mt-2 text-sm text-muted">
              These are changes seen between index scans, not a complete
              transfer history.
            </p>
            <div className="mt-4 rounded-card border border-line bg-white">
              {observedChanges.length ? (
                observedChanges.map((change, index) => (
                  <div
                    key={`${change.observedAt}-${index}`}
                    className="border-b border-line p-4 text-sm last:border-b-0"
                  >
                    <p className="font-bold text-ink">
                      {change.burnt
                        ? "Burned"
                        : change.previousBurnt
                          ? "Active again"
                          : "Owner changed"}
                    </p>
                    <p className="mt-1 break-all text-muted">
                      {change.previousOwner
                        ? shortAddress(change.previousOwner)
                        : "No previous owner"}{" "}
                      →{" "}
                      {change.owner
                        ? shortAddress(change.owner)
                        : "No current owner"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(change.observedAt).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="p-5 text-sm text-muted">
                  No ownership change has been observed since indexing began.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

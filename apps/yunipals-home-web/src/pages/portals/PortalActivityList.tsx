import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchPortalActivity,
  fetchPortalClaims,
  portalPrice
} from "@/lib/portals";
import { portalTransactionUrl } from "./PortalClaimDialog";

export function PortalActivityList({
  tokenId,
  owner
}: {
  tokenId?: string;
  owner?: string;
}) {
  const query = useInfiniteQuery({
    queryKey: [
      "portals",
      owner ? "claims" : "activity",
      owner?.toLowerCase() ?? tokenId
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      owner
        ? fetchPortalClaims(owner, pageParam, signal)
        : fetchPortalActivity(tokenId!, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(owner || tokenId),
    refetchInterval: 15000
  });
  const rows = query.data?.pages.flatMap((page) => page.events) ?? [];
  return (
    <section className="mt-8 rounded-card border border-line p-5 sm:p-6">
      <h2 className="font-display text-xl">
        {owner ? "Your claim history" : "Portal activity"}
      </h2>
      {query.isPending ? (
        <p role="status" className="mt-4 animate-pulse">
          Loading confirmed activity…
        </p>
      ) : query.error ? (
        <p role="alert" className="mt-4 text-sm">
          {query.error.message}{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      ) : !rows.length ? (
        <p className="mt-4 text-muted">
          No confirmed {owner ? "claims" : "activity"} indexed yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((event) => (
            <li
              key={`${event.transactionHash}:${event.logIndex}`}
              className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"
            >
              <div>
                <Link
                  className="font-semibold underline"
                  to={`/portals/tokens/${event.tokenId}`}
                >
                  Portal #{event.tokenId}
                </Link>
                <p className="mt-1">
                  {event.type === "PortalClaimed"
                    ? `Burned and claimed ${portalPrice(event.args.amount)} USDC`
                    : event.type === "PortalFeeAccrued"
                      ? `Earned ${portalPrice(event.args.amount)} USDC`
                      : event.type === "Transfer"
                        ? /^0x0{40}$/i.test(event.args.to)
                          ? "NFT burned"
                          : /^0x0{40}$/i.test(event.args.from)
                            ? "NFT minted"
                            : "Ownership transferred"
                        : event.type === "PortalRetired"
                          ? "Removed from live portals"
                          : event.type === "PortalRoundUnavailable"
                            ? "Selected for a closed round after retirement"
                            : event.type === "PortalActivated"
                              ? "Portal window opened"
                              : "Portal revealed"}
                </p>
              </div>
              <a
                className="font-semibold underline"
                href={portalTransactionUrl(event.transactionHash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className="mt-4 rounded-full border border-line px-5 py-2 font-semibold"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "More activity"}
        </button>
      )}
      <p className="mt-4 text-xs text-muted">
        History appears after chain confirmations. Portal balances and claims
        use live contract reads.
      </p>
    </section>
  );
}

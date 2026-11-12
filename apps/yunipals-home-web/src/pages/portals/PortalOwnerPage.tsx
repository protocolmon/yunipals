import { useState, type FormEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { environment } from "@/environment";
import { usePortalClaim } from "@/hooks/usePortalClaim";
import { fetchOwnedPortals, portalImage, portalPrice } from "@/lib/portals";
import { cn } from "@/lib/utils";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";
import { PortalActivityList } from "./PortalActivityList";
import {
  PortalClaimDialog,
  PortalClaimStatus,
  PortalWalletButton
} from "./PortalClaimDialog";

export function PortalOwnerPage() {
  const claim = usePortalClaim();
  const navigate = useNavigate();
  const [portalId, setPortalId] = useState("");
  const query = useInfiniteQuery({
    queryKey: [
      "portals",
      "owned",
      environment.portalChainId,
      claim.address?.toLowerCase()
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchOwnedPortals(claim.address!, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(claim.address && environment.portalGrading),
    refetchInterval: 15000
  });
  const tokens = (
    query.data?.pages.flatMap((page) => page.tokens) ?? []
  ).filter((token) => token.id !== claim.success?.tokenId);
  const subtotal = tokens.reduce(
    (sum, token) => sum + BigInt(token.claimable),
    0n
  );
  function lookup(event: FormEvent) {
    event.preventDefault();
    if (/^[1-9][0-9]*$/.test(portalId) && BigInt(portalId) < 2n ** 256n)
      navigate(`/portals/tokens/${portalId}`);
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link className="font-semibold underline" to="/portals">
        ← Active portal
      </Link>
      <h1 className="mt-5 font-display text-3xl sm:text-5xl">My portals</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Each portal holds its accumulated USDC. Keep it earning, sell it with
        its balance, or burn it to claim the full amount.
      </p>
      <PortalWalletButton claim={claim} />
      <PortalClaimStatus claim={claim} />
      {!environment.portalGrading && (
        <p className="mt-6">Portal contracts are being prepared.</p>
      )}
      {claim.address && environment.portalGrading && (
        <>
          <p className="mt-6 font-bold">
            {query.hasNextPage ? "Loaded portals" : "Listed portals"}:{" "}
            {tokens.length} · {portalPrice(subtotal)} USDC shown
          </p>
          {query.isPending ? (
            <div
              role="status"
              className="mt-6 h-48 animate-pulse rounded-card bg-lavender/20"
            >
              <span className="sr-only">Finding your portals…</span>
            </div>
          ) : query.error ? (
            <p
              role="alert"
              className="mt-5 rounded-card border border-line p-5"
            >
              {query.error.message}{" "}
              <button
                className="font-semibold underline"
                type="button"
                onClick={() => void query.refetch()}
              >
                Retry
              </button>
            </p>
          ) : !tokens.length ? (
            <p className="mt-6 rounded-card border border-line p-6">
              No live portals are currently indexed for this wallet. Recently
              received portals may take a few confirmations to appear.
            </p>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {tokens.map((token) => (
                <article
                  key={token.id}
                  className="rounded-card border border-line bg-white p-5 shadow-card"
                >
                  <Link to={`/portals/tokens/${token.id}`}>
                    <img
                      src={portalImage(token.imageURI)}
                      alt={`${token.name} #${token.id}`}
                      className="mx-auto max-h-72 rounded-2xl object-contain"
                      loading="lazy"
                    />
                  </Link>
                  <h2 className="mt-4 font-display text-xl">
                    <Link to={`/portals/tokens/${token.id}`}>
                      {token.name} #{token.id}
                    </Link>
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {token.active
                      ? "Currently open"
                      : "Available for future rounds"}{" "}
                    · Kind {token.kindId}
                  </p>
                  <p className="mt-4 text-2xl font-bold">
                    {portalPrice(token.claimable)} USDC
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Accumulated on this NFT
                  </p>
                  <button
                    type="button"
                    className={cn(boosterButtonClass, "mt-5 w-full")}
                    disabled={
                      claim.busy || claim.chainId !== environment.portalChainId
                    }
                    onClick={() => void claim.prepare(token.id)}
                  >
                    Burn portal &amp; claim
                  </button>
                  <Link
                    className="mt-3 inline-block text-sm font-semibold underline"
                    to={`/portals/tokens/${token.id}`}
                  >
                    Gates and history
                  </Link>
                </article>
              ))}
            </div>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              className={cn(boosterButtonClass, "mt-6")}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "More portals"}
            </button>
          )}
          <PortalActivityList owner={claim.address} />
        </>
      )}
      <form
        className="mt-8 rounded-card border border-line p-5"
        onSubmit={lookup}
      >
        <label htmlFor="owned-portal-id" className="block font-bold">
          Find a portal by number
        </label>
        <p className="mt-2 text-sm text-muted">
          Open a portal directly if it has not appeared in your indexed holdings
          yet.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            id="owned-portal-id"
            inputMode="numeric"
            pattern="[1-9][0-9]*"
            required
            value={portalId}
            onChange={(event) => setPortalId(event.target.value)}
            className="min-w-0 rounded-full border border-line px-4 py-3"
            placeholder="Portal NFT number"
          />
          <button className={boosterButtonClass}>View portal</button>
        </div>
      </form>
      <PortalClaimDialog claim={claim} />
    </main>
  );
}

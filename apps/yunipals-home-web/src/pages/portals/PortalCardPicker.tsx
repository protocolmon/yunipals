import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Address, PublicClient } from "viem";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";

import { DialogSurface, dialogButtonVariants } from "@/components/ui/dialog";
import { YunipalsLoader } from "@/components/YunipalsLoader";
import { fetchPackGridPage, packGridTraits } from "@/lib/boosterCollectionGrid";
import { eligiblePortalCards } from "@/lib/portalCardPicker";
import {
  portalDeploymentMatches,
  portalCardImage,
  type ActivePortalStatus
} from "@/lib/portals";
import { cn } from "@/lib/utils";
import { BoosterArtwork } from "@/pages/boosters/BoosterCollection";

export function PortalCardPicker({
  status,
  owner,
  client,
  preferredTokenId,
  onSelect,
  onClose
}: {
  status: ActivePortalStatus;
  owner: Address;
  client: PublicClient;
  preferredTokenId?: string;
  onSelect: (card: BoosterMonster) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const portal = status.portal;
  const query = useInfiniteQuery({
    queryKey: [
      "portals",
      "eligible-cards",
      status.deployment.chainId,
      status.deployment.cards,
      status.deployment.grading,
      owner.toLowerCase(),
      status.round.id,
      portal?.id
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!portal || !portalDeploymentMatches(status))
        throw new Error("The portal configuration changed. Please refresh.");
      const page = await fetchPackGridPage(
        status.deployment.cards,
        owner,
        pageParam,
        signal
      );
      signal.throwIfAborted();
      const items = await eligiblePortalCards(
        client,
        {
          cards: status.deployment.cards as Address,
          grading: status.deployment.grading as Address,
          portalId: portal.id,
          owner
        },
        page.items
      );
      signal.throwIfAborted();
      return { items, nextCursor: page.nextCursor };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
    gcTime: 0,
    retry: 1
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  // Continue past non-matching pages so an empty first page never hides a match.
  useEffect(() => {
    if (
      query.hasNextPage &&
      !query.isFetching &&
      !query.isError &&
      !items.length
    )
      void query.fetchNextPage();
  }, [
    query.hasNextPage,
    query.isFetching,
    query.isError,
    query.fetchNextPage,
    items.length
  ]);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <DialogSurface
      ref={dialog}
      size="xl"
      aria-labelledby="portal-card-picker-title"
      aria-describedby="portal-card-picker-description"
      onCancel={onClose}
      onClose={(event) => {
        // StrictMode can close and reopen the dialog before its close event runs.
        if (!event.currentTarget.open) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="portal-card-picker-title" className="font-display text-2xl">
            Choose your card
          </h2>
          <p
            id="portal-card-picker-description"
            className="mt-2 text-sm leading-relaxed text-muted"
          >
            Only cards you own that qualify for {portal?.name} #{portal?.id}{" "}
            appear here. Cards with a spell already processing are left out.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card picker"
          className={cn(
            dialogButtonVariants({ variant: "secondary" }),
            "shrink-0 px-3"
          )}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {preferredTokenId && (
        <p className="mt-3 text-sm text-muted">
          You arrived from card #{preferredTokenId}. Choose it below if it
          qualifies.
        </p>
      )}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((card) => {
          const traits = packGridTraits(card);
          return (
            <button
              key={card.id}
              type="button"
              aria-label={`Choose ${traits.Type} #${card.tokenId}`}
              onClick={() => onSelect(card)}
              className="overflow-hidden rounded-2xl border border-line bg-white p-2 text-left transition-colors hover:border-grape focus-visible:outline-grape"
            >
              <div className="aspect-[2/3] overflow-hidden rounded-xl bg-lavender/15">
                <BoosterArtwork
                  uri={card.metadataUri}
                  card={card}
                  label={`${traits.Type} #${card.tokenId}`}
                  display="thumbnail"
                />
              </div>
              <p className="mt-2 text-sm font-bold">
                {traits.Type} #{card.tokenId}
              </p>
              <p className="mt-1 text-xs text-muted">
                {traits.Color} · {traits.Horn}
                {traits.Glitter === "Yes" ? " · Glitter" : ""}
              </p>
            </button>
          );
        })}
      </div>
      {query.isFetching && (
        <YunipalsLoader
          label="Checking your cards…"
          detail="Finding cards in your wallet that meet this portal’s requirements."
          className="mt-4 rounded-2xl bg-lavender/15 p-4 text-sm"
        />
      )}
      {query.isError && (
        <div role="alert" className="mt-4 text-sm">
          <p>We couldn’t finish checking your cards. Please try again.</p>
          <button
            type="button"
            className={cn(
              dialogButtonVariants({ variant: "secondary" }),
              "mt-3"
            )}
            onClick={() =>
              void (query.isFetchNextPageError
                ? query.fetchNextPage()
                : query.refetch())
            }
          >
            Try again
          </button>
        </div>
      )}
      {!query.isPending &&
        !query.isError &&
        !query.isFetching &&
        !query.hasNextPage &&
        !items.length && (
          <div className="mt-4 text-center">
            <img
              src={
                portal
                  ? portalCardImage(portal)
                  : "/images/portals/rainbow-portal-card-v3.webp"
              }
              alt=""
              width={1024}
              height={1536}
              className="mx-auto h-36 w-24 rounded-xl object-contain"
            />
            <p className="mt-4 font-bold">No matching cards in this wallet</p>
            <p className="mt-2 text-sm text-muted">
              Try another wallet or check again when the next portal opens.
            </p>
          </div>
        )}
      {query.hasNextPage && items.length > 0 && !query.isError && (
        <button
          type="button"
          disabled={query.isFetching}
          className={cn(
            dialogButtonVariants({ variant: "secondary" }),
            "mt-5 w-full"
          )}
          onClick={() => void query.fetchNextPage()}
        >
          Check more cards
        </button>
      )}
    </DialogSurface>
  );
}

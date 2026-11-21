import { BoosterArtwork } from "@/pages/boosters/BoosterCollection";
import { dialogButtonVariants } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  cardFinishes,
  serumPresences,
  serumDefinition
} from "@protopals/yunipals-market-core/serums";
import {
  fetchAdventureCards,
  type AdventureCard,
  type DoseHistory
} from "@/lib/evolution";
import { cn } from "@/lib/utils";

export const adventureButton = dialogButtonVariants({ variant: "primary" });
export function AdventureCardTile({
  card,
  onSelect
}: {
  card: AdventureCard;
  onSelect?: (card: AdventureCard) => void;
}) {
  const body = (
    <>
      <BoosterArtwork
        uri={card.metadataURI}
        label={`Yunipal #${card.tokenId}, ${serumPresences[card.presence]} Presence`}
        display="thumbnail"
      />
      <div className="p-3">
        <p className="font-bold">
          {card.level ? `Fusion ${card.level}` : "Yunipal"} #{card.tokenId}
        </p>
        <p className="mt-1 text-sm text-muted">
          {serumPresences[card.presence]} · {cardFinishes[card.finish]} finish ·{" "}
          {card.graded ? "Graded" : `${card.localDoses}/11 doses`}
        </p>
      </div>
    </>
  );
  const className =
    "block overflow-hidden rounded-3xl border border-line bg-white text-left transition hover:border-grape focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape";
  return onSelect ? (
    <button className={className} onClick={() => onSelect(card)}>
      {body}
    </button>
  ) : (
    <Link to={`/adventures/cards/${card.tokenId}`} className={className}>
      {body}
    </Link>
  );
}
export function AdventureWallet({
  owner,
  compatibleWith,
  onSelect
}: {
  owner: string;
  compatibleWith?: string;
  onSelect?: (card: AdventureCard) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["evolution", "owned", owner.toLowerCase(), compatibleWith],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchAdventureCards(owner, pageParam, compatibleWith, signal),
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    refetchInterval: 12000,
    retry: 1
  });
  const cards = query.data?.pages.flatMap((p) => p.cards) ?? [];
  return (
    <div>
      {query.isPending && (
        <p role="status" className="py-6 animate-pulse">
          Finding your Yunipals…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="py-4 text-red-700">
          {query.error.message}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <AdventureCardTile
            key={card.tokenId}
            card={card}
            onSelect={onSelect}
          />
        ))}
      </div>
      {!query.isPending && !query.isError && !cards.length && (
        <p className="py-6 text-muted">
          {compatibleWith
            ? "No compatible partner on this page. First fusions need neighbouring sequence positions from the same original; second fusions need a different original lineage."
            : "No cards found for this wallet yet. Your base cards and fusions appear together here."}
        </p>
      )}
      {query.hasNextPage && (
        <button
          className={cn(adventureButton, "mt-5")}
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          Load more cards
        </button>
      )}
    </div>
  );
}
export function SerumHistory({ history }: { history: DoseHistory }) {
  return (
    <div className="space-y-3 rounded-2xl border border-line p-4">
      <p className="font-semibold">
        {history.level ? `Fusion ${history.level}` : "Source"} #
        {history.tokenId} · {history.doses.length}/11 local doses ·{" "}
        {cardFinishes[history.finish]} finish
      </p>
      {history.doses.length ? (
        <ol className="list-inside list-decimal space-y-1 text-sm">
          {history.doses.map((dose, i) => {
            const serum = serumDefinition(dose);
            return (
              <li key={i}>
                {serum.name} · {serum.presence}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">No local doses applied.</p>
      )}
      {history.parents.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Inherited effects from both parents
          </summary>
          <div className="mt-3 space-y-3">
            {history.parents.map((p) => (
              <SerumHistory key={p.tokenId} history={p} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Fusions share the base collection contract, with their own ancestry instead of a fake base variant. */
export function CollectionFusions({ owner }: { owner?: string }) {
  const query = useInfiniteQuery({
    queryKey: ["evolution", "collection", owner?.toLowerCase()],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const { evolutionRequest, evolutionCardSchema } = await import(
        "@/lib/evolution"
      );
      const { z } = await import("zod");
      return z
        .object({
          cards: z.array(evolutionCardSchema),
          nextAfter: z.string().nullable()
        })
        .parse(
          await evolutionRequest(
            `/collection?${new URLSearchParams({ ...(pageParam ? { after: pageParam } : {}), ...(owner ? { owner } : {}) })}`,
            signal
          )
        );
    },
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    refetchInterval: 15000,
    retry: 1
  });
  const cards = query.data?.pages.flatMap((p) => p.cards) ?? [];
  return (
    <section className="mt-8 rounded-3xl border border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">
          {owner ? "Fusions in this wallet" : "Fusions in this collection"}
        </h2>
        <Link className="text-sm underline" to="/adventures">
          Your adventures & fusions
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">
        The same Yunipals TCG collection, with two or four source cards in every
        fusion. This gallery shows all fusions separately from base-card
        filters.
      </p>
      {query.isPending && (
        <p className="mt-4 animate-pulse" role="status">
          Loading fusions…
        </p>
      )}
      {query.isError && (
        <p className="mt-4 text-sm" role="alert">
          Fusions are temporarily unavailable.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <AdventureCardTile key={card.tokenId} card={card} />
        ))}
      </div>
      {!cards.length && !query.isPending && !query.isError && (
        <p className="mt-4 text-sm">
          The first fused companions will appear here.
        </p>
      )}
      {query.hasNextPage && (
        <button
          className={cn(adventureButton, "mt-4")}
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          More fusions
        </button>
      )}
    </section>
  );
}

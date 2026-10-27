import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { Clock3, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { Select, SelectItem } from "@/components/ui/select";
import { YunipalsLoader } from "@/components/YunipalsLoader";
import { environment } from "@/environment";
import {
  accruedBoosterCredits,
  boosterBatchSize,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterOwner
} from "@/lib/boosters";
import { formatInteger } from "@/lib/format";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterRequestOpening } from "./BoosterRequestOpening";

export function BoosterClaimPacks({
  onConfirmed,
  onSubmitted
}: {
  onConfirmed?: (hash: Hex) => void;
  onSubmitted?: (hash: Hex, replacedHash?: Hex) => void;
}) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const deployment = boosterAddresses();
  const [selectedOriginals, setSelectedOriginals] = useState<
    Record<string, string>
  >({});
  const [pendingPack, setPendingPack] = useState<{
    wallet: string;
    requestId: string;
  } | null>(null);
  const query = useInfiniteQuery({
    queryKey: [...boosterQueryKey, "originals", address?.toLowerCase()],
    enabled: Boolean(address && deployment),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      fetchBoosterOwner<BoosterOriginal>(
        address!,
        "originals",
        pageParam,
        signal
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 10000
  });
  const clock = useQuery({
    queryKey: [...boosterQueryKey, "base-clock"],
    enabled: Boolean(address && client && deployment),
    queryFn: async () =>
      (await client!.getBlock({ blockTag: "latest" })).timestamp,
    refetchInterval: 15000
  });
  if (!address || !deployment) return null;
  const originals =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (original) =>
          !original.burned &&
          original.owner.toLowerCase() === address.toLowerCase() &&
          original.collection.toLowerCase() === deployment.monsters &&
          original.engine.toLowerCase() === deployment.engine
      ) ?? [];
  const groups = new Map<string, BoosterOriginal[]>();
  for (const original of originals) {
    const members = groups.get(original.pack.id) ?? [];
    members.push(original);
    groups.set(original.pack.id, members);
  }
  const paused = query.data?.pages.some((page) => page.requestsPaused) ?? true;
  if (!query.isPending && !query.error && !originals.length) return null;
  return (
    <section
      id="daily-packs"
      aria-labelledby="daily-packs-heading"
      className="mt-12 scroll-mt-24 border-t border-line pt-10"
    >
      <h2
        id="daily-packs-heading"
        className="font-display text-2xl text-ink sm:text-3xl"
      >
        Your daily packs
      </h2>
      <p className="mt-3 max-w-2xl text-muted">
        Your originals earn new pulls every day. Choose an original and open up
        to seven of its saved pulls together in one pack. Your cards appear in
        Collection.
      </p>
      {query.isPending && (
        <YunipalsLoader className="mt-5" label="Checking your daily packs…" />
      )}
      {query.error && (
        <p role="alert" className="mt-5">
          {query.error.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {clock.error && (
        <p role="alert" className="mt-5">
          Current Base time is unavailable. Claim availability will update when
          the connection recovers.
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {[...groups].map(([groupId, members]) => {
          const selectionKey = `${address.toLowerCase()}:${groupId}`;
          const original =
            members.find(
              (item) => item.id === selectedOriginals[selectionKey]
            ) ??
            members.find(
              (item) =>
                !item.pendingRequest &&
                clock.data !== undefined &&
                boosterBatchSize(item, clock.data) > 0
            ) ??
            members[0];
          const now = clock.data ?? BigInt(original.revealedAt ?? "0");
          const totalPulls = members.reduce(
            (total, item) => total + accruedBoosterCredits(item, now).claimable,
            0n
          );
          const { claimable, nextAt } = accruedBoosterCredits(original, now);
          const quantity = Math.min(7, boosterBatchSize(original, now));
          const pendingId = original.pendingRequest?.split(":").at(-1);
          const revealed = BigInt(original.minted) > 0n;
          const complete = BigInt(original.remaining) === 0n;
          return (
            <article
              key={groupId}
              className="flex flex-col gap-5 rounded-card border border-line bg-white p-6 sm:flex-row sm:items-center"
            >
              <img
                src="/images/boosters/yunipals-pack-v1.png"
                alt="Lavender Yunipals daily claim pack"
                width={1024}
                height={1536}
                loading="lazy"
                draggable={false}
                className="mx-auto w-32 shrink-0 drop-shadow-lg sm:mx-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-grape">Daily pack</p>
                {members.length > 1 ? (
                  <div className="mt-3">
                    <p className="mb-3 text-sm text-muted">
                      {formatInteger(totalPulls.toString())} pulls saved across{" "}
                      {members.length} originals
                    </p>
                    <label
                      htmlFor={`daily-original-${original.pack.packTypeId}`}
                      className="mb-2 block text-sm font-bold"
                    >
                      Choose original
                    </label>
                    <Select
                      id={`daily-original-${original.pack.packTypeId}`}
                      value={original.id}
                      className="w-full"
                      onValueChange={(id) =>
                        setSelectedOriginals((selected) => ({
                          ...selected,
                          [selectionKey]: id
                        }))
                      }
                    >
                      {members.map((item) => {
                        const available = accruedBoosterCredits(
                          item,
                          now
                        ).claimable;
                        return (
                          <SelectItem key={item.id} value={item.id}>
                            Original #{item.tokenId} ·{" "}
                            {item.pendingRequest
                              ? "Reveal pending"
                              : `${available} saved ${available === 1n ? "pull" : "pulls"}`}
                          </SelectItem>
                        );
                      })}
                    </Select>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    Original #{original.tokenId}
                  </p>
                )}
                <h3 className="mt-2 font-display text-xl">
                  {pendingId
                    ? "Your pack is being revealed"
                    : quantity > 0
                      ? `${quantity} ${quantity === 1 ? "pull" : "pulls"} ready to open`
                      : complete
                        ? "Collection complete"
                        : "Your next pack is growing"}
                </h3>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <Layers3 size={17} aria-hidden="true" />
                  {formatInteger(original.minted)} /{" "}
                  {formatInteger(original.pack.totalVariants)} variants
                  collected
                </p>
                {pendingId ? (
                  <>
                    <p className="mt-3 text-sm text-muted">
                      Waiting for randomness or mint completion. This pack
                      follows the original’s owner.
                    </p>
                    <button
                      type="button"
                      className="mt-4 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
                      onClick={() =>
                        setPendingPack({
                          wallet: address,
                          requestId: pendingId
                        })
                      }
                    >
                      View pending pack
                    </button>
                  </>
                ) : quantity > 0 ? (
                  <>
                    <p className="mt-3 text-sm text-muted">
                      No {environment.boosterPaymentSymbol} needed. Pay only ETH
                      for randomness and network fees.
                    </p>
                    {claimable > BigInt(quantity) && (
                      <p className="mt-2 text-sm text-muted">
                        {(claimable - BigInt(quantity)).toString()} more saved
                        pulls stay available for your next pack.
                      </p>
                    )}
                    <div className="mt-4">
                      <BoosterActionButton
                        action={{
                          kind: "claim",
                          packTypeId: original.pack.packTypeId,
                          originalId: original.tokenId,
                          quantity
                        }}
                        disabled={
                          paused ||
                          clock.data === undefined ||
                          Boolean(clock.error)
                        }
                        onConfirmed={onConfirmed}
                        onSubmitted={onSubmitted}
                      >
                        {paused
                          ? "Claims paused"
                          : `Open daily pack · ${quantity} ${quantity === 1 ? "pull" : "pulls"}`}
                      </BoosterActionButton>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 flex gap-2 text-sm text-muted">
                    <Clock3
                      size={17}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {complete
                        ? "All variants from this original have been minted."
                        : !revealed
                          ? "Your first daily pull starts 24 hours after the original is revealed."
                          : nextAt !== null
                            ? `Next pull ${new Date(Number(nextAt) * 1000).toLocaleString()}. Unused pulls stay saved.`
                            : "Checking available pulls…"}
                    </span>
                  </p>
                )}
                {revealed && (
                  <Link
                    to={`/monsters/${original.collection}/${original.tokenId}`}
                    className="mt-4 inline-block text-sm font-bold text-grape underline"
                  >
                    View original
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          className="mt-5 rounded-full border border-line bg-white px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-grape"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more daily packs
        </button>
      )}
      {pendingPack?.wallet === address && (
        <BoosterRequestOpening
          requestId={pendingPack.requestId}
          onClose={() => setPendingPack(null)}
        />
      )}
    </section>
  );
}

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Gift } from "lucide-react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import {
  accruedBoosterCredits,
  type BoosterMonster,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";

import { useBoosterClock } from "@/hooks/useBoosterClock";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterOriginal,
  fetchBoosterOwner
} from "@/lib/boosters";
import { BoosterDailyClaimButton } from "@/pages/boosters/BoosterDailyClaimButton";
import { BoosterOriginalThumbnail } from "@/pages/boosters/BoosterOriginalThumbnail";

export function CollectionDailyPulls() {
  const { address } = useAccount();
  const deployment = boosterAddresses();
  const [openWallet, setOpenWallet] = useState<string | null>(null);
  const open = Boolean(address && openWallet === address.toLowerCase());
  const panelId = useId();
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !document.querySelector("dialog[open]") &&
        event.target instanceof Node &&
        !popover.current?.contains(event.target)
      )
        setOpenWallet(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setOpenWallet(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const originals = useInfiniteQuery({
    queryKey: [...boosterQueryKey, "originals", address?.toLowerCase()],
    enabled: Boolean(address && deployment),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchBoosterOwner<BoosterOriginal>(
        address!,
        "originals",
        pageParam,
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchInterval: 15_000
  });
  const items = (
    originals.data?.pages.flatMap((page) => page.items) ?? []
  ).filter(
    (item) =>
      !item.burned &&
      item.owner.toLowerCase() === address?.toLowerCase() &&
      item.collection.toLowerCase() === deployment?.monsters &&
      item.engine.toLowerCase() === deployment?.engine
  );
  const clock = useBoosterClock(items.length > 0);
  const ready =
    clock.data === undefined
      ? 0n
      : items.reduce(
          (total, item) =>
            total + accruedBoosterCredits(item, clock.data!).claimable,
          0n
        );
  const pending = items.some((item) => item.pendingRequest);
  if (!address || (!ready && !pending && !originals.hasNextPage)) return null;
  const count = ready > 99n ? "99+" : ready.toString();
  return (
    <div ref={popover} className="relative z-20">
      <button
        ref={trigger}
        type="button"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-grape/20 bg-lavender/40 px-4 py-2.5 text-sm font-bold text-grape transition hover:bg-lavender/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
        aria-label={
          ready
            ? `${ready} daily cards ready. Open daily cards.`
            : "Check your daily cards"
        }
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenWallet(open ? null : address.toLowerCase())}
        title="Your saved daily cards"
      >
        <Gift size={19} aria-hidden="true" />
        <span>Daily cards</span>
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-grape px-1.5 text-xs text-white">
          {ready
            ? `${count}${originals.hasNextPage && ready <= 99n ? "+" : ""}`
            : "•"}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Your daily cards"
          className="absolute right-0 top-full mt-3 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-grape/15 bg-white shadow-cardHover max-sm:fixed max-sm:bottom-4 max-sm:left-4 max-sm:right-4 max-sm:top-auto max-sm:w-auto max-sm:max-w-none"
        >
          <div className="border-b border-line px-4 py-4">
            <p className="font-display text-lg text-ink">Your daily cards</p>
            <p className="mt-1 text-xs text-muted">
              Choose a Yunipal. Open its saved cards.
            </p>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto px-4">
            {items
              .filter(
                (item) =>
                  item.pendingRequest ||
                  (clock.data !== undefined &&
                    accruedBoosterCredits(item, clock.data).claimable > 0n)
              )
              .map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <Link
                    to={`/monsters/${item.collection}/${item.tokenId}`}
                    className="flex items-center gap-2 rounded-lg text-xs font-bold focus-visible:ring-2 focus-visible:ring-grape"
                  >
                    <BoosterOriginalThumbnail original={item} />
                    <span>
                      Original
                      <br />#{item.tokenId}
                    </span>
                  </Link>
                  <BoosterDailyClaimButton
                    original={item}
                    variant="compact"
                    className="gap-1.5 px-3 py-2 text-xs"
                  />
                </li>
              ))}
          </ul>
          {originals.hasNextPage && (
            <button
              type="button"
              disabled={originals.isFetchingNextPage}
              className="w-full border-t border-line p-3 text-sm font-bold text-grape focus-visible:ring-2 focus-visible:ring-grape"
              onClick={() => void originals.fetchNextPage()}
            >
              {originals.isFetchingNextPage
                ? "Loading…"
                : "Check more originals"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CollectionDailyClaimBadge({
  monster
}: {
  monster: BoosterMonster;
}) {
  const { address } = useAccount();
  const deployment = boosterAddresses();
  const enabled = Boolean(
    monster.isOriginal &&
      !monster.burned &&
      address?.toLowerCase() === monster.owner.toLowerCase() &&
      monster.collection.toLowerCase() === deployment?.monsters
  );
  const original = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "original",
      monster.collection,
      monster.tokenId
    ],
    enabled,
    queryFn: ({ signal }) =>
      fetchBoosterOriginal(monster.collection, monster.tokenId, signal),
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    retry: 1
  });
  if (!enabled || !original.data) return null;
  return (
    <div className="absolute right-2.5 top-2.5 z-10">
      <BoosterDailyClaimButton original={original.data.item} variant="badge" />
    </div>
  );
}

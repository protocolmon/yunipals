import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { confirmedBoosterPulls } from "@/lib/boosterReveal";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterRequestMonsters
} from "@/lib/boosters";
import { BoosterPackOpening } from "./BoosterPackOpening";
import { BoosterActionButton } from "./BoosterActionButton";

export function BoosterRequestOpening({
  requestId,
  onClose
}: {
  requestId: string;
  onClose: () => void;
}) {
  const deployment = boosterAddresses();
  const client = usePublicClient({ chainId: 8453 });
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "opening-request",
      deployment?.engine,
      requestId
    ],
    enabled: Boolean(deployment && client),
    queryFn: () =>
      client!.readContract({
        address: deployment!.engine,
        abi: boosterPacksAbi,
        functionName: "getRequest",
        args: [BigInt(requestId)]
      }),
    refetchInterval: (query) =>
      query.state.data && query.state.data.status >= 3 ? false : 4000
  });
  const state = request.data;
  const cards = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "request-cards",
      deployment?.engine,
      requestId
    ],
    enabled: Boolean(deployment && state?.status === 3),
    queryFn: async ({ signal }) => {
      if (!deployment || !state || state.status !== 3)
        throw new Error("Your pack is not revealed yet.");
      const response = await fetchBoosterRequestMonsters(
        deployment.engine,
        requestId,
        signal
      );
      return confirmedBoosterPulls(response.items, {
        ...deployment,
        collection: deployment.monsters,
        requestId,
        originalId: state.originalId.toString(),
        quantity: state.quantity,
        opening: state.opening
      });
    },
    refetchInterval: (query) => (query.state.data ? false : 4000)
  });
  const pulls = state?.status === 3 ? cards.data : undefined;
  const ready = Boolean(pulls?.[0]);
  useEffect(() => {
    if (ready) return;
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [ready]);
  if (pulls?.[0])
    return (
      <BoosterPackOpening
        {...pulls[0]}
        additionalCards={pulls.slice(1)}
        onClose={onClose}
      />
    );
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="w-full max-w-md rounded-card bg-white p-7 text-ink shadow-card backdrop:bg-ink/70"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="font-display text-2xl">
          Your pack
        </h2>
        <button
          type="button"
          aria-label="Close pack"
          onClick={onClose}
          className="rounded-full p-1 focus-visible:ring-2 focus-visible:ring-grape"
        >
          <X aria-hidden="true" size={22} />
        </button>
      </div>
      <p role="status" className="mt-5 text-muted">
        {state?.status === 4
          ? "This pack was forfeited because its original was burned."
          : state?.status === 2
            ? "Randomness has arrived. Finish the reveal to open your pack."
            : state?.status === 3
              ? "Your Yunipals are minted. Preparing your pack’s cards…"
              : "Waiting for Chainlink randomness. You can close this and return from recent pack transactions."}
      </p>
      {(request.error || cards.error) && (
        <p role="alert" className="mt-4 text-sm text-muted">
          {cards.error?.message ?? "Pack status could not be loaded."}{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              void request.refetch();
              if (state?.status === 3) void cards.refetch();
            }}
          >
            Try again
          </button>
        </p>
      )}
      {state?.status === 2 && (
        <div className="mt-5">
          <BoosterActionButton action={{ kind: "recover", requestId }}>
            Finish reveal
          </BoosterActionButton>
        </div>
      )}
      <p className="mt-5 text-sm text-muted">
        Reopening this view never requests another mint.
      </p>
      <Link
        to="/collection"
        onClick={onClose}
        className="mt-5 inline-block font-bold text-grape underline"
      >
        View collection
      </Link>
    </dialog>,
    document.body
  );
}

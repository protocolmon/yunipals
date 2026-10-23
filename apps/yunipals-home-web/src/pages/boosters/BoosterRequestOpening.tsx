import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import {
  combinedBoosterPulls,
  confirmedBoosterPulls,
  confirmedBoosterRequestState,
  type BoosterCreatedRequest,
  type BoosterPullRequest,
  type BoosterRequestState
} from "@/lib/boosterReveal";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterRequestMonsters
} from "@/lib/boosters";
import { BoosterPackOpening } from "./BoosterPackOpening";
import { BoosterActionButton } from "./BoosterActionButton";

type Props = { onClose: () => void } & (
  | { requestId: string; requests?: never }
  | { requests: readonly BoosterCreatedRequest[]; requestId?: never }
);

export function BoosterRequestOpening({ requestId, requests, onClose }: Props) {
  const deployment = boosterAddresses();
  const client = usePublicClient({ chainId: 8453 });
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [acceptForfeited, setAcceptForfeited] = useState(false);
  const entries = useMemo(
    () =>
      requests
        ? requests.map((created) => ({ id: created.requestId, created }))
        : [{ id: requestId!, created: undefined }],
    [requestId, requests]
  );
  const validGroup =
    entries.length >= 1 &&
    entries.length <= 10 &&
    new Set(entries.map(({ id }) => id)).size === entries.length;
  const states = useQueries({
    queries: entries.map(({ id, created }) => ({
      queryKey: [
        ...boosterQueryKey,
        "opening-request",
        deployment?.engine,
        id,
        created?.transactionHash,
        created?.blockHash,
        created?.logIndex
      ],
      enabled: Boolean(validGroup && deployment && client),
      queryFn: async () => {
        const state = await client!.readContract({
          address: deployment!.engine,
          abi: boosterPacksAbi,
          functionName: "getRequest",
          args: [BigInt(id)]
        });
        return created ? confirmedBoosterRequestState(state, created) : state;
      },
      refetchInterval: (query: { state: { data?: BoosterRequestState } }) =>
        query.state.data && query.state.data.status >= 3 ? false : 4000
    }))
  });
  const requestDetails = entries.map(({ id, created }, index) => {
    const state = states[index].data;
    return state && deployment
      ? ({
          ...deployment,
          collection: deployment.monsters,
          requestId: id,
          originalId: state.originalId.toString(),
          quantity: state.quantity,
          opening: state.opening,
          packTypeId: created?.packTypeId
        } satisfies BoosterPullRequest)
      : undefined;
  });
  const cards = useQueries({
    queries: entries.map(({ id, created }, index) => ({
      queryKey: [
        ...boosterQueryKey,
        "request-cards",
        deployment?.engine,
        id,
        created?.transactionHash,
        created?.blockHash,
        requestDetails[index]?.originalId,
        requestDetails[index]?.quantity
      ],
      enabled: Boolean(
        validGroup && deployment && states[index].data?.status === 3
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const expected = requestDetails[index];
        if (!deployment || !expected || states[index].data?.status !== 3)
          throw new Error("Your pack is not revealed yet.");
        const response = await fetchBoosterRequestMonsters(
          deployment.engine,
          id,
          signal
        );
        confirmedBoosterPulls(response.items, expected);
        return response.items;
      },
      refetchInterval: (query: { state: { data?: unknown } }) =>
        query.state.data ? false : 4000
    }))
  });
  const completed = states.filter((query) => query.data?.status === 3).length;
  const forfeited = states.filter((query) => query.data?.status === 4).length;
  const recovery = states.filter((query) => query.data?.status === 2).length;
  const terminal = validGroup && completed + forfeited === entries.length;
  let aggregationError = false;
  let pulls: ReturnType<typeof combinedBoosterPulls> | undefined;
  if (
    terminal &&
    completed > 0 &&
    states.every(
      (query, index) =>
        query.data?.status === 4 || cards[index].data !== undefined
    )
  ) {
    try {
      pulls = combinedBoosterPulls(
        entries.flatMap((_, index) =>
          states[index].data?.status === 3
            ? [{ request: requestDetails[index]!, items: cards[index].data! }]
            : []
        )
      );
    } catch {
      aggregationError = true;
    }
  }
  const ready = Boolean(pulls?.[0] && (!forfeited || acceptForfeited));
  const errored =
    !validGroup ||
    aggregationError ||
    states.some((query) => query.error) ||
    cards.some((query) => query.error);
  useEffect(() => {
    if (ready) return;
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [ready]);
  if (ready && pulls?.[0])
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
          {entries.length > 1 ? `Your ${entries.length} packs` : "Your pack"}
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
        {forfeited === entries.length
          ? "These requests were forfeited because their originals were burned. No cards were minted."
          : pulls?.length
            ? `${pulls.length} revealed ${pulls.length === 1 ? "card is" : "cards are"} ready. ${forfeited} ${forfeited === 1 ? "request was" : "requests were"} forfeited because an original was burned.`
            : terminal
              ? "Your Yunipals are minted. Preparing all of your cards…"
              : `${completed} of ${entries.length} ${entries.length === 1 ? "pack is" : "packs are"} revealed. ${recovery ? "Finish the requests below to continue." : "Waiting for Chainlink randomness. You can close this and return from recent pack transactions."}`}
      </p>
      {errored && (
        <p role="alert" className="mt-4 text-sm text-muted">
          Pack details are temporarily unavailable. Your requests remain saved.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              for (const query of states) void query.refetch();
              for (const [index, query] of cards.entries())
                if (states[index].data?.status === 3) void query.refetch();
            }}
          >
            Try again
          </button>
        </p>
      )}
      {entries.map(({ id }, index) =>
        states[index].data?.status === 2 ? (
          <div key={id} className="mt-5">
            <BoosterActionButton action={{ kind: "recover", requestId: id }}>
              {entries.length > 1
                ? `Finish reveal · pack ${index + 1}`
                : "Finish reveal"}
            </BoosterActionButton>
          </div>
        ) : null
      )}
      {pulls?.[0] && forfeited > 0 && (
        <button
          type="button"
          className="mt-5 rounded-full bg-grape px-5 py-2 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
          onClick={() => setAcceptForfeited(true)}
        >
          Open {pulls.length} revealed {pulls.length === 1 ? "card" : "cards"}
        </button>
      )}
      <p className="mt-5 text-sm text-muted">
        All completed requests open together in one wrapper. Reopening never
        requests another mint.
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

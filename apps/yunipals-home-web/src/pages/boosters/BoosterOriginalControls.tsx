import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import {
  accruedBoosterCredits,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";
import { boosterQueryKey, fetchBoosterRequest } from "@/lib/boosters";
import { formatInteger } from "@/lib/format";

export function BoosterOriginalControls({
  original
}: {
  original: BoosterOriginal;
}) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const clock = useQuery({
    queryKey: [...boosterQueryKey, "base-clock"],
    enabled: Boolean(client),
    queryFn: async () =>
      (await client!.getBlock({ blockTag: "latest" })).timestamp,
    refetchInterval: 15000
  });
  const now = clock.data ?? BigInt(original.revealedAt ?? "0");
  const { claimable, nextAt } = accruedBoosterCredits(original, now);
  const requestId = original.pendingRequest?.split(":").at(-1);
  const pending = useQuery({
    queryKey: [...boosterQueryKey, "request", original.engine, requestId],
    enabled: Boolean(requestId),
    queryFn: ({ signal }) =>
      fetchBoosterRequest(original.engine, requestId!, signal),
    refetchInterval: 5000
  });
  const own = address?.toLowerCase() === original.owner.toLowerCase();
  return (
    <div className="mt-4 space-y-3 text-sm">
      {clock.error && (
        <p role="alert">
          Current Base time is unavailable. Mint availability will update when
          the connection recovers.
        </p>
      )}
      <p>
        <strong>
          {formatInteger(original.minted)} /{" "}
          {formatInteger(original.pack.totalVariants)}
        </strong>{" "}
        variants minted from this original
      </p>
      {original.burned ? (
        <p>Original burned. Pending mints and future rights ended.</p>
      ) : BigInt(original.minted) === 0n ? (
        <p role="status">Awaiting the original’s reveal.</p>
      ) : (
        <>
          <p>
            {claimable.toString()} unused mint{claimable === 1n ? "" : "s"}
            {nextAt !== null && (
              <>
                {" "}
                · Next credit {new Date(Number(nextAt) * 1000).toLocaleString()}
              </>
            )}
          </p>
          {original.pendingRequest && (
            <p role="status">
              {pending.data?.item.status === "seeded"
                ? "Randomness received; reveal needs recovery."
                : "A mint batch is awaiting reveal."}{" "}
              Pending NFTs follow this original’s owner.
            </p>
          )}
          {(own || !address) && (
            <Link
              to={`/boosters?original=${original.tokenId}#daily-packs`}
              className="inline-block rounded-full bg-ink px-5 py-3 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
            >
              {address ? "Open daily pack" : "Connect to open daily pack"}
            </Link>
          )}
          {BigInt(original.remaining) === 0n && (
            <p className="font-bold text-success">
              Every variant has been minted.
            </p>
          )}
        </>
      )}
    </div>
  );
}

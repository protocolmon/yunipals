import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import {
  accruedBoosterCredits,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";
import { boosterQueryKey, fetchBoosterRequest } from "@/lib/boosters";
import { formatInteger } from "@/lib/format";
import { BoosterDailyClaimButton } from "./BoosterDailyClaimButton";

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
  const { claimable, nextAt, expiresAt, endsAt } = accruedBoosterCredits(
    original,
    now
  );
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
          {original.pack.dailyClaimsExpire && (
            <p className="rounded-2xl bg-lavender/20 p-3">
              {endsAt && now >= endsAt
                ? "This pack’s daily claim period has ended. Missed claims cannot be recovered."
                : expiresAt && claimable > 0n
                  ? `Claim before ${new Date(Number(expiresAt) * 1000).toLocaleString()}. This claim expires permanently.`
                  : "Claim in every daily window to receive the full set. Missed claims expire permanently."}
            </p>
          )}
          {original.pendingRequest && (
            <p role="status">
              {pending.data?.item.status === "seeded"
                ? "Randomness received; reveal needs recovery."
                : "A mint batch is awaiting reveal."}{" "}
              Pending NFTs follow this original’s owner.
            </p>
          )}
          {(own || !address) && <BoosterDailyClaimButton original={original} />}
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

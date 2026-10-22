import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import {
  accruedBoosterCredits,
  boosterBatchSize,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";
import { boosterQueryKey, fetchBoosterRequest } from "@/lib/boosters";
import { formatInteger } from "@/lib/format";
import { BoosterActionButton } from "./BoosterActionButton";

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
  const [quantity, setQuantity] = useState(1);
  const { claimable, nextAt } = accruedBoosterCredits(original, now);
  const max = boosterBatchSize(original, now);
  const requestId = original.pendingRequest?.split(":").at(-1);
  const pending = useQuery({
    queryKey: [...boosterQueryKey, "request", original.engine, requestId],
    enabled: Boolean(requestId),
    queryFn: ({ signal }) =>
      fetchBoosterRequest(original.engine, requestId!, signal),
    refetchInterval: 5000
  });
  const own = address?.toLowerCase() === original.owner.toLowerCase();
  const selected = Math.min(quantity, max);
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
          {own && max > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                Mints in this batch
                <input
                  type="number"
                  min={1}
                  max={max}
                  value={selected}
                  onChange={(event) =>
                    setQuantity(
                      Math.max(
                        1,
                        Math.min(max, Number(event.target.value) || 1)
                      )
                    )
                  }
                  className="w-24 rounded-full border border-line px-4 py-3 focus-visible:ring-2 focus-visible:ring-ink"
                />
              </label>
              <BoosterActionButton
                action={{
                  kind: "claim",
                  packTypeId: original.pack.packTypeId,
                  originalId: original.tokenId,
                  quantity: selected
                }}
              >
                Claim {selected}
              </BoosterActionButton>
            </div>
          )}
          {BigInt(original.remaining) === 0n && (
            <p className="font-bold text-success">
              Every variant has been minted.
            </p>
          )}
        </>
      )}
      {!original.burned && pending.data?.item.status === "seeded" && (
        <BoosterActionButton
          action={{ kind: "recover", requestId: pending.data.item.requestId }}
        >
          Finish reveal
        </BoosterActionButton>
      )}
    </div>
  );
}

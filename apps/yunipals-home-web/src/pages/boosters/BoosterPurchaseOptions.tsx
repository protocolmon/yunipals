import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, PlayCircle, Plus } from "lucide-react";
import { formatUnits, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import type { BoosterType } from "@protopals/yunipals-market-core/boosters";

import { environment } from "@/environment";
import { boosterAddresses, boosterQueryKey } from "@/lib/boosters";
import { readBoosterPurchaseLimit } from "@/lib/boosterPurchase";
import { cn } from "@/lib/utils";
import { BoosterActionButton } from "./BoosterActionButton";

const quantityButton =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-grape/20 bg-white text-grape hover:bg-lavender/40 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape";

export function BoosterPurchaseOptions({
  pack,
  paused,
  onConfirmed,
  onSubmitted,
  onPreview
}: {
  pack: BoosterType;
  paused: boolean;
  onConfirmed?: (hash: Hex) => void;
  onSubmitted?: (hash: Hex, replacedHash?: Hex) => void;
  onPreview: (quantity: number) => void;
}) {
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const inputId = useId();
  const client = usePublicClient({ chainId: 8453 });
  const deployment = boosterAddresses();
  const availability = useQuery({
    queryKey: [...boosterQueryKey, "purchase-limit", deployment?.engine],
    enabled: Boolean(client && deployment),
    queryFn: () => readBoosterPurchaseLimit(client!, deployment!.engine),
    refetchInterval: 30_000,
    retry: 1
  });
  const limit = availability.data ?? 1;
  const quantity = Math.min(selectedQuantity, limit);
  const total = BigInt(pack.price) * BigInt(quantity);

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-bold text-ink">
        Packs to open
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-grape/20 bg-lavender/20 p-1">
          <button
            type="button"
            aria-label="One fewer pack"
            disabled={quantity <= 1}
            onClick={() => setSelectedQuantity(quantity - 1)}
            className={quantityButton}
          >
            <Minus size={17} aria-hidden="true" />
          </button>
          <input
            id={inputId}
            type="number"
            min={1}
            max={limit}
            step={1}
            value={quantity}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isSafeInteger(next))
                setSelectedQuantity(Math.max(1, Math.min(limit, next)));
            }}
            className="w-12 rounded-lg bg-transparent py-2 text-center font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          />
          <button
            type="button"
            aria-label="One more pack"
            disabled={quantity >= limit}
            onClick={() => setSelectedQuantity(quantity + 1)}
            className={quantityButton}
          >
            <Plus size={17} aria-hidden="true" />
          </button>
        </div>
        {limit > 1 && (
          <div className="flex gap-2" aria-label="Quick pack quantities">
            {[1, 3, 5, 10]
              .filter((count) => count <= limit)
              .map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-label={`Choose ${count} ${count === 1 ? "pack" : "packs"}`}
                  aria-pressed={quantity === count}
                  onClick={() => setSelectedQuantity(count)}
                  className={cn(
                    quantityButton,
                    quantity === count &&
                      "border-grape bg-grape text-white hover:bg-grape/90"
                  )}
                >
                  {count}
                </button>
              ))}
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-muted" aria-live="polite">
        {quantity > 1
          ? `${quantity} originals · one opening transaction · one wrapper with ${quantity} cards. Each original earns its own daily mints.`
          : "One original with its own daily mints."}
      </p>
      {availability.error && (
        <p role="status" className="mt-2 text-xs text-muted">
          Multiple-pack availability could not be checked.{" "}
          <button
            type="button"
            className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
            onClick={() => void availability.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      <p className="mt-6 text-2xl font-bold text-ink" aria-live="polite">
        {pack.paymentToken.toLowerCase() ===
        environment.boosterPaymentToken.toLowerCase()
          ? `${formatUnits(total, 18)} ${environment.boosterPaymentSymbol}`
          : "See payment details in review"}
        <span className="block pt-1 text-sm font-normal text-muted">
          + ETH for randomness and network fees
        </span>
      </p>
      <p className="mt-3 text-sm text-muted">
        The full price is burned when your opening transaction succeeds.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <BoosterActionButton
          action={{ kind: "open", packTypeId: pack.packTypeId, quantity }}
          disabled={paused}
          onConfirmed={onConfirmed}
          onSubmitted={onSubmitted}
        >
          {paused
            ? "Openings paused"
            : quantity === 1
              ? "Open pack"
              : `Open ${quantity} packs`}
        </BoosterActionButton>
        <button
          type="button"
          onClick={() => onPreview(quantity)}
          className="flex items-center gap-2 rounded-full border border-grape/20 bg-lavender/20 px-5 py-3 text-sm font-bold text-grape transition-colors hover:bg-lavender/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
        >
          <PlayCircle size={19} aria-hidden="true" />
          Try the opening
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">
        Try the opening is a preview. No wallet or purchase needed.
      </p>
    </div>
  );
}

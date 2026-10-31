import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Gift, Hourglass } from "lucide-react";
import {
  boosterBatchSize,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";

import { useBoosterClock } from "@/hooks/useBoosterClock";
import { boosterAddresses } from "@/lib/boosters";
import { cn } from "@/lib/utils";
import { useBoosterOpening } from "@/providers/BoosterOpeningProvider";
import { BoosterActionButton } from "./BoosterActionButton";

export function BoosterDailyClaimButton({
  original,
  variant = "default",
  className
}: {
  original: BoosterOriginal;
  variant?: "default" | "compact" | "badge";
  className?: string;
}) {
  const { address } = useAccount();
  const iconOnly = variant === "badge";
  const { openConnectModal } = useConnectModal();
  const deployment = boosterAddresses();
  const own = address?.toLowerCase() === original.owner.toLowerCase();
  const valid =
    original.collection.toLowerCase() === deployment?.monsters &&
    original.engine.toLowerCase() === deployment?.engine &&
    !original.burned;
  const clock = useBoosterClock(Boolean(own && valid));
  const { openTransaction, openRequest } = useBoosterOpening();
  const pendingId = original.pendingRequest?.split(":").at(-1);
  const quantity =
    clock.data === undefined
      ? 0
      : Math.min(7, boosterBatchSize(original, clock.data));
  const buttonClass = cn(
    iconOnly &&
      "h-11 min-w-11 gap-1.5 border-2 border-white bg-grape px-3 py-2 shadow-card hover:bg-grape/90",
    className
  );
  if (!valid || (address && !own)) return null;
  return (
    <>
      {!address && !iconOnly ? (
        <button
          type="button"
          className="rounded-full bg-grape px-5 py-3 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2"
          onClick={openConnectModal}
        >
          Connect to open daily cards
        </button>
      ) : own && pendingId ? (
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-grape px-5 py-3 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2",
            buttonClass
          )}
          aria-label={`View pending daily cards from original #${original.tokenId}`}
          title="Your daily cards are on their way"
          onClick={() => openRequest(pendingId)}
        >
          <Hourglass size={18} aria-hidden="true" />
          {!iconOnly &&
            (variant === "compact" ? "Pending" : "View pending cards")}
        </button>
      ) : own && quantity > 0 ? (
        <BoosterActionButton
          action={{
            kind: "claim",
            originalId: original.tokenId,
            packTypeId: original.pack.packTypeId,
            quantity
          }}
          claimOriginal={original}
          ariaLabel={`Open ${quantity} saved ${quantity === 1 ? "card" : "cards"} from original #${original.tokenId}`}
          className={buttonClass}
          onSubmitted={openTransaction}
        >
          <Gift size={18} aria-hidden="true" />
          {iconOnly
            ? quantity
            : variant === "compact"
              ? `Open ${quantity}`
              : `Open ${quantity} daily ${quantity === 1 ? "card" : "cards"}`}
        </BoosterActionButton>
      ) : null}
    </>
  );
}

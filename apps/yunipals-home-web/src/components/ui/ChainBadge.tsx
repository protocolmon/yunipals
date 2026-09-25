import { ChainLogo } from "@/components/ui/ChainLogo";
import { type ChainId, chainDetails } from "@/data/chains";
import { cn } from "@/lib/utils";

type ChainBadgeProps = {
  chainId: ChainId;
  variant?: "overlay" | "soft";
  className?: string;
};

const variantClasses = {
  overlay: "bg-white shadow-sm",
  soft: "bg-white/65 ring-1"
};

export function ChainBadge({
  chainId,
  variant = "overlay",
  className
}: ChainBadgeProps) {
  const chain = chainDetails[chainId];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold",
        variantClasses[variant],
        chain.badgeClassName,
        className
      )}
    >
      <ChainLogo chainId={chainId} className="h-3.5 w-3.5 shrink-0" />
      {chain.label}
    </span>
  );
}

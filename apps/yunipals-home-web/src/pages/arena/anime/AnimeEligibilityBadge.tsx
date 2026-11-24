import { ChainLogo } from "@/components/ui/ChainLogo";

export function AnimeEligibilityBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-panel-base px-3 py-1.5 text-xs font-bold text-basechain ring-1 ring-basechain/20">
      <ChainLogo chainId="base" className="h-3.5 w-3.5 shrink-0" />
      Base OG only
    </span>
  );
}

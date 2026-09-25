import { formatUnits } from "viem";

import type { MarketOrder } from "@/lib/marketplace/marketApi";

export function formatMarketAmount(
  value: string,
  order: Pick<MarketOrder, "currency">
) {
  return `${formatUnits(BigInt(value), order.currency.decimals)} ${order.currency.symbol}`;
}

// Display only: round base units to three significant digits without converting
// money to a floating-point number. Transaction amounts remain unchanged.
export function formatMarketCardAmount(
  value: string,
  order: Pick<MarketOrder, "currency">
) {
  const amount = BigInt(value);
  const magnitude = amount < 0n ? -amount : amount;
  const discardedDigits = Math.max(0, magnitude.toString().length - 3);
  const step = 10n ** BigInt(discardedDigits);
  const roundedMagnitude = ((magnitude + step / 2n) / step) * step;
  const rounded = amount < 0n ? -roundedMagnitude : roundedMagnitude;
  const prefix = rounded === amount ? "" : "≈ ";
  return `${prefix}${formatMarketAmount(rounded.toString(), order)}`;
}

import { formatUnits } from "viem";

import type { MarketOrder } from "@/lib/marketplace/marketApi";
import { formatRoundedAmount } from "@/lib/format";

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
  return formatRoundedAmount(
    BigInt(value),
    order.currency.decimals,
    order.currency.symbol
  );
}

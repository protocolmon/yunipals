import { formatUnits } from "viem";

export function formatInteger(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        numeric
      )
    : String(value);
}

export function formatDecimal(
  value: number | string,
  maximumFractionDigits = 2
) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(numeric)
    : String(value);
}

// Display only. Keep submitted base units unchanged while showing three
// significant digits, including for fees smaller than a fixed decimal place.
export function formatRoundedAmount(
  amount: bigint,
  decimals: number,
  symbol: string
) {
  const magnitude = amount < 0n ? -amount : amount;
  const discardedDigits = Math.max(0, magnitude.toString().length - 3);
  const step = 10n ** BigInt(discardedDigits);
  const roundedMagnitude = ((magnitude + step / 2n) / step) * step;
  const rounded = amount < 0n ? -roundedMagnitude : roundedMagnitude;
  const prefix = rounded === amount ? "" : "≈ ";
  return `${prefix}${formatUnits(rounded, decimals)} ${symbol}`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return "Update pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update pending";

  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 1000)
  );
  if (elapsedSeconds < 10) return "Updated just now";
  if (elapsedSeconds < 60) return `Updated ${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;

  return `Updated ${date.toLocaleString()}`;
}

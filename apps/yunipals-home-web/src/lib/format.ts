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

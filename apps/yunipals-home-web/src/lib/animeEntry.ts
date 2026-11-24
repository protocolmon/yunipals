import { normalizeCollectorSearch } from "@/lib/collector";

export function selectedAnimeFighter(search: string): string | null {
  const value = new URLSearchParams(search).get("fighter");
  if (!value || !/^\d{1,78}$/.test(value)) return null;
  try {
    return normalizeCollectorSearch(value);
  } catch {
    return null;
  }
}

export function animeEntryHref(tokenId: string) {
  return `/arena/anime?fighter=${encodeURIComponent(tokenId)}`;
}

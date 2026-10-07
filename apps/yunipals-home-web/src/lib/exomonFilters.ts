import type { ExomonFilters, SolanaSort } from "@/lib/solanaIndexer";

const sorts: SolanaSort[] = [
  "rarity-capped-desc",
  "rarity-capped-asc",
  "rarity-desc",
  "rarity-asc",
  "token-id-asc",
  "token-id-desc"
];
const validRarity = (value: string | null) =>
  value && /^\d+(?:\.\d+)?$/.test(value) ? value : "";

export function parseExomonFilters(params: URLSearchParams): ExomonFilters {
  const sort = params.get("sort") as SolanaSort;
  const traits: Record<string, string[]> = {};
  for (const [key, value] of params) {
    if (!key.startsWith("t.") || !key.slice(2) || !value) continue;
    const type = key.slice(2);
    const values = traits[type] ?? [];
    if (!values.includes(value)) values.push(value);
    traits[type] = values;
  }
  return {
    sort: sorts.includes(sort) ? sort : "rarity-capped-desc",
    rarityMin: validRarity(params.get("rarityMin")) || "",
    rarityMax: validRarity(params.get("rarityMax")) || "",
    traits
  };
}

export function serializeExomonFilters(
  filters: ExomonFilters
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.sort !== "rarity-capped-desc") params.set("sort", filters.sort);
  if (filters.rarityMin) params.set("rarityMin", filters.rarityMin);
  if (filters.rarityMax) params.set("rarityMax", filters.rarityMax);
  for (const [type, values] of Object.entries(filters.traits).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    for (const value of [...values].sort()) params.append(`t.${type}`, value);
  }
  return params;
}

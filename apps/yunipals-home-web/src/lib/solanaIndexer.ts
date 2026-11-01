import { environment } from "@/environment";

export const solanaCacheVersion = "exomon-v1";
export const solanaMetrics = [
  "collector-score",
  "total-rarity",
  "monster-count",
  "unique-types",
  "special-count",
  "glitter-count"
] as const;
export type SolanaMetric = (typeof solanaMetrics)[number];
export type SolanaSort =
  | "token-id-asc"
  | "token-id-desc"
  | "rarity-desc"
  | "rarity-asc"
  | "rarity-capped-desc"
  | "rarity-capped-asc";

export type ExomonAttribute = {
  trait_type: string;
  value: unknown;
  display_type?: string;
};
export type ExomonToken = {
  chain: "solana";
  tokenId: string;
  owner: string | null;
  burned: boolean;
  name: string | null;
  image: string | null;
  attributes: ExomonAttribute[] | null;
  rarityPoints: string | null;
  rarityPointsCapped: string | null;
  legacyAlias: string | null;
  tokenUri: string | null;
  ownershipObservedAt: string | null;
  document?: { description?: string | null };
};
export type ExomonFilters = {
  sort: SolanaSort;
  rarityMin: string;
  rarityMax: string;
  traits: Record<string, string[]>;
};
export type ExomonPage = {
  chain: "solana";
  items: ExomonToken[];
  total: number;
  nextCursor: string | null;
  ownershipObservedAt: string;
};
export type ExomonCollection = {
  knownTokens: number;
  indexedTokens: number;
  activeSupply: number;
  burnedTokens: number;
  missingCount: number;
  ownershipObservedAt: string;
};
export type ExomonStatus = {
  ready: boolean;
  freshness: "fresh" | "stale" | "unavailable";
  publishedAt: string | null;
  missingCount: number | null;
  lastError: string | null;
};
export type ExomonFacet = {
  traitType: string;
  kind: "categorical";
  values: { value: string; count: number }[];
};
export type ExomonDetail = {
  token: ExomonToken;
  observedChanges: {
    previousOwner: string | null;
    owner: string | null;
    previousBurnt: boolean | null;
    burnt: boolean;
    observedAt: string;
  }[];
  historyMode: "observed_changes";
};
export type ExomonLeaderboardEntry = {
  rank: number;
  owner: string;
  score: string;
  monsterCount: number;
  totalRarity: string;
  uniqueTypes: number;
  specialCount: number;
  glitterCount: number;
  collectorScore: string;
};
export type ExomonLeaderboard = {
  metric: SolanaMetric;
  label: string;
  items: ExomonLeaderboardEntry[];
  nextCursor: string | null;
  updatedAt: string | null;
};
export type ExomonOwnerStats = {
  owner: string;
  monsterCount: number;
  totalRarity: string;
  uniqueTypes: number;
  specialCount: number;
  glitterCount: number;
  collectorScore: string;
  totalRarityRank: number;
  monsterCountRank: number;
  uniqueTypesRank: number;
  specialCountRank: number;
  glitterCountRank: number;
  collectorScoreRank: number;
};

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const digits = new Map(
  [...alphabet].map((character, index) => [character, BigInt(index)])
);

/** Public keys are 32 bytes after base58 decoding and must retain their case. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return false;
  let number = 0n;
  for (const character of value) {
    const digit = digits.get(character);
    if (digit === undefined) return false;
    number = number * 58n + digit;
  }
  let bytes = 0;
  for (let remaining = number; remaining > 0n; remaining >>= 8n) bytes++;
  return (value.match(/^1*/)?.[0].length ?? 0) + bytes === 32;
}

export class SolanaApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function retrySolanaQuery(count: number, error: Error) {
  if (
    error instanceof SolanaApiError &&
    (error.status < 500 ||
      error.code === "solana_ownership_unavailable" ||
      error.code === "solana_disabled")
  )
    return false;
  return count < 2;
}

async function request<T>(
  path: string,
  params?: URLSearchParams,
  signal?: AbortSignal
): Promise<T> {
  const query = params?.toString();
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}${path}${query ? `?${query}` : ""}`,
    { signal }
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new SolanaApiError(
      response.status,
      payload?.error ?? `HTTP ${response.status}`
    );
  }
  return response.json() as Promise<T>;
}

const chainParams = () => new URLSearchParams({ chain: "solana" });

function appendFilters(params: URLSearchParams, filters: ExomonFilters) {
  params.set("sort", filters.sort);
  if (filters.rarityMin) params.set("rarityCappedMin", filters.rarityMin);
  if (filters.rarityMax) params.set("rarityCappedMax", filters.rarityMax);
  for (const [type, values] of Object.entries(filters.traits).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    for (const value of [...values].sort()) {
      params.append("traitType", type);
      params.append("traitValue", value);
    }
  }
}

export function fetchExomonCollection(signal?: AbortSignal) {
  return request<ExomonCollection>("/v1/collection", chainParams(), signal);
}
export function fetchExomonStatus(signal?: AbortSignal) {
  return request<ExomonStatus>("/v1/indexing-status", chainParams(), signal);
}
export function fetchExomonTraits(signal?: AbortSignal) {
  return request<{ items: ExomonFacet[] }>("/v1/traits", chainParams(), signal);
}
export function fetchExomonTokens(
  filters: ExomonFilters,
  cursor?: string,
  signal?: AbortSignal
) {
  const params = chainParams();
  params.set("burned", "false");
  params.set("limit", "24");
  appendFilters(params, filters);
  if (cursor) params.set("cursor", cursor);
  return request<ExomonPage>("/v1/tokens", params, signal);
}
export function fetchExomonOwnerTokens(
  owner: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const params = chainParams();
  params.set("limit", "24");
  params.set("sort", "rarity-capped-desc");
  if (cursor) params.set("cursor", cursor);
  return request<ExomonPage>(
    `/v1/owners/${encodeURIComponent(owner)}/tokens`,
    params,
    signal
  );
}
export function fetchExomonToken(mint: string, signal?: AbortSignal) {
  return request<ExomonDetail>(
    `/v1/tokens/solana/${encodeURIComponent(mint)}`,
    undefined,
    signal
  );
}
export function fetchExomonOwnerStats(owner: string, signal?: AbortSignal) {
  return request<ExomonOwnerStats>(
    `/v1/owners/${encodeURIComponent(owner)}/leaderboard`,
    chainParams(),
    signal
  );
}
export function fetchExomonLeaderboard(
  metric: SolanaMetric,
  cursor?: string,
  signal?: AbortSignal
) {
  const params = chainParams();
  params.set("limit", "50");
  if (cursor) params.set("cursor", cursor);
  return request<ExomonLeaderboard>(
    `/v1/leaderboards/${metric}`,
    params,
    signal
  );
}

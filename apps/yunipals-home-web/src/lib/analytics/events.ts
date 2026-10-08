import { z } from "zod";

export const analyticsChainSchema = z.enum([
  "ethereum",
  "base",
  "polygon",
  "bnb",
  "solana"
]);
const collection = z.enum(["yunipals", "islands", "exomon"]);
const page = z.enum([
  "collection",
  "collectible",
  "collector",
  "leaderboard",
  "orders",
  "order-recovery",
  "activity",
  "privacy",
  "terms"
]);
const entryPoint = z.enum([
  "navigation",
  "trade-review",
  "order-creation",
  "token-market",
  "orders",
  "order-recovery",
  "activity"
]);
const trade = {
  action: z.enum(["buy", "accept-offer"]),
  chain: analyticsChainSchema,
  marketplace: z.enum(["opensea", "yunipals"])
};
export const analyticsEventSchemas = {
  "Page Viewed": z.object({
    page,
    route: z.enum([
      "/",
      "/collection/:chain/:tokenId",
      "/collection/:tokenId",
      "/collector/:address",
      "/collector/solana/:address",
      "/leaderboard",
      "/orders",
      "/orders/recovery",
      "/orders/activity",
      "/privacy",
      "/terms"
    ]),
    collection: collection.optional(),
    chain: analyticsChainSchema.optional()
  }),
  "Collection Filter Applied": z.object({
    collection,
    filter: z.enum(["filters", "sort", "chain", "edition", "owner"]),
    sort: z
      .enum([
        "token-id-asc",
        "token-id-desc",
        "rarity-asc",
        "rarity-desc",
        "rarity-capped-asc",
        "rarity-capped-desc",
        "price-asc",
        "price-desc"
      ])
      .optional(),
    chain: analyticsChainSchema.optional()
  }),
  "Collection Search Submitted": z.object({
    collection,
    search_type: z.enum(["token", "collector", "invalid"]),
    outcome: z.enum(["valid", "invalid", "chain-required"])
  }),
  "Collectible Viewed": z.object({ collection, chain: analyticsChainSchema }),
  "Wallet Connect Started": z.object({ entry_point: entryPoint }),
  "Wallet Connected": z.object({
    entry_point: entryPoint,
    chain: analyticsChainSchema.optional(),
    connector: z.enum(["injected", "walletconnect", "coinbase", "other"])
  }),
  "Trade Started": z.object(trade),
  "Trade Submitted": z.object(trade),
  "Trade Confirmed": z.object(trade),
  "Trade Interrupted": z.object({
    ...trade,
    stage: z.enum([
      "preparing",
      "checking",
      "switching",
      "simulating",
      "wallet",
      "pending"
    ]),
    reason: z.enum([
      "wallet-rejected",
      "timeout",
      "confirmation-unknown",
      "unavailable",
      "other"
    ])
  }),
  "Order Published": z.object({
    chain: analyticsChainSchema,
    order_type: z.enum(["listing", "offer"])
  }),
  "Order Cancelled": z.object({ chain: analyticsChainSchema })
};
export type AnalyticsEvent = keyof typeof analyticsEventSchemas;
export type AnalyticsProperties<E extends AnalyticsEvent> = z.infer<
  (typeof analyticsEventSchemas)[E]
>;
export type AnalyticsEntryPoint = z.infer<typeof entryPoint>;
export type AnalyticsChain = z.infer<typeof analyticsChainSchema>;
export type AnalyticsPayload = {
  event: string;
  properties: Record<string, unknown>;
};
export const analyticsUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function analyticsChainFromId(
  chainId?: number
): AnalyticsChain | undefined {
  return (
    { 1: "ethereum", 8453: "base", 137: "polygon", 56: "bnb" } as Record<
      number,
      AnalyticsChain
    >
  )[chainId ?? 0];
}

export function sanitizeAnalyticsPayload(
  payload: AnalyticsPayload,
  token: string,
  visitorId: string
): AnalyticsPayload | null {
  if (
    !Object.hasOwn(analyticsEventSchemas, payload.event) ||
    !analyticsUuid.test(visitorId)
  )
    return null;
  const event = payload.event as AnalyticsEvent;
  const result = analyticsEventSchemas[event].safeParse(payload.properties);
  if (!result.success) return null;
  const properties: Record<string, unknown> = {
    ...result.data,
    token,
    distinct_id: visitorId,
    $device_id: visitorId,
    schema_version: 1
  };
  const env = payload.properties.environment;
  if (env === "production" || env === "preview" || env === "development")
    properties.environment = env;
  const device = payload.properties.device_type;
  if (device === "mobile" || device === "desktop")
    properties.device_type = device;
  if (
    typeof payload.properties.time === "number" &&
    Number.isFinite(payload.properties.time)
  )
    properties.time = payload.properties.time;
  if (
    typeof payload.properties.$insert_id === "string" &&
    analyticsUuid.test(payload.properties.$insert_id)
  )
    properties.$insert_id = payload.properties.$insert_id;
  return { event, properties };
}

export function analyticsPage(
  pathname: string,
  search: string
): AnalyticsProperties<"Page Viewed"> | null {
  const parts = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  if (!parts.length)
    return {
      page: "collection",
      route: "/",
      collection:
        params.get("collection") === "islands"
          ? "islands"
          : params.getAll("chain").join(",") === "solana"
            ? "exomon"
            : "yunipals"
    };
  if (parts[0] === "collector" && parts[1] === "solana" && parts.length === 3)
    return {
      page: "collector",
      route: "/collector/solana/:address",
      collection: "exomon",
      chain: "solana"
    };
  if (parts[0] === "collector" && parts.length === 2)
    return { page: "collector", route: "/collector/:address" };
  if (parts[0] === "collection" && (parts.length === 2 || parts.length === 3)) {
    const islands = parts[1] === "ethereum-islands";
    return {
      page: "collectible",
      route:
        parts.length === 3
          ? "/collection/:chain/:tokenId"
          : "/collection/:tokenId",
      collection: islands
        ? "islands"
        : parts[1] === "solana"
          ? "exomon"
          : "yunipals",
      chain: islands
        ? "ethereum"
        : analyticsChainSchema.safeParse(parts[1]).success
          ? (parts[1] as AnalyticsChain)
          : undefined
    };
  }
  if (
    pathname.replace(/\/$/, "") === "/leaderboard" &&
    params.get("chain") === "solana"
  )
    return {
      page: "leaderboard",
      route: "/leaderboard",
      collection: "exomon",
      chain: "solana"
    };
  const pages: Record<string, AnalyticsProperties<"Page Viewed">> = {
    "/leaderboard": { page: "leaderboard", route: "/leaderboard" },
    "/orders": { page: "orders", route: "/orders" },
    "/orders/recovery": { page: "order-recovery", route: "/orders/recovery" },
    "/orders/activity": { page: "activity", route: "/orders/activity" },
    "/privacy": { page: "privacy", route: "/privacy" },
    "/terms": { page: "terms", route: "/terms" }
  };
  return pages[pathname.replace(/\/$/, "")] ?? null;
}

import { z } from "zod";

import { analyticsCountry, analyticsWalletId } from "@/lib/analytics/identity";

export const analyticsChainSchema = z.enum([
  "ethereum",
  "base",
  "polygon",
  "bnb",
  "solana"
]);
export const analyticsOnchainAction = z.enum([
  "buy",
  "accept-offer",
  "cancel-order",
  "publish-order",
  "approve-nft",
  "approve-currency",
  "wrap-currency",
  "wrap-ypal",
  "booster-open",
  "booster-claim",
  "booster-recover",
  "booster-burn",
  "booster-refund",
  "island-unstake",
  "arena-approve",
  "arena-enter",
  "arena-claim",
  "arena-refund",
  "arena-register",
  "contract-configure"
]);
const onchain = { action: analyticsOnchainAction, chain: analyticsChainSchema };
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
  "terms",
  "boosters",
  "wrap",
  "arena",
  "monster",
  "contracts",
  "brandkit"
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
  "Wallet Identified": z.object({ identity_type: z.literal("wallet") }),
  "Onchain Action Submitted": z.object(onchain),
  "Onchain Action Confirmed": z.object(onchain),
  "Onchain Action Failed": z.object({
    ...onchain,
    reason: z.enum(["reverted", "cancelled", "unexpected-replacement"])
  }),
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
      "/terms",
      "/boosters",
      "/boosters/:section",
      "/boosters/setup/:section",
      "/wrap",
      "/arena",
      "/arena/:section",
      "/arena/:id",
      "/arena/:kind",
      "/arena/:kind/:section",
      "/monsters/:collection/:tokenId",
      "/contracts",
      "/brandkit"
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
  visitorId: string,
  context: { userId?: string; country?: string } = {}
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
    distinct_id:
      context.userId && analyticsWalletId.test(context.userId)
        ? context.userId
        : visitorId,
    $device_id: visitorId,
    schema_version: 2
  };
  if (context.userId && analyticsWalletId.test(context.userId))
    properties.$user_id = context.userId;
  const country = analyticsCountry(context.country);
  if (country) properties.country = country;
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
  if (parts[0] === "boosters" && parts.length <= 3)
    return {
      page: "boosters",
      route:
        parts.length === 1
          ? "/boosters"
          : parts.length === 3
            ? "/boosters/setup/:section"
            : "/boosters/:section"
    };
  if (pathname === "/wrap") return { page: "wrap", route: "/wrap" };
  if (parts[0] === "arena" && parts.length <= 3)
    return {
      page: "arena",
      route:
        parts.length === 1
          ? "/arena"
          : parts.length === 3
            ? "/arena/:kind/:section"
            : ["anime", "video"].includes(parts[1])
              ? "/arena/:kind"
              : /^\d+$/.test(parts[1])
                ? "/arena/:id"
                : "/arena/:section"
    };
  if (parts[0] === "monsters" && parts.length === 3)
    return {
      page: "monster",
      route: "/monsters/:collection/:tokenId",
      chain: "base"
    };
  if (pathname === "/contracts")
    return { page: "contracts", route: "/contracts" };
  if (pathname === "/brandkit") return { page: "brandkit", route: "/brandkit" };
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
    const islands =
      parts[1] === "ethereum-islands" || parts[1] === "base-islands";
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
        ? parts[1] === "base-islands"
          ? "base"
          : "ethereum"
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

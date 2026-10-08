import { z } from "zod";

import {
  analytics,
  analyticsStorage,
  trackAnalyticsEvent
} from "@/lib/analytics/index";
import {
  analyticsOperationsKey,
  type AnalyticsStorage
} from "@/lib/analytics/consent";
import {
  analyticsChainFromId,
  analyticsChainSchema,
  analyticsUuid,
  type AnalyticsProperties
} from "@/lib/analytics/events";

const recordSchema = z.object({
  visitor: z.string().regex(analyticsUuid),
  id: z.string().regex(analyticsUuid),
  chain: analyticsChainSchema,
  kind: z.enum(["buy", "accept-offer", "cancel", "validate"]),
  confirmed: z.boolean(),
  orderType: z.enum(["listing", "offer"]).optional(),
  orderKey: z.string().optional()
});
type Operation = z.infer<typeof recordSchema>;
type OperationIntent = {
  chainId: number;
  kind: string;
  orderHash?: string;
  order?: { offer: readonly { itemType: number }[] };
};

// Raw transaction and order hashes are local keys only. No operation record is
// passed to the event API. Storage is removed together with analytics consent.
export function createAnalyticsOperations(
  storage: () => AnalyticsStorage | null,
  visitor: () => string | null,
  track: typeof trackAnalyticsEvent,
  uuid: () => string
) {
  function read(): Record<string, Operation> {
    try {
      const value = z
        .record(recordSchema)
        .safeParse(
          JSON.parse(storage()?.getItem(analyticsOperationsKey) ?? "{}")
        );
      return value.success ? value.data : {};
    } catch {
      return {};
    }
  }
  function save(records: Record<string, Operation>) {
    try {
      storage()?.setItem(
        analyticsOperationsKey,
        JSON.stringify(Object.fromEntries(Object.entries(records).slice(-200)))
      );
    } catch {
      /* Skip analytics if persistence is unavailable. */
    }
  }
  function submitted(
    intent: OperationIntent,
    hash: string,
    previousHash?: string
  ) {
    const owner = visitor();
    const chain = analyticsChainFromId(intent.chainId);
    if (
      !owner ||
      !chain ||
      !["buy", "accept-offer", "cancel", "validate"].includes(intent.kind)
    )
      return;
    const records = read();
    const previous = previousHash
      ? records[`${intent.chainId}:${previousHash.toLowerCase()}`]
      : undefined;
    const key = `${intent.chainId}:${hash.toLowerCase()}`;
    if (records[key]?.visitor === owner) return;
    const record: Operation =
      previous?.visitor === owner
        ? previous
        : {
            visitor: owner,
            id: uuid(),
            chain,
            kind: intent.kind as Operation["kind"],
            confirmed: false,
            orderType:
              intent.kind === "validate"
                ? intent.order?.offer[0]?.itemType === 2
                  ? "listing"
                  : "offer"
                : undefined,
            orderKey: intent.orderHash
              ? `order:${intent.chainId}:${intent.orderHash.toLowerCase()}`
              : undefined
          };
    records[key] = record;
    save(records);
    if (!previous && (record.kind === "buy" || record.kind === "accept-offer"))
      track("Trade Submitted", {
        action: record.kind,
        chain,
        marketplace: chain === "bnb" ? "yunipals" : "opensea"
      });
  }
  function confirmed(chainId: number, hash: string) {
    const owner = visitor();
    if (!owner) return;
    const records = read();
    const record = records[`${chainId}:${hash.toLowerCase()}`];
    if (
      !record ||
      record.visitor !== owner ||
      record.confirmed ||
      Object.values(records).some(
        (item) => item.id === record.id && item.confirmed
      )
    )
      return;
    record.confirmed = true;
    if (record.orderKey) records[record.orderKey] = record;
    save(records);
    if (record.kind === "buy" || record.kind === "accept-offer")
      track("Trade Confirmed", {
        action: record.kind,
        chain: record.chain,
        marketplace: record.chain === "bnb" ? "yunipals" : "opensea"
      });
    if (record.kind === "cancel")
      track("Order Cancelled", { chain: record.chain });
    if (record.kind === "validate" && record.orderType)
      track("Order Published", {
        chain: record.chain,
        order_type: record.orderType
      });
  }
  function published(
    chainId: number,
    orderHash: string,
    orderType: "listing" | "offer"
  ) {
    const owner = visitor();
    const chain = analyticsChainFromId(chainId);
    if (!owner || !chain) return;
    const records = read();
    const key = `order:${chainId}:${orderHash.toLowerCase()}`;
    if (records[key]?.visitor === owner && records[key]?.confirmed) return;
    records[key] = {
      visitor: owner,
      id: uuid(),
      chain,
      kind: "validate",
      confirmed: true,
      orderType
    };
    save(records);
    track("Order Published", { chain, order_type: orderType });
  }
  function safely<Args extends unknown[]>(action: (...args: Args) => void) {
    return (...args: Args) => {
      try {
        action(...args);
      } catch {
        /* Analytics must never affect a wallet action or receipt. */
      }
    };
  }
  return {
    submitted: safely(submitted),
    confirmed: safely(confirmed),
    published: safely(published)
  };
}

export const analyticsOperations = createAnalyticsOperations(
  analyticsStorage,
  analytics.visitor,
  trackAnalyticsEvent,
  () => crypto.randomUUID()
);
export function analyticsTradeProperties(
  chainId: number,
  side: "listing" | "offer"
): AnalyticsProperties<"Trade Started"> {
  const chain = analyticsChainFromId(chainId) ?? "ethereum";
  return {
    action: side === "listing" ? "buy" : "accept-offer",
    chain,
    marketplace: chain === "bnb" ? "yunipals" : "opensea"
  };
}
export function analyticsInterruptionReason(
  error: unknown
): AnalyticsProperties<"Trade Interrupted">["reason"] {
  if (!(error instanceof Error)) return "other";
  if (error.name === "SubmittedTransactionError") return "confirmation-unknown";
  if (error.name === "TimeoutError") return "timeout";
  if (/user rejected|user denied|rejected the request/i.test(error.message))
    return "wallet-rejected";
  if (/unavailable|not enabled/i.test(error.message)) return "unavailable";
  return "other";
}

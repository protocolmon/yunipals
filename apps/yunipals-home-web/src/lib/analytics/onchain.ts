import { z } from "zod";

import {
  analytics,
  analyticsStorage,
  trackAnalyticsEvent
} from "@/lib/analytics/index";
import {
  analyticsOnchainKey,
  type AnalyticsStorage
} from "@/lib/analytics/consent";
import {
  analyticsChainFromId,
  analyticsChainSchema,
  analyticsOnchainAction,
  analyticsUuid
} from "@/lib/analytics/events";

const operation = z.object({
  visitor: z.string().regex(analyticsUuid),
  id: z.string().regex(analyticsUuid),
  action: analyticsOnchainAction,
  chain: analyticsChainSchema,
  state: z.enum(["submitted", "confirmed", "failed"])
});
type Action = z.infer<typeof analyticsOnchainAction>;
type Record = z.infer<typeof operation>;
type Failure = "reverted" | "cancelled" | "unexpected-replacement";

// Hashes are used only as local deduplication keys, never as event properties.
export function createOnchainAnalytics(
  storage: () => AnalyticsStorage | null,
  visitor: () => string | null,
  track: typeof trackAnalyticsEvent,
  uuid: () => string,
  matchesWallet: (address: string) => boolean = () => true
) {
  function records(): { [key: string]: Record } {
    try {
      return z
        .record(operation)
        .parse(JSON.parse(storage()?.getItem(analyticsOnchainKey) ?? "{}"));
    } catch {
      return {};
    }
  }
  function save(value: { [key: string]: Record }) {
    storage()?.setItem(
      analyticsOnchainKey,
      JSON.stringify(Object.fromEntries(Object.entries(value).slice(-300)))
    );
  }
  function key(chainId: number, hash: string) {
    return `${chainId}:${hash.toLowerCase()}`;
  }
  function submitted(
    chainId: number,
    action: Action,
    hash: string,
    account?: string
  ) {
    const owner = visitor(),
      chain = analyticsChainFromId(chainId);
    if (
      (account !== undefined && !matchesWallet(account)) ||
      !owner ||
      !chain ||
      !analyticsOnchainAction.safeParse(action).success
    )
      return;
    const all = records(),
      id = key(chainId, hash);
    if (all[id]?.visitor === owner) return;
    all[id] = { visitor: owner, id: uuid(), action, chain, state: "submitted" };
    save(all);
    track("Onchain Action Submitted", { action, chain });
  }
  function replace(chainId: number, original: string, replacement: string) {
    const all = records(),
      item = all[key(chainId, original)];
    if (!item || item.visitor !== visitor()) return;
    all[key(chainId, replacement)] = { ...item };
    save(all);
  }
  function finish(chainId: number, hash: string, reason?: Failure) {
    const all = records(),
      item = all[key(chainId, hash)];
    if (
      !item ||
      item.visitor !== visitor() ||
      item.state !== "submitted" ||
      Object.values(all).some(
        (other) => other.id === item.id && other.state !== "submitted"
      )
    )
      return;
    item.state = reason ? "failed" : "confirmed";
    save(all);
    if (reason)
      track("Onchain Action Failed", {
        action: item.action,
        chain: item.chain,
        reason
      });
    else
      track("Onchain Action Confirmed", {
        action: item.action,
        chain: item.chain
      });
  }
  function safely<Args extends unknown[]>(fn: (...args: Args) => void) {
    return (...args: Args) => {
      try {
        fn(...args);
      } catch {
        /* Analytics cannot affect signing, receipts or recovery. */
      }
    };
  }
  return {
    submitted: safely(submitted),
    replace: safely(replace),
    confirmed: safely((chain: number, hash: string) => finish(chain, hash)),
    failed: safely((chain: number, hash: string, reason: Failure) =>
      finish(chain, hash, reason)
    )
  };
}
export const onchainAnalytics = createOnchainAnalytics(
  analyticsStorage,
  analytics.visitor,
  trackAnalyticsEvent,
  () => crypto.randomUUID(),
  analytics.matchesWallet
);

export function marketAnalyticsAction(kind: string): Action | undefined {
  const actions: { [key: string]: Action } = {
    buy: "buy",
    "accept-offer": "accept-offer",
    cancel: "cancel-order",
    validate: "publish-order",
    "approve-nft": "approve-nft",
    "approve-currency": "approve-currency",
    wrap: "wrap-currency"
  };
  return actions[kind];
}

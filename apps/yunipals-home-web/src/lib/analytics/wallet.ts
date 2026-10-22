import { analytics, trackAnalyticsEvent } from "@/lib/analytics/index";
import {
  analyticsChainFromId,
  type AnalyticsEntryPoint
} from "@/lib/analytics/events";

let requested: {
  entryPoint: AnalyticsEntryPoint;
  visitor: string;
  at: number;
} | null = null;
export function analyticsWalletRequested(entryPoint: AnalyticsEntryPoint) {
  const visitor = analytics.visitor();
  requested = visitor ? { entryPoint, visitor, at: Date.now() } : null;
  trackAnalyticsEvent("Wallet Connect Started", { entry_point: entryPoint });
}
export function analyticsWalletConnected(chainId?: number, connectorId = "") {
  const request = requested;
  requested = null;
  if (
    !request ||
    request.visitor !== analytics.visitor() ||
    Date.now() - request.at > 120_000
  )
    return;
  const id = connectorId.toLowerCase();
  trackAnalyticsEvent("Wallet Connected", {
    entry_point: request.entryPoint,
    chain: analyticsChainFromId(chainId),
    connector: id.includes("walletconnect")
      ? "walletconnect"
      : id.includes("coinbase")
        ? "coinbase"
        : id.includes("injected") || id.includes("metamask")
          ? "injected"
          : "other"
  });
}

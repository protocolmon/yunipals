import { fetchAnalyticsCountry } from "@/lib/analytics/identity";
import { environment } from "@/environment";
import { createAnalyticsClient } from "@/lib/analytics/client";
import { hasAnalyticsPrivacySignal } from "@/lib/analytics/consent";

export function analyticsStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function analyticsPrivacySignal() {
  return (
    typeof navigator !== "undefined" &&
    hasAnalyticsPrivacySignal(
      navigator as Navigator & { globalPrivacyControl?: boolean }
    )
  );
}
export const analytics = createAnalyticsClient(environment.analytics, {
  storage: analyticsStorage,
  privacySignal: analyticsPrivacySignal,
  load: async () =>
    (await import("@/lib/analytics/mixpanel")).createMixpanelAdapter,
  uuid: () => crypto.randomUUID(),
  country: fetchAnalyticsCountry,
  // Atomically bind an anonymous device across tabs. Without Web Locks, use a
  // fresh device ID on wallet connection to prevent two wallets sharing a cluster.
  withIdentityLock: (task) =>
    navigator.locks
      ? navigator.locks.request("yunipals-analytics-identity-v2", task)
      : Promise.resolve().then(task),
  linkAnonymous: typeof navigator !== "undefined" && Boolean(navigator.locks),
  deviceType: () =>
    window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop"
});
export const trackAnalyticsEvent = analytics.track;

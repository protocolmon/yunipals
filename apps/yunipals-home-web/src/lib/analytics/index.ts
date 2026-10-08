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
  deviceType: () =>
    window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop"
});
export const trackAnalyticsEvent = analytics.track;

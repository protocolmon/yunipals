export const analyticsConsentKey = "yunipals.analytics.consent.v1";
export const analyticsVisitorKey = "yunipals.analytics.visitor.v1";
export const analyticsOperationsKey = "yunipals.analytics.operations.v1";
export const analyticsPreferenceLifetime = 180 * 24 * 60 * 60 * 1000;
export type AnalyticsChoice = "unknown" | "accepted" | "declined";
export type AnalyticsConsent = {
  version: 1;
  choice: Exclude<AnalyticsChoice, "unknown">;
  updatedAt: number;
  expiresAt: number;
};
export interface AnalyticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readAnalyticsConsent(
  storage: AnalyticsStorage | null,
  now = Date.now()
): AnalyticsConsent | null {
  try {
    const value: unknown = JSON.parse(
      storage?.getItem(analyticsConsentKey) ?? "null"
    );
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1 ||
      (record.choice !== "accepted" && record.choice !== "declined") ||
      typeof record.updatedAt !== "number" ||
      typeof record.expiresAt !== "number" ||
      !Number.isFinite(record.updatedAt) ||
      record.updatedAt > now ||
      record.expiresAt !== record.updatedAt + analyticsPreferenceLifetime ||
      record.expiresAt <= now
    )
      return null;
    return record as AnalyticsConsent;
  } catch {
    return null;
  }
}

export function clearAnalyticsData(storage: AnalyticsStorage | null) {
  for (const key of [analyticsVisitorKey, analyticsOperationsKey]) {
    try {
      storage?.removeItem(key);
    } catch {
      /* Storage can be disabled. */
    }
  }
}

export function writeAnalyticsConsent(
  storage: AnalyticsStorage | null,
  choice: Exclude<AnalyticsChoice, "unknown">,
  now = Date.now()
): boolean {
  if (!storage) return false;
  try {
    if (choice === "declined") clearAnalyticsData(storage);
    storage.setItem(
      analyticsConsentKey,
      JSON.stringify({
        version: 1,
        choice,
        updatedAt: now,
        expiresAt: now + analyticsPreferenceLifetime
      })
    );
    return true;
  } catch {
    clearAnalyticsData(storage);
    return false;
  }
}

export function hasAnalyticsPrivacySignal(browser: {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}) {
  return (
    browser.doNotTrack === "1" ||
    browser.doNotTrack === "yes" ||
    browser.globalPrivacyControl === true
  );
}

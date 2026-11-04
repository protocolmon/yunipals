export const analyticsConsentKey = "yunipals.analytics.consent.v2";
export const analyticsVisitorKey = "yunipals.analytics.visitor.v2";
export const analyticsOperationsKey = "yunipals.analytics.operations.v2";
export const analyticsOnchainKey = "yunipals.analytics.onchain.v2";
export const analyticsPreferenceLifetime = 180 * 24 * 60 * 60 * 1000;
export type AnalyticsChoice = "unknown" | "accepted" | "declined";
export type AnalyticsConsent = {
  version: 2;
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
    const current = storage?.getItem(analyticsConsentKey);
    const value: unknown = JSON.parse(current ?? "null");
    if (!current) {
      const legacy: unknown = JSON.parse(
        storage?.getItem("yunipals.analytics.consent.v1") ?? "null"
      );
      // A previous refusal remains a refusal. Previous permission does not cover
      // wallet-linked profiles and country; request the expanded permission.
      if (legacy && typeof legacy === "object") {
        const old = legacy as Record<string, unknown>;
        if (
          old.version === 1 &&
          old.choice === "declined" &&
          typeof old.updatedAt === "number" &&
          old.updatedAt <= now &&
          old.expiresAt === old.updatedAt + analyticsPreferenceLifetime &&
          old.expiresAt > now
        )
          return { ...old, version: 2 } as AnalyticsConsent;
      }
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 2 ||
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
  for (const key of [
    analyticsVisitorKey,
    analyticsOperationsKey,
    analyticsOnchainKey,
    "yunipals.analytics.visitor.v1",
    "yunipals.analytics.operations.v1"
  ]) {
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
        version: 2,
        choice,
        updatedAt: now,
        expiresAt: now + analyticsPreferenceLifetime
      })
    );
    storage.removeItem("yunipals.analytics.consent.v1");
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

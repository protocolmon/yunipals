export const tradingTermsVersion = "2026-09-25";
export const tradingInformationStorageKey = "yunipals:trading-information:v2";
export const tradingTermsStorageKey = `yunipals:trading-terms:${tradingTermsVersion}`;

type TradingTermsAcceptance = {
  acceptedAt: string;
  version: string;
};

function storageAdapters() {
  return ["localStorage", "sessionStorage"] as const;
}

export function hasDismissedTradingInformation() {
  for (const name of storageAdapters()) {
    try {
      if (window[name].getItem(tradingInformationStorageKey) === "dismissed")
        return true;
    } catch {
      // Storage can be disabled. The notice must never prevent browsing.
    }
  }
  return false;
}

export function dismissTradingInformation() {
  for (const name of storageAdapters()) {
    try {
      window[name].setItem(tradingInformationStorageKey, "dismissed");
    } catch {
      // Session storage is a fallback when persistent storage is unavailable.
    }
  }
}

export function hasAcceptedTradingTerms() {
  for (const name of storageAdapters()) {
    try {
      const stored = window[name].getItem(tradingTermsStorageKey);
      if (!stored) continue;
      const acceptance = JSON.parse(stored) as TradingTermsAcceptance;
      if (
        acceptance.version === tradingTermsVersion &&
        !Number.isNaN(Date.parse(acceptance.acceptedAt))
      )
        return true;
    } catch {
      // A malformed or unavailable record is not a current acceptance.
    }
  }
  return false;
}

export function acceptTradingTerms(acceptedAt = new Date()) {
  const acceptance: TradingTermsAcceptance = {
    acceptedAt: acceptedAt.toISOString(),
    version: tradingTermsVersion
  };
  for (const name of storageAdapters()) {
    try {
      window[name].setItem(tradingTermsStorageKey, JSON.stringify(acceptance));
      window[name].setItem(tradingInformationStorageKey, "dismissed");
    } catch {
      // In-memory application state still permits the current browsing session.
    }
  }
  return acceptance;
}

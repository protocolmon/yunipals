import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptTradingTerms,
  dismissTradingInformation,
  hasAcceptedTradingTerms,
  hasDismissedTradingInformation,
  tradingInformationStorageKey,
  tradingTermsStorageKey,
  tradingTermsVersion
} from "@/lib/marketplace/tradingInformation";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withStorage(
  run: (local: MemoryStorage, session: MemoryStorage) => void
) {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const previous = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage }
  });
  try {
    run(localStorage, sessionStorage);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previous
    });
  }
}

test("acceptance records the current terms version and date", () => {
  withStorage((local, session) => {
    const acceptedAt = new Date("2026-09-18T12:00:00.000Z");
    acceptTradingTerms(acceptedAt);
    assert.equal(hasAcceptedTradingTerms(), true);
    assert.deepEqual(JSON.parse(local.getItem(tradingTermsStorageKey)!), {
      acceptedAt: acceptedAt.toISOString(),
      version: tradingTermsVersion
    });
    assert.equal(session.getItem(tradingInformationStorageKey), "dismissed");
  });
});

test("dismissal permits browsing without recording terms acceptance", () => {
  withStorage((local) => {
    dismissTradingInformation();
    assert.equal(hasDismissedTradingInformation(), true);
    assert.equal(hasAcceptedTradingTerms(), false);
    assert.equal(local.getItem(tradingTermsStorageKey), null);
  });
});

test("old, malformed and undated acceptance records are rejected", () => {
  withStorage((local) => {
    for (const value of [
      "not-json",
      JSON.stringify({
        version: "2026-01-01",
        acceptedAt: new Date().toISOString()
      }),
      JSON.stringify({ version: tradingTermsVersion, acceptedAt: "unknown" })
    ]) {
      local.setItem(tradingTermsStorageKey, value);
      assert.equal(hasAcceptedTradingTerms(), false);
    }
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  createAnalyticsClient,
  type AnalyticsAdapterFactory
} from "@/lib/analytics/client";
import { analyticsConfigFromEnv } from "@/lib/analytics/config";
import {
  analyticsConsentKey,
  analyticsVisitorKey,
  analyticsOperationsKey,
  analyticsPreferenceLifetime,
  hasAnalyticsPrivacySignal,
  readAnalyticsConsent,
  type AnalyticsStorage
} from "@/lib/analytics/consent";
import {
  analyticsPage,
  sanitizeAnalyticsPayload,
  type AnalyticsPayload
} from "@/lib/analytics/events";
import { createAnalyticsOperations } from "@/lib/analytics/operations";

class MemoryStorage implements AnalyticsStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const configuredEnv = {
  VITE_MIXPANEL_ENABLED: "true",
  VITE_MIXPANEL_TOKEN: "test-token",
  VITE_MIXPANEL_REGION: "eu",
  VITE_ANALYTICS_ENVIRONMENT: "development",
  VITE_ANALYTICS_RETENTION_DAYS: "90",
  VITE_PRIVACY_EMAIL: "privacy@example.test"
};
const config = analyticsConfigFromEnv(configuredEnv);
function harness(loadOverride?: () => Promise<AnalyticsAdapterFactory>) {
  const storage = new MemoryStorage();
  const sent: AnalyticsPayload[] = [];
  const filters: ((event: AnalyticsPayload) => AnalyticsPayload | null)[] = [];
  let loads = 0;
  let clock = 1_000_000;
  let privacy = false;
  const factory: AnalyticsAdapterFactory = (_, filter) => {
    filters.push(filter);
    return {
      track: (event, properties) => {
        const data = filter({
          event,
          properties: {
            ...properties,
            $current_url: "https://yunipals.test/collector/0xSECRET",
            utm_source: "secret"
          }
        });
        if (data) sent.push(data);
      },
      stop: () => {}
    };
  };
  const client = createAnalyticsClient(config, {
    storage: () => storage,
    privacySignal: () => privacy,
    now: () => clock,
    uuid: randomUUID,
    load: async () => {
      loads++;
      return loadOverride ? loadOverride() : factory;
    }
  });
  return {
    client,
    storage,
    sent,
    filters,
    factory,
    loads: () => loads,
    advance: (ms: number) => {
      clock += ms;
    },
    privacy: (value: boolean) => {
      privacy = value;
    }
  };
}
const samplePage = { page: "privacy", route: "/privacy" } as const;

test("Exomon routes use collection labels and never expose Solana wallet or mint addresses", () => {
  const address = "11111111111111111111111111111111";
  const collector = analyticsPage(
    `/collector/solana/${address}`,
    "?utm_source=private"
  );
  assert.deepEqual(collector, {
    page: "collector",
    route: "/collector/solana/:address",
    collection: "exomon",
    chain: "solana"
  });
  const detail = analyticsPage(`/collection/solana/${address}`, "");
  assert.equal(detail?.collection, "exomon");
  assert.equal(detail?.chain, "solana");
  assert.equal(JSON.stringify(detail).includes(address), false);
  assert.equal(analyticsPage("/", "?chain=solana")?.collection, "exomon");
  assert.equal(analyticsPage("/leaderboard", "?chain=solana")?.chain, "solana");
});

test("incomplete configuration, fixtures, and invalid regions cannot activate analytics", () => {
  assert.equal(config.enabled, true);
  assert.equal(config.apiHost, "https://api-eu.mixpanel.com");
  for (const key of Object.keys(configuredEnv))
    assert.equal(
      analyticsConfigFromEnv({ ...configuredEnv, [key]: "" }).enabled,
      false,
      key
    );
  assert.equal(
    analyticsConfigFromEnv({ ...configuredEnv, MODE: "fixtures" }).enabled,
    false
  );
  assert.equal(
    analyticsConfigFromEnv({
      ...configuredEnv,
      VITE_MIXPANEL_REGION: "unknown"
    }).enabled,
    false
  );
  assert.equal(
    analyticsConfigFromEnv({
      ...configuredEnv,
      VITE_ANALYTICS_RETENTION_DAYS: "0"
    }).enabled,
    false
  );
  assert.equal(
    analyticsConfigFromEnv({ ...configuredEnv, VITE_MIXPANEL_REGION: "india" })
      .apiHost,
    "https://api-in.mixpanel.com"
  );
});
test("retention supports calendar years and rejects ambiguous or invalid periods", () => {
  const env = {
    ...configuredEnv,
    VITE_ANALYTICS_RETENTION_DAYS: "",
    VITE_ANALYTICS_RETENTION_YEARS: "2",
    VITE_PRIVACY_EMAIL: "privacy@yunipals.com"
  };
  const actual = analyticsConfigFromEnv(env);
  assert.equal(actual.enabled, true);
  assert.deepEqual(actual.retention, { value: 2, unit: "years" });
  assert.equal(actual.privacyEmail, "privacy@yunipals.com");
  assert.deepEqual(config.retention, { value: 90, unit: "days" });
  assert.equal(
    analyticsConfigFromEnv({ ...env, VITE_ANALYTICS_RETENTION_DAYS: "730" })
      .enabled,
    false
  );
  for (const value of ["", "0", "-2", "2.5", "unknown", "101"]) {
    assert.equal(
      analyticsConfigFromEnv({ ...env, VITE_ANALYTICS_RETENTION_YEARS: value })
        .enabled,
      false
    );
  }
});
test("fresh visits and declines never load the SDK, store an identifier, or queue events", async () => {
  const h = harness();
  h.client.track("Page Viewed", samplePage);
  await h.client.start();
  assert.equal(h.loads(), 0);
  assert.equal(h.storage.values.size, 0);
  h.client.choose("declined");
  await h.client.start();
  assert.equal(h.loads(), 0);
  assert.deepEqual([...h.storage.values.keys()], [analyticsConsentKey]);
  assert.equal(h.sent.length, 0);
});
test("consent creates one browser identifier, survives reload, and deduplicates pageviews", async () => {
  const h = harness();
  h.client.choose("accepted");
  await Promise.all([h.client.start(), h.client.start()]);
  assert.equal(h.loads(), 1);
  h.client.page("privacy", samplePage);
  h.client.page("privacy", samplePage);
  assert.equal(h.sent.length, 1);
  const id = h.client.visitor();
  h.client.stop();
  await h.client.start();
  assert.equal(h.client.visitor(), id);
  assert.equal(h.sent[0].properties.$current_url, undefined);
  assert.equal(h.sent[0].properties.utm_source, undefined);
});
test("withdrawal blocks old hooks and removes identifiers; regrant gets a fresh identifier", async () => {
  const h = harness();
  h.client.choose("accepted");
  await h.client.start();
  const id = h.client.visitor();
  h.storage.setItem(analyticsOperationsKey, "{}");
  h.client.choose("declined");
  assert.equal(h.storage.getItem(analyticsVisitorKey), null);
  assert.equal(h.storage.getItem(analyticsOperationsKey), null);
  assert.equal(
    h.filters[0]({ event: "Page Viewed", properties: samplePage }),
    null
  );
  h.advance(1);
  h.client.choose("accepted");
  await h.client.start();
  assert.notEqual(h.client.visitor(), id);
  assert.equal(
    h.filters[0]({ event: "Page Viewed", properties: samplePage }),
    null
  );
});
test("accept then withdraw while the SDK loads cannot initialize tracking", async () => {
  let resolve!: (factory: AnalyticsAdapterFactory) => void;
  const pending = new Promise<AnalyticsAdapterFactory>((done) => {
    resolve = done;
  });
  const h = harness(() => pending);
  h.client.choose("accepted");
  const loading = h.client.start();
  h.client.choose("declined");
  resolve(h.factory);
  await loading;
  assert.equal(h.filters.length, 0);
  assert.equal(h.client.visitor(), null);
  assert.equal(h.storage.getItem(analyticsVisitorKey), null);
});
test("an older rejected load cannot erase a later consented session", async () => {
  let reject!: (error: Error) => void;
  let first = true;
  const deferred = new Promise<AnalyticsAdapterFactory>((_, fail) => {
    reject = fail;
  });
  const h = harness(() => {
    if (first) {
      first = false;
      return deferred;
    }
    return Promise.resolve(h.factory);
  });
  h.client.choose("accepted");
  const old = h.client.start();
  h.client.choose("declined");
  h.advance(1);
  h.client.choose("accepted");
  await h.client.start();
  const id = h.client.visitor();
  reject(new Error("old request failed"));
  await old;
  assert.equal(h.client.visitor(), id);
  assert.ok(h.storage.getItem(analyticsVisitorKey));
});
test("expired, corrupt, future, and unknown-version preferences fail closed", async () => {
  const h = harness();
  h.client.choose("accepted");
  await h.client.start();
  h.advance(analyticsPreferenceLifetime);
  assert.equal(h.client.track("Page Viewed", samplePage), false);
  assert.equal(h.client.refresh(), "unknown");
  assert.equal(h.storage.getItem(analyticsVisitorKey), null);
  for (const value of [
    "invalid",
    '{"version":2}',
    JSON.stringify({
      version: 1,
      choice: "accepted",
      updatedAt: Date.now() + 10_000,
      expiresAt: Date.now() + analyticsPreferenceLifetime + 10_000
    })
  ]) {
    h.storage.setItem(analyticsConsentKey, value);
    assert.equal(readAnalyticsConsent(h.storage), null);
  }
});
test("privacy signals and cross-tab preference removal block dispatch immediately", async () => {
  const h = harness();
  h.client.choose("accepted");
  await h.client.start();
  h.storage.removeItem(analyticsConsentKey);
  assert.equal(
    h.filters[0]({ event: "Page Viewed", properties: samplePage }),
    null
  );
  h.client.refresh();
  h.client.choose("accepted");
  h.privacy(true);
  await h.client.start();
  assert.equal(h.client.track("Page Viewed", samplePage), false);
  assert.equal(hasAnalyticsPrivacySignal({ globalPrivacyControl: true }), true);
  assert.equal(hasAnalyticsPrivacySignal({ doNotTrack: "1" }), true);
});
test("cross-tab consent renewal blocks old SDK hooks before the storage event arrives", async () => {
  const h = harness();
  h.client.choose("accepted");
  await h.client.start();
  const id = h.client.visitor();
  const record = readAnalyticsConsent(h.storage, 1_000_000)!;
  h.advance(1);
  h.storage.setItem(
    analyticsConsentKey,
    JSON.stringify({
      ...record,
      updatedAt: record.updatedAt + 1,
      expiresAt: record.expiresAt + 1
    })
  );
  assert.equal(
    h.filters[0]({ event: "Page Viewed", properties: samplePage }),
    null
  );
  await h.client.start();
  assert.notEqual(h.client.visitor(), id);
  assert.equal(h.client.track("Page Viewed", samplePage), true);
});
test("blocked storage, failed UUID generation, SDK failures and loads cannot break the app", async () => {
  const throwing: AnalyticsStorage = {
    getItem: () => {
      throw new Error();
    },
    setItem: () => {
      throw new Error();
    },
    removeItem: () => {
      throw new Error();
    }
  };
  const client = createAnalyticsClient(config, {
    storage: () => throwing,
    privacySignal: () => false,
    uuid: randomUUID,
    load: async () => {
      throw new Error();
    }
  });
  assert.equal(client.choose("accepted"), false);
  await client.start();
  assert.equal(client.track("Page Viewed", samplePage), false);
  const h = harness(async () => {
    throw new Error("blocked SDK");
  });
  h.client.choose("accepted");
  await h.client.start();
  assert.equal(h.client.visitor(), null);
  const failing = createAnalyticsClient(config, {
    storage: () => h.storage,
    privacySignal: () => false,
    uuid: () => {
      throw new Error();
    },
    load: async () => h.factory
  });
  await failing.start();
  assert.equal(failing.track("Page Viewed", samplePage), false);
});
test("normalization and final payload allowlists exclude addresses, titles, input and SDK attribution", () => {
  const sensitive = "0x1234567890123456789012345678901234567890";
  const props = analyticsPage(
    `/collector/${sensitive}`,
    `?owner=${sensitive}&utm_source=${sensitive}`
  )!;
  const clean = sanitizeAnalyticsPayload(
    {
      event: "Page Viewed",
      properties: {
        ...props,
        $current_url: sensitive,
        $referrer: sensitive,
        current_page_title: sensitive,
        utm_source: sensitive,
        address: sensitive,
        $user_id: sensitive,
        distinct_id: sensitive
      }
    },
    "token",
    randomUUID()
  )!;
  assert.equal(JSON.stringify(clean).includes(sensitive), false);
  assert.equal(clean.properties.route, "/collector/:address");
  assert.equal(
    analyticsPage("/", "?collection=islands&owner=secret")?.collection,
    "islands"
  );
  assert.equal(analyticsPage("/race-lab", ""), null);
  assert.equal(
    sanitizeAnalyticsPayload(
      { event: "$opt_in", properties: {} },
      "token",
      randomUUID()
    ),
    null
  );
  assert.equal(
    sanitizeAnalyticsPayload(
      {
        event: "Page Viewed",
        properties: { page: sensitive, route: "/privacy" }
      },
      "token",
      randomUUID()
    ),
    null
  );
});
test("transaction replacements and receipt recovery count each submitted and confirmed action once", () => {
  const h = harness();
  const sent: AnalyticsPayload[] = [];
  const id = randomUUID();
  const operations = createAnalyticsOperations(
    () => h.storage,
    () => id,
    (event, properties) => {
      sent.push({ event, properties });
      return true;
    },
    randomUUID
  );
  const intent = { kind: "buy", chainId: 56 };
  operations.confirmed(56, "historical");
  assert.equal(sent.length, 0);
  operations.submitted(intent, "original");
  operations.submitted(intent, "replacement", "original");
  operations.confirmed(56, "replacement");
  operations.confirmed(56, "original");
  operations.confirmed(56, "replacement");
  assert.deepEqual(
    sent.map((item) => item.event),
    ["Trade Submitted", "Trade Confirmed"]
  );
  assert.equal(JSON.stringify(sent).includes("original"), false);
  operations.submitted({ kind: "approve-nft", chainId: 56 }, "approval");
  operations.confirmed(56, "approval");
  assert.equal(sent.length, 2);
  operations.submitted(
    {
      kind: "validate",
      chainId: 56,
      orderHash: "order",
      order: { offer: [{ itemType: 2 }] }
    },
    "publication"
  );
  operations.confirmed(56, "publication");
  operations.published(56, "order", "listing");
  assert.equal(
    sent.filter((item) => item.event === "Order Published").length,
    1
  );
});
test("analytics bookkeeping failures do not interfere with transactions", () => {
  const operations = createAnalyticsOperations(
    () => null,
    () => randomUUID(),
    () => {
      throw new Error("SDK blocked");
    },
    () => {
      throw new Error("UUID unavailable");
    }
  );
  assert.doesNotThrow(() =>
    operations.submitted({ kind: "buy", chainId: 56 }, "hash")
  );
  assert.doesNotThrow(() => operations.published(56, "order", "listing"));
});

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
  analyticsPreferenceLifetime,
  analyticsVisitorKey,
  type AnalyticsStorage
} from "@/lib/analytics/consent";
import { analyticsCountry, walletAnalyticsId } from "@/lib/analytics/identity";
import type { AnalyticsPayload } from "@/lib/analytics/events";
import { createOnchainAnalytics } from "@/lib/analytics/onchain";

const walletA = `0x${"a".repeat(40)}`;
const walletB = `0x${"b".repeat(40)}`;
const config = analyticsConfigFromEnv({
  VITE_MIXPANEL_ENABLED: "true",
  VITE_MIXPANEL_TOKEN: "test-token",
  VITE_MIXPANEL_REGION: "eu",
  VITE_ANALYTICS_ENVIRONMENT: "development",
  VITE_ANALYTICS_RETENTION_YEARS: "2",
  VITE_PRIVACY_EMAIL: "privacy@example.test"
});
const page = { page: "privacy", route: "/privacy" } as const;
function fixture(
  options: {
    country?: () => Promise<unknown>;
    walletId?: typeof walletAnalyticsId;
    storage?: AnalyticsStorage;
    withIdentityLock?: (task: () => void) => Promise<void>;
  } = {}
) {
  const values = new Map<string, string>();
  const storage = options.storage ?? {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
  const events: AnalyticsPayload[] = [],
    profiles: Record<string, unknown>[] = [];
  const filters: ((event: AnalyticsPayload) => AnalyticsPayload | null)[] = [];
  const profileFilters: ((
    profile: Record<string, unknown>
  ) => Record<string, unknown> | null)[] = [];
  let loads = 0;
  const factory: AnalyticsAdapterFactory = (_, filter, profileFilter) => {
    filters.push(filter);
    profileFilters.push(profileFilter);
    return {
      track: (event, properties) => {
        const value = filter({
          event,
          properties: { ...properties, wallet: walletA, $current_url: walletB }
        });
        if (value) events.push(value);
      },
      identify: (_, userId, profile) => {
        const value = profileFilter({
          $distinct_id: userId,
          $set: { ...profile, wallet: walletA, $city: "secret" },
          $ip: "203.0.113.1"
        });
        if (value) profiles.push(value);
      },
      stop: () => {}
    };
  };
  const client = createAnalyticsClient(config, {
    storage: () => storage,
    privacySignal: () => false,
    uuid: randomUUID,
    load: async () => {
      loads++;
      return factory;
    },
    country: options.country,
    withIdentityLock: options.withIdentityLock,
    walletId: options.walletId
  });
  return {
    client,
    storage,
    events,
    profiles,
    filters,
    profileFilters,
    loads: () => loads
  };
}

test("wallet IDs normalize case, stay stable across devices and separate environments", async () => {
  const id = await walletAnalyticsId(walletA, "production");
  assert.match(id, /^wallet:evm:[a-f0-9]{64}$/);
  assert.equal(
    id,
    await walletAnalyticsId(`0x${"A".repeat(40)}`, "production")
  );
  assert.notEqual(id, await walletAnalyticsId(walletB, "production"));
  assert.notEqual(id, await walletAnalyticsId(walletA, "development"));
  await assert.rejects(walletAnalyticsId("not a wallet", "production"));
});

test("consented anonymous activity links to a wallet, with allowlisted profiles and no raw address", async () => {
  const h = fixture({ country: async () => "DE" });
  h.client.choose("accepted");
  await h.client.start();
  const anonymous = h.client.visitor();
  assert.equal(h.profiles.length, 0);
  h.client.track("Page Viewed", page);
  h.client.setWallet(walletA);
  await h.client.start();
  assert.equal(h.client.visitor(), anonymous);
  const id = await walletAnalyticsId(walletA, config.environment);
  assert.equal(h.client.user(), id);
  assert.equal(h.profiles[0].$distinct_id, id);
  assert.equal(h.profiles[0].$device_id, anonymous);
  assert.equal(h.profiles[0].$ip, "0");
  assert.deepEqual(h.profiles[0].$set, {
    identity_type: "wallet",
    environment: "development",
    schema_version: 2,
    country: "DE"
  });
  const linked = h.events.find((e) => e.event === "Wallet Identified")!;
  assert.equal(linked.properties.$user_id, id);
  assert.equal(linked.properties.distinct_id, id);
  assert.equal(linked.properties.$device_id, anonymous);
  assert.equal(linked.properties.country, "DE");
  assert.equal(
    JSON.stringify({ events: h.events, profiles: h.profiles }).includes(
      walletA
    ),
    false
  );
  const other = fixture({ country: async () => "FR" });
  other.client.setWallet(walletA);
  other.client.choose("accepted");
  await other.client.start();
  assert.equal(other.client.user(), id);
  assert.notEqual(other.client.visitor(), anonymous);
});

test("wallet switching and disconnect rotate device IDs and invalidate old dispatch callbacks", async () => {
  const h = fixture();
  h.client.choose("accepted");
  h.client.setWallet(walletA);
  await h.client.start();
  const a = h.client.visitor(),
    oldProfile = h.profiles[0];
  h.client.setWallet(walletB);
  assert.equal(h.filters[0]({ event: "Page Viewed", properties: page }), null);
  assert.equal(h.profileFilters[0](oldProfile), null);
  await h.client.start();
  const b = h.client.visitor();
  assert.notEqual(a, b);
  assert.equal(
    h.client.user(),
    await walletAnalyticsId(walletB, config.environment)
  );
  h.client.setWallet(null);
  await h.client.start();
  assert.notEqual(h.client.visitor(), b);
  assert.equal(h.client.user(), undefined);
  h.client.track("Page Viewed", page);
  assert.equal(h.events.at(-1)?.properties.$user_id, undefined);
  h.client.choose("declined");
  assert.equal(h.profileFilters[1](h.profiles[1]), null);
});

test("reload reuses the same wallet/device pair but never reuses an identified device for another wallet", async () => {
  const h = fixture();
  h.client.setWallet(walletA);
  h.client.choose("accepted");
  await h.client.start();
  const id = h.client.visitor();
  const reload = fixture({ storage: h.storage });
  reload.client.setWallet(walletA);
  await reload.client.start();
  assert.equal(reload.client.visitor(), id);
  const disconnected = fixture({ storage: h.storage });
  await disconnected.client.start();
  assert.notEqual(disconnected.client.visitor(), id);
});

test("old permission needs renewal; old refusals remain off and old identifiers are cleared", async () => {
  const h = fixture();
  const updatedAt = Date.now();
  const legacy = {
    version: 1,
    choice: "accepted",
    updatedAt,
    expiresAt: updatedAt + analyticsPreferenceLifetime
  };
  h.storage.setItem("yunipals.analytics.consent.v1", JSON.stringify(legacy));
  h.storage.setItem("yunipals.analytics.visitor.v1", "old-identifier");
  assert.equal(h.client.refresh(), "unknown");
  await h.client.start();
  assert.equal(h.loads(), 0);
  assert.equal(h.storage.getItem("yunipals.analytics.visitor.v1"), null);
  h.storage.setItem(
    "yunipals.analytics.consent.v1",
    JSON.stringify({ ...legacy, choice: "declined" })
  );
  assert.equal(h.client.refresh(), "declined");
  h.client.choose("accepted");
  assert.equal(JSON.parse(h.storage.getItem(analyticsConsentKey)!).version, 2);
  await h.client.start();
  assert.ok(h.storage.getItem(analyticsVisitorKey));
});

test("late wallet hashes cannot identify a previous wallet or restart withdrawn analytics", async () => {
  let resolve!: (id: string) => void;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const h = fixture({
    walletId: async (address) =>
      address === walletA ? pending : walletAnalyticsId(address, "development")
  });
  h.client.choose("accepted");
  h.client.setWallet(walletA);
  const old = h.client.start();
  h.client.setWallet(walletB);
  await h.client.start();
  resolve(await walletAnalyticsId(walletA, "development"));
  await old;
  assert.equal(h.profiles.length, 1);
  assert.equal(
    h.client.user(),
    await walletAnalyticsId(walletB, "development")
  );
  h.client.choose("declined");
  assert.equal(h.client.visitor(), null);
  assert.equal(h.client.user(), undefined);
});

test("country is omitted on lookup failure or unavailable values, without interrupting analytics", async () => {
  for (const value of [null, "", "de", "DE,FR", "XX", "ZZ", { ip: "private" }])
    assert.equal(analyticsCountry(value), undefined);
  const h = fixture({
    country: async () => {
      throw new Error("Offline");
    }
  });
  h.client.choose("accepted");
  await h.client.start();
  assert.equal(h.client.track("Page Viewed", page), true);
  assert.equal(h.events[0].properties.country, undefined);
});

test("onchain receipts deduplicate replacements, omit hashes, and never backfill history", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
  let owner: string | null = randomUUID();
  const events: AnalyticsPayload[] = [];
  const chain = createOnchainAnalytics(
    () => storage,
    () => owner,
    (event, properties) => {
      events.push({ event, properties });
      return true;
    },
    randomUUID
  );
  chain.confirmed(8453, "historical");
  assert.equal(events.length, 0);
  chain.submitted(8453, "booster-open", "original");
  chain.replace(8453, "original", "replacement");
  chain.confirmed(8453, "replacement");
  chain.confirmed(8453, "original");
  chain.confirmed(8453, "replacement");
  assert.deepEqual(
    events.map((e) => e.event),
    ["Onchain Action Submitted", "Onchain Action Confirmed"]
  );
  assert.equal(JSON.stringify(events).includes("original"), false);
  chain.submitted(8453, "wrap-ypal", "reverted");
  chain.failed(8453, "reverted", "reverted");
  chain.confirmed(8453, "reverted");
  assert.equal(events.at(-1)?.event, "Onchain Action Failed");
  chain.submitted(8453, "arena-enter", "cancelled");
  chain.failed(8453, "cancelled", "cancelled");
  chain.confirmed(8453, "cancelled");
  chain.submitted(8453, "island-unstake", "previous-user");
  owner = randomUUID();
  chain.confirmed(8453, "previous-user");
  assert.equal(events.at(-1)?.event, "Onchain Action Submitted");
  const length = events.length;
  owner = null;
  chain.submitted(8453, "arena-claim", "no-consent");
  chain.confirmed(8453, "no-consent");
  assert.equal(events.length, length);
});

test("an action submitted by a previous wallet cannot be attributed to the newly connected wallet", () => {
  const events: AnalyticsPayload[] = [];
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    }
  };
  const chain = createOnchainAnalytics(
    () => storage,
    () => randomUUID(),
    (event, properties) => {
      events.push({ event, properties });
      return true;
    },
    randomUUID,
    (address) => address === walletB
  );
  chain.submitted(8453, "booster-open", "previous-wallet-hash", walletA);
  chain.confirmed(8453, "previous-wallet-hash");
  assert.equal(events.length, 0);
});

test("different wallets in two tabs claim different browser identities under the shared lock", async () => {
  const anonymous = fixture();
  anonymous.client.choose("accepted");
  await anonymous.client.start();
  const shared = anonymous.storage;
  let pending = Promise.resolve();
  const lock = (task: () => void) => {
    const result = pending.then(task);
    pending = result;
    return result;
  };
  const a = fixture({ storage: shared, withIdentityLock: lock });
  const b = fixture({ storage: shared, withIdentityLock: lock });
  a.client.setWallet(walletA);
  b.client.setWallet(walletB);
  await Promise.all([a.client.start(), b.client.start()]);
  assert.notEqual(a.client.visitor(), b.client.visitor());
  assert.notEqual(a.client.user(), b.client.user());
});
test("withdrawal while waiting for another tab's identity lock prevents SDK/profile creation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = fixture({
    withIdentityLock: async (task) => {
      await gate;
      task();
    }
  });
  h.client.choose("accepted");
  h.client.setWallet(walletA);
  const start = h.client.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  h.client.choose("declined");
  release();
  await start;
  assert.equal(h.profiles.length, 0);
  assert.equal(h.events.length, 0);
});

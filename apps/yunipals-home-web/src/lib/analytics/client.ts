import {
  analyticsCountry,
  analyticsWalletId,
  normalizeAnalyticsWallet,
  walletAnalyticsId
} from "@/lib/analytics/identity";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import {
  analyticsVisitorKey,
  clearAnalyticsData,
  readAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsChoice,
  type AnalyticsStorage
} from "@/lib/analytics/consent";
import {
  analyticsUuid,
  sanitizeAnalyticsPayload,
  type AnalyticsEvent,
  type AnalyticsPayload,
  type AnalyticsProperties
} from "@/lib/analytics/events";

export type AnalyticsProfile = {
  identity_type: "wallet";
  environment: AnalyticsConfig["environment"];
  schema_version: 2;
  country?: string;
};
export type AnalyticsAdapter = {
  identify?: (
    deviceId: string,
    userId: string,
    profile: AnalyticsProfile
  ) => void;
  track: (event: string, properties: Record<string, unknown>) => void;
  stop: () => void;
};
export type AnalyticsAdapterFactory = (
  config: AnalyticsConfig,
  filter: (payload: AnalyticsPayload) => AnalyticsPayload | null,
  profileFilter: (
    payload: Record<string, unknown>
  ) => Record<string, unknown> | null
) => AnalyticsAdapter;
type ClientDependencies = {
  storage: () => AnalyticsStorage | null;
  privacySignal: () => boolean;
  load: () => Promise<AnalyticsAdapterFactory>;
  uuid: () => string;
  now?: () => number;
  withIdentityLock?: (task: () => void) => Promise<void>;
  linkAnonymous?: boolean;
  country?: () => Promise<unknown>;
  walletId?: typeof walletAnalyticsId;
  deviceType?: () => "mobile" | "desktop";
};

export function createAnalyticsClient(
  config: AnalyticsConfig,
  dependencies: ClientDependencies
) {
  const now = dependencies.now ?? Date.now;
  let adapter: AnalyticsAdapter | null = null;
  let pending: Promise<void> | null = null;
  let generation = 0;
  let visitorId: string | null = null;
  let userId: string | undefined;
  let country: string | undefined;
  let wallet: string | null = null;
  let lastPage: string | null = null;
  let lastConsent = "";
  let storageReady = true;
  function consent() {
    return readAnalyticsConsent(dependencies.storage(), now());
  }
  function allowed() {
    return (
      storageReady &&
      config.enabled &&
      !dependencies.privacySignal() &&
      consent()?.choice === "accepted"
    );
  }
  function stop() {
    generation++;
    pending = null;
    lastPage = null;
    visitorId = null;
    userId = undefined;
    country = undefined;
    try {
      adapter?.stop();
    } catch {
      /* Analytics must not interrupt the app. */
    }
    adapter = null;
  }
  function refresh(): AnalyticsChoice {
    const record = consent();
    if (!record) {
      try {
        dependencies.storage()?.removeItem("yunipals.analytics.consent.v1");
      } catch {
        /* Stay off. */
      }
    }
    const fingerprint = record
      ? `${record.choice}:${record.updatedAt}`
      : "unknown";
    if (fingerprint !== lastConsent || !allowed()) {
      stop();
      lastConsent = fingerprint;
    }
    if (!allowed()) clearAnalyticsData(dependencies.storage());
    return record?.choice ?? "unknown";
  }
  function choose(choice: Exclude<AnalyticsChoice, "unknown">) {
    stop();
    const saved = writeAnalyticsConsent(dependencies.storage(), choice, now());
    storageReady = saved;
    refresh();
    return saved;
  }
  async function start() {
    refresh();
    if (!allowed() || adapter) return;
    if (pending) return pending;
    const epoch = generation;
    const sessionWallet = wallet;
    const record = consent();
    if (!record) return;
    function sessionAllowed() {
      const current = consent();
      return (
        generation === epoch &&
        allowed() &&
        current?.updatedAt === record?.updatedAt &&
        current?.expiresAt === record?.expiresAt
      );
    }
    const task = (async () => {
      try {
        const [factory, nextUser, nextCountry] = await Promise.all([
          dependencies.load(),
          sessionWallet
            ? (dependencies.walletId ?? walletAnalyticsId)(
                sessionWallet,
                config.environment
              )
            : undefined,
          dependencies.country?.().catch(() => undefined)
        ]);
        if (nextUser && !analyticsWalletId.test(nextUser)) return;
        if (!sessionAllowed()) return;
        await (
          dependencies.withIdentityLock ?? (async (task: () => void) => task())
        )(() => {
          if (!sessionAllowed()) return;
          const storage = dependencies.storage();
          const stored: unknown = JSON.parse(
            storage?.getItem(analyticsVisitorKey) ?? "null"
          );
          const previous =
            stored && typeof stored === "object"
              ? (stored as Record<string, unknown>)
              : null;
          const id =
            previous &&
            previous.expiresAt === record.expiresAt &&
            (!previous.userId || previous.userId === nextUser) &&
            !(
              nextUser &&
              !previous.userId &&
              dependencies.linkAnonymous === false
            ) &&
            typeof previous.id === "string" &&
            analyticsUuid.test(previous.id)
              ? previous.id
              : dependencies.uuid();
          if (!storage || !analyticsUuid.test(id)) return;
          if (previous?.id && previous.id !== id) clearAnalyticsData(storage);
          storage.setItem(
            analyticsVisitorKey,
            JSON.stringify({
              id,
              userId: nextUser,
              expiresAt: record.expiresAt
            })
          );
          visitorId = id;
          userId = nextUser;
          country = analyticsCountry(nextCountry);
          const context = { userId, country };
          const profile: AnalyticsProfile = {
            identity_type: "wallet",
            environment: config.environment,
            schema_version: 2,
            ...(country ? { country } : {})
          };
          adapter = factory(
            config,
            (payload) =>
              sessionAllowed()
                ? sanitizeAnalyticsPayload(payload, config.token, id, context)
                : null,
            (payload) =>
              sessionAllowed() && nextUser && payload.$distinct_id === nextUser
                ? {
                    $token: config.token,
                    $distinct_id: nextUser,
                    $device_id: id,
                    $user_id: nextUser,
                    $ip: "0",
                    $set: profile
                  }
                : null
          );
          if (nextUser) {
            adapter.identify?.(id, nextUser, profile);
            track("Wallet Identified", { identity_type: "wallet" });
          }
        });
      } catch {
        if (generation === epoch) {
          stop();
          clearAnalyticsData(dependencies.storage());
        }
      }
    })();
    pending = task;
    await task;
    if (pending === task) pending = null;
  }
  function track<E extends AnalyticsEvent>(
    event: E,
    properties: AnalyticsProperties<E>
  ) {
    try {
      refresh();
      if (!allowed() || !adapter || !visitorId) return false;
      const payload = sanitizeAnalyticsPayload(
        {
          event,
          properties: {
            ...properties,
            environment: config.environment,
            device_type: dependencies.deviceType?.() ?? "desktop",
            time: now() / 1000,
            $insert_id: dependencies.uuid()
          }
        },
        config.token,
        visitorId,
        { userId, country }
      );
      if (!payload) return false;
      adapter.track(payload.event, payload.properties);
      return true;
    } catch {
      return false;
    }
  }
  function page(key: string, properties: AnalyticsProperties<"Page Viewed">) {
    if (key === lastPage) return;
    if (track("Page Viewed", properties)) lastPage = key;
  }
  function setWallet(address?: string | null) {
    const next = normalizeAnalyticsWallet(address);
    if (wallet !== next) {
      stop(); // Block callbacks synchronously before hashing or initializing another wallet.
      wallet = next;
    }
  }
  return {
    setWallet,
    matchesWallet: (address: string) =>
      allowed() &&
      wallet !== null &&
      normalizeAnalyticsWallet(address) === wallet,
    user: () => (allowed() ? userId : undefined),
    start,
    stop,
    refresh,
    choose,
    track,
    page,
    allowed,
    consent,
    visitor: () => (allowed() ? visitorId : null)
  };
}

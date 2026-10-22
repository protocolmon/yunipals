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

export type AnalyticsAdapter = {
  track: (event: string, properties: Record<string, unknown>) => void;
  stop: () => void;
};
export type AnalyticsAdapterFactory = (
  config: AnalyticsConfig,
  filter: (payload: AnalyticsPayload) => AnalyticsPayload | null
) => AnalyticsAdapter;
type ClientDependencies = {
  storage: () => AnalyticsStorage | null;
  privacySignal: () => boolean;
  load: () => Promise<AnalyticsAdapterFactory>;
  uuid: () => string;
  now?: () => number;
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
    try {
      adapter?.stop();
    } catch {
      /* Analytics must not interrupt the app. */
    }
    adapter = null;
  }
  function refresh(): AnalyticsChoice {
    const record = consent();
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
        const factory = await dependencies.load();
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
          typeof previous.id === "string" &&
          analyticsUuid.test(previous.id)
            ? previous.id
            : dependencies.uuid();
        if (!storage || !analyticsUuid.test(id)) return;
        storage.setItem(
          analyticsVisitorKey,
          JSON.stringify({ id, expiresAt: record.expiresAt })
        );
        visitorId = id;
        adapter = factory(config, (payload) =>
          sessionAllowed()
            ? sanitizeAnalyticsPayload(payload, config.token, id)
            : null
        );
      } catch {
        if (generation === epoch) {
          clearAnalyticsData(dependencies.storage());
          visitorId = null;
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
        visitorId
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
  return {
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

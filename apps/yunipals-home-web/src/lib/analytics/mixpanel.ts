import mixpanel from "mixpanel-browser/src/loaders/loader-module-core";

import type { AnalyticsAdapterFactory } from "@/lib/analytics/client";

let instanceNumber = 0;
export const createMixpanelAdapter: AnalyticsAdapterFactory = (
  config,
  filter
) => {
  const instance = mixpanel.init(
    config.token,
    {
      api_host: config.apiHost,
      autocapture: false,
      track_pageview: false,
      record_sessions_percent: 0,
      record_heatmap_data: false,
      remote_settings_mode: "disabled",
      flags: false,
      ip: false,
      debug: false,
      batch_requests: false,
      disable_persistence: true,
      persistence: "localStorage",
      cross_subdomain_cookie: false,
      secure_cookie: true,
      opt_out_tracking_by_default: true,
      opt_out_persistence_by_default: true,
      save_referrer: false,
      store_google: false,
      skip_first_touch_marketing: true,
      stop_utm_persistence: true,
      hooks: { before_send_events: filter }
    },
    `yunipals_${++instanceNumber}`
  );
  // Suppress the SDK's automatic opt-in event; our preference is stored locally.
  instance.opt_in_tracking({ track: () => {} });
  return {
    track: (event, properties) => {
      instance.track(event, properties);
    },
    stop: () => {
      instance.opt_out_tracking({ delete_user: false });
      instance.clear_opt_in_out_tracking();
      instance.reset();
    }
  };
};

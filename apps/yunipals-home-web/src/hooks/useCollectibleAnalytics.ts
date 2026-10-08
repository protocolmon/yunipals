import { useEffect, useRef } from "react";

import { useAnalyticsConsent } from "@/providers/AnalyticsConsentProvider";
import { analytics, trackAnalyticsEvent } from "@/lib/analytics/index";
import type { AnalyticsChain } from "@/lib/analytics/events";

export function useCollectibleAnalytics(
  loaded: boolean,
  localKey: string,
  collection: "yunipals" | "islands" | "exomon",
  chain: AnalyticsChain
) {
  const { choice, revision } = useAnalyticsConsent();
  const last = useRef("");
  useEffect(() => {
    let active = true;
    if (loaded && choice === "accepted") {
      void analytics.start().then(() => {
        const key = `${analytics.visitor()}:${localKey}`;
        if (
          active &&
          key !== last.current &&
          trackAnalyticsEvent("Collectible Viewed", { collection, chain })
        )
          last.current = key;
      });
    }
    return () => {
      active = false;
    };
  }, [chain, choice, collection, loaded, localKey, revision]);
}

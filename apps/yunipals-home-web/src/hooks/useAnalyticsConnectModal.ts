import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback } from "react";

import type { AnalyticsEntryPoint } from "@/lib/analytics/events";
import { analyticsWalletRequested } from "@/lib/analytics/wallet";

export function useAnalyticsConnectModal(entryPoint: AnalyticsEntryPoint) {
  const { openConnectModal } = useConnectModal();
  const open = useCallback(() => {
    if (!openConnectModal) return;
    analyticsWalletRequested(entryPoint);
    openConnectModal();
  }, [entryPoint, openConnectModal]);
  return { openConnectModal: openConnectModal ? open : undefined };
}

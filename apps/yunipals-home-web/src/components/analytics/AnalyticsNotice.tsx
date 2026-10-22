import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type AnalyticsNoticeProps = {
  settings: boolean;
  available: boolean;
  privacySignal: boolean;
  accepted: boolean;
  storageError: boolean;
  privacyId: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
};
const actionClass =
  "rounded-full border border-line px-5 py-3 text-sm font-bold text-ink transition hover:bg-line/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

export function AnalyticsNotice(props: AnalyticsNoticeProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    if (!props.settings) return;
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [props.settings]);
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="display text-xl">
          {props.settings ? "Analytics settings" : "Optional analytics"}
        </h2>
        {props.settings && (
          <button
            type="button"
            aria-label="Close analytics settings"
            onClick={props.onClose}
            className="rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        id={descriptionId}
        className="mt-3 space-y-2 text-sm leading-relaxed text-muted"
      >
        <p>
          With your permission, we use Mixpanel to understand collection
          browsing and wallet and trading features. We use a random browser
          identifier and selected interaction events. Wallet addresses and
          signatures are excluded. You can browse and trade whichever option you
          choose.
        </p>
        <p>
          <Link
            to="/privacy"
            onClick={props.onClose}
            className="rounded font-semibold text-ink underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Read our Privacy Notice
          </Link>
        </p>
        {!props.available && (
          <p>Optional analytics is currently disabled on this deployment.</p>
        )}
        {props.privacySignal && (
          <p>
            Your browser requests that analytics stay off. We respect that
            preference.
          </p>
        )}
        {props.settings && props.available && !props.privacySignal && (
          <p>
            Analytics is {props.accepted ? "allowed" : "off"} in this browser.
            Your choice is remembered for 180 days.
          </p>
        )}
        {props.storageError && (
          <p role="alert">
            We could not save your preference. Analytics remains off. Browser
            storage must be available to allow analytics.
          </p>
        )}
        {props.settings && props.privacyId && (
          <details>
            <summary className="cursor-pointer rounded font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
              Privacy request identifier
            </summary>
            <p className="mt-2">
              Include this identifier when requesting access to or deletion of
              analytics information. Copy it before turning analytics off, which
              removes it from this browser.
            </p>
            <code className="mt-2 block break-all text-xs text-ink">
              {props.privacyId}
            </code>
          </details>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={props.onDecline} className={actionClass}>
          {props.settings ? "Turn analytics off" : "Decline"}
        </button>
        <button
          type="button"
          onClick={props.onAccept}
          disabled={!props.available || props.privacySignal}
          className={cn(
            actionClass,
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          Allow analytics
        </button>
      </div>
    </>
  );
  return props.settings ? (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      className="m-auto max-h-[90dvh] w-11/12 max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6 text-ink shadow-cardHover backdrop:bg-ink/50"
    >
      {content}
    </dialog>
  ) : (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[50dvh] overflow-y-auto border-t border-line bg-white p-5 text-ink shadow-cardHover"
    >
      <div className="mx-auto max-w-6xl">{content}</div>
    </section>
  );
}

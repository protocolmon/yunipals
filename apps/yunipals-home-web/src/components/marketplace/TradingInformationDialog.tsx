import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { tradingTermsVersion } from "@/lib/marketplace/tradingInformation";

export function TradingInformationDialog({
  accepted,
  onAccept,
  onClose
}: {
  accepted: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const acceptanceId = useId();
  const [confirmed, setConfirmed] = useState(false);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90dvh] w-11/12 max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6 text-ink shadow-cardHover backdrop:bg-ink/50 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="display text-2xl">
          Buying and selling on Yunipals
        </h2>
        <button
          type="button"
          aria-label="Close buying and selling information"
          onClick={onClose}
          className="shrink-0 rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div
        id={descriptionId}
        className="mt-5 space-y-4 text-sm leading-relaxed text-muted"
      >
        <p>
          Yunipals is an independent interface for exploring and managing
          Yunipals NFTs, with integrated access to third-party services and
          blockchain protocols for buying and selling NFTs.
        </p>
        <p>
          Purchases and sales on Ethereum, Base and Polygon use OpenSea
          services. Sellers publish BNB Chain orders in on-chain Seaport
          validation transactions, which Yunipals indexes. Transactions settle
          through Seaport smart contracts.
        </p>
        <p>
          Yunipals is not OpenSea and is not endorsed by or affiliated with
          OpenSea. You remain in control of your wallet and approve transactions
          yourself. Yunipals does not hold your private keys or take custody of
          customer funds or NFTs.
        </p>
        <p>
          Review the price, fee recipients, network, expiry and approval
          permissions before signing. Network gas is additional. Disconnecting
          your wallet does not cancel signed orders or revoke token approvals.
          Yunipals generally cannot reverse completed blockchain transactions.
        </p>
        <p>
          Buying and selling are unavailable where prohibited by applicable law
          or sanctions, including for sanctioned persons or anyone acting on
          their behalf.
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 font-semibold text-ink">
          <Link
            to="/terms"
            onClick={onClose}
            className="underline decoration-line underline-offset-4"
          >
            Yunipals Terms of Use
          </Link>
          <Link
            to="/privacy"
            onClick={onClose}
            className="underline decoration-line underline-offset-4"
          >
            Privacy Notice
          </Link>
          <a
            href="https://opensea.io/tos"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-line underline-offset-4"
          >
            OpenSea Terms
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
      {accepted ? (
        <>
          <p className="mt-5 text-xs font-semibold text-muted">
            Terms version {tradingTermsVersion} accepted in this browser.
          </p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="mt-5 w-full rounded-full bg-ink px-5 py-3 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            Close
          </button>
        </>
      ) : (
        <>
          <label
            htmlFor={acceptanceId}
            className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-4 text-sm font-semibold leading-relaxed text-ink"
          >
            <input
              id={acceptanceId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-ink"
            />
            <span>
              I accept the Yunipals Terms of Use, confirm that I am at least 18
              and legally eligible to use these buying and selling features, and
              understand the transaction risks.
            </span>
          </label>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!confirmed}
              onClick={onAccept}
              className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 sm:flex-1"
            >
              Accept and continue
            </button>
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="rounded-full border border-line px-5 py-3 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              Browse only
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { Link } from "react-router-dom";
import { environment } from "@/environment";
import type { usePortalClaim } from "@/hooks/usePortalClaim";
import { portalPrice } from "@/lib/portals";
import { cn } from "@/lib/utils";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";

export type PortalClaimActions = ReturnType<typeof usePortalClaim>;
export const portalTransactionUrl = (hash: string) =>
  `https://${environment.portalChainId === 84532 ? "sepolia." : ""}basescan.org/tx/${hash}`;

export function PortalWalletButton({ claim }: { claim: PortalClaimActions }) {
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  if (claim.address && claim.chainId === environment.portalChainId) return null;
  return (
    <button
      type="button"
      className={cn(boosterButtonClass, "mt-5")}
      onClick={() => {
        if (!claim.address) openConnectModal?.();
        else switchChain({ chainId: environment.portalChainId });
      }}
    >
      {claim.address
        ? "Switch to portal network"
        : "Connect portal owner wallet"}
    </button>
  );
}

export function PortalClaimStatus({ claim }: { claim: PortalClaimActions }) {
  return (
    <div className="mt-5 space-y-3" aria-live="polite">
      {claim.busy && <p role="status">{claim.phase}</p>}
      {claim.error && (
        <p
          role="alert"
          className="break-words rounded-2xl border border-line p-4"
        >
          {claim.error}
        </p>
      )}
      {claim.pending && (
        <a
          className="font-semibold underline"
          href={portalTransactionUrl(claim.pending.hash)}
          target="_blank"
          rel="noreferrer"
        >
          View pending burn transaction
        </a>
      )}
      {claim.success && (
        <div role="status" className="rounded-2xl bg-mint/30 p-5">
          <p className="font-bold">
            Portal #{claim.success.tokenId} burned. You received{" "}
            {portalPrice(claim.success.amount)} USDC.
          </p>
          <p className="mt-2 text-sm">
            Its balance has been paid and it is permanently removed from future
            portal rounds.
          </p>
          <a
            className="mt-2 inline-block font-semibold underline"
            href={portalTransactionUrl(claim.success.hash)}
            target="_blank"
            rel="noreferrer"
          >
            View confirmed claim
          </a>
          <Link
            className="ml-4 font-semibold underline"
            to={`/portals/tokens/${claim.success.tokenId}`}
          >
            Portal history
          </Link>
        </div>
      )}
    </div>
  );
}

export function PortalClaimDialog({ claim }: { claim: PortalClaimActions }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const token = claim.review?.token;
  useEffect(() => {
    setAcknowledged(false);
  }, [token?.id, token?.claimable]);
  useEffect(() => {
    if (token && !dialog.current?.open) dialog.current?.showModal();
    if (!token) dialog.current?.close();
  }, [token]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="portal-claim-title"
      aria-describedby="portal-claim-warning"
      className="w-full max-w-lg rounded-3xl border border-line bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
      onCancel={(event) => {
        event.preventDefault();
        claim.dismiss();
      }}
    >
      {token && (
        <>
          <h2 id="portal-claim-title" className="font-display text-2xl">
            Burn portal &amp; claim
          </h2>
          <p className="mt-3 font-semibold">
            {token.name} #{token.id}
          </p>
          <p className="mt-4 rounded-2xl bg-lavender/20 p-4 text-xl font-bold">
            You will receive {portalPrice(token.claimable)} USDC
          </p>
          <p className="mt-3 break-all text-sm text-muted">
            Paid to {claim.address}
          </p>
          <p id="portal-claim-warning" className="mt-5 font-semibold">
            Burning permanently destroys this portal. You will receive its full
            accumulated USDC and it will no longer earn fees.
          </p>
          {token.claimable === "0" && (
            <p className="mt-3 font-bold">
              This portal has no accumulated fees. You will receive 0 USDC.
            </p>
          )}
          {token.active && (
            <p className="mt-3">
              This portal is currently open. Burning it immediately closes entry
              for the rest of its slot.
            </p>
          )}
          <p className="mt-3 text-sm text-muted">
            Accepted grading jobs will still finish. Your wallet pays network
            gas.
          </p>
          <label className="mt-5 flex items-start gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={claim.busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1 size-4 shrink-0"
            />
            I understand that this permanently burns my portal NFT.
          </label>
          {claim.error && (
            <p role="alert" className="mt-3 text-sm">
              {claim.error}
            </p>
          )}
          {claim.busy && (
            <p role="status" className="mt-3 text-sm">
              {claim.phase}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className={boosterButtonClass}
              disabled={!acknowledged || claim.busy}
              onClick={() => void claim.confirm()}
            >
              Burn portal &amp; claim {portalPrice(token.claimable)} USDC
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-5 py-3 font-semibold focus-visible:outline-grape"
              disabled={claim.busy}
              onClick={claim.dismiss}
            >
              Keep my portal
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

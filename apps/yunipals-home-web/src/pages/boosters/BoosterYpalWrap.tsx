import { useEffect, useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { formatEther, formatUnits } from "viem";

import { useYpalWrap } from "@/hooks/useYpalWrap";
import { formatRoundedAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isConfirmedYpalWrapDeployment,
  type YpalWrapDeployment
} from "@/lib/ypalWrap";
import { boosterButtonClass } from "./BoosterActionButton";

export type BoosterYpalWrapProps = { deployment: YpalWrapDeployment | null };

export function BoosterYpalWrap({ deployment }: BoosterYpalWrapProps) {
  // Do not mount wallet or read hooks before the fresh deployment is confirmed.
  if (!isConfirmedYpalWrapDeployment(deployment)) return null;
  return <YpalWrapForm deployment={deployment} />;
}
function YpalWrapForm({ deployment }: { deployment: YpalWrapDeployment }) {
  const wrap = useYpalWrap(deployment),
    { openConnectModal } = useConnectModal(),
    switcher = useSwitchChain();
  const dialog = useRef<HTMLDialogElement>(null),
    review = wrap.review;
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    if (!review) dialog.current?.close();
  }, [review]);
  const failure =
    wrap.error ??
    (wrap.balanceError instanceof Error ? wrap.balanceError.message : null);
  return (
    <section
      className="space-y-4 rounded-card border border-line bg-white p-5"
      aria-labelledby="ypal-wrap-title"
    >
      <div>
        <h2 id="ypal-wrap-title" className="font-display text-xl text-ink">
          Get YPAL
        </h2>
        <p className="mt-1 text-sm text-muted">
          Wrap PMON on Base to receive the same amount of YPAL. Use YPAL to open
          Yunipals packs.
        </p>
      </div>
      {wrap.balances && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted">PMON balance</dt>
            <dd title={formatUnits(wrap.balances.pmonBalance, 18)}>
              {formatRoundedAmount(wrap.balances.pmonBalance, 18, "PMON")}
            </dd>
          </div>
          <div>
            <dt className="text-muted">YPAL balance</dt>
            <dd title={formatUnits(wrap.balances.ypalBalance, 18)}>
              {formatRoundedAmount(wrap.balances.ypalBalance, 18, "YPAL")}
            </dd>
          </div>
        </dl>
      )}
      {!wrap.address ? (
        <button
          className={boosterButtonClass}
          onClick={() => openConnectModal?.()}
        >
          Connect wallet to get YPAL
        </button>
      ) : wrap.chainId !== 8453 ? (
        <button
          className={boosterButtonClass}
          onClick={() => switcher.switchChain({ chainId: 8453 })}
        >
          Switch to Base to get YPAL
        </button>
      ) : (
        <>
          <label
            htmlFor="ypal-wrap-amount"
            className="block text-sm font-medium"
          >
            PMON amount
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="ypal-wrap-amount"
              inputMode="decimal"
              autoComplete="off"
              value={wrap.amount}
              onChange={(event) => wrap.setAmount(event.target.value)}
              className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2"
              aria-invalid={Boolean(wrap.inputError)}
              aria-describedby="ypal-wrap-explanation"
            />
            <button
              className={boosterButtonClass}
              disabled={!wrap.canPrepare}
              onClick={() =>
                wrap.prepare(wrap.needsApproval ? "approve" : "wrap")
              }
            >
              {wrap.needsApproval ? "Review PMON approval" : "Review wrap"}
            </button>
          </div>
          <p id="ypal-wrap-explanation" className="text-sm text-muted">
            {wrap.parsedAmount
              ? `${formatUnits(wrap.parsedAmount, 18)} PMON → ${formatUnits(wrap.parsedAmount, 18)} YPAL`
              : "Enter the amount to wrap."}{" "}
            {wrap.balances
              ? wrap.needsApproval
                ? "Approve this exact amount first, then review wrapping separately."
                : "Your existing allowance is sufficient for this amount."
              : "Checking the current PMON allowance."}
          </p>
          {wrap.inputError && (
            <p className="text-sm text-red-700">{wrap.inputError}</p>
          )}
          {wrap.insufficient && (
            <p className="text-sm text-red-700">
              Your Base PMON balance is lower than this amount.
            </p>
          )}
          {wrap.loading && !wrap.balances && (
            <p role="status" className="text-sm text-muted">
              Checking Base balances and YPAL…
            </p>
          )}
          <button
            className="text-sm underline"
            disabled={wrap.busy}
            onClick={() => void wrap.refresh()}
          >
            Refresh balances
          </button>
        </>
      )}
      {wrap.pending && (
        <div className="space-y-2 rounded-xl border border-line p-3 text-sm">
          <p>
            Saved {wrap.pending.kind === "approve" ? "PMON approval" : "wrap"}{" "}
            transaction
          </p>
          <a
            href={`https://basescan.org/tx/${wrap.pending.hash}`}
            target="_blank"
            rel="noreferrer"
            className="block break-all underline"
          >
            {wrap.pending.hash}
          </a>
          <button
            className={boosterButtonClass}
            disabled={wrap.busy}
            onClick={wrap.resolvePending}
          >
            Check pending transaction
          </button>
        </div>
      )}
      {wrap.message && (
        <p role="status" className="text-sm">
          {wrap.message}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-red-700">
          {failure}
        </p>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="ypal-wrap-review-title"
        onCancel={(event) => {
          event.preventDefault();
          wrap.dismissReview();
        }}
        className="w-full max-w-lg rounded-card border border-line bg-white p-6 text-ink backdrop:bg-black/60"
      >
        <h3
          id="ypal-wrap-review-title"
          className="font-display text-xl text-ink"
        >
          {review?.kind === "approve"
            ? "Review exact PMON approval"
            : "Review PMON wrapping"}
        </h3>
        {review && (
          <div className="mt-4 space-y-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt>Network</dt>
                <dd>Base mainnet</dd>
              </div>
              <div>
                <dt>Wallet</dt>
                <dd className="break-all">{review.owner}</dd>
              </div>
              <div>
                <dt>
                  {review.kind === "approve"
                    ? "Approve exactly"
                    : "Wrap exactly"}
                </dt>
                <dd>
                  {formatUnits(review.amount, 18)} PMON
                  {review.kind === "wrap"
                    ? ` → ${formatUnits(review.amount, 18)} YPAL`
                    : " for the YPAL contract"}
                </dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd className="break-all">{review.to}</dd>
              </div>
              <div>
                <dt>Estimated network fee</dt>
                <dd title={`${formatEther(review.networkFee)} ETH`}>
                  {formatRoundedAmount(review.networkFee, 18, "ETH")}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted">
              {review.kind === "approve"
                ? "Approval does not wrap tokens. Review the separate wrap transaction after it confirms."
                : "Your PMON moves to the confirmed YPAL wrapper and the same amount of YPAL is minted to your wallet."}{" "}
              This review expires after two minutes.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                className={cn(boosterButtonClass)}
                disabled={wrap.busy}
                onClick={wrap.confirm}
              >
                {review.kind === "approve"
                  ? "Confirm exact approval"
                  : "Confirm wrap"}
              </button>
              <button
                className="rounded-full border border-line px-4 py-2"
                onClick={wrap.dismissReview}
              >
                Cancel review
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

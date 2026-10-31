import { useEffect, useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { formatEther, formatUnits } from "viem";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Coins,
  RefreshCw,
  Wallet
} from "lucide-react";

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
      className="rounded-card border border-lavender/50 bg-white p-5 shadow-card sm:p-7"
      aria-labelledby="ypal-wrap-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="ypal-wrap-title" className="font-display text-2xl text-ink">
            Get YPAL
          </h2>
          <p className="mt-1 text-sm text-muted">
            Wrap PMON to YPAL, one for one.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-basechain/5 px-3 py-1.5 text-xs font-bold text-basechain">
          <span
            className="h-2 w-2 rounded-full bg-basechain"
            aria-hidden="true"
          />
          Base
        </span>
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-lavender/10 p-4 focus-within:border-grape/50 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="ypal-wrap-amount"
            className="text-sm font-semibold text-muted"
          >
            <span aria-hidden="true">You wrap</span>
            <span className="sr-only">PMON amount</span>
          </label>
          <button
            type="button"
            disabled={
              !wrap.address ||
              wrap.chainId !== 8453 ||
              !wrap.balances ||
              wrap.busy ||
              Boolean(wrap.pending) ||
              wrap.balances.pmonBalance === 0n
            }
            onClick={() =>
              wrap.balances &&
              wrap.setAmount(formatUnits(wrap.balances.pmonBalance, 18))
            }
            className="rounded-full bg-white px-3 py-1 text-xs font-bold text-grape transition-colors hover:bg-lavender/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-40"
          >
            Max
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            id="ypal-wrap-amount"
            aria-label="PMON amount"
            inputMode="decimal"
            autoComplete="off"
            value={wrap.amount}
            onChange={(event) => wrap.setAmount(event.target.value)}
            disabled={
              !wrap.address ||
              wrap.chainId !== 8453 ||
              wrap.busy ||
              Boolean(wrap.pending)
            }
            className="w-full min-w-0 rounded-lg bg-transparent py-1 text-3xl font-semibold tracking-tight text-ink placeholder:text-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-60"
            aria-invalid={Boolean(wrap.inputError || wrap.insufficient)}
            aria-describedby="ypal-wrap-explanation ypal-wrap-errors"
          />
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-white py-2 pl-2 pr-3 text-sm font-bold text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-grape/10 text-grape">
              <Coins size={18} aria-hidden="true" />
            </span>
            PMON
          </span>
        </div>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-1 text-xs text-muted">
          <dt>PMON balance</dt>
          <dd
            title={
              wrap.balances
                ? formatUnits(wrap.balances.pmonBalance, 18)
                : undefined
            }
          >
            {wrap.balances
              ? formatRoundedAmount(wrap.balances.pmonBalance, 18, "PMON")
              : wrap.address && wrap.chainId === 8453 && wrap.loading
                ? "Checking…"
                : "—"}
          </dd>
        </dl>
      </div>
      <div
        className="relative z-10 -my-3 flex justify-center"
        aria-hidden="true"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border-4 border-white bg-lavender/40 text-grape">
          <ArrowDown size={18} />
        </span>
      </div>
      <div className="rounded-2xl border border-grape/15 bg-panel-polygon p-4 sm:p-5">
        <p className="text-sm font-semibold text-muted">You receive</p>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <output
            htmlFor="ypal-wrap-amount"
            className="min-w-0 break-all text-3xl font-semibold tracking-tight text-ink"
            aria-live="polite"
          >
            {wrap.parsedAmount ? formatUnits(wrap.parsedAmount, 18) : "0"}
          </output>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white bg-white py-2 pl-2 pr-3 text-sm font-bold text-ink">
            <img
              src="/images/yunipals-logo.webp"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
            />
            YPAL
          </span>
        </div>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-1 text-xs text-muted">
          <dt>YPAL balance</dt>
          <dd
            title={
              wrap.balances
                ? formatUnits(wrap.balances.ypalBalance, 18)
                : undefined
            }
          >
            {wrap.balances
              ? formatRoundedAmount(wrap.balances.ypalBalance, 18, "YPAL")
              : wrap.address && wrap.chainId === 8453 && wrap.loading
                ? "Checking…"
                : "—"}
          </dd>
        </dl>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-muted">1 PMON = 1 YPAL</span>
        {wrap.address && wrap.chainId === 8453 && (
          <button
            type="button"
            disabled={wrap.busy || wrap.loading}
            onClick={() => void wrap.refresh()}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-muted hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-40"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Refresh balances
          </button>
        )}
      </div>
      <div
        id="ypal-wrap-errors"
        className="mt-3 space-y-2 text-sm text-red-700"
        role="status"
      >
        {wrap.inputError && <p>{wrap.inputError}</p>}
        {wrap.insufficient && (
          <p>Your Base PMON balance is lower than this amount.</p>
        )}
      </div>
      {wrap.address && wrap.chainId === 8453 && (
        <ol
          aria-label="Wrapping steps"
          className="my-5 grid grid-cols-2 gap-2 text-xs font-semibold"
        >
          <li className="flex items-center gap-2 text-grape">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-grape/10">
              {wrap.balances && !wrap.needsApproval ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                "1"
              )}
            </span>
            Approve PMON
          </li>
          <li
            className={cn(
              "flex items-center gap-2",
              wrap.balances && !wrap.needsApproval ? "text-grape" : "text-muted"
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lavender/25">
              2
            </span>
            Wrap to YPAL
          </li>
        </ol>
      )}
      <button
        type="button"
        className={cn(
          boosterButtonClass,
          "mt-2 flex w-full items-center justify-center gap-2 bg-grape py-3.5 shadow-none hover:bg-grape/90 focus-visible:outline-grape"
        )}
        disabled={Boolean(
          wrap.address && wrap.chainId === 8453 && !wrap.canPrepare
        )}
        onClick={() => {
          if (!wrap.address) openConnectModal?.();
          else if (wrap.chainId !== 8453)
            switcher.switchChain({ chainId: 8453 });
          else void wrap.prepare(wrap.needsApproval ? "approve" : "wrap");
        }}
      >
        {!wrap.address ? (
          <>
            <Wallet size={18} aria-hidden="true" />
            Connect wallet to get YPAL
          </>
        ) : wrap.chainId !== 8453 ? (
          "Switch to Base to get YPAL"
        ) : wrap.needsApproval ? (
          "Review PMON approval"
        ) : (
          "Review wrap"
        )}
      </button>
      <p
        id="ypal-wrap-explanation"
        className="mt-3 text-center text-xs leading-relaxed text-muted"
      >
        {!wrap.address
          ? "Connect your wallet to see your Base balances."
          : wrap.chainId !== 8453
            ? "Switch networks to use your PMON on Base."
            : wrap.balances
              ? wrap.needsApproval
                ? "Approve this exact amount first, then review wrapping separately."
                : "Your existing allowance is sufficient for this amount."
              : "Checking Base balances and YPAL…"}
      </p>
      {wrap.pending && (
        <div className="mt-5 rounded-2xl border border-lavender/50 bg-lavender/10 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">
                Saved{" "}
                {wrap.pending.kind === "approve" ? "PMON approval" : "wrap"}{" "}
                transaction
              </p>
              <p className="mt-1 text-xs text-muted">
                Check its status before continuing.
              </p>
            </div>
            <a
              href={`https://basescan.org/tx/${wrap.pending.hash}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View saved transaction on BaseScan"
              title={wrap.pending.hash}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg p-1 text-xs font-semibold text-grape underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
            >
              BaseScan <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <button
            type="button"
            disabled={wrap.busy}
            onClick={wrap.resolvePending}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-grape/20 bg-white px-4 py-2 text-xs font-bold text-grape hover:bg-lavender/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-40"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Check pending transaction
          </button>
        </div>
      )}
      {wrap.message && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-mint/40 p-3 text-sm text-ink"
        >
          {wrap.message}
        </p>
      )}
      {failure && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
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

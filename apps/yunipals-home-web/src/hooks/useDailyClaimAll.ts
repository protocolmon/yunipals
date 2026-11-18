import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { BaseError, type Hex } from "viem";
import type { BoosterOriginal } from "@protopals/yunipals-market-core/boosters";

import {
  allDailyOriginals,
  dailyClaimPlan,
  quoteDailyClaims
} from "@/lib/boosterDailyClaims";
import { confirmedBoosterDailyRequests } from "@/lib/boosterReveal";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterOwner,
  saveBoosterTransaction
} from "@/lib/boosters";

type Pending =
  | { kind: "batch"; id: string }
  | { kind: "transaction"; hash: Hex };
type Progress = { pending: Pending | null; hashes: Hex[] };
type Review = Awaited<ReturnType<typeof quoteDailyClaims>> & {
  atomic: boolean;
  upgrade: boolean;
};
const emptyProgress = (): Progress => ({ pending: null, hashes: [] });
function readProgress(key: string): Progress {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !value ||
      !Array.isArray(value.hashes) ||
      !value.hashes.every(
        (hash: unknown) =>
          typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)
      )
    )
      return emptyProgress();
    const pending = value.pending;
    if (
      pending &&
      !(
        (pending.kind === "batch" && typeof pending.id === "string") ||
        (pending.kind === "transaction" &&
          /^0x[0-9a-f]{64}$/i.test(pending.hash))
      )
    )
      return emptyProgress();
    return value;
  } catch {
    return emptyProgress();
  }
}

// Mounted above the popover so closing it or refreshing its rows cannot lose a
// submitted batch. Persist the wallet batch ID before polling, including timeouts.
export function useDailyClaimAll() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { data: wallet } = useWalletClient();
  const queries = useQueryClient();
  const deployment = boosterAddresses();
  const key = `yunipals:daily-all:v1:${deployment?.engine}:${address?.toLowerCase()}`;
  const [progress, setProgress] = useState(() => readProgress(key));
  const [review, setReview] = useState<Review | null>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const latest = useRef({ address, chainId, wallet, key });
  latest.current = { address, chainId, wallet, key };
  useEffect(() => {
    generation.current++;
    setProgress(readProgress(key));
    setReview(null);
    setVisible(false);
    setError(null);
    setPhase(null);
    return () => {
      generation.current++;
    };
  }, [key, chainId]);

  function save(next: Progress) {
    // Retain tracking for the submitting account even if the wallet changed.
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Tracking still works in memory. */
    }
    if (latest.current.key === key) setProgress(next);
  }
  async function checked() {
    if (!address || !wallet || !client || !deployment || chainId !== 8453)
      throw new Error("Connect your wallet on Base to continue.");
    const [actualChain, accounts] = await Promise.all([
      wallet.getChainId(),
      wallet.getAddresses()
    ]);
    if (
      actualChain !== 8453 ||
      accounts[0]?.toLowerCase() !== address.toLowerCase() ||
      latest.current.key !== key ||
      latest.current.chainId !== 8453 ||
      latest.current.wallet !== wallet
    )
      throw new Error("Your wallet changed. Review your daily cards again.");
    return { account: address, wallet, client, deployment };
  }
  function fail(cause: unknown) {
    const message =
      cause instanceof BaseError
        ? cause.shortMessage
        : cause instanceof Error
          ? cause.message
          : "Could not open your daily cards.";
    setError(
      /user rejected|user denied/i.test(message)
        ? "Cancelled in your wallet. Cards already submitted remain saved."
        : message.slice(0, 400)
    );
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    const current = generation.current;
    setError(null);
    try {
      await work();
    } catch (cause) {
      if (current === generation.current) fail(cause);
    } finally {
      lock.current = false;
      if (current === generation.current) setPhase(null);
    }
  }
  async function track(next: Progress) {
    const active = await checked();
    const pending = next.pending;
    if (!pending) return next;
    setPhase("Waiting for confirmation…");
    let hashes: Hex[];
    if (pending.kind === "batch") {
      const status = await active.wallet.waitForCallsStatus({
        id: pending.id,
        timeout: 120_000
      });
      if (status.status !== "success") {
        // A terminal failure may still contain receipts. Preserve them for review.
        for (const receipt of status.receipts ?? [])
          saveBoosterTransaction(active.account, active.deployment.engine, {
            hash: receipt.transactionHash,
            kind: "claim"
          });
        save({ ...next, pending: null });
        throw new Error(
          "The wallet batch failed. Refresh your daily cards before trying again."
        );
      }
      hashes = [
        ...new Set(
          (status.receipts ?? []).map((receipt) => receipt.transactionHash)
        )
      ];
      if (!hashes.length)
        throw new Error(
          "Your wallet has not returned transaction details yet. Check status again; do not resubmit."
        );
    } else {
      let cancelled = false;
      const receipt = await active.client.waitForTransactionReceipt({
        hash: pending.hash,
        onReplaced: ({ transaction, reason }) => {
          cancelled = reason === "cancelled";
          saveBoosterTransaction(
            active.account,
            active.deployment.engine,
            {
              hash: transaction.hash,
              kind: "claim",
              cancelled
            },
            undefined,
            next.pending?.kind === "transaction" ? next.pending.hash : undefined
          );
          next = {
            ...next,
            pending: { kind: "transaction", hash: transaction.hash }
          };
          save(next);
        }
      });
      if (cancelled || receipt.status !== "success") {
        save({ ...next, pending: null });
        throw new Error(
          "The transaction was cancelled or reverted. Refresh your daily cards before continuing."
        );
      }
      hashes = [receipt.transactionHash];
    }
    for (const hash of hashes) {
      const receipt = await active.client.getTransactionReceipt({ hash });
      confirmedBoosterDailyRequests(
        receipt,
        active.deployment.engine,
        active.account
      );
      saveBoosterTransaction(active.account, active.deployment.engine, {
        hash,
        kind: "claim"
      });
    }
    const confirmed = {
      pending: null,
      hashes: [...new Set([...next.hashes, ...hashes])]
    };
    save(confirmed);
    await queries.invalidateQueries({ queryKey: boosterQueryKey });
    return confirmed;
  }
  const prepare = () =>
    run(async () => {
      setVisible(true);
      setReview(null);
      if (progress.pending) {
        await track(progress);
        return;
      }
      const current = generation.current;
      setPhase("Checking all your originals and fees…");
      const active = await checked();
      const [originals, block, capabilities] = await Promise.all([
        allDailyOriginals((cursor) =>
          fetchBoosterOwner<BoosterOriginal>(
            active.account,
            "originals",
            cursor
          )
        ),
        active.client.getBlock({ blockTag: "latest" }),
        active.wallet
          .getCapabilities({ account: active.account, chainId: 8453 })
          .catch(() => undefined)
      ]);
      const claims = dailyClaimPlan(
        originals,
        active.account,
        active.deployment,
        block.timestamp
      );
      const quote = await quoteDailyClaims(
        active.client,
        active.account,
        active.deployment,
        claims
      );
      await checked();
      if (current !== generation.current) return;
      const status = capabilities?.atomic?.status;
      setReview({
        ...quote,
        atomic:
          quote.nativeTransactions.length === 0 &&
          quote.calls.length > 1 &&
          (status === "supported" || status === "ready"),
        upgrade: status === "ready"
      });
    });
  const confirm = () =>
    run(async () => {
      if (!review || progress.pending) return;
      const current = generation.current;
      const active = await checked();
      const assertFresh = () => {
        if (current !== generation.current || Date.now() >= review.expiresAt)
          throw new Error(
            "Your wallet changed or the quote expired. Review your daily cards again."
          );
      };
      assertFresh();
      let next = { ...progress };
      // No automatic fallback after wallet_sendCalls: a rejection or ambiguous
      // response must never trigger another spending request.
      const groups = review.nativeTransactions.length
        ? review.nativeTransactions.map((transaction) => [transaction])
        : review.atomic
          ? [review.calls]
          : review.calls.map((call) => [call]);
      for (const [index, calls] of groups.entries()) {
        await checked();
        assertFresh();
        setPhase(
          review.atomic
            ? "Confirm the bundle in your wallet…"
            : `Confirm ${index + 1} of ${groups.length} in your wallet…`
        );
        for (const call of calls)
          await active.client.call({
            account: active.account,
            to: call.to,
            data: call.data,
            value: call.value,
            ...review.fees
          });
        await checked();
        assertFresh();
        if (review.atomic) {
          const { id } = await active.wallet.sendCalls({
            account: active.account,
            chain: active.client.chain,
            forceAtomic: true,
            calls: calls.map(({ to, data, value }) => ({ to, data, value }))
          });
          next.pending = { kind: "batch", id };
        } else {
          const call = calls[0];
          const hash = await active.wallet.sendTransaction({
            account: active.account,
            chain: active.client.chain,
            to: call.to,
            data: call.data,
            value: call.value,
            gas: call.gas,
            ...review.fees
          });
          next.pending = { kind: "transaction", hash };
          saveBoosterTransaction(active.account, active.deployment.engine, {
            hash,
            kind: "claim"
          });
        }
        save(next);
        // A new review is required after any submission, even when polling fails.
        if (current === generation.current) setReview(null);
        next = await track(next);
      }
    });
  return {
    progress,
    review,
    visible,
    phase,
    error,
    prepare,
    confirm,
    resume: () =>
      run(async () => {
        await track(progress);
      }),
    dismiss: () => {
      if (!lock.current) setVisible(false);
    }
  };
}

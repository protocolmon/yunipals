import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link } from "react-router-dom";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import { BaseError, formatEther, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { estimateL1Fee } from "viem/op-stack";

import { Select, SelectItem } from "@/components/ui/select";
import { boosterSetupOwner } from "@/lib/boosterSetup";
import { formatRoundedAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  checkYpalPublishedArtwork,
  readYpalDeployment,
  readYpalLaunchPackage,
  ypalLaunchAction,
  ypalLaunchPackagePath,
  ypalLaunchPackageSha256,
  ypalLaunchSteps,
  ypalStepLabels,
  ypalDeploymentManifest,
  type YpalLaunchReceipts,
  type YpalLaunchStep
} from "@/lib/boosterYpalDeployment";
import { boosterButtonClass } from "./BoosterActionButton";

type Review = {
  step: YpalLaunchStep;
  to?: Address;
  data: Hex;
  value: 0n;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  networkFee: bigint;
  expiresAt: number;
  version: number;
};
const storageKey = `yunipals/boosters/ypal-launch/v1/${ypalLaunchPackageSha256}`;
const hashPattern = /^0x[0-9a-f]{64}$/i;

export function BoosterYpalSetupPage() {
  const { address, chainId } = useAccount(),
    wallet = useWalletClient();
  const client = usePublicClient({ chainId: 8453 }),
    switcher = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [receipts, setReceipts] = useState<YpalLaunchReceipts>({});
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null),
    [receiptInput, setReceiptInput] = useState("");
  const [recoveryStep, setRecoveryStep] = useState<YpalLaunchStep>("ypal");
  const saved = useRef<YpalLaunchReceipts>({}),
    active = useRef<Review | null>(null);
  const version = useRef(0),
    mounted = useRef(true),
    working = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef({ address, chainId, wallet: wallet.data });
  if (
    latest.current.address !== address ||
    latest.current.chainId !== chainId ||
    latest.current.wallet !== wallet.data
  ) {
    version.current++;
    active.current = null;
  }
  latest.current = { address, chainId, wallet: wallet.data };
  const owner = address?.toLowerCase() === boosterSetupOwner.toLowerCase();
  const connected = Boolean(owner && chainId === 8453 && client);
  const bundle = useQuery({
    queryKey: ["ypal-fresh-launch-package", ypalLaunchPackageSha256],
    queryFn: ({ signal }) => readYpalLaunchPackage(signal),
    staleTime: Infinity,
    retry: false
  });
  const state = useQuery({
    queryKey: ["ypal-fresh-launch-state", ypalLaunchPackageSha256, receipts],
    enabled: Boolean(connected && bundle.data),
    retry: false,
    staleTime: 10000,
    queryFn: () => readYpalDeployment(client!, bundle.data!, receipts)
  });
  useEffect(() => {
    mounted.current = true;
    try {
      const text = localStorage.getItem(storageKey) ?? "{}";
      if (text.length > 20000) throw Error("Oversized saved record");
      const value = JSON.parse(text) as Record<string, unknown>,
        restored: YpalLaunchReceipts = {};
      for (const step of ypalLaunchSteps)
        if (typeof value[step] === "string" && hashPattern.test(value[step]))
          restored[step] = value[step] as Hex;
      saved.current = restored;
      setReceipts(restored);
    } catch {
      /* Each successful action can be restored from its actual receipt. */
    }
    return () => {
      mounted.current = false;
      version.current++;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    dismiss();
  }, [address, chainId, wallet.data]);
  useEffect(() => {
    if (state.data?.nextStep) setRecoveryStep(state.data.nextStep);
  }, [state.data?.nextStep]);
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    if (!review) dialog.current?.close();
  }, [review]);
  function dismiss() {
    version.current++;
    active.current = null;
    setReview(null);
  }
  function remember(next: YpalLaunchReceipts) {
    saved.current = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Manual receipt recovery remains available. */
    }
    if (mounted.current) setReceipts(next);
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof BaseError
            ? cause.shortMessage
            : cause instanceof Error
              ? cause.message
              : "The fresh launch step could not finish."
        );
        setMessage("");
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function currentWallet(expectedVersion: number) {
    const now = latest.current;
    if (
      !mounted.current ||
      version.current !== expectedVersion ||
      now.address?.toLowerCase() !== boosterSetupOwner.toLowerCase() ||
      now.chainId !== 8453 ||
      !now.wallet ||
      now.wallet.account.address.toLowerCase() !==
        boosterSetupOwner.toLowerCase() ||
      now.wallet.chain.id !== 8453
    )
      throw Error(
        "The wallet, network or setup page changed. Review this step again."
      );
    return now.wallet;
  }
  function currentReview(value: Review) {
    if (active.current !== value || Date.now() >= value.expiresAt)
      throw Error(
        "This review expired or was dismissed. Review the step again."
      );
    return currentWallet(value.version);
  }
  async function liveStep(step: YpalLaunchStep) {
    if (!client || !connected)
      throw Error("Connect the approved owner wallet on Base.");
    const b = await readYpalLaunchPackage();
    const actual = await readYpalDeployment(client, b, saved.current);
    if (actual.pending || actual.failed)
      throw Error(
        "Resolve the saved transaction before submitting another transaction."
      );
    if (actual.nextStep !== step)
      throw Error(
        "The deployment changed. Refresh the actual receipts before signing."
      );
    if (step === "configure" || step === "activate")
      await checkYpalPublishedArtwork(b);
    return { b, actual, action: ypalLaunchAction(b, step, actual) };
  }
  function prepare(step: YpalLaunchStep) {
    const captured = version.current;
    void run(async () => {
      currentWallet(captured);
      setMessage("Verifying confirmed deployments and current network fees…");
      const { action } = await liveStep(step),
        fees = await client!.estimateFeesPerGas();
      const transaction = { account: boosterSetupOwner, ...action, ...fees };
      const gas = ((await client!.estimateGas(transaction)) * 120n) / 100n;
      await client!.call({ ...transaction, gas });
      const networkFee =
        gas * fees.maxFeePerGas +
        (await estimateL1Fee(client!, { ...transaction, gas }));
      if (
        (await client!.getBalance({ address: boosterSetupOwner })) < networkFee
      )
        throw Error("The owner needs more Base ETH for this transaction.");
      currentWallet(captured);
      const next = {
        step,
        ...action,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        networkFee,
        expiresAt: Date.now() + 120000,
        version: captured
      };
      active.current = next;
      setReview(next);
      setMessage("");
    });
  }
  function confirm() {
    const captured = review;
    if (!captured) return;
    void run(async () => {
      currentReview(captured);
      const { action } = await liveStep(captured.step);
      if (
        action.to?.toLowerCase() !== captured.to?.toLowerCase() ||
        action.data !== captured.data ||
        action.value !== 0n
      )
        throw Error("The exact transaction changed after review.");
      const transaction = {
        account: boosterSetupOwner,
        ...action,
        gas: captured.gas,
        maxFeePerGas: captured.maxFeePerGas,
        maxPriorityFeePerGas: captured.maxPriorityFeePerGas
      };
      await client!.call(transaction);
      const signer = currentReview(captured);
      const [signerChain, accounts] = await Promise.all([
        signer.getChainId(),
        signer.getAddresses()
      ]);
      if (
        signerChain !== 8453 ||
        !accounts.some(
          (a) => a.toLowerCase() === boosterSetupOwner.toLowerCase()
        )
      )
        throw Error("The wallet provider changed account or network.");
      // No await between this final active-review fence and entering the wallet.
      const finalSigner = currentReview(captured);
      if (finalSigner !== signer)
        throw Error("The signing wallet changed after review.");
      let hash = await finalSigner.sendTransaction({
        ...transaction,
        chain: base
      });
      remember({ ...saved.current, [captured.step]: hash });
      dismiss();
      if (mounted.current)
        setMessage("Waiting for the actual Base transaction receipt…");
      let replacementError = false;
      const receipt = await client!.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
        onReplaced: ({ transaction: next, replacedTransaction }) => {
          const sameNonce =
            next.nonce === replacedTransaction.nonce &&
            next.from.toLowerCase() === boosterSetupOwner.toLowerCase() &&
            replacedTransaction.from.toLowerCase() ===
              boosterSetupOwner.toLowerCase();
          const matches =
            next.value === 0n &&
            next.input.toLowerCase() === action.data.toLowerCase() &&
            (action.to
              ? next.to?.toLowerCase() === action.to.toLowerCase()
              : next.to === null);
          const cancelled =
            next.to?.toLowerCase() === boosterSetupOwner.toLowerCase() &&
            next.value === 0n &&
            next.input === "0x";
          replacementError =
            !sameNonce || next.chainId !== 8453 || (!matches && !cancelled);
          hash = next.hash;
          remember({ ...saved.current, [captured.step]: hash });
        }
      });
      if (replacementError)
        throw Error(
          "The replacement differs from this deployment step. Its hash is retained for manual review."
        );
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
        throw Error("The receipt differs from the saved transaction hash.");
      const actual = await readYpalDeployment(
        client!,
        bundle.data!,
        saved.current
      );
      if (actual.failed)
        throw Error(
          "The transaction is confirmed cancelled or reverted. Resolve it before reviewing a fresh transaction."
        );
      if (actual.pending)
        throw Error(
          "The saved transaction is still pending. Its hash is preserved."
        );
      if (mounted.current) {
        setMessage(
          actual.completed === 10
            ? "The fresh YPAL token, NFT collection, engine and single public pack are verified on Base."
            : "Confirmed and verified. Review the next step separately."
        );
        await state.refetch();
      }
    });
  }
  function resolve() {
    void run(async () => {
      if (!connected || !client || !bundle.data)
        throw Error("Connect the approved owner on Base.");
      const actual = await readYpalDeployment(
        client,
        bundle.data,
        saved.current
      );
      if (actual.failed) {
        const next = { ...saved.current };
        delete next[actual.failed.step];
        remember(next);
        setMessage(
          "The saved transaction is proven cancelled or reverted. You can review the same step again."
        );
      } else
        setMessage(
          actual.pending
            ? "The transaction is still pending. No new transaction was prepared."
            : "Confirmed deployment receipts and current onchain state are verified."
        );
      await state.refetch();
    });
  }
  function recover() {
    void run(async () => {
      if (
        !connected ||
        !client ||
        !bundle.data ||
        !hashPattern.test(receiptInput)
      )
        throw Error(
          "Enter a Base deployment transaction hash and connect the approved owner."
        );
      const step = recoveryStep,
        index = ypalLaunchSteps.indexOf(step);
      if (ypalLaunchSteps.slice(0, index).some((key) => !saved.current[key]))
        throw Error("Restore preceding deployment receipts first.");
      const prior = saved.current[step],
        hash = receiptInput as Hex;
      if (prior && prior.toLowerCase() !== hash.toLowerCase()) {
        const [original, replacement] = await Promise.all([
          client.getTransaction({ hash: prior }),
          client.getTransaction({ hash })
        ]);
        if (
          original.from.toLowerCase() !== boosterSetupOwner.toLowerCase() ||
          replacement.from.toLowerCase() !== boosterSetupOwner.toLowerCase() ||
          original.nonce !== replacement.nonce ||
          original.chainId !== 8453 ||
          replacement.chainId !== 8453
        )
          throw Error(
            "A pending transaction can only be replaced by the same owner's actual same-nonce transaction."
          );
      }
      const next = { ...saved.current, [step]: hash },
        actual = await readYpalDeployment(client, bundle.data, next);
      if (actual.pending || actual.failed)
        throw Error(
          "Manual recovery requires the exact successful confirmed step receipt. The existing hash is preserved."
        );
      if (actual.completed <= index)
        throw Error("The receipt did not verify the selected deployment step.");
      remember(next);
      setReceiptInput("");
      setMessage("The actual receipt and deployed code are verified.");
    });
  }
  function exportDeployment() {
    void run(async () => {
      if (!client || !bundle.data || !connected)
        throw Error("Connect the approved owner on Base.");
      const actual = await readYpalDeployment(
        client,
        bundle.data,
        saved.current
      );
      const manifest = ypalDeploymentManifest(bundle.data, actual);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(manifest, null, 2) + "\n"], {
          type: "application/json"
        })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "yunipals-ypal-fresh-deployment-confirmed-v1.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  }
  const current = state.data,
    disabled =
      !connected ||
      busy ||
      Boolean(review) ||
      !bundle.data ||
      Boolean(state.error) ||
      state.isFetching;
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Link to="/boosters" className="text-sm underline">
        Back to packs
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Fresh YPAL launch</h1>
        <p>
          Deploy a new YPAL token, NFT collection and pack engine, then
          configure one public pack. Each action requires its own fee review and
          wallet confirmation.
        </p>
        <p className="text-sm text-muted-foreground">
          Base mainnet · Owner {boosterSetupOwner}
        </p>
      </header>
      {!owner ? (
        <button
          className={boosterButtonClass}
          onClick={() => openConnectModal?.()}
        >
          Connect owner wallet
        </button>
      ) : chainId !== 8453 ? (
        <button
          className={boosterButtonClass}
          onClick={() => switcher.switchChain({ chainId: 8453 })}
        >
          Switch to Base
        </button>
      ) : null}
      <div className="rounded-2xl border border-border p-5">
        <p className="font-semibold">
          1 YPAL per pack · 264 variants · one daily credit · unlimited sales
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This fresh registry contains one public pack. Approved artwork is
          shared. Deployment addresses come from confirmed receipts.
        </p>
        <a
          href={ypalLaunchPackagePath}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm underline"
        >
          Review unsigned launch package
        </a>
      </div>
      {(error || bundle.error || state.error) && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-4 text-destructive"
        >
          {error ??
            (bundle.error instanceof Error ? bundle.error.message : null) ??
            (state.error instanceof Error
              ? state.error.message
              : "The onchain state could not be verified.")}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-border p-4">
          {message}
        </p>
      )}
      {bundle.isPending && <p role="status">Loading the reviewed package…</p>}
      <ol className="space-y-3" aria-label="Fresh launch steps">
        {ypalLaunchSteps.map((step, i) => (
          <li key={step} className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold">
                {i + 1}. {ypalStepLabels[step]}
              </span>
              <span className="text-sm text-muted-foreground">
                {current && current.completed > i
                  ? "Confirmed and verified"
                  : current?.pending?.step === step
                    ? "Pending"
                    : current?.failed?.step === step
                      ? "Cancelled or reverted"
                      : "Awaiting receipt"}
              </span>
            </div>
            {receipts[step] && (
              <a
                className="mt-2 block break-all text-sm underline"
                href={`https://basescan.org/tx/${receipts[step]}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction {receipts[step]}
              </a>
            )}
            {current?.nextStep === step &&
              !current.pending &&
              !current.failed && (
                <button
                  disabled={disabled}
                  className={cn(boosterButtonClass, "mt-3")}
                  onClick={() => prepare(step)}
                >
                  Review: {ypalStepLabels[step]}
                </button>
              )}
          </li>
        ))}
      </ol>
      <section
        className="space-y-3 rounded-2xl border border-border p-5"
        aria-labelledby="ypal-recovery-title"
      >
        <h2 id="ypal-recovery-title" className="text-xl font-bold">
          Check or restore a transaction
        </h2>
        <p className="text-sm text-muted-foreground">
          Reloading preserves saved hashes. Check a pending transaction before
          trying again. Restore the next confirmed receipt if this browser lost
          its saved state.
        </p>
        <button
          disabled={!connected || busy || Boolean(review) || !bundle.data}
          className={boosterButtonClass}
          onClick={resolve}
        >
          Check saved transactions
        </button>
        <label className="block text-sm" htmlFor="ypal-recovery-step">
          Receipt step
        </label>
        <Select
          id="ypal-recovery-step"
          value={recoveryStep}
          onValueChange={(value) => setRecoveryStep(value as YpalLaunchStep)}
          className="w-full rounded-full border border-border bg-background px-4 py-2"
        >
          {ypalLaunchSteps.map((step, i) => (
            <SelectItem key={step} value={step}>
              {i + 1}. {ypalStepLabels[step]}
            </SelectItem>
          ))}
        </Select>
        <label className="block text-sm" htmlFor="ypal-receipt">
          Next step's successful transaction hash
        </label>
        <input
          id="ypal-receipt"
          value={receiptInput}
          onChange={(e) => setReceiptInput(e.target.value)}
          className="w-full rounded-full border border-border bg-background px-4 py-2"
          autoComplete="off"
        />
        <button
          disabled={!connected || busy || Boolean(review) || !bundle.data}
          className={boosterButtonClass}
          onClick={recover}
        >
          Verify and restore receipt
        </button>
      </section>
      {current && Object.keys(current.addresses).length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border p-5">
          <h2 className="text-xl font-bold">Verified receipt addresses</h2>
          {Object.entries(current.addresses).map(([key, value]) => (
            <p key={key} className="break-all text-sm">
              {ypalStepLabels[key as YpalLaunchStep]}:{" "}
              <a
                href={`https://basescan.org/address/${value}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {value}
              </a>
            </p>
          ))}
          {current.typeId !== undefined && (
            <p className="text-sm">
              Public pack type: {current.typeId.toString()}
            </p>
          )}
        </section>
      )}
      {current?.completed === 10 && (
        <button
          className={boosterButtonClass}
          disabled={disabled}
          onClick={exportDeployment}
        >
          Download verified deployment manifest
        </button>
      )}
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          dismiss();
        }}
        aria-labelledby="ypal-review-title"
        className="w-full max-w-xl rounded-2xl border border-border bg-background p-6 text-foreground backdrop:bg-black/60"
      >
        <h2 id="ypal-review-title" className="text-xl font-bold">
          Review {review ? ypalStepLabels[review.step] : "launch transaction"}
        </h2>
        {review && (
          <div className="mt-4 space-y-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt>Network</dt>
                <dd>Base mainnet</dd>
              </div>
              <div>
                <dt>From</dt>
                <dd className="break-all">{boosterSetupOwner}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd className="break-all">
                  {review.to ?? "New contract; address verified from receipt"}
                </dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd>0 ETH</dd>
              </div>
              <div>
                <dt>Estimated maximum network fee</dt>
                <dd title={`${formatEther(review.networkFee)} ETH`}>
                  {formatRoundedAmount(review.networkFee, 18, "ETH")}
                </dd>
              </div>
            </dl>
            <details>
              <summary className="cursor-pointer text-sm underline">
                Exact transaction data
              </summary>
              <p className="mt-2 max-h-40 overflow-auto break-all font-mono text-xs">
                {review.data}
              </p>
            </details>
            <p className="text-sm text-muted-foreground">
              This review expires after two minutes. Your wallet supplies the
              nonce. No later deployment step is submitted automatically.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                className={boosterButtonClass}
                onClick={confirm}
              >
                Confirm this transaction
              </button>
              <button
                className="rounded-full border border-border px-4 py-2"
                onClick={dismiss}
              >
                Cancel review
              </button>
            </div>
          </div>
        )}
      </dialog>
    </main>
  );
}

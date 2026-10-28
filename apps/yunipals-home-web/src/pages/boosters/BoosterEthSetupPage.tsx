import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Link } from "react-router-dom";
import { BaseError, keccak256, type Address, type Hex } from "viem";
import { estimateL1Fee } from "viem/op-stack";
import { YunipalsLoader } from "@/components/YunipalsLoader";
import { cn } from "@/lib/utils";
import { formatRoundedAmount } from "@/lib/format";
import {
  ethSetupAction,
  ethSetupBundle,
  ethSetupLabels,
  ethSetupState,
  ethSetupSteps,
  type EthSetupReceipts,
  type EthSetupStep
} from "@/lib/boosterEthSetup";
import { boosterButtonClass } from "./BoosterActionButton";

const storageKey = `yunipals/eth-payment-setup/v1/${keccak256(ethSetupBundle.engineCreation as Hex)}`;
type Review = {
  step: EthSetupStep;
  to?: Address;
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  networkFee: bigint;
  expires: number;
};

export function BoosterEthSetupPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { data: wallet } = useWalletClient();
  const [receipts, setReceipts] = useState<EthSetupReceipts>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return Object.fromEntries(
        ethSetupSteps
          .filter((step) => /^0x[0-9a-f]{64}$/i.test(value[step]))
          .map((step) => [step, value[step]])
      );
    } catch {
      return {};
    }
  });
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const scope = useRef({ address, chainId, wallet });
  scope.current = { address, chainId, wallet };
  const owner =
    address?.toLowerCase() === ethSetupBundle.owner && chainId === 8453;
  const state = useQuery({
    queryKey: ["eth-payment-setup", receipts],
    enabled: Boolean(client && owner),
    retry: false,
    queryFn: () => ethSetupState(client!, receipts)
  });
  useEffect(() => {
    setReview(null);
  }, [address, chainId, wallet]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function remember(value: EthSetupReceipts) {
    if (mounted.current) setReceipts(value);
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Hash remains visible for manual recovery. */
    }
  }
  async function checkedWallet() {
    if (
      !mounted.current ||
      !wallet ||
      scope.current.wallet !== wallet ||
      scope.current.chainId !== 8453 ||
      scope.current.address?.toLowerCase() !== ethSetupBundle.owner
    )
      throw new Error("Connect the deployment owner wallet on Base.");
    const [chain, accounts] = await Promise.all([
      wallet.getChainId(),
      wallet.getAddresses()
    ]);
    if (
      chain !== 8453 ||
      accounts[0]?.toLowerCase() !== ethSetupBundle.owner ||
      scope.current.wallet !== wallet ||
      scope.current.address !== address ||
      scope.current.chainId !== 8453 ||
      !mounted.current
    )
      throw new Error("Your wallet changed. Review this step again.");
    return wallet;
  }
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof BaseError
            ? cause.shortMessage
            : cause instanceof Error
              ? cause.message
              : "This step could not be completed."
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function prepare(step: EthSetupStep) {
    setReview(null);
    await checkedWallet();
    const action = await ethSetupAction(client!, receipts, step);
    const fees = await client!.estimateFeesPerGas();
    const tx = {
      ...action,
      account: ethSetupBundle.owner as Address,
      value: 0n,
      ...fees
    };
    await client!.call(tx);
    const gas = ((await client!.estimateGas(tx)) * 120n) / 100n;
    const networkFee =
      gas * fees.maxFeePerGas + (await estimateL1Fee(client!, { ...tx, gas }));
    await checkedWallet();
    setReview({
      ...action,
      ...fees,
      gas,
      networkFee,
      step,
      expires: Date.now() + 600_000
    });
  }
  async function confirm() {
    const current = review;
    if (!current || Date.now() >= current.expires)
      throw new Error("Review this step again.");
    const signing = await checkedWallet();
    const action = await ethSetupAction(client!, receipts, current.step);
    if (action.data !== current.data || action.to !== current.to)
      throw new Error("The deployment state changed.");
    const tx = {
      account: ethSetupBundle.owner as Address,
      to: current.to,
      data: current.data,
      value: 0n,
      gas: current.gas,
      maxFeePerGas: current.maxFeePerGas,
      maxPriorityFeePerGas: current.maxPriorityFeePerGas
    };
    await client!.call(tx);
    if (
      (await client!.getBalance({ address: ethSetupBundle.owner as Address })) <
      current.networkFee
    )
      throw new Error("More ETH is needed for deployment gas.");
    await checkedWallet();
    if (Date.now() >= current.expires)
      throw new Error("Review this step again.");
    const hash = await signing.sendTransaction({ ...tx, chain: client!.chain });
    const next = { ...receipts, [current.step]: hash };
    remember(next);
    setReview(null);
    const receipt = await client!.waitForTransactionReceipt({
      hash,
      onReplaced: ({ transaction }) =>
        remember({ ...receipts, [current.step]: transaction.hash })
    });
    if (receipt.status !== "success")
      throw new Error(
        "The transaction reverted. Check the saved transaction before retrying."
      );
    // Re-read contract state, rather than declaring success from a receipt alone.
    await ethSetupState(client!, {
      ...next,
      [current.step]: receipt.transactionHash
    });
    await state.refetch();
  }
  const done = (step: EthSetupStep) =>
    step === "implementation"
      ? Boolean(state.data?.implementation)
      : step === "adapter"
        ? Boolean(state.data?.adapter)
        : step === "upgrade"
          ? state.data?.upgraded
          : state.data?.activated;
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-ink">
      <Link to="/boosters" className="font-bold text-grape underline">
        Back to packs
      </Link>
      <h1 className="mt-6 text-3xl font-extrabold">Enable ETH pack payments</h1>
      <p className="mt-3 text-muted">
        Deploy the reviewed payment contracts, upgrade the existing engine, then
        grant access. Each step is a separate wallet transaction.
      </p>
      <p className="mt-3 text-sm text-muted">
        Connect the deployment owner wallet on Base to continue.
      </p>
      <div className="mt-6 space-y-4">
        {ethSetupSteps.map((step, index) => (
          <section
            key={step}
            className="rounded-2xl border border-line bg-white p-5"
          >
            <h2 className="font-bold">
              {index + 1}. {ethSetupLabels[step]} {done(step) ? "✓" : ""}
            </h2>
            <button
              type="button"
              className={cn(boosterButtonClass, "mt-4")}
              disabled={
                !owner ||
                busy ||
                !state.data ||
                done(step) ||
                (index > 0 && !done(ethSetupSteps[index - 1]))
              }
              onClick={() => void run(() => prepare(step))}
            >
              Review step
            </button>
            {receipts[step] && (
              <a
                className="ml-4 text-sm text-grape underline"
                target="_blank"
                rel="noreferrer"
                href={`https://basescan.org/tx/${receipts[step]}`}
              >
                View transaction
              </a>
            )}
            <label className="mt-4 block text-xs text-muted">
              Restore transaction hash
              <input
                className="mt-1 w-full rounded-full border border-line px-4 py-2 text-sm"
                defaultValue={receipts[step] || ""}
                disabled={busy}
                onBlur={(event) => {
                  const hash = event.target.value.trim();
                  if (/^0x[0-9a-f]{64}$/i.test(hash))
                    remember({ ...receipts, [step]: hash as Hex });
                }}
              />
            </label>
          </section>
        ))}
      </div>
      {busy && (
        <YunipalsLoader
          className="my-5"
          label="Checking deployment"
          detail="Confirm in your wallet if requested."
        />
      )}
      {review && (
        <section
          className="mt-5 rounded-2xl border border-grape p-5"
          aria-label="Deployment transaction review"
        >
          <h2 className="font-bold">{ethSetupLabels[review.step]}</h2>
          <p className="mt-3 text-sm">
            Estimated network fee:{" "}
            {formatRoundedAmount(review.networkFee, 18, "ETH")}
          </p>
          <p className="mt-2 break-all text-xs text-muted">
            Transaction data hash: {keccak256(review.data)}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className={boosterButtonClass}
              disabled={busy}
              onClick={() => void run(confirm)}
            >
              Confirm in wallet
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-5 py-3 font-bold"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Close
            </button>
          </div>
        </section>
      )}
      {(error || state.error) && (
        <p role="alert" className="mt-5 text-destructive">
          {error || state.error?.message}
        </p>
      )}
      <button
        type="button"
        className="mt-5 text-grape underline"
        disabled={busy}
        onClick={() => void state.refetch()}
      >
        Refresh deployment state
      </button>
      {state.data?.activated && (
        <p role="status" className="mt-5 font-bold text-grape">
          Contracts activated. Set VITE_BOOSTER_ETH_ADAPTER to{" "}
          {state.data.adapter} in the website deployment to show ETH checkout.
        </p>
      )}
    </main>
  );
}

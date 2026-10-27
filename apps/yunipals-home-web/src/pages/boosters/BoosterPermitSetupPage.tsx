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
import {
  BaseError,
  formatEther,
  getAddress,
  isAddress,
  type Address,
  type Hex
} from "viem";
import { estimateL1Fee } from "viem/op-stack";

import { boosterSetupOwner } from "@/lib/boosterSetup";
import { cn } from "@/lib/utils";
import {
  assertPermitReceiptIdentity,
  checkPermitUpgradeState,
  permitUpgradeCalldata,
  permitUpgradePackagePath,
  permitUpgradePackageSha256,
  readPermitUpgradePackage,
  recoverPermitImplementation
} from "@/lib/boosterPermitSetup";
import { boosterButtonClass } from "./BoosterActionButton";

type SavedDeployment = {
  deploymentHash?: Hex;
  implementation?: Address;
  upgradeHash?: Hex;
};
type PermitReview = {
  kind: "deploy" | "upgrade";
  implementation?: Address;
  to?: Address;
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  networkFee: bigint;
  expiresAt: number;
};
const storageKey = `yunipals/boosters/permit/v1/${permitUpgradePackageSha256}`;
const transactionHash = /^0x[0-9a-fA-F]{64}$/;

export function BoosterPermitSetupPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const wallet = useWalletClient();
  const switcher = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [saved, setSaved] = useState<SavedDeployment>({});
  const [implementationInput, setImplementationInput] = useState("");
  const [receiptInput, setReceiptInput] = useState("");
  const [review, setReview] = useState<PermitReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const activeReview = useRef<PermitReview | null>(null);
  const savedRef = useRef<SavedDeployment>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const latestWallet = useRef({ address, chainId, wallet: wallet.data });
  if (
    latestWallet.current.address !== address ||
    latestWallet.current.chainId !== chainId ||
    latestWallet.current.wallet !== wallet.data
  )
    activeReview.current = null;
  latestWallet.current = { address, chainId, wallet: wallet.data };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeReview.current = null;
    };
  }, []);
  const owner = address?.toLowerCase() === boosterSetupOwner.toLowerCase();
  const connected = Boolean(owner && chainId === 8453 && client);
  const bundle = useQuery({
    queryKey: ["booster-permit-package", permitUpgradePackageSha256],
    queryFn: ({ signal }) => readPermitUpgradePackage(signal),
    staleTime: Infinity,
    retry: false
  });
  const state = useQuery({
    queryKey: [
      "booster-permit-state",
      permitUpgradePackageSha256,
      saved.implementation
    ],
    enabled: Boolean(connected && bundle.data),
    queryFn: () =>
      checkPermitUpgradeState(client!, bundle.data!, saved.implementation),
    staleTime: 15000,
    retry: false
  });
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      const restored: SavedDeployment = {};
      if (
        typeof value.deploymentHash === "string" &&
        transactionHash.test(value.deploymentHash)
      )
        restored.deploymentHash = value.deploymentHash;
      if (
        typeof value.upgradeHash === "string" &&
        transactionHash.test(value.upgradeHash)
      )
        restored.upgradeHash = value.upgradeHash;
      if (
        typeof value.implementation === "string" &&
        isAddress(value.implementation)
      )
        restored.implementation = getAddress(value.implementation);
      savedRef.current = restored;
      setSaved(restored);
      setImplementationInput(restored.implementation ?? "");
      setReceiptInput(restored.deploymentHash ?? "");
    } catch {
      /* A receipt or implementation address can be restored below. */
    }
  }, []);
  useEffect(() => {
    setActiveReview(null);
  }, [address, chainId, wallet.data]);
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    if (!review) dialog.current?.close();
  }, [review]);
  function setActiveReview(value: PermitReview | null) {
    activeReview.current = value;
    setReview(value);
  }
  function remember(value: Partial<SavedDeployment>) {
    const next = { ...savedRef.current, ...value };
    savedRef.current = next;
    setSaved(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* The actual transaction receipt also supports manual recovery. */
    }
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof BaseError
          ? cause.shortMessage
          : cause instanceof Error
            ? cause.message
            : "The permit setup could not finish."
      );
      setMessage("");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function assertCurrentWallet() {
    if (!mounted.current)
      throw new Error(
        "This setup page closed. Return and review the step again."
      );
    const current = latestWallet.current;
    if (
      current.address?.toLowerCase() !== boosterSetupOwner.toLowerCase() ||
      current.chainId !== 8453 ||
      !current.wallet ||
      current.wallet.account.address.toLowerCase() !==
        boosterSetupOwner.toLowerCase() ||
      current.wallet.chain.id !== 8453
    )
      throw new Error(
        "The wallet or network changed. Prepare this step again."
      );
    return current.wallet;
  }
  function assertActiveReview(current: PermitReview) {
    if (activeReview.current !== current || Date.now() >= current.expiresAt)
      throw new Error(
        "The wallet or network changed, or this review was cancelled. Prepare this step again."
      );
    return assertCurrentWallet();
  }
  async function resolveSaved(kind: "deploy" | "upgrade") {
    if (!client || !bundle.data || !connected)
      throw new Error("Connect the approved owner wallet on Base.");
    const hash =
      kind === "deploy"
        ? savedRef.current.deploymentHash
        : savedRef.current.upgradeHash;
    if (!hash) return;
    if ((await client.getChainId()) !== 8453)
      throw new Error("Resolve the saved receipt on Base mainnet.");
    const [receipt, actual] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash })
    ]);
    assertPermitReceiptIdentity(receipt, actual, hash);
    if (actual.from.toLowerCase() !== boosterSetupOwner.toLowerCase())
      throw new Error(
        "This transaction does not belong to the approved owner."
      );
    const cancelled =
      receipt.status === "success" &&
      actual.to?.toLowerCase() === boosterSetupOwner.toLowerCase() &&
      actual.input === "0x" &&
      actual.value === 0n;
    if (receipt.status === "reverted" || cancelled) {
      remember(
        kind === "deploy"
          ? { deploymentHash: undefined }
          : { upgradeHash: undefined }
      );
      setMessage(
        "The saved transaction is confirmed cancelled or reverted. You can review a fresh transaction."
      );
      return;
    }
    if (kind === "deploy") {
      const implementation = await recoverPermitImplementation(
        client,
        bundle.data,
        hash
      );
      remember({ implementation });
      setImplementationInput(implementation);
      setMessage("The deployed implementation's exact bytecode is verified.");
    } else {
      const implementation = savedRef.current.implementation;
      if (
        !implementation ||
        actual.to?.toLowerCase() !== bundle.data.proxy.toLowerCase() ||
        actual.input.toLowerCase() !==
          permitUpgradeCalldata(bundle.data, implementation).toLowerCase() ||
        actual.value !== 0n ||
        !(await checkPermitUpgradeState(client, bundle.data, implementation))
          .complete
      )
        throw new Error(
          "The saved upgrade receipt does not match the approved completed upgrade."
        );
      await state.refetch();
      setMessage("The permit engine upgrade is already installed.");
    }
  }
  async function liveCheck(
    kind: PermitReview["kind"],
    implementation?: Address
  ) {
    if (!bundle.data || !client || !owner || chainId !== 8453)
      throw new Error("Connect the approved owner wallet on Base.");
    if (
      (kind === "deploy" && savedRef.current.deploymentHash) ||
      (kind === "upgrade" && savedRef.current.upgradeHash)
    )
      throw new Error(
        "Resolve the saved transaction receipt before submitting another transaction."
      );
    const current = await checkPermitUpgradeState(
      client,
      bundle.data,
      implementation
    );
    if (current.complete)
      throw new Error("This permit engine upgrade is already complete.");
    if (kind === "upgrade") {
      if (!implementation)
        throw new Error("Verify the deployed implementation first.");
    }
    return bundle.data;
  }
  function prepare(kind: PermitReview["kind"]) {
    void run(async () => {
      setMessage("Checking the deployment, permissions and current fees…");
      const implementation =
        kind === "upgrade" ? saved.implementation : undefined;
      const b = await liveCheck(kind, implementation);
      const data =
        kind === "deploy"
          ? b.candidate.creationBytecode
          : permitUpgradeCalldata(b, implementation!);
      const to = kind === "deploy" ? undefined : b.proxy;
      const fees = await client!.estimateFeesPerGas();
      const transaction = {
        account: boosterSetupOwner,
        ...(to ? { to } : {}),
        data,
        value: 0n,
        ...fees
      };
      const gas = ((await client!.estimateGas(transaction)) * 120n) / 100n;
      await client!.call({ ...transaction, gas });
      const networkFee =
        gas * fees.maxFeePerGas +
        (await estimateL1Fee(client!, { ...transaction, gas }));
      if (
        (await client!.getBalance({ address: boosterSetupOwner })) < networkFee
      )
        throw new Error(
          "The owner wallet needs more ETH for this transaction."
        );
      assertCurrentWallet();
      setActiveReview({
        kind,
        implementation,
        to,
        data,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        networkFee,
        expiresAt: Date.now() + 120000
      });
      setMessage("");
    });
  }
  function confirm() {
    const current = review;
    if (!current) return;
    void run(async () => {
      assertActiveReview(current);
      const b = await liveCheck(current.kind, current.implementation);
      if (
        !wallet.data ||
        wallet.data.account.address.toLowerCase() !== b.owner.toLowerCase() ||
        wallet.data.chain.id !== 8453 ||
        Date.now() >= current.expiresAt
      )
        throw new Error(
          "The wallet or fee review changed. Close and prepare this step again."
        );
      const transaction = {
        account: boosterSetupOwner,
        ...(current.to ? { to: current.to } : {}),
        data: current.data,
        value: 0n,
        gas: current.gas,
        maxFeePerGas: current.maxFeePerGas,
        maxPriorityFeePerGas: current.maxPriorityFeePerGas
      };
      await client!.call(transaction);
      setMessage("Confirm this step in your wallet…");
      const signingWallet = assertActiveReview(current);
      const [signingChain, signingAddresses] = await Promise.all([
        signingWallet.getChainId(),
        signingWallet.getAddresses()
      ]);
      if (
        signingChain !== 8453 ||
        signingAddresses[0]?.toLowerCase() !==
          boosterSetupOwner.toLowerCase() ||
        latestWallet.current.wallet !== signingWallet ||
        Date.now() >= current.expiresAt
      )
        throw new Error(
          "The wallet changed during preflight. Prepare this step again."
        );
      if (assertActiveReview(current) !== signingWallet)
        throw new Error("The signing wallet changed. Prepare this step again.");
      let hash = await signingWallet.sendTransaction({
        ...transaction,
        chain: client!.chain
      });
      remember(
        current.kind === "deploy"
          ? { deploymentHash: hash }
          : { upgradeHash: hash }
      );
      setActiveReview(null);
      setMessage("Waiting for confirmation on Base…");
      let cancelled = false;
      const receipt = await client!.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        onReplaced: ({ transaction, reason }) => {
          hash = transaction.hash;
          cancelled = reason === "cancelled";
          remember(
            current.kind === "deploy"
              ? { deploymentHash: hash }
              : { upgradeHash: hash }
          );
        }
      });
      if (cancelled || receipt.status !== "success")
        throw new Error(
          "The transaction was cancelled or reverted. Check its receipt before trying again."
        );
      if (current.kind === "deploy") {
        const implementation = await recoverPermitImplementation(
          client!,
          b,
          receipt.transactionHash
        );
        remember({ implementation });
        setImplementationInput(implementation);
        setReceiptInput(receipt.transactionHash);
        setMessage(
          "Implementation deployed and verified. Review the separate engine upgrade when this deployment is confirmed."
        );
      } else {
        const actual = await client!.getTransaction({
          hash: receipt.transactionHash
        });
        assertPermitReceiptIdentity(receipt, actual, receipt.transactionHash);
        if (
          actual.from.toLowerCase() !== b.owner.toLowerCase() ||
          actual.to?.toLowerCase() !== b.proxy.toLowerCase() ||
          actual.value !== 0n ||
          actual.input.toLowerCase() !== current.data.toLowerCase()
        )
          throw new Error(
            "The confirmed transaction differs from the reviewed atomic upgrade."
          );
        const result = await checkPermitUpgradeState(
          client!,
          b,
          current.implementation
        );
        if (!result.complete)
          throw new Error(
            "The receipt succeeded but the permit upgrade is not installed."
          );
        setMessage(
          "The approved permit engine implementation and signature approval capability are verified on Base."
        );
      }
      await state.refetch();
    });
  }
  function recover(from: "receipt" | "address") {
    void run(async () => {
      if (!connected || !client || !bundle.data)
        throw new Error("Connect the approved owner wallet on Base.");
      let implementation: Address;
      if (from === "receipt") {
        if (!transactionHash.test(receiptInput))
          throw new Error(
            "Enter the implementation deployment transaction hash."
          );
        implementation = await recoverPermitImplementation(
          client,
          bundle.data,
          receiptInput as Hex
        );
      } else {
        if (!isAddress(implementationInput))
          throw new Error("Enter a valid implementation address.");
        implementation = getAddress(implementationInput);
      }
      const current = await checkPermitUpgradeState(
        client,
        bundle.data,
        implementation
      );
      remember({
        implementation,
        ...(from === "receipt" ? { deploymentHash: receiptInput as Hex } : {})
      });
      setImplementationInput(implementation);
      setMessage(
        current.complete
          ? "The permit engine upgrade is already installed."
          : "The deployed implementation's exact bytecode is verified."
      );
    });
  }
  const complete = state.data?.complete === true;
  const ready =
    connected && bundle.data && state.data && !state.error && !busy && !review;
  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-4 py-12">
      <Link to="/boosters" className="text-sm font-bold underline">
        Back to packs
      </Link>
      <h1 className="mt-6 font-display text-3xl">Owner permit upgrade</h1>
      <p className="mt-3 text-muted">
        Enable a signed PROTO approval and pack opening in one paid transaction.
        Existing packs, daily credits, minting and burning rules are preserved.
      </p>
      <p className="mt-3 break-all text-sm text-muted">
        Approved Base wallet: {boosterSetupOwner}
      </p>
      {!address ? (
        <button
          type="button"
          className={cn(boosterButtonClass, "mt-5")}
          onClick={() => openConnectModal?.()}
        >
          Connect owner wallet
        </button>
      ) : !owner ? (
        <p role="status" className="mt-5">
          Connect the approved owner wallet to prepare these transactions.
        </p>
      ) : chainId !== 8453 ? (
        <button
          type="button"
          className={cn(boosterButtonClass, "mt-5")}
          disabled={switcher.isPending}
          onClick={() => switcher.switchChain({ chainId: 8453 })}
        >
          Switch to Base
        </button>
      ) : null}
      {bundle.isPending && (
        <p role="status" className="mt-5 animate-pulse">
          Verifying the approved package…
        </p>
      )}
      {(error || bundle.error || state.error || switcher.error) && (
        <p role="alert" className="mt-5 break-words text-sm">
          {error ??
            bundle.error?.message ??
            state.error?.message ??
            switcher.error?.message}
        </p>
      )}
      {message && (
        <p role="status" className="mt-5 break-words text-sm">
          {message}
        </p>
      )}
      {complete && (
        <p
          role="status"
          className="mt-6 rounded-card border border-line bg-lavender/20 p-5 font-bold"
        >
          Permit upgrade complete. The implementation and permit capability
          match the approved package.
        </p>
      )}
      {bundle.data && (
        <>
          <section className="mt-7 space-y-4 rounded-card border border-line p-6">
            <h2 className="text-xl font-bold">1. Deploy the implementation</h2>
            <p className="text-sm text-muted">
              This creates the approved contract. The engine proxy is updated in
              step 2, using the actual address from the confirmed deployment
              receipt.
            </p>
            <dl className="space-y-2 break-all text-xs">
              <div>
                <dt className="font-bold">Creation bytecode hash</dt>
                <dd>{bundle.data.candidate.creationCodeKeccak256}</dd>
              </div>
              <div>
                <dt className="font-bold">Creation bytecode size</dt>
                <dd>
                  {(bundle.data.candidate.creationBytecode.length - 2) / 2}{" "}
                  bytes
                </dd>
              </div>
              <div>
                <dt className="font-bold">Package SHA-256</dt>
                <dd>{permitUpgradePackageSha256}</dd>
              </div>
            </dl>
            <a
              href={permitUpgradePackagePath}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm underline"
            >
              Review the unsigned package
            </a>
            <div>
              <button
                type="button"
                className={boosterButtonClass}
                disabled={
                  !ready ||
                  complete ||
                  Boolean(saved.implementation || saved.deploymentHash)
                }
                onClick={() => prepare("deploy")}
              >
                Review deployment
              </button>
            </div>
            {saved.deploymentHash && (
              <button
                type="button"
                className={boosterButtonClass}
                disabled={!connected || busy || Boolean(review)}
                onClick={() => void run(() => resolveSaved("deploy"))}
              >
                Resolve saved deployment
              </button>
            )}
            {saved.deploymentHash && (
              <a
                href={`https://basescan.org/tx/${saved.deploymentHash}`}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sm underline"
              >
                Deployment transaction: {saved.deploymentHash}
              </a>
            )}
          </section>
          <section className="mt-5 space-y-4 rounded-card border border-line p-6">
            <h2 className="text-xl font-bold">
              Restore or verify a deployment
            </h2>
            <p className="text-sm text-muted">
              Saved addresses are checked against the approved runtime bytecode.
              If you refreshed while a transaction was pending, check its
              receipt here.
            </p>
            <label
              className="block text-sm font-bold"
              htmlFor="permit-deploy-receipt"
            >
              Deployment transaction hash
            </label>
            <input
              id="permit-deploy-receipt"
              value={receiptInput}
              onChange={(event) => setReceiptInput(event.target.value.trim())}
              className="w-full rounded-xl border border-line p-3 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={boosterButtonClass}
              disabled={!connected || !bundle.data || busy || Boolean(review)}
              onClick={() => recover("receipt")}
            >
              Check deployment receipt
            </button>
            <label
              className="block text-sm font-bold"
              htmlFor="permit-implementation"
            >
              Deployed implementation address
            </label>
            <input
              id="permit-implementation"
              value={implementationInput}
              onChange={(event) =>
                setImplementationInput(event.target.value.trim())
              }
              className="w-full rounded-xl border border-line p-3 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={boosterButtonClass}
              disabled={!connected || !bundle.data || busy || Boolean(review)}
              onClick={() => recover("address")}
            >
              Verify implementation
            </button>
            {saved.implementation && (
              <p className="break-all text-sm">
                Selected implementation: {saved.implementation}
              </p>
            )}
          </section>
          <section className="mt-5 space-y-4 rounded-card border border-line bg-lavender/20 p-6">
            <h2 className="text-xl font-bold">2. Upgrade the pack engine</h2>
            <p className="text-sm text-muted">
              This installs the verified implementation with empty
              initialization data. Existing originals, requests, refunds,
              recovery state and pack rules remain intact. This action does not
              purchase or open packs.
            </p>
            <dl className="space-y-3 break-all text-sm">
              <div>
                <dt className="font-bold">Pack engine proxy</dt>
                <dd>{bundle.data.proxy}</dd>
              </div>
              <div>
                <dt className="font-bold">Current approved implementation</dt>
                <dd>{bundle.data.currentImplementation.address}</dd>
              </div>
              <div>
                <dt className="font-bold">Maximum packs in one transaction</dt>
                <dd>{bundle.data.capability.maxOpenPacks}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
              disabled={
                !connected || busy || state.isFetching || Boolean(review)
              }
              onClick={() => {
                void state.refetch();
              }}
            >
              Refresh readiness
            </button>
            <div>
              <button
                type="button"
                className={boosterButtonClass}
                disabled={
                  !ready ||
                  complete ||
                  Boolean(saved.upgradeHash) ||
                  !saved.implementation
                }
                onClick={() => prepare("upgrade")}
              >
                Review atomic upgrade
              </button>
            </div>
            {saved.upgradeHash && !complete && (
              <button
                type="button"
                className={boosterButtonClass}
                disabled={!connected || busy || Boolean(review)}
                onClick={() => void run(() => resolveSaved("upgrade"))}
              >
                Resolve saved upgrade
              </button>
            )}
            {saved.upgradeHash && (
              <a
                href={`https://basescan.org/tx/${saved.upgradeHash}`}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sm underline"
              >
                Upgrade transaction: {saved.upgradeHash}
              </a>
            )}
          </section>
        </>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="permit-review-title"
        className="w-full max-w-xl rounded-card bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setActiveReview(null);
        }}
      >
        <h2 id="permit-review-title" className="text-xl font-bold">
          {review?.kind === "deploy"
            ? "Review implementation deployment"
            : "Review atomic permit upgrade"}
        </h2>
        {review && (
          <>
            <dl className="my-5 space-y-3 break-all text-sm">
              <div>
                <dt className="font-bold">Network</dt>
                <dd>Base mainnet (8453)</dd>
              </div>
              <div>
                <dt className="font-bold">Target</dt>
                <dd>{review.to ?? "New implementation contract"}</dd>
              </div>
              {review.implementation && (
                <div>
                  <dt className="font-bold">Verified implementation</dt>
                  <dd>{review.implementation}</dd>
                </div>
              )}
              <div>
                <dt className="font-bold">ETH sent</dt>
                <dd>0 ETH</dd>
              </div>
              <div>
                <dt className="font-bold">
                  Estimated maximum network fee, including L1 data
                </dt>
                <dd>{formatEther(review.networkFee)} ETH</dd>
              </div>
              <div>
                <dt className="font-bold">Gas limit (20% margin)</dt>
                <dd>{review.gas.toString()}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted">
              This review is valid for two minutes. Your wallet supplies the
              current nonce. Confirming this step opens the wallet for this
              transaction only.
            </p>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-bold">
                Review exact{" "}
                {review.kind === "deploy"
                  ? "creation bytecode"
                  : "upgrade calldata"}
              </summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line p-3 text-xs">
                {review.data}
              </pre>
            </details>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className={boosterButtonClass}
                disabled={busy}
                onClick={confirm}
              >
                {review.kind === "deploy"
                  ? "Deploy in wallet"
                  : "Upgrade in wallet"}
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
                disabled={busy}
                onClick={() => setActiveReview(null)}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}

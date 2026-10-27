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
  checkMetadataAPI,
  checkMetadataUpgradeState,
  metadataUpgradeCalldata,
  metadataUpgradePackagePath,
  metadataUpgradePackageSha256,
  readMetadataUpgradePackage,
  recoverMetadataImplementation
} from "@/lib/boosterMetadataSetup";
import { boosterButtonClass } from "./BoosterActionButton";

type SavedDeployment = {
  deploymentHash?: Hex;
  implementation?: Address;
  upgradeHash?: Hex;
};
type MetadataReview = {
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
const storageKey = `yunipals/boosters/metadata/v1/${metadataUpgradePackageSha256}`;
const transactionHash = /^0x[0-9a-fA-F]{64}$/;

export function BoosterMetadataSetupPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const wallet = useWalletClient();
  const switcher = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [saved, setSaved] = useState<SavedDeployment>({});
  const [implementationInput, setImplementationInput] = useState("");
  const [receiptInput, setReceiptInput] = useState("");
  const [review, setReview] = useState<MetadataReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const savedRef = useRef<SavedDeployment>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const latestWallet = useRef({ address, chainId, wallet: wallet.data });
  latestWallet.current = { address, chainId, wallet: wallet.data };
  const owner = address?.toLowerCase() === boosterSetupOwner.toLowerCase();
  const connected = Boolean(owner && chainId === 8453 && client);
  const bundle = useQuery({
    queryKey: ["booster-metadata-package", metadataUpgradePackageSha256],
    queryFn: ({ signal }) => readMetadataUpgradePackage(signal),
    staleTime: Infinity,
    retry: false
  });
  const state = useQuery({
    queryKey: [
      "booster-metadata-state",
      metadataUpgradePackageSha256,
      saved.implementation
    ],
    enabled: Boolean(connected && bundle.data),
    queryFn: () =>
      checkMetadataUpgradeState(client!, bundle.data!, saved.implementation),
    staleTime: 15000,
    retry: false
  });
  const api = useQuery({
    queryKey: ["booster-metadata-api", metadataUpgradePackageSha256],
    enabled: Boolean(connected && bundle.data),
    queryFn: () => checkMetadataAPI(bundle.data!),
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
    setReview(null);
  }, [address, chainId]);
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    if (!review) dialog.current?.close();
  }, [review]);
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
            : "The metadata setup could not finish."
      );
      setMessage("");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function assertCurrentWallet() {
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
  async function resolveSaved(kind: "deploy" | "upgrade") {
    if (!client || !bundle.data || !connected)
      throw new Error("Connect the approved owner wallet on Base.");
    const hash =
      kind === "deploy"
        ? savedRef.current.deploymentHash
        : savedRef.current.upgradeHash;
    if (!hash) return;
    const [receipt, actual] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash })
    ]);
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
      const implementation = await recoverMetadataImplementation(
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
          metadataUpgradeCalldata(bundle.data, implementation).toLowerCase() ||
        actual.value !== 0n ||
        !(await checkMetadataUpgradeState(client, bundle.data, implementation))
          .complete
      )
        throw new Error(
          "The saved upgrade receipt does not match the approved completed upgrade."
        );
      await state.refetch();
      setMessage("The metadata upgrade is already installed and configured.");
    }
  }
  async function liveCheck(
    kind: MetadataReview["kind"],
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
    const current = await checkMetadataUpgradeState(
      client,
      bundle.data,
      implementation
    );
    if (current.complete)
      throw new Error("This metadata upgrade is already complete.");
    if (kind === "upgrade") {
      if (!implementation)
        throw new Error("Verify the deployed implementation first.");
      await checkMetadataAPI(bundle.data);
    }
    return bundle.data;
  }
  function prepare(kind: MetadataReview["kind"]) {
    void run(async () => {
      setMessage("Checking the deployment, permissions and current fees…");
      const implementation =
        kind === "upgrade" ? saved.implementation : undefined;
      const b = await liveCheck(kind, implementation);
      const data =
        kind === "deploy"
          ? b.candidate.creationBytecode
          : metadataUpgradeCalldata(b, implementation!);
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
      setReview({
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
      const signingWallet = assertCurrentWallet();
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
      assertCurrentWallet();
      let hash = await signingWallet.sendTransaction({
        ...transaction,
        chain: client!.chain
      });
      remember(
        current.kind === "deploy"
          ? { deploymentHash: hash }
          : { upgradeHash: hash }
      );
      setReview(null);
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
        const implementation = await recoverMetadataImplementation(
          client!,
          b,
          receipt.transactionHash
        );
        remember({ implementation });
        setImplementationInput(implementation);
        setReceiptInput(receipt.transactionHash);
        setMessage(
          "Implementation deployed and verified. Review the separate atomic upgrade when the metadata API is ready."
        );
      } else {
        const actual = await client!.getTransaction({
          hash: receipt.transactionHash
        });
        if (
          actual.from.toLowerCase() !== b.owner.toLowerCase() ||
          actual.to?.toLowerCase() !== b.proxy.toLowerCase() ||
          actual.value !== 0n ||
          actual.input.toLowerCase() !== current.data.toLowerCase()
        )
          throw new Error(
            "The confirmed transaction differs from the reviewed atomic upgrade."
          );
        const result = await checkMetadataUpgradeState(
          client!,
          b,
          current.implementation
        );
        if (!result.complete)
          throw new Error(
            "The receipt succeeded but the metadata upgrade is not installed."
          );
        setMessage(
          "The metadata implementation and per-NFT URL are verified on Base."
        );
      }
      await Promise.all([state.refetch(), api.refetch()]);
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
        implementation = await recoverMetadataImplementation(
          client,
          bundle.data,
          receiptInput as Hex
        );
      } else {
        if (!isAddress(implementationInput))
          throw new Error("Enter a valid implementation address.");
        implementation = getAddress(implementationInput);
      }
      const current = await checkMetadataUpgradeState(
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
          ? "The metadata upgrade is already installed and configured."
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
      <h1 className="mt-6 font-display text-3xl">Owner metadata upgrade</h1>
      <p className="mt-3 text-muted">
        Give each monster its own birth timestamp and birth day while keeping
        the shared variant artwork.
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
          Metadata upgrade complete. The implementation and token #1 URL match
          the approved package.
        </p>
      )}
      {bundle.data && (
        <>
          <section className="mt-7 space-y-4 rounded-card border border-line p-6">
            <h2 className="text-xl font-bold">1. Deploy the implementation</h2>
            <p className="text-sm text-muted">
              This creates the approved contract. The collection is updated in
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
                <dd>{metadataUpgradePackageSha256}</dd>
              </div>
            </dl>
            <a
              href={metadataUpgradePackagePath}
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
              htmlFor="metadata-deploy-receipt"
            >
              Deployment transaction hash
            </label>
            <input
              id="metadata-deploy-receipt"
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
              htmlFor="metadata-implementation"
            >
              Deployed implementation address
            </label>
            <input
              id="metadata-implementation"
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
            <h2 className="text-xl font-bold">
              2. Upgrade and configure metadata
            </h2>
            <p className="text-sm text-muted">
              One atomic transaction installs the verified implementation and
              sets the approved per-NFT metadata URL. Existing token ownership,
              provenance and pack rules are preserved.
            </p>
            <dl className="space-y-3 break-all text-sm">
              <div>
                <dt className="font-bold">Collection proxy</dt>
                <dd>{bundle.data.proxy}</dd>
              </div>
              <div>
                <dt className="font-bold">Current approved implementation</dt>
                <dd>{bundle.data.currentImplementation.address}</dd>
              </div>
              <div>
                <dt className="font-bold">Metadata URL</dt>
                <dd>{bundle.data.metadataBaseURI}</dd>
              </div>
            </dl>
            <p role="status" className="text-sm">
              {api.data
                ? "Token #1 birth metadata is verified and ready."
                : api.isFetching
                  ? "Checking token #1 metadata…"
                  : (api.error?.message ??
                    "Metadata API verification is required before upgrading.")}
            </p>
            <button
              type="button"
              className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
              disabled={!connected || busy || api.isFetching || Boolean(review)}
              onClick={() => {
                void api.refetch();
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
                  !saved.implementation ||
                  !api.data ||
                  Boolean(api.error)
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
        aria-labelledby="metadata-review-title"
        className="w-full max-w-xl rounded-card bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setReview(null);
        }}
      >
        <h2 id="metadata-review-title" className="text-xl font-bold">
          {review?.kind === "deploy"
            ? "Review implementation deployment"
            : "Review atomic metadata upgrade"}
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
                onClick={() => setReview(null)}
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

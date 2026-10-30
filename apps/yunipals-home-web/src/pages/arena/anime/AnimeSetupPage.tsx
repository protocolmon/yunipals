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
import { BaseError, formatEther, type Hex } from "viem";
import { base } from "viem/chains";
import { estimateL1Fee } from "viem/op-stack";

import {
  animeDeploymentPackageSha256,
  animeLaunchAction,
  animeLaunchSteps,
  readAnimeDeploymentPackage,
  readAnimeLaunch,
  type AnimeLaunchReceipts,
  type AnimeLaunchStep
} from "@/lib/animeDeployment";
import { cn } from "@/lib/utils";
import { Select, SelectItem } from "@/components/ui/select";

const labels = { registry: "Deploy fighter registry", arena: "Deploy arena" };
const button =
  "inline-flex items-center justify-center rounded-full bg-grape px-5 py-3 font-bold text-white transition hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-50";
const validHash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
type Review = {
  step: AnimeLaunchStep;
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  fee: bigint;
  owner: string;
  expires: number;
};

export function AnimeSetupPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: base.id });
  const wallet = useWalletClient();
  const switcher = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [hashes, setHashes] = useState<AnimeLaunchReceipts>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [restore, setRestore] = useState("");
  const [restoreStep, setRestoreStep] = useState<AnimeLaunchStep>("registry");
  const working = useRef(false);
  const latest = useRef({ address, chainId, wallet: wallet.data });
  latest.current = { address, chainId, wallet: wallet.data };
  const storage = address
    ? `yunipals/anime-launch/${animeDeploymentPackageSha256}/${address.toLowerCase()}`
    : null;
  const [loadedStorage, setLoadedStorage] = useState<string | null>(null);
  const bundle = useQuery({
    queryKey: ["anime-deployment-package", animeDeploymentPackageSha256],
    queryFn: ({ signal }) => readAnimeDeploymentPackage(signal),
    staleTime: Infinity,
    retry: false
  });
  const state = useQuery({
    queryKey: [
      "anime-deployment",
      animeDeploymentPackageSha256,
      address,
      hashes
    ],
    enabled: Boolean(
      address &&
        chainId === base.id &&
        client &&
        bundle.data &&
        loadedStorage === storage
    ),
    queryFn: () => readAnimeLaunch(client!, bundle.data!, address!, hashes),
    retry: false,
    staleTime: 10000,
    refetchInterval: (query) => (query.state.data?.pending ? 10000 : false)
  });
  useEffect(() => {
    setReview(null);
    setError(null);
    setMessage("");
    setRestore("");
    setRestoreStep("registry");
    let saved: AnimeLaunchReceipts = {};
    try {
      const text = storage ? localStorage.getItem(storage) : null;
      if (text && text.length < 1000) {
        const value = JSON.parse(text) as Record<string, unknown>;
        saved = Object.fromEntries(
          animeLaunchSteps
            .filter((s) => validHash(value[s]))
            .map((s) => [s, value[s]])
        );
      }
    } catch {
      /* Recovery from an actual transaction hash remains available. */
    }
    setHashes(saved);
    setLoadedStorage(storage);
  }, [storage]);
  useEffect(() => {
    setReview(null);
  }, [chainId, wallet.data]);
  useEffect(() => {
    if (state.data?.verified.registry) setRestoreStep("arena");
  }, [state.data?.verified.registry?.transactionHash]);
  function remember(value: AnimeLaunchReceipts, owner = address) {
    if (!owner) return;
    const key = `yunipals/anime-launch/${animeDeploymentPackageSha256}/${owner.toLowerCase()}`;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* The transaction link remains visible. */
    }
    if (latest.current.address?.toLowerCase() === owner.toLowerCase())
      setHashes(value);
  }
  function assertWallet(owner: string) {
    if (
      latest.current.address?.toLowerCase() !== owner.toLowerCase() ||
      latest.current.chainId !== base.id ||
      latest.current.wallet?.account.address.toLowerCase() !==
        owner.toLowerCase()
    )
      throw Error(
        "Reconnect the wallet and Base network used for this deployment."
      );
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setReview(null);
      setError(
        cause instanceof BaseError
          ? cause.shortMessage
          : cause instanceof Error
            ? cause.message
            : "The deployment could not be verified. Retain the transaction hash before retrying."
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function prepare() {
    void run(async () => {
      if (!address || !client || !bundle.data || !wallet.data)
        throw Error("Connect your wallet on Base first.");
      const owner = address;
      assertWallet(owner);
      setMessage("Checking confirmed transactions and current network fees…");
      const fresh = await readAnimeLaunch(client, bundle.data, owner, hashes);
      if (!fresh.next)
        throw Error(
          "Wait for the saved transaction or restore its actual receipt."
        );
      const action = await animeLaunchAction(
        bundle.data,
        fresh.next,
        owner,
        fresh.verified.registry?.address
      );
      const gas =
        ((await client.estimateGas({
          account: owner,
          data: action.data,
          value: 0n
        })) *
          120n) /
        100n;
      const fees = await client.estimateFeesPerGas();
      const maxFeePerGas = fees.maxFeePerGas,
        maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
      const l1 = await estimateL1Fee(client, {
        account: owner,
        data: action.data
      });
      const fee = gas * maxFeePerGas + l1;
      if ((await client.getBalance({ address: owner })) < fee)
        throw Error("This wallet needs more ETH on Base for the network fee.");
      assertWallet(owner);
      setReview({
        step: fresh.next,
        data: action.data,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        fee,
        owner,
        expires: Date.now() + 120000
      });
      setMessage("");
    });
  }
  function sign() {
    void run(async () => {
      if (
        !review ||
        !client ||
        !bundle.data ||
        !address ||
        Date.now() > review.expires
      )
        throw Error("Refresh the network fee review before signing.");
      const selected = review,
        owner = address;
      assertWallet(selected.owner);
      const fresh = await readAnimeLaunch(client, bundle.data, owner, hashes);
      if (fresh.next !== selected.step)
        throw Error("This step has changed. Refresh its confirmed state.");
      const action = await animeLaunchAction(
        bundle.data,
        selected.step,
        owner,
        fresh.verified.registry?.address
      );
      if (action.data !== selected.data)
        throw Error("Deployment data changed. Review this step again.");
      assertWallet(selected.owner);
      let hash = await latest.current.wallet!.sendTransaction({
        account: owner,
        chain: base,
        data: selected.data,
        value: 0n,
        gas: selected.gas,
        maxFeePerGas: selected.maxFeePerGas,
        maxPriorityFeePerGas: selected.maxPriorityFeePerGas
      });
      remember({ ...hashes, [selected.step]: hash }, owner);
      setReview(null);
      setMessage(
        "Waiting for confirmation on Base. Your transaction hash is saved."
      );
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        onReplaced: (replacement) => {
          hash = replacement.transaction.hash;
          remember({ ...hashes, [selected.step]: hash }, owner);
        }
      });
      const next = { ...hashes, [selected.step]: receipt.transactionHash };
      remember(next, owner);
      await readAnimeLaunch(client, bundle.data, owner, next);
      if (latest.current.address?.toLowerCase() === owner.toLowerCase())
        setMessage("Confirmed deployment and closed initial state verified.");
      await state.refetch();
    });
  }
  function recover() {
    void run(async () => {
      if (!validHash(restore) || !address || !client || !bundle.data)
        throw Error("Enter the actual Base deployment transaction hash.");
      const step = restoreStep;
      const next = { ...hashes, [step]: restore };
      const result = await readAnimeLaunch(client, bundle.data, address, next);
      if (!result.verified[step])
        throw Error(
          "The transaction is not a successful confirmed deployment for this step."
        );
      assertWallet(address);
      remember(next);
      setRestore("");
      setReview(null);
    });
  }
  const problem = error ?? bundle.error?.message ?? state.error?.message;
  const complete = state.data?.verified.arena && state.data.verified.registry;
  const record =
    complete && address
      ? JSON.stringify(
          {
            version: "anime-browser-deployment/confirmed-v1",
            chainId: base.id,
            admin: address,
            packageSha256: animeDeploymentPackageSha256,
            deployments: state.data!.verified
          },
          null,
          2
        )
      : "";
  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-12 text-ink">
      <Link
        to="/arena/anime"
        className="font-semibold text-grape hover:underline"
      >
        Anime Arena
      </Link>
      <h1 className="mt-5 font-display text-4xl">Set up Anime Arena</h1>
      <p className="mt-4 text-muted">
        Deploy the fighter registry and arena on Base using your wallet. Your
        wallet becomes the admin, curator and operations beneficiary. Both
        contracts start closed while we prepare the controlled pilot.
      </p>
      <div className="my-6 rounded-card border border-line bg-panel-base p-5">
        <p className="font-bold">1 USDC entry · four fighters</p>
        <p className="mt-2 text-muted">
          Champion 3.20 USDC · island owner 0.20 USDC · operations 0.60 USDC.
          One shared anime background. You pay the deployment network fees shown
          by your wallet.
        </p>
        {address && (
          <p className="mt-3 break-all text-sm">Admin and curator: {address}</p>
        )}
      </div>
      {!address ? (
        <button className={button} onClick={openConnectModal}>
          Connect deployment wallet
        </button>
      ) : chainId !== base.id ? (
        <button
          className={button}
          onClick={() => switcher.switchChain({ chainId: base.id })}
        >
          Switch to Base
        </button>
      ) : null}
      <ol className="my-6 space-y-4">
        {animeLaunchSteps.map((step, i) => (
          <li key={step} className="rounded-card border border-line p-5">
            <h2 className="text-xl font-bold">
              {i + 1}. {labels[step]}
            </h2>
            <p className="mt-2 text-muted">
              {state.data?.verified[step]
                ? "Deployed and verified."
                : hashes[step]
                  ? "Transaction saved. Checking its receipt."
                  : step === "registry"
                    ? "Applications start closed."
                    : "Paid entry starts paused."}
            </p>
            {state.data?.verified[step] && (
              <p className="mt-3 break-all text-sm">
                {state.data.verified[step]!.address}
              </p>
            )}
            {hashes[step] && (
              <a
                className="mt-3 block break-all font-semibold text-grape underline"
                href={`https://basescan.org/tx/${hashes[step]}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            )}
          </li>
        ))}
      </ol>
      {!complete && (
        <button
          className={button}
          disabled={
            busy ||
            !state.data?.next ||
            state.isFetching ||
            Boolean(problem) ||
            chainId !== base.id ||
            !wallet.data
          }
          onClick={prepare}
        >
          {busy
            ? "Checking…"
            : state.data?.next
              ? `Review: ${labels[state.data.next].toLowerCase()}`
              : "Waiting for deployment state"}
        </button>
      )}
      {review && (
        <section
          className="mt-5 rounded-card border border-grape bg-lavender/20 p-5"
          aria-label="Review deployment transaction"
        >
          <h2 className="text-xl font-bold">{labels[review.step]}</h2>
          <p className="mt-3 text-muted">
            Estimated network fee, including Base data fees:{" "}
            {formatEther(review.fee)} ETH. The contract receives 0 ETH. Review
            the fee in your wallet before confirming.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={sign}>
              Confirm in wallet
            </button>
            <button
              className={cn(button, "bg-ink")}
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {problem && (
        <p role="alert" className="mt-5 break-words text-destructive">
          {problem}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 text-muted">
          {message}
        </p>
      )}
      {state.data?.failed && (
        <button
          className={cn(button, "mt-5")}
          disabled={busy}
          onClick={() => {
            const next = { ...hashes };
            delete next[state.data!.failed!];
            remember(next);
            setError(null);
          }}
        >
          Clear reverted transaction
        </button>
      )}
      {complete ? (
        <section className="mt-6 rounded-card border border-line p-5">
          <h2 className="text-xl font-bold">Deployment complete</h2>
          <p className="mt-3 text-muted">
            Both contracts are verified and remain closed. Copy this record back
            to the deployment chat so we can configure the services and run the
            paid pilot.
          </p>
          <button
            className={cn(button, "mt-4")}
            onClick={() =>
              void navigator.clipboard.writeText(record).then(
                () => setMessage("Deployment record copied."),
                () => setError("Copy the deployment record below.")
              )
            }
          >
            Copy deployment record
          </button>
          <details className="mt-4">
            <summary className="cursor-pointer font-semibold">
              View deployment record
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs">
              {record}
            </pre>
          </details>
        </section>
      ) : (
        <section className="mt-8 rounded-card border border-line p-5">
          <h2 className="text-xl font-bold">Recover a deployment</h2>
          <p className="mt-2 text-muted">
            If you used another browser or replaced a transaction, restore its
            actual transaction hash. Restore the registry first, then the arena.
          </p>
          <label
            className="mt-4 block font-semibold"
            htmlFor="anime-deployment-step"
          >
            Contract to recover
          </label>
          <Select
            id="anime-deployment-step"
            value={restoreStep}
            onValueChange={(value) =>
              setRestoreStep(value === "arena" ? "arena" : "registry")
            }
            disabled={busy}
          >
            <SelectItem value="registry">Fighter registry</SelectItem>
            <SelectItem value="arena">Arena</SelectItem>
          </Select>
          <label
            className="mt-4 block font-semibold"
            htmlFor="anime-deployment-receipt"
          >
            Base transaction hash
          </label>
          <input
            id="anime-deployment-receipt"
            value={restore}
            onChange={(e) => setRestore(e.target.value.trim())}
            className="mt-2 w-full rounded-xl border border-line p-3 focus-visible:outline focus-visible:outline-grape"
          />
          <button
            className={cn(button, "mt-4")}
            disabled={
              busy ||
              !address ||
              chainId !== base.id ||
              !validHash(restore) ||
              !bundle.data
            }
            onClick={recover}
          >
            Verify and restore transaction
          </button>
        </section>
      )}
    </main>
  );
}

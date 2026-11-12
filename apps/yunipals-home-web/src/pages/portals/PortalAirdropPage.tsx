import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Gift, Sparkles, Upload } from "lucide-react";
import {
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import { environment } from "@/environment";
import { usePortals } from "@/hooks/usePortals";
import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { portalTransactionPending } from "@/lib/portalTransactions";
import { fetchPortalStatus, portalImage } from "@/lib/portals";
import {
  airdropBatchKey,
  airdropFenceKey,
  airdropFenceSchema,
  airdropFirstSerial,
  airdropPendingTransaction,
  parseAirdropFile,
  type AirdropFence,
  type PortalAirdrop
} from "@/lib/portalAirdrop";
import { cn } from "@/lib/utils";
import { readAirdrop } from "@/lib/portalAirdropState";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";

function readFence(plan: PortalAirdrop, index: number): AirdropFence | null {
  const text = localStorage.getItem(airdropFenceKey(plan, index));
  return text ? airdropFenceSchema.parse(JSON.parse(text)) : null;
}

export function PortalAirdropPage() {
  const [search] = useSearchParams();
  const source = search.get("manifest"),
    checksum = search.get("sha256");
  const [imported, setImported] = useState<PortalAirdrop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState("");
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [, setRevision] = useState(0);
  const [recoveryHash, setRecoveryHash] = useState("");
  const { openConnectModal } = useConnectModal();
  const switcher = useSwitchChain();
  const { tracker, transactions } = usePortalTransactions();
  const load = useQuery({
    queryKey: ["portal-airdrop-file", source, checksum],
    enabled: Boolean(source),
    retry: false,
    queryFn: async ({ signal }) => {
      if (!source || !checksum)
        throw new Error("This airdrop link is missing its file checksum.");
      const url = new URL(source, location.origin);
      const allowed = [
        location.origin,
        new URL(environment.portalApiUrl ?? "/", location.origin).origin
      ];
      if (!allowed.includes(url.origin) || url.username || url.password)
        throw new Error(
          "Load a file from the configured portal service or import the allocation JSON."
        );
      const response = await fetch(url, {
        signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok)
        throw new Error("The airdrop file could not be loaded.");
      return parseAirdropFile(await response.text(), checksum);
    }
  });
  const plan = imported ?? load.data;
  const planKey = plan ? JSON.stringify(plan) : "";
  const statusQuery = useQuery({
    queryKey: ["portals", "active"],
    queryFn: ({ signal }) => fetchPortalStatus(signal),
    refetchInterval: 5000
  });
  const status = statusQuery.data?.enabled ? statusQuery.data : null;
  const actions = usePortals(status);
  const deploymentMatches = Boolean(
    plan &&
    status &&
    plan.chainId === status.deployment.chainId &&
    plan.collection.toLowerCase() === status.deployment.collection.toLowerCase()
  );
  const progress = useQuery({
    queryKey: ["portals", "airdrop", planKey],
    enabled: Boolean(plan && deploymentMatches && actions.client),
    queryFn: () => readAirdrop(actions.client as PublicClient, plan!),
    refetchInterval: 5000,
    retry: false
  });
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  // Re-read durable intent on every chain refresh and cross-tab storage update.
  let fenceError = false;
  const fences =
    plan?.batches.map((_, i) => {
      try {
        return readFence(plan, i);
      } catch {
        fenceError = true;
        return null;
      }
    }) ?? [];
  const pending = transactions.some(portalTransactionPending);
  const correctWallet = Boolean(
    plan &&
    actions.address?.toLowerCase() === plan.admin.toLowerCase() &&
    actions.chainId === plan.chainId
  );
  const allComplete = Boolean(
    plan && progress.data?.batches.every((b) => b.complete)
  );
  const ready = Boolean(
    deploymentMatches &&
    correctWallet &&
    progress.data &&
    !progress.isError &&
    !statusQuery.isError &&
    !working &&
    !actions.busy &&
    !pending &&
    !fenceError
  );
  const recipients = new Map<string, number>();
  for (const batch of plan?.batches ?? [])
    for (const address of batch.recipients)
      recipients.set(
        address.toLowerCase(),
        (recipients.get(address.toLowerCase()) ?? 0) + 1
      );
  const total = plan?.batches.reduce((n, b) => n + b.recipients.length, 0) ?? 0;
  const delivered =
    progress.data?.batches.reduce((n, b) => n + b.delivered, 0) ?? 0;
  const saveFence = (index: number, value: AirdropFence | null) => {
    if (!plan) throw new Error("Load an allocation first.");
    const key = airdropFenceKey(plan, index);
    if (value) {
      localStorage.setItem(key, JSON.stringify(value));
      if (!localStorage.getItem(key))
        throw new Error("Enable browser storage to save airdrop progress.");
    } else localStorage.removeItem(key);
    setRevision((n) => n + 1);
  };
  async function run(task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This step could not be completed."
      );
    } finally {
      busy.current = false;
      setWorking(false);
      await progress.refetch();
    }
  }
  async function commit(index: number) {
    if (!plan || !actions.client || !ready || reviewed !== planKey) return;
    const task = async () => {
      const gas = await actions.client!.getGasPrice();
      const quote = await actions.client!.readContract({
        address: plan.collection as Address,
        abi: portalCollectionAbi,
        functionName: "quoteRandomness",
        args: [gas]
      });
      const maximum = (quote * 125n) / 100n;
      const data = encodeFunctionData({
        abi: portalCollectionAbi,
        functionName: "mintBatch",
        args: [
          BigInt(plan.kindId),
          plan.batches[index].recipients as Address[],
          maximum
        ]
      });
      let fence: AirdropFence;
      await actions.send(plan.collection as Address, data, maximum, {
        actionKey: airdropBatchKey(plan, index),
        validate: async () => {
          if (readFence(plan, index))
            throw new Error(
              "This batch already has a wallet request. Resume it below."
            );
          if (
            airdropPendingTransaction(plan, index, tracker?.getSnapshot() ?? [])
          )
            throw new Error(
              "This batch already has a submitted transaction. Wait for indexing."
            );
          const fresh = await readAirdrop(actions.client as PublicClient, plan);
          if (
            fresh.kind.allocated !== airdropFirstSerial(plan, index) - 1 ||
            !fresh.batches.slice(0, index).every((b) => b.complete)
          )
            throw new Error(
              "Wait for the previous batch to be fully delivered and indexed."
            );
          const [nonce, pendingNonce] = await Promise.all(
            ["latest", "pending"].map((blockTag) =>
              actions.client!.getTransactionCount({
                address: plan.admin as Address,
                blockTag: blockTag as "latest" | "pending"
              })
            )
          );
          if (nonce !== pendingNonce)
            throw new Error(
              "Your admin wallet already has a pending transaction. Wait for it before starting this batch."
            );
          fence = {
            version: 1,
            hash: null,
            createdAt: Date.now(),
            nonce,
            dataHash: keccak256(data)
          };
        },
        onWalletRequest: () => saveFence(index, fence),
        onWalletRejected: () => saveFence(index, null),
        onSubmitted: (hash) => saveFence(index, { ...fence, hash })
      });
    };
    if (!navigator.locks)
      throw new Error(
        "Use a browser with Web Locks support for the guided airdrop."
      );
    await navigator.locks.request(
      airdropFenceKey(plan, index),
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "This batch is already open for signing in another tab."
          );
        await task();
      }
    );
  }
  async function finish(index: number) {
    if (!plan || !ready) return;
    const fresh = await readAirdrop(actions.client as PublicClient, plan);
    const row = fresh.batches[index];
    if (!row.ready || row.complete || !row.requestId)
      throw new Error(
        "Wait for confirmed randomness and indexed delivery progress."
      );
    await actions.send(
      plan.collection as Address,
      encodeFunctionData({
        abi: portalCollectionAbi,
        functionName: "finishMint",
        args: [BigInt(row.requestId), 32]
      })
    );
  }
  async function recover(index: number) {
    if (!plan || !actions.client || !tracker || !correctWallet)
      throw new Error("Connect the prepared admin wallet first.");
    const fence = readFence(plan, index);
    const hash = fence?.hash ?? recoveryHash;
    if (!fence || !/^0x[\da-f]{64}$/i.test(hash))
      throw new Error("Enter the transaction hash from this wallet request.");
    const tx = await actions.client.getTransaction({ hash: hash as Hex });
    if (
      tx.from.toLowerCase() !== plan.admin.toLowerCase() ||
      tx.to?.toLowerCase() !== plan.collection.toLowerCase() ||
      tx.nonce !== fence.nonce ||
      keccak256(tx.input) !== fence.dataHash
    )
      throw new Error(
        "This transaction does not match the saved airdrop request."
      );
    const saved = tracker.add(hash as Hex, {
      to: plan.collection,
      data: tx.input,
      value: tx.value.toString(),
      actionKey: airdropBatchKey(plan, index),
      label: "Commit portal mint"
    });
    saveFence(index, { ...fence, hash: hash as Hex });
    await tracker.check(saved.id);
    if (
      tracker.getSnapshot().find((t) => t.id === saved.id)?.state === "failed"
    )
      saveFence(index, null);
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        to="/portals/admin"
        className="text-sm font-semibold text-grape underline"
      >
        All portal settings
      </Link>
      <header className="mt-5 grid overflow-hidden rounded-card bg-gradient-to-br from-lavender/35 via-sky/30 to-mint/30 md:grid-cols-[1fr_220px]">
        <div className="p-6 sm:p-9">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-grape">
            <Gift size={16} aria-hidden="true" /> A little magic, delivered
          </p>
          <h1 className="mt-4 font-display text-3xl sm:text-4xl">
            Portal airdrop
          </h1>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            Review the allocation, sign one step at a time, and watch your
            portals find their new homes. Progress stays here when you come
            back.
          </p>
          {plan && (
            <dl className="mt-6 flex flex-wrap gap-7">
              {[
                [total, "Portal cards"],
                [recipients.size, "Wallets"],
                [plan.batches.length, "Batches"]
              ].map(([value, label]) => (
                <div key={label}>
                  <dd className="font-display text-3xl">{value}</dd>
                  <dt className="mt-1 text-sm text-muted">{label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
        <img
          src={
            progress.data
              ? portalImage(progress.data.kind.definition.imageURI)
              : "/images/portals/rainbow-portal-card.webp"
          }
          alt={
            progress.data?.kind.definition.name ?? "Rainbow Portal card preview"
          }
          width={1024}
          height={1536}
          className="mx-auto mb-6 w-36 self-center rounded-2xl shadow-card md:mb-0 md:w-40"
        />
      </header>
      {!plan && (
        <section className="mt-6 rounded-card border border-line p-6">
          <h2 className="font-display text-xl">Load your prepared airdrop</h2>
          <p className="mt-3 text-sm text-muted">
            Open the prepared airdrop link, or import its allocation JSON.
            Recipient wallets are reviewed before signing.
          </p>
          {load.isFetching && (
            <p role="status" className="mt-3 animate-pulse">
              Loading the allocation…
            </p>
          )}
          <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-lavender p-5 text-sm font-bold">
            <Upload size={20} aria-hidden="true" /> Allocation JSON
            <input
              type="file"
              accept="application/json,.json"
              className="min-w-0 flex-1"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > 100_000) {
                    setError("The allocation file is too large.");
                    return;
                  }
                  void file
                    .text()
                    .then(parseAirdropFile)
                    .then((value) => {
                      setImported(value);
                      setError(null);
                    })
                    .catch(() =>
                      setError(
                        "This is not a supported airdrop allocation file."
                      )
                    );
                }
              }}
            />
          </label>
        </section>
      )}
      {plan && (
        <>
          <section className="mt-6 rounded-card border border-line p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl">
                1. Review your allocation
              </h2>
              <span className="rounded-full bg-lavender/20 px-3 py-1 text-xs font-semibold">
                {plan.title}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">
              Snapshot: {new Date(plan.snapshotAt).toLocaleString()}. Each
              recipient line receives one card; repeated wallets retain their
              full quantities.
            </p>
            <p className="mt-2 break-all text-xs text-muted">
              Chain {plan.chainId} · Portal kind {plan.kindId} · Collection{" "}
              {plan.collection}
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-bold text-grape">
                Review all {recipients.size} wallets and quantities
              </summary>
              <div className="mt-3 max-h-64 overflow-auto rounded-2xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th className="p-3">Recipient</th>
                      <th className="p-3">Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...recipients].map(([address, quantity]) => (
                      <tr key={address} className="border-t border-line">
                        <td className="break-all p-3 font-mono text-xs">
                          {address}
                        </td>
                        <td className="p-3 font-bold">{quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <label className="mt-5 flex items-start gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={reviewed === planKey}
                onChange={(event) =>
                  setReviewed(event.target.checked ? planKey : "")
                }
                className="mt-1 h-4 w-4 accent-grape"
              />
              I reviewed these recipients and quantities for this airdrop.
            </label>
            {!actions.address ? (
              <button
                onClick={() => openConnectModal?.()}
                className={cn(boosterButtonClass, "mt-5")}
              >
                Connect admin wallet
              </button>
            ) : actions.chainId !== plan.chainId ? (
              <button
                onClick={() => switcher.switchChain({ chainId: plan.chainId })}
                className={cn(boosterButtonClass, "mt-5")}
              >
                Switch network
              </button>
            ) : !correctWallet ? (
              <p className="mt-4 break-all text-sm text-grape">
                Connect the prepared admin: {plan.admin}
              </p>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-sm font-bold text-success">
                <Check size={16} aria-hidden="true" /> Admin wallet connected
              </p>
            )}
          </section>
          <section aria-labelledby="airdrop-deliveries" className="mt-8">
            <h2 id="airdrop-deliveries" className="font-display text-2xl">
              2. Send the magic
            </h2>
            <p className="mt-2 text-sm text-muted">
              Each batch needs one randomness request, then delivery in groups
              of up to 32. We wait for confirmations and indexed events before
              moving on.
            </p>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {plan.batches.map((batch, index) => {
                const row = progress.data?.batches[index];
                const fence = fences[index];
                const previousComplete = progress.data?.batches
                  .slice(0, index)
                  .every((b) => b.complete);
                const canCommit =
                  ready &&
                  reviewed === planKey &&
                  previousComplete &&
                  progress.data?.kind.allocated ===
                    airdropFirstSerial(plan, index) - 1 &&
                  !fence &&
                  !airdropPendingTransaction(plan, index, transactions);
                const label = row?.complete
                  ? "Delivered"
                  : row?.indexing
                    ? "Updating indexed progress"
                    : row?.ready
                      ? "Ready for delivery"
                      : row?.committed
                        ? "Waiting for randomness and indexing"
                        : fence
                          ? "Checking saved wallet request"
                          : previousComplete
                            ? "Ready to commit"
                            : "Finish the previous batch first";
                return (
                  <article
                    key={index}
                    className="rounded-card border border-lavender bg-white p-6 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-grape">
                          Batch {index + 1}
                        </p>
                        <h3 className="mt-2 font-display text-2xl">
                          {batch.recipients.length} portal cards
                        </h3>
                      </div>
                      {row?.complete ? (
                        <Check className="text-success" aria-label="Complete" />
                      ) : (
                        <Gift className="text-grape" aria-hidden="true" />
                      )}
                    </div>
                    <p className="mt-4 text-sm font-semibold" role="status">
                      {label}
                    </p>
                    <progress
                      value={row?.delivered ?? 0}
                      max={batch.recipients.length}
                      aria-label={`Batch ${index + 1} delivered`}
                      className="mt-3 h-2 w-full overflow-hidden rounded-full accent-grape"
                    />
                    <p className="mt-2 text-sm text-muted">
                      {row?.delivered ?? 0} / {batch.recipients.length}{" "}
                      delivered
                    </p>
                    {row?.requestId && (
                      <p className="mt-2 break-all text-xs text-muted">
                        Request #{row.requestId}
                      </p>
                    )}
                    {!row?.committed && !fence ? (
                      <button
                        disabled={!canCommit}
                        onClick={() => void run(() => commit(index))}
                        className={cn(boosterButtonClass, "mt-5 w-full")}
                      >
                        Commit batch {index + 1}
                      </button>
                    ) : !row?.complete && row?.requestId ? (
                      <button
                        disabled={!ready || !row.ready}
                        onClick={() => void run(() => finish(index))}
                        className={cn(boosterButtonClass, "mt-5 w-full")}
                      >
                        Deliver next{" "}
                        {Math.min(
                          32,
                          batch.recipients.length - (row.delivered ?? 0)
                        )}{" "}
                        cards
                      </button>
                    ) : null}
                    {fence && !row?.committed && (
                      <div className="mt-4 rounded-2xl bg-lavender/15 p-4 text-sm">
                        <p>
                          The wallet request is saved. Check it here to resume;
                          this batch stays locked against a second commitment.
                        </p>
                        {!fence.hash && (
                          <label className="mt-3 block font-semibold">
                            Transaction hash
                            <input
                              value={recoveryHash}
                              onChange={(event) =>
                                setRecoveryHash(event.target.value)
                              }
                              className="mt-2 w-full rounded-xl border border-line p-2 font-mono text-xs"
                              placeholder="0x…"
                            />
                          </label>
                        )}
                        <button
                          disabled={working || !correctWallet}
                          onClick={() => void run(() => recover(index))}
                          className="mt-3 font-bold text-grape underline"
                        >
                          Check saved transaction
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          <section className="my-8 flex flex-col gap-5 overflow-hidden rounded-card bg-ink p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sky">
                <Sparkles size={16} aria-hidden="true" /> The first adventure
              </p>
              <h2 className="mt-3 font-display text-2xl">3. Open a portal</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/75">
                {allComplete
                  ? "Every card has found its home. Request a random portal, wait for Chainlink, then open its eleven-minute window."
                  : `${delivered} of ${total} cards delivered. Finish the airdrop before opening the first portal.`}
              </p>
            </div>
            {status?.open ? (
              <Link
                to="/portals"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-ink"
              >
                Visit the open portal{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <button
                disabled={
                  !ready ||
                  !allComplete ||
                  !status?.rotationIndexed ||
                  (!status.rotation.canRequest && !status.rotation.canActivate)
                }
                onClick={() =>
                  void run(async () => {
                    await actions.rotate();
                  })
                }
                className="rounded-full bg-white px-6 py-3 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status?.rotation.canActivate
                  ? "Open the first portal"
                  : status && status.rotation.requestId !== "0"
                    ? "Waiting for Chainlink…"
                    : "Request the first portal"}
              </button>
            )}
          </section>
        </>
      )}
      {plan && status && !deploymentMatches && (
        <p
          role="alert"
          className="mt-5 rounded-card border border-lavender p-5 text-grape"
        >
          This allocation is for a different portal deployment. No signing is
          available.
        </p>
      )}
      {(error ||
        actions.error ||
        load.error ||
        progress.error ||
        statusQuery.error ||
        fenceError) && (
        <p
          role="alert"
          className="my-5 break-words rounded-card border border-lavender bg-lavender/15 p-5 text-grape"
        >
          {error ??
            actions.error ??
            load.error?.message ??
            progress.error?.message ??
            statusQuery.error?.message ??
            "Saved airdrop progress is unavailable. Enable browser storage before signing."}
        </p>
      )}
      {(working || actions.busy) && (
        <p role="status" className="my-5 font-semibold">
          {actions.busy ? actions.phase : "Checking airdrop progress…"}
        </p>
      )}
    </main>
  );
}

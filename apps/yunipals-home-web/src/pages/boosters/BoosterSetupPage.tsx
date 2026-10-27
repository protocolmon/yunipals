import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  encodeFunctionData,
  formatEther,
  parseEventLogs,
  type Hex
} from "viem";
import { estimateL1Fee } from "viem/op-stack";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";

import { environment } from "@/environment";
import { boosterAddresses, boosterQueryKey } from "@/lib/boosters";
import {
  boosterSetupOwner,
  checkPublishedBoosterSetup,
  matchesBoosterSetup,
  readBoosterSetup,
  type BoosterSetupKind
} from "@/lib/boosterSetup";
import { boosterButtonClass } from "./BoosterActionButton";

type SetupReview = {
  kind: "configure" | "activate";
  data: Hex;
  typeId: string;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  networkFee: bigint;
  expiresAt: number;
};

export function BoosterSetupPage({
  kind = "smoke"
}: {
  kind?: BoosterSetupKind;
}) {
  const standard = kind === "standard";
  const setupSha = standard
    ? environment.boosterStandardSetupSha256
    : environment.boosterSetupSha256;
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const wallet = useWalletClient();
  const switcher = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const queries = useQueryClient();
  const deployment = boosterAddresses();
  const [typeId, setTypeId] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const [review, setReview] = useState<SetupReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const owner = address?.toLowerCase() === boosterSetupOwner.toLowerCase();
  const configured = deployment !== null && /^[0-9a-f]{64}$/.test(setupSha);
  const storageKey = `yunipals/boosters/setup/v1/${setupSha}`;
  const bundle = useQuery({
    queryKey: [...boosterQueryKey, "setup", kind, setupSha],
    enabled: configured,
    queryFn: ({ signal }) =>
      readBoosterSetup(setupSha, deployment!, signal, kind),
    staleTime: Infinity,
    retry: false
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (
        typeof saved.typeId === "string" &&
        /^[1-9][0-9]{0,77}$/.test(saved.typeId)
      )
        setTypeId(saved.typeId);
      if (
        typeof saved.hash === "string" &&
        /^0x[0-9a-f]{64}$/i.test(saved.hash)
      )
        setHash(saved.hash);
    } catch {
      /* Onchain draft checks also support manual recovery below. */
    }
  }, [storageKey]);
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    if (!review) dialog.current?.close();
  }, [review]);
  const validId =
    /^[1-9][0-9]{0,77}$/.test(typeId) && BigInt(typeId) < 2n ** 256n;
  const state = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "setup-state",
      bundle.data?.configureData,
      typeId
    ],
    enabled: Boolean(bundle.data && client && (!typeId || validId)),
    queryFn: async () => {
      const b = bundle.data!;
      const [count, role] = await Promise.all([
        client!.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "typeCount"
        }),
        client!.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "CONFIG_ROLE"
        })
      ]);
      const allowed = await client!.readContract({
        address: b.registry,
        abi: packRegistryAbi,
        functionName: "hasRole",
        args: [role, boosterSetupOwner]
      });
      if (!allowed)
        throw new Error(
          "The approved wallet does not have pack configuration permission."
        );
      if (!typeId) return { count, pack: null, matches: false };
      const [pack, catalog] = await Promise.all([
        client!.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "getPack",
          args: [BigInt(typeId)]
        }),
        client!.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "getCatalog",
          args: [BigInt(typeId)]
        })
      ]);
      return { count, pack, matches: matchesBoosterSetup(b, pack, catalog) };
    },
    refetchInterval: 10000,
    retry: false
  });
  function remember(id: string, tx: Hex) {
    setTypeId(id);
    setHash(tx);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ typeId: id, hash: tx })
      );
    } catch {
      /* The confirmed type can be restored manually from its receipt. */
    }
  }
  function failure(cause: unknown) {
    setMessage("");
    setError(
      cause instanceof BaseError
        ? cause.shortMessage
        : cause instanceof Error
          ? cause.message
          : "The wallet transaction failed."
    );
    setBusy(false);
  }
  async function liveCheck(kind: SetupReview["kind"], id: string) {
    const b = bundle.data;
    if (!b || !client || !owner || chainId !== 8453)
      throw new Error("Connect the approved owner wallet on Base.");
    await checkPublishedBoosterSetup(b);
    const role = await client.readContract({
      address: b.registry,
      abi: packRegistryAbi,
      functionName: "CONFIG_ROLE"
    });
    if (
      !(await client.readContract({
        address: b.registry,
        abi: packRegistryAbi,
        functionName: "hasRole",
        args: [role, boosterSetupOwner]
      }))
    )
      throw new Error("Pack configuration permission changed.");
    if (kind === "configure") {
      const count = await client.readContract({
        address: b.registry,
        abi: packRegistryAbi,
        functionName: "typeCount"
      });
      if (count !== BigInt(b.expectedTypeCount))
        throw new Error(
          standard && count === 0n
            ? "Complete the capped mainnet smoke test before configuring the public pack."
            : "The registry changed. Restore the configured type ID below instead of creating another draft."
        );
    } else {
      const [pack, catalog] = await Promise.all([
        client.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "getPack",
          args: [BigInt(id)]
        }),
        client.readContract({
          address: b.registry,
          abi: packRegistryAbi,
          functionName: "getCatalog",
          args: [BigInt(id)]
        })
      ]);
      if (!matchesBoosterSetup(b, pack, catalog))
        throw new Error(
          "The onchain draft differs from the frozen setup package."
        );
      if (pack.active) throw new Error("This pack is already active.");
    }
    return b;
  }
  async function prepare(kind: SetupReview["kind"]) {
    setError(null);
    setMessage("Checking the frozen rules, artwork and transaction fees…");
    setBusy(true);
    try {
      const b = await liveCheck(kind, typeId);
      const data =
        kind === "configure"
          ? b.configureData
          : encodeFunctionData({
              abi: packRegistryAbi,
              functionName: "activate",
              args: [BigInt(typeId)]
            });
      const fees = await client!.estimateFeesPerGas();
      const transaction = {
        account: boosterSetupOwner,
        to: b.registry,
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
      setReview({
        kind,
        data,
        typeId,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        networkFee,
        expiresAt: Date.now() + 600000
      });
      setMessage("");
      setBusy(false);
    } catch (cause) {
      failure(cause);
    }
  }
  async function confirm() {
    const current = review;
    if (!current) return;
    setBusy(true);
    setError(null);
    let submitted = false;
    try {
      const b = await liveCheck(current.kind, current.typeId);
      if (
        !wallet.data ||
        wallet.data.account.address.toLowerCase() !==
          boosterSetupOwner.toLowerCase() ||
        wallet.data.chain.id !== 8453 ||
        Date.now() >= current.expiresAt
      )
        throw new Error(
          "The wallet or quote changed. Review this transaction again."
        );
      const transaction = {
        account: boosterSetupOwner,
        to: b.registry,
        data: current.data,
        value: 0n,
        gas: current.gas,
        maxFeePerGas: current.maxFeePerGas,
        maxPriorityFeePerGas: current.maxPriorityFeePerGas
      };
      await client!.call(transaction);
      setMessage("Confirm the transaction in your wallet…");
      let tracked = await wallet.data.sendTransaction({
        ...transaction,
        chain: client!.chain
      });
      submitted = true;
      remember(current.typeId, tracked);
      setMessage("Waiting for confirmation on Base…");
      let cancelled = false;
      const receipt = await client!.waitForTransactionReceipt({
        hash: tracked,
        confirmations: 1,
        onReplaced: ({ transaction, reason }) => {
          tracked = transaction.hash;
          cancelled = reason === "cancelled";
          remember(current.typeId, tracked);
        }
      });
      if (cancelled || receipt.status !== "success")
        throw new Error("The transaction was cancelled or reverted.");
      const actual = await client!.getTransaction({
        hash: receipt.transactionHash
      });
      if (
        actual.from.toLowerCase() !== boosterSetupOwner.toLowerCase() ||
        actual.to?.toLowerCase() !== b.registry ||
        actual.input.toLowerCase() !== current.data.toLowerCase() ||
        actual.value !== 0n
      )
        throw new Error(
          "The confirmed transaction differs from the reviewed call. Check its receipt before continuing."
        );
      if (current.kind === "configure") {
        const events = parseEventLogs({
          abi: packRegistryAbi,
          eventName: "TypeConfigured",
          logs: receipt.logs
        }).filter(
          (event) =>
            event.address.toLowerCase() === b.registry &&
            event.args.engine.toLowerCase() === b.engine &&
            event.args.catalogHash.toLowerCase() === b.catalogHash
        );
        if (events.length !== 1)
          throw new Error(
            "The receipt did not identify exactly one matching configured type."
          );
        remember(events[0].args.packTypeId.toString(), receipt.transactionHash);
        setMessage(
          `Type #${events[0].args.packTypeId} is configured. Review activation to freeze its rules.`
        );
      } else
        setMessage(
          standard
            ? `Type #${current.typeId} is active. Unlimited public pack sales are enabled.`
            : `Type #${current.typeId} is active. You can open the capped test pack.`
        );
      setReview(null);
      setBusy(false);
      await queries.invalidateQueries({ queryKey: boosterQueryKey });
    } catch (cause) {
      if (submitted) setReview(null);
      failure(cause);
    }
  }
  const active = state.data?.matches && state.data.pack?.active;
  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-4 py-12">
      <Link to="/boosters" className="text-sm font-bold underline">
        Back to packs
      </Link>
      <h1 className="mt-6 font-display text-3xl">Owner pack setup</h1>
      <p className="mt-3 break-all text-sm text-muted">
        Approved Base wallet: {boosterSetupOwner}
      </p>
      {!configured && (
        <p role="status" className="mt-6">
          The owner setup package is not published yet.
        </p>
      )}
      {configured && bundle.isPending && (
        <p role="status" className="mt-6 animate-pulse">
          Checking setup package…
        </p>
      )}
      {(bundle.error || state.error || error) && (
        <p role="alert" className="mt-5 break-words text-sm">
          {error ?? bundle.error?.message ?? state.error?.message}
        </p>
      )}
      {bundle.data && (
        <section className="mt-7 space-y-4 rounded-card border border-line bg-lavender/20 p-6">
          <h2 className="text-xl font-bold">
            {standard ? "Unlimited public pack" : "One-pack mainnet test"}
          </h2>
          <p>
            1 PROTO burned per opening · 264 variants · one daily mint · no
            speed boost.
          </p>
          <p className="text-sm text-muted">
            {standard
              ? "Supply is unlimited. Configure this pack after the capped live VRF test. Activation freezes its rules and makes packs available to everyone."
              : "Supply is capped at one opening. Configuration creates a draft; activation freezes its rules and makes that single pack purchasable."}
          </p>
          <a
            href={bundle.data.pack.manifestURI}
            target="_blank"
            rel="noreferrer"
            className="block text-sm underline"
          >
            Review published artwork manifest
          </a>
          {message && (
            <p role="status" className="font-bold">
              {message}
            </p>
          )}
          {!owner || chainId !== 8453 ? (
            <button
              type="button"
              className={boosterButtonClass}
              disabled={switcher.isPending}
              onClick={() =>
                !address
                  ? openConnectModal?.()
                  : chainId !== 8453
                    ? switcher.switchChain({ chainId: 8453 })
                    : openConnectModal?.()
              }
            >
              {!address
                ? "Connect owner wallet"
                : chainId !== 8453
                  ? "Switch to Base"
                  : "Use the approved owner wallet"}
            </button>
          ) : (
            <>
              {!typeId && (
                <button
                  type="button"
                  className={boosterButtonClass}
                  disabled={
                    busy ||
                    state.isPending ||
                    state.isError ||
                    state.data?.count !== BigInt(bundle.data.expectedTypeCount)
                  }
                  onClick={() => void prepare("configure")}
                >
                  Review configuration
                </button>
              )}
              {typeId && state.data?.matches && !active && (
                <button
                  type="button"
                  className={boosterButtonClass}
                  disabled={busy}
                  onClick={() => void prepare("activate")}
                >
                  Review activation
                </button>
              )}
              {active && (
                <p role="status" className="font-bold text-success">
                  Type #{typeId} is active.{" "}
                  <Link to="/boosters" className="underline">
                    {standard ? "View public packs" : "Open the test pack"}
                  </Link>
                </p>
              )}
              {typeId && !state.isPending && !state.data?.matches && (
                <p role="alert">
                  This type does not match the frozen setup package.
                </p>
              )}
              {!typeId &&
                state.data &&
                state.data.count !== BigInt(bundle.data.expectedTypeCount) && (
                  <p role="status">
                    {standard && state.data.count === 0n
                      ? "Complete the capped mainnet smoke test before configuring the public pack."
                      : "A type was already configured. Restore its ID below to continue."}
                  </p>
                )}
            </>
          )}
          <label className="block text-sm font-bold">
            Configured type ID (restore after a refresh)
            <input
              value={typeId}
              onChange={(event) => {
                setTypeId(event.target.value);
                setError(null);
              }}
              disabled={busy}
              inputMode="numeric"
              autoComplete="off"
              className="mt-2 block w-full rounded-full border border-line bg-white px-4 py-3 font-normal focus-visible:ring-2 focus-visible:ring-ink"
            />
          </label>
          {hash && (
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sm underline"
            >
              Last transaction: {hash}
            </a>
          )}
        </section>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="booster-setup-review-title"
        className="w-full max-w-md rounded-card bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setReview(null);
        }}
      >
        <h2 id="booster-setup-review-title" className="text-xl font-bold">
          {review?.kind === "configure"
            ? standard
              ? "Configure the unlimited public pack"
              : "Configure the capped test pack"
            : `Activate type #${review?.typeId}`}
        </h2>
        <p className="mt-4 text-sm">
          {review?.kind === "configure"
            ? "Creates a draft with the exact frozen package. It does not open a pack."
            : standard
              ? "Permanently freezes this type’s rules and enables unlimited public pack sales."
              : "Permanently freezes this type’s rules. Its supply cap permits one opening."}
        </p>
        {review && (
          <p className="mt-4 break-all text-sm">
            Estimated network fee: {formatEther(review.networkFee)} ETH. No
            PROTO or additional ETH is sent by this setup call.
          </p>
        )}
        {message && (
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            className={boosterButtonClass}
            disabled={busy}
            onClick={() => void confirm()}
          >
            Confirm in wallet
          </button>
          <button
            type="button"
            className="rounded-full border border-line px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
            disabled={busy}
            onClick={() => setReview(null)}
          >
            Close
          </button>
        </div>
      </dialog>
    </main>
  );
}

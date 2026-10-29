import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { BaseError, type Address, type Hex } from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { arenaMode } from "@protopals/yunipals-market-core/arenaProtocol";
import { environment } from "@/environment";
import { arenaRequestAt, type ArenaConfig } from "@/lib/arenaLive";
import { cn } from "@/lib/utils";

type Kind = "video" | "anime";
const button =
  "rounded-full bg-grape px-5 py-3 font-bold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-50";

export function SharedArenaControls({
  contract,
  admin,
  rulesHashes
}: {
  contract: Address;
  admin: Address;
  rulesHashes: Record<Kind, Hex>;
}) {
  const { address, chainId } = useAccount(),
    client = usePublicClient({ chainId: 8453 });
  const { writeContractAsync } = useWriteContract(),
    { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState<Hex | null>(null);
  const latest = useRef({ address, chainId });
  latest.current = { address, chainId };
  const guard = useRef(false),
    storage = `yunipals/shared-arena/control/${contract.toLowerCase()}`;
  const owner = address?.toLowerCase() === admin.toLowerCase();
  useEffect(() => {
    try {
      const hash = localStorage.getItem(storage);
      if (hash && /^0x[0-9a-f]{64}$/i.test(hash)) setPending(hash as Hex);
    } catch {
      /* Chain state remains readable. */
    }
  }, [storage]);
  async function readiness(kind: Kind, signal?: AbortSignal) {
    if (!environment.sharedArenaApiUrl)
      throw new Error("The new mode services are being prepared.");
    const url = `${environment.sharedArenaApiUrl}/${kind}`;
    const [config, health, rules] = await Promise.all([
      arenaRequestAt<ArenaConfig>(url, "/config", undefined, signal),
      arenaRequestAt<{
        ok: boolean;
        indexerMode: string;
        sourceKind: string;
        sourceEpoch: string | null;
      }>(url, "/health", undefined, signal),
      arenaRequestAt<{ rulesHash: Hex }>(url, "/rules", undefined, signal)
    ]);
    if (
      config.chainId !== 8453 ||
      config.contract.toLowerCase() !== contract.toLowerCase() ||
      config.contractVersion !== 2 ||
      config.randomnessFunding !== "first-entrant" ||
      config.mediaKind !== kind ||
      !config.entriesEnabled ||
      config.entryMode !== "pilot" ||
      !health.ok ||
      health.indexerMode !== "unified" ||
      health.sourceKind !== "unified" ||
      !health.sourceEpoch ||
      rules.rulesHash !== rulesHashes[kind]
    )
      throw new Error("This mode is not ready for its controlled pilot yet.");
    return true;
  }
  const state = useQuery({
    queryKey: ["shared-arena-controls", contract],
    enabled: !!client,
    queryFn: async () => {
      const [owner, video, anime] = await Promise.all([
        client!.readContract({
          address: contract,
          abi: arenaV2Abi,
          functionName: "owner"
        }),
        client!.readContract({
          address: contract,
          abi: arenaV2Abi,
          functionName: "entriesPaused",
          args: [0n]
        }),
        client!.readContract({
          address: contract,
          abi: arenaV2Abi,
          functionName: "entriesPaused",
          args: [1n]
        })
      ]);
      if (owner.toLowerCase() !== admin.toLowerCase())
        throw new Error(
          "The current Arena owner differs from the reviewed deployment wallet."
        );
      return { video, anime };
    },
    refetchInterval: 10000,
    retry: false
  });
  const ready = useQuery({
    queryKey: ["shared-arena-controls-readiness", contract],
    enabled: !!environment.sharedArenaApiUrl,
    queryFn: async ({ signal }) => {
      const results = await Promise.allSettled(
        (["video", "anime"] as const).map((kind) => readiness(kind, signal))
      );
      return {
        video: results[0].status === "fulfilled",
        anime: results[1].status === "fulfilled"
      };
    },
    refetchInterval: 15000,
    retry: false
  });
  async function checkPending() {
    if (!pending || !client) return;
    const receipt = await client.getTransactionReceipt({ hash: pending });
    const [block, head] = await Promise.all([
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getBlockNumber({ cacheTime: 0 })
    ]);
    if (block.hash !== receipt.blockHash || head < receipt.blockNumber + 1n)
      throw new Error("Waiting for two canonical confirmations.");
    try {
      localStorage.removeItem(storage);
    } catch {
      /* A future check can re-read the receipt. */
    }
    setPending(null);
    await state.refetch();
    if (receipt.status !== "success")
      throw new Error(
        "The owner transaction reverted. Refresh the state before retrying."
      );
  }
  async function setPause(kind: Kind, paused: boolean) {
    if (guard.current || !client || !owner) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    const assertOwner = () => {
      if (
        latest.current.chainId !== 8453 ||
        latest.current.address?.toLowerCase() !== admin.toLowerCase()
      )
        throw new Error(
          "Connect the deployment wallet on Base before signing."
        );
    };
    try {
      if (pending) {
        await checkPending();
        return;
      }
      if (chainId !== 8453) {
        await switchChainAsync({ chainId: 8453 });
        throw new Error("Base selected. Check the mode state before signing.");
      }
      if (!paused) await readiness(kind);
      assertOwner();
      const mode = arenaMode(kind);
      const [current, actualOwner] = await Promise.all([
        client.readContract({
          address: contract,
          abi: arenaV2Abi,
          functionName: "entriesPaused",
          args: [BigInt(mode)]
        }),
        client.readContract({
          address: contract,
          abi: arenaV2Abi,
          functionName: "owner"
        })
      ]);
      if (actualOwner.toLowerCase() !== admin.toLowerCase())
        throw new Error("The reviewed wallet is no longer this Arena's owner.");
      if (current === paused) {
        await state.refetch();
        return;
      }
      assertOwner();
      const hash = await writeContractAsync({
        chainId: 8453,
        account: admin,
        address: contract,
        abi: arenaV2Abi,
        functionName: "setEntriesPaused",
        args: [mode, paused]
      });
      try {
        localStorage.setItem(storage, hash);
      } catch {
        /* Keep the transaction link visible. */
      }
      setPending(hash);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 120000,
        onReplaced: ({ transaction }) => {
          setPending(transaction.hash);
          try {
            localStorage.setItem(storage, transaction.hash);
          } catch {
            /* Keep the replacement hash visible. */
          }
        }
      });
      if (receipt.status !== "success")
        throw new Error(
          "The owner transaction reverted. Check its receipt before retrying."
        );
      try {
        localStorage.removeItem(storage);
      } catch {
        /* Retained receipts are safe to check again. */
      }
      setPending(null);
      await state.refetch();
    } catch (cause) {
      setError(
        cause instanceof BaseError
          ? cause.shortMessage
          : cause instanceof Error
            ? cause.message
            : "The owner action could not be checked."
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="mt-6 space-y-4 rounded-card border border-line p-5"
      aria-label="Shared Arena owner controls"
    >
      <h2 className="text-xl font-bold">Controlled pilot</h2>
      <p className="text-sm text-muted">
        Each mode opens with its own owner transaction after its services are
        ready. Paid entry remains limited to the pilot wallet. The first entrant
        pays for the draw; no reserve deposit is needed.
      </p>
      {(["video", "anime"] as const).map((kind) => (
        <div className="flex flex-wrap items-center gap-3" key={kind}>
          <p className="font-semibold capitalize">
            {kind}:{" "}
            {state.data
              ? state.data[kind]
                ? "entries paused"
                : "entries open"
              : "checking…"}
          </p>
          {owner && (
            <button
              className={cn(button, "text-sm")}
              disabled={
                busy ||
                !!pending ||
                !state.data ||
                (state.data[kind] && !ready.data?.[kind])
              }
              onClick={() => void setPause(kind, !state.data![kind])}
            >
              {state.data?.[kind]
                ? `Enable ${kind} pilot`
                : `Pause ${kind} entries`}
            </button>
          )}
        </div>
      ))}
      {(!ready.data?.video || !ready.data?.anime) && (
        <p className="text-sm text-muted">
          Mode services are still being prepared or checked. Enabling a mode
          becomes available after its verified service reports readiness.
        </p>
      )}
      {state.error && <p role="alert">{state.error.message}</p>}
      {pending && (
        <div className="space-y-3">
          <a
            className="break-all underline"
            href={`https://basescan.org/tx/${pending}`}
            target="_blank"
            rel="noreferrer"
          >
            View owner transaction
          </a>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void checkPending()
                .catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Receipt unavailable."
                  )
                )
                .finally(() => setBusy(false));
            }}
          >
            Check owner transaction
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

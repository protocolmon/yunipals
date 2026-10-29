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
  encodeFunctionData,
  formatEther,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import { animeArenaAbi } from "@protopals/yunipals-market-core/animeArenaAbi";
import {
  animePilot,
  animePilotDrawBlocker,
  readAnimePilotState,
  verifyPilotManifest,
  pilotOwnsFighters
} from "@/lib/animePilot";
import { arenaRequestAt, type ArenaConfig } from "@/lib/arenaLive";
import { environment } from "@/environment";
import { cn } from "@/lib/utils";

type Action =
  | "open"
  | "close"
  | "approve"
  | "fund"
  | "enable"
  | "pause"
  | `apply:${string}`;
const button =
  "rounded-full bg-grape px-5 py-3 font-bold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-50";
const statuses = [
  "Awaiting application",
  "Applied",
  "Approved",
  "Rejected",
  "Revoked"
];
export function AnimePilotPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: base.id });
  const wallet = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState<Hex | null>(null);
  const working = useRef(false);
  const latest = useRef({ address, chainId, wallet: wallet.data });
  latest.current = { address, chainId, wallet: wallet.data };
  const storage = address
    ? `yunipals/anime-pilot/${animePilot.arena}/${address.toLowerCase()}`
    : null;
  useEffect(() => {
    setError(null);
    setMessage("");
    setPending(null);
    if (storage) {
      try {
        const saved = localStorage.getItem(storage);
        if (saved && /^0x[0-9a-f]{64}$/i.test(saved)) setPending(saved as Hex);
      } catch {
        /* Transaction links remain available. */
      }
    }
  }, [storage]);
  const state = useQuery({
    queryKey: ["anime-pilot-state"],
    enabled: !!client,
    queryFn: () => readAnimePilotState(client!),
    refetchInterval: 15000,
    retry: false
  });
  const config = useQuery({
    queryKey: ["anime-pilot-api"],
    enabled: !!environment.animeArenaApiUrl,
    queryFn: ({ signal }) =>
      arenaRequestAt<ArenaConfig>(
        environment.animeArenaApiUrl,
        "/config",
        undefined,
        signal
      ),
    retry: false
  });
  const admin = address?.toLowerCase() === animePilot.admin.toLowerCase();
  const holder = address?.toLowerCase() === animePilot.wallet;
  const data = state.data;
  const drawBlocker = data ? animePilotDrawBlocker(data) : null;
  const approved =
    !!data && data.fighters.every((fighter) => fighter.status === 2);
  const pilotReady =
    config.data?.entryMode === "pilot" &&
    config.data.entriesEnabled &&
    config.data.contract.toLowerCase() === animePilot.arena &&
    config.data.eligibilityRegistry?.toLowerCase() === animePilot.registry;
  function remember(hash: Hex | null, key: string) {
    try {
      if (hash) localStorage.setItem(key, hash);
      else localStorage.removeItem(key);
    } catch {
      /* Keep the receipt link visible. */
    }
    if (
      key ===
      `yunipals/anime-pilot/${animePilot.arena}/${latest.current.address?.toLowerCase()}`
    )
      setPending(hash);
  }
  function assertWallet(owner: Address) {
    if (
      latest.current.chainId !== base.id ||
      latest.current.address?.toLowerCase() !== owner.toLowerCase() ||
      latest.current.wallet?.account.address.toLowerCase() !==
        owner.toLowerCase()
    )
      throw Error("Reconnect the same wallet on Base before continuing.");
  }
  async function run(action?: Action) {
    if (working.current || !client || !address || !wallet.data || !storage)
      return;
    working.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    const owner = address,
      key = storage;
    try {
      if (chainId !== base.id) {
        await switchChainAsync({ chainId: base.id });
        throw Error("Base selected. Press the action again to review it.");
      }
      assertWallet(owner);
      if (pending) {
        const receipt = await client.waitForTransactionReceipt({
          hash: pending,
          confirmations: 2,
          timeout: 45000,
          onReplaced: ({ transaction }) => remember(transaction.hash, key)
        });
        remember(null, key);
        if (receipt.status !== "success")
          throw Error(
            "The transaction failed. Review its receipt before retrying."
          );
        setMessage("Transaction confirmed.");
        await state.refetch();
        return;
      }
      if (!action) return;
      const fresh = await readAnimePilotState(client);
      const isAdmin = owner.toLowerCase() === animePilot.admin.toLowerCase();
      let to: Address = animePilot.registry,
        input: Hex = "0x",
        value = 0n;
      if (action.startsWith("apply:")) {
        const tokenId = action.slice(6);
        if (
          owner.toLowerCase() !== animePilot.wallet ||
          !pilotOwnsFighters(fresh, owner) ||
          !animePilot.fighters.some((fighter) => fighter.tokenId === tokenId) ||
          !fresh.applicationsOpen
        )
          throw Error("Connect the pilot wallet while applications are open.");
        input = encodeFunctionData({
          abi: animeRegistryAbi,
          functionName: "applyForArena",
          args: [BigInt(tokenId)]
        });
      } else {
        if (!isAdmin)
          throw Error("Connect the deployment wallet for owner actions.");
        if (action === "open" || action === "close")
          input = encodeFunctionData({
            abi: animeRegistryAbi,
            functionName: "setApplicationsOpen",
            args: [action === "open"]
          });
        if (action === "approve") {
          if (
            !fresh.fighters.every(
              (fighter) => fighter.status === 1 || fighter.status === 4
            )
          )
            throw Error("All four fighters must apply before batch approval.");
          const hashes: Hex[] = [];
          for (const fighter of animePilot.fighters) {
            const expected: string | null = fighter.manifestHash;
            if (!expected)
              throw Error(
                "The four reviewed artwork hashes are not ready yet."
              );
            await verifyPilotManifest(fighter.tokenId, expected);
            hashes.push(expected as Hex);
          }
          input = encodeFunctionData({
            abi: animeRegistryAbi,
            functionName: "approve",
            args: [
              animePilot.fighters.map((fighter) => BigInt(fighter.tokenId)),
              hashes,
              2
            ]
          });
        }
        if (action === "fund") {
          to = animePilot.arena;
          value =
            fresh.balance < animePilot.reserveWei
              ? animePilot.reserveWei - fresh.balance
              : 0n;
          if (!value) throw Error("The pilot island draw is already funded.");
        }
        if (action === "enable" || action === "pause") {
          if (action === "enable") {
            const freshDrawBlocker = animePilotDrawBlocker(fresh);
            if (freshDrawBlocker) throw Error(freshDrawBlocker);
            const api = await arenaRequestAt<ArenaConfig>(
              environment.animeArenaApiUrl,
              "/config"
            );
            if (
              api.entryMode !== "pilot" ||
              !api.entriesEnabled ||
              api.contract.toLowerCase() !== animePilot.arena ||
              api.eligibilityRegistry?.toLowerCase() !== animePilot.registry ||
              !fresh.fighters.every((fighter) => fighter.status === 2)
            )
              throw Error(
                "Finish artwork approval, fund the draw and wait for pilot services before enabling entry."
              );
          }
          to = animePilot.arena;
          input = encodeFunctionData({
            abi: animeArenaAbi,
            functionName: "setEntriesPaused",
            args: [action === "pause"]
          });
        }
      }
      await client.call({ account: owner, to, data: input, value });
      assertWallet(owner);
      const hash = await wallet.data.sendTransaction({
        account: owner,
        chain: base,
        to,
        data: input,
        value
      });
      remember(hash, key);
      setMessage("Transaction sent. Waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 90000,
        onReplaced: ({ transaction }) => remember(transaction.hash, key)
      });
      remember(null, key);
      if (receipt.status !== "success")
        throw Error("The transaction did not succeed. Review its receipt.");
      setMessage("Transaction confirmed.");
      await state.refetch();
    } catch (cause) {
      setError(
        cause instanceof BaseError
          ? cause.shortMessage
          : cause instanceof Error
            ? cause.message
            : "The pilot action could not be completed."
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || !!pending || !data;
  return (
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-12 text-ink">
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Anime Arena
      </p>
      <h1 className="mt-3 font-display text-4xl">Controlled paid pilot</h1>
      <p className="mt-4 text-muted">
        Four Base Yunipals, one island drawing and one film. Entry is 1 USDC per
        fighter. Wallets keep their NFTs.
      </p>
      <p className="mt-3 break-all text-sm">
        Deployment wallet: {animePilot.admin}
        <br />
        Pilot wallet: {animePilot.wallet}
      </p>
      {!address && (
        <button className={cn(button, "mt-5")} onClick={openConnectModal}>
          Connect wallet
        </button>
      )}
      {address && !admin && !holder && (
        <p className="mt-5">
          Connect the deployment wallet for owner controls, or the pilot wallet
          to apply and enter.
        </p>
      )}
      {state.isPending ? (
        <p className="mt-6 animate-pulse">Checking the deployed arena…</p>
      ) : state.error ? (
        <p className="mt-6 text-destructive" role="alert">
          {state.error.message}
        </p>
      ) : (
        data && (
          <>
            <p className="mt-6">
              Applications: {data.applicationsOpen ? "open" : "closed"} · Paid
              entry: {data.paused ? "paused" : "enabled for the pilot"}
            </p>
            <p className="mt-2 text-sm text-muted">
              Island draw reserve: {formatEther(data.balance)} ETH. Buffered
              draw quote:{" "}
              {data.vrfPrice === null
                ? "unavailable"
                : `${formatEther(data.vrfPrice)} ETH`}
              . Fixed draw cap: {formatEther(data.vrfMax)} ETH.
            </p>
            {drawBlocker && (
              <p
                className="mt-4 rounded-card border border-line bg-lavender/10 p-4 text-sm"
                role="status"
              >
                {drawBlocker}
              </p>
            )}
            {admin && (
              <section
                className="mt-6 space-y-4 rounded-card border border-line p-5"
                aria-label="Pilot owner controls"
              >
                <h2 className="text-xl font-bold">
                  Deployment wallet controls
                </h2>
                <p className="text-sm">
                  Open applications, then switch to the pilot wallet and apply
                  for all four fighters. Switch back to approve the reviewed
                  artwork. Applications may stay open while paid entry is
                  limited to the pilot wallet.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    className={button}
                    disabled={disabled}
                    onClick={() =>
                      void run(data.applicationsOpen ? "close" : "open")
                    }
                  >
                    {data.applicationsOpen
                      ? "Close applications"
                      : "Open applications"}
                  </button>
                  <button
                    className={button}
                    disabled={
                      disabled ||
                      approved ||
                      !animePilot.fighters.every(
                        (fighter) => fighter.manifestHash
                      ) ||
                      !data.fighters.every(
                        (fighter) =>
                          fighter.status === 1 || fighter.status === 4
                      )
                    }
                    onClick={() => void run("approve")}
                  >
                    Approve four reviewed fighters
                  </button>
                  <button
                    className={button}
                    disabled={disabled || data.balance >= animePilot.reserveWei}
                    onClick={() => void run("fund")}
                  >
                    Fund draw reserve · up to{" "}
                    {formatEther(animePilot.reserveWei)} ETH
                  </button>
                  <button
                    className={button}
                    disabled={
                      disabled ||
                      (data.paused &&
                        (!approved || !!drawBlocker || !pilotReady))
                    }
                    onClick={() => void run(data.paused ? "enable" : "pause")}
                  >
                    {data.paused
                      ? "Enable controlled paid pilot"
                      : "Pause paid entry"}
                  </button>
                </div>
                {!pilotReady && (
                  <p className="text-sm text-muted">
                    Paid entry stays paused until the pilot services and
                    reviewed fighters are ready.
                  </p>
                )}
              </section>
            )}
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {data.fighters.map((fighter) => (
                <li
                  key={fighter.tokenId}
                  className="rounded-card border border-line p-5"
                >
                  <h2 className="font-bold">{fighter.name}</h2>
                  <p className="mt-1 text-sm">
                    #{fighter.tokenId} · {statuses[fighter.status] ?? "Unknown"}
                  </p>
                  <Link
                    className="mt-3 inline-block underline"
                    to={`/collection/base/${fighter.tokenId}`}
                  >
                    View Yunipal
                  </Link>
                  {holder && (fighter.status === 0 || fighter.status === 3) && (
                    <button
                      className={cn(button, "mt-3 block")}
                      disabled={disabled || !data.applicationsOpen}
                      onClick={() => void run(`apply:${fighter.tokenId}`)}
                    >
                      Apply for this fighter
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )
      )}
      {pending && (
        <div className="mt-6 space-y-3">
          <a
            className="break-all underline"
            href={`https://basescan.org/tx/${pending}`}
            target="_blank"
            rel="noreferrer"
          >
            View pending transaction
          </a>
          <button className={button} disabled={busy} onClick={() => void run()}>
            Check confirmation
          </button>
        </div>
      )}
      <p className="mt-4" role="status">
        {message}
      </p>
      {error && (
        <p className="mt-3 text-destructive" role="alert">
          {error}
        </p>
      )}
      {approved && (
        <Link
          className="mt-6 inline-block font-bold underline"
          to="/arena/anime"
        >
          Go to the Anime Arena
        </Link>
      )}
    </main>
  );
}

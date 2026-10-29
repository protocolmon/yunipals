import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { BaseError, formatEther, type Hex } from "viem";
import { base } from "viem/chains";
import { Link } from "react-router-dom";
import { sharedArenaConfirmedHash } from "@/lib/sharedArenaLiveDeployment";
import { SharedArenaControls } from "./SharedArenaControls";
import {
  readSharedArenaDeploymentPackage,
  readSharedArenaDeployment,
  sharedArenaCreation,
  sharedArenaDeploymentSha256
} from "@/lib/sharedArenaDeployment";

const button =
  "rounded-full bg-grape px-5 py-3 font-bold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-50";
const validHash = (v: string): v is Hex => /^0x[0-9a-f]{64}$/i.test(v);
type Review = {
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  expires: number;
  owner: string;
};

export function SharedArenaSetupPage() {
  const queries = useQueryClient();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const wallet = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [hash, setHash] = useState<Hex | null>(null),
    [restored, setRestored] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const lock = useRef(false),
    latest = useRef({ address, chainId, wallet: wallet.data });
  latest.current = { address, chainId, wallet: wallet.data };
  const storage = address
    ? `yunipals/shared-arena/${sharedArenaDeploymentSha256}/${address.toLowerCase()}`
    : null;
  const [loadedStorage, setLoadedStorage] = useState<string | null>(null);
  useEffect(() => {
    setReview(null);
    setError(null);
    setMessage("");
    setHash(null);
    setRestored("");
    try {
      const saved = storage ? localStorage.getItem(storage) : null;
      if (saved && validHash(saved)) setHash(saved);
      else if (sharedArenaConfirmedHash) setHash(sharedArenaConfirmedHash);
    } catch {
      /* Receipt recovery is also available below. */
      setHash(sharedArenaConfirmedHash);
    }
    setLoadedStorage(storage);
  }, [storage, chainId]);
  const bundle = useQuery({
    queryKey: ["shared-arena-package", sharedArenaDeploymentSha256],
    queryFn: ({ signal }) => readSharedArenaDeploymentPackage(signal),
    staleTime: Infinity,
    retry: false
  });
  const result = useQuery({
    queryKey: ["shared-arena-deployment", hash, sharedArenaDeploymentSha256],
    queryFn: () => readSharedArenaDeployment(client!, bundle.data!, hash!),
    enabled:
      !!client &&
      !!bundle.data &&
      !!hash &&
      chainId === 8453 &&
      loadedStorage === storage,
    retry: false,
    refetchInterval: hash ? 10000 : false
  });
  const isOwner =
    !!address && address.toLowerCase() === bundle.data?.admin.toLowerCase();
  function assertWallet() {
    const now = latest.current;
    if (
      now.chainId !== 8453 ||
      now.address?.toLowerCase() !== bundle.data?.admin.toLowerCase() ||
      now.wallet?.account.address.toLowerCase() !==
        bundle.data?.admin.toLowerCase()
    )
      throw new Error(
        "Connect the reviewed deployment wallet on Base before continuing."
      );
  }
  function remember(next: Hex) {
    if (storage)
      try {
        localStorage.setItem(storage, next);
      } catch {
        /* Keep the hash visible. */
      }
    if (
      latest.current.address?.toLowerCase() === address?.toLowerCase() &&
      latest.current.chainId === 8453
    )
      setHash(next);
  }
  async function clearReverted() {
    if (!client || !hash || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      assertWallet();
      const receipt = await client.getTransactionReceipt({ hash });
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (
        receipt.status !== "reverted" ||
        block.hash !== receipt.blockHash ||
        (await client.getBlockNumber({ cacheTime: 0 })) <
          receipt.blockNumber + 1n
      )
        throw new Error(
          "Only a confirmed, reverted deployment can be cleared. Keep pending or successful transactions for recovery."
        );
      assertWallet();
      if (storage) localStorage.removeItem(storage);
      setHash(sharedArenaConfirmedHash);
      setReview(null);
      setMessage(
        "The reverted transaction is cleared. Review a fresh deployment fee before retrying."
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The transaction could not be checked."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function act(send: boolean) {
    if (lock.current || !client || !bundle.data || !wallet.data) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      if (chainId !== 8453) {
        await switchChainAsync({ chainId: 8453 });
        throw new Error(
          "Base selected. Review the deployment again before signing."
        );
      }
      assertWallet();
      if (hash)
        throw new Error(
          "Check the retained deployment transaction before sending another."
        );
      const data = sharedArenaCreation(bundle.data);
      if (!send) {
        const [gas, fees] = await Promise.all([
          client.estimateGas({ account: address!, data, value: 0n }),
          client.estimateFeesPerGas({ type: "eip1559", chain: undefined })
        ]);
        assertWallet();
        setReview({
          data,
          gas: (gas * 125n) / 100n,
          ...fees,
          expires: Date.now() + 120000,
          owner: address!
        });
        return;
      }
      if (
        !review ||
        review.expires < Date.now() ||
        review.owner.toLowerCase() !== address?.toLowerCase() ||
        review.data !== data
      )
        throw new Error(
          "Review the current deployment fee again before signing."
        );
      await client.call({ account: address!, data, value: 0n });
      assertWallet();
      const next = await wallet.data.sendTransaction({
        account: address!,
        chain: base,
        data,
        value: 0n,
        gas: review.gas,
        maxFeePerGas: review.maxFeePerGas,
        maxPriorityFeePerGas: review.maxPriorityFeePerGas
      });
      remember(next);
      setReview(null);
      setMessage("Deployment sent. Waiting for two confirmations…");
      await client.waitForTransactionReceipt({
        hash: next,
        confirmations: 2,
        timeout: 120000,
        onReplaced: ({ transaction }) => remember(transaction.hash)
      });
      await queries.invalidateQueries({
        queryKey: ["shared-arena-deployment"]
      });
    } catch (cause) {
      setError(
        cause instanceof BaseError
          ? cause.shortMessage
          : cause instanceof Error
            ? cause.message
            : "Deployment could not be checked."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-4xl px-5 pb-20 pt-12 text-ink">
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Yunipals Arena
      </p>
      <h1 className="mt-3 font-display text-4xl">Set up shared Arena</h1>
      <p className="mt-4 text-muted">
        One contract for video and anime battles. The first successful entrant
        pays the island draw fee; unused ETH is returned. Both modes start
        paused.
      </p>
      <section
        className="mt-6 space-y-3 rounded-card border border-line p-5"
        aria-label="Reviewed deployment settings"
      >
        <p>Video: 2 USDC entry · 6 USDC champion payout.</p>
        <p>Anime: 1 USDC entry · 3.20 USDC champion payout.</p>
        <p>
          The existing fighter registry and four approved anime fighters are
          reused. No new fighter applications or draw reserve deposit are
          required.
        </p>
        <p className="text-sm text-muted">
          Previous arenas remain available for their films, outstanding payouts
          and claims. This deployment does not move those funds.
        </p>
        {bundle.data && (
          <p className="break-all text-sm">
            Deployment wallet: {bundle.data.admin}
            <br />
            Existing fighter registry: {bundle.data.registry}
          </p>
        )}
      </section>
      {!address && (
        <button className={cn(button, "mt-6")} onClick={openConnectModal}>
          Connect deployment wallet
        </button>
      )}
      {address && bundle.data && !isOwner && (
        <p className="mt-5" role="alert">
          Connect the reviewed deployment wallet shown above.
        </p>
      )}
      {bundle.error && (
        <p className="mt-5" role="alert">
          {bundle.error.message}
        </p>
      )}
      {isOwner && !hash && !sharedArenaConfirmedHash && (
        <section
          className="mt-6 space-y-4 rounded-card border border-line p-5"
          aria-label="Deploy shared Arena"
        >
          <h2 className="text-xl font-bold">Deploy the shared contract</h2>
          <button
            className={button}
            disabled={busy || !bundle.data}
            onClick={() => void act(false)}
          >
            Review deployment fee
          </button>
          {review && (
            <>
              <p>
                Estimated transaction execution limit:{" "}
                {formatEther(review.gas * review.maxFeePerGas)} ETH, plus the
                Base data fee shown by your wallet. No ETH is deposited into the
                Arena.
              </p>
              <button
                className={button}
                disabled={busy}
                onClick={() => void act(true)}
              >
                Deploy shared Arena
              </button>
            </>
          )}
        </section>
      )}
      {hash && (
        <section className="mt-6 space-y-4 rounded-card border border-line p-5">
          <a
            className="break-all underline"
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View deployment transaction
          </a>
          <button
            className={button}
            disabled={busy || result.isFetching}
            onClick={() => void result.refetch()}
          >
            Check deployment
          </button>
          {result.error && (
            <button
              className={button}
              disabled={busy || !isOwner}
              onClick={() => void clearReverted()}
            >
              Clear a confirmed reverted transaction
            </button>
          )}
          {result.error && <p role="alert">{result.error.message}</p>}
          {result.data && (
            <>
              <SharedArenaControls
                contract={result.data.arena.address}
                admin={result.data.admin}
                rulesHashes={result.data.rulesHashes}
              />
              <p className="break-all">
                Verified shared Arena: {result.data.arena.address}
              </p>
              <p>
                Both modes were deployed paused. Configuration and worker
                activation follow this verification.
              </p>
              <button
                className={button}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(JSON.stringify(result.data, null, 2))
                    .then(() => setMessage("Deployment record copied."))
                    .catch(() =>
                      setError("Copy the deployment record shown below.")
                    )
                }
              >
                Copy deployment record
              </button>
              <details>
                <summary className="cursor-pointer font-semibold">
                  Deployment record
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </details>
            </>
          )}
        </section>
      )}
      {!hash && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold">
            Recover an existing deployment
          </summary>
          <label className="mt-3 block text-sm" htmlFor="shared-arena-restore">
            Deployment transaction hash
          </label>
          <input
            id="shared-arena-restore"
            value={restored}
            onChange={(event) => setRestored(event.target.value)}
            className="mt-2 w-full rounded-full border border-line px-4 py-2"
          />
          <button
            className={cn(button, "mt-3")}
            disabled={busy || !isOwner || !validHash(restored.trim())}
            onClick={() => {
              if (validHash(restored.trim())) remember(restored.trim() as Hex);
            }}
          >
            Check this deployment
          </button>
        </details>
      )}
      <p className="mt-4" role="status">
        {busy ? "Checking the deployment…" : message}
      </p>
      {error && (
        <p className="mt-4" role="alert">
          {error}
        </p>
      )}
      <Link className="mt-6 inline-block font-semibold underline" to="/arena">
        Back to Arena
      </Link>
    </main>
  );
}

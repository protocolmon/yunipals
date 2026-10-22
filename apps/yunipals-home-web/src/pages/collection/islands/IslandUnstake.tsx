import { useQueryClient } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { formatEther, type Address, type Hash } from "viem";
import { useAccount, useConfig } from "wagmi";
import {
  getAccount,
  getPublicClient,
  switchChain,
  waitForTransactionReceipt,
  writeContract
} from "wagmi/actions";

import { environment } from "@/environment";
import {
  assertIslandWithdrawal,
  prepareIslandUnstake
} from "@/lib/islandUnstake";
import { islandsCollectionId, type IslandToken } from "@/lib/islandsIndexer";
import { acquireMarketplaceWallet } from "@/lib/marketplace/walletExecution";
import { cn } from "@/lib/utils";

const buttonClass =
  "rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ethereum";
const storageKey = (account: string, id: string) =>
  `yunipals:island-unstake:1:${account.toLowerCase()}:${id}`;
function savedHash(account: string, id: string): Hash | undefined {
  try {
    const hash = localStorage.getItem(storageKey(account, id));
    return hash && /^0x[0-9a-fA-F]{64}$/.test(hash)
      ? (hash as Hash)
      : undefined;
  } catch {
    return;
  }
}
function saveHash(account: string, id: string, hash?: Hash) {
  try {
    if (hash) localStorage.setItem(storageKey(account, id), hash);
    else localStorage.removeItem(storageKey(account, id));
  } catch {
    /* Confirmation tracking continues in memory. */
  }
}

export function IslandUnstake({ token }: { token: IslandToken }) {
  const config = useConfig();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState<bigint>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [confirmed, setConfirmed] = useState(false);
  const held = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setFee(undefined);
    setError("");
    setNotice("");
    setConfirmed(false);
    setHash(address ? savedHash(address, token.tokenId) : undefined);
  }, [address, token.tokenId]);

  const ownStake =
    token.staking?.status === "staked" &&
    address?.toLowerCase() === token.staking.staker?.toLowerCase();
  async function track(
    account: Address,
    submitted: Hash,
    updatePending: (hash: Hash | undefined) => void
  ) {
    setNotice("Transaction submitted. Waiting for Ethereum confirmation…");
    const receipt = await waitForTransactionReceipt(config, {
      chainId: 1,
      hash: submitted,
      confirmations: 1,
      timeout: 180_000,
      onReplaced: ({ transactionReceipt }) => {
        updatePending(transactionReceipt.transactionHash);
        saveHash(account, token.tokenId, transactionReceipt.transactionHash);
        if (
          mounted.current &&
          getAccount(config).address?.toLowerCase() === account.toLowerCase()
        )
          setHash(transactionReceipt.transactionHash);
      }
    });
    // A receipt is definitive, including a cancellation or revert. Timeouts retain the saved hash.
    saveHash(account, token.tokenId);
    updatePending(undefined);
    assertIslandWithdrawal(receipt, account, token.tokenId);
    await query.invalidateQueries({ queryKey: [islandsCollectionId] });
    if (
      !mounted.current ||
      getAccount(config).address?.toLowerCase() !== account.toLowerCase()
    )
      return;
    setConfirmed(true);
    setNotice("Island returned to your wallet. Collection status is updating.");
  }

  async function run(confirm: boolean) {
    if (!address || held.current) return;
    const release = acquireMarketplaceWallet();
    if (!release) {
      setError("Finish the current wallet action first.");
      return;
    }
    held.current = true;
    setBusy(true);
    setError("");
    const account = address;
    let unconfirmedHash = hash;
    const assertAccount = () => {
      if (
        !mounted.current ||
        getAccount(config).address?.toLowerCase() !== account.toLowerCase()
      )
        throw new Error(
          "The connected wallet changed. Review the action again."
        );
    };
    try {
      if (hash) {
        await track(account, hash, (next) => {
          unconfirmedHash = next;
        });
        return;
      }
      const client = getPublicClient(config, { chainId: 1 });
      if (!client) throw new Error("Ethereum is temporarily unavailable.");
      setNotice("Checking your stake and estimating gas…");
      const prepared = await prepareIslandUnstake(
        client,
        account,
        token.tokenId
      );
      assertAccount();
      if (!confirm) {
        setFee(prepared.estimatedFee);
        setNotice("");
        return;
      }
      if (getAccount(config).chainId !== 1) {
        setNotice("Switch your wallet to Ethereum.");
        await switchChain(config, { chainId: 1 });
      }
      assertAccount();
      // Recheck after a network-switch prompt; another transaction may have withdrawn it.
      const fresh = await prepareIslandUnstake(client, account, token.tokenId);
      assertAccount();
      if (getAccount(config).chainId !== 1)
        throw new Error("Switch your wallet to Ethereum and try again.");
      setNotice("Confirm the unstaking transaction in your wallet.");
      const submitted = await writeContract(config, {
        ...fresh.call,
        chainId: 1
      });
      saveHash(account, token.tokenId, submitted);
      unconfirmedHash = submitted;
      if (
        mounted.current &&
        getAccount(config).address?.toLowerCase() === account.toLowerCase()
      )
        setHash(submitted);
      await track(account, submitted, (next) => {
        unconfirmedHash = next;
      });
    } catch (cause) {
      if (
        mounted.current &&
        getAccount(config).address?.toLowerCase() === account.toLowerCase()
      ) {
        setError(
          unconfirmedHash
            ? "Your transaction was submitted, but confirmation is still pending or temporarily unavailable. Check confirmation before trying again."
            : cause instanceof Error
              ? "shortMessage" in cause
                ? String(cause.shortMessage)
                : cause.message
              : "Unstaking could not be completed."
        );
        setNotice("");
        setFee(undefined);
        setHash(unconfirmedHash);
      }
    } finally {
      release();
      held.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!environment.islandStakingEnabled || !environment.islandUnstakeEnabled)
    return null;
  if (!address && token.staking?.status === "staked")
    return (
      <button
        type="button"
        onClick={openConnectModal}
        disabled={!openConnectModal}
        className={cn("mt-5", buttonClass)}
      >
        Connect staking wallet to unstake
      </button>
    );
  if (!ownStake && !hash && !confirmed) return null;
  return (
    <div className="mt-5 rounded-card border border-line bg-white p-5">
      <h2 className="text-lg font-extrabold text-ink">Unstake island</h2>
      {!confirmed && (
        <p className="mt-2 text-sm text-muted">
          Return this island to your Ethereum wallet. You pay the network gas
          fee.
        </p>
      )}
      {fee !== undefined && !hash && (
        <div className="mt-3 text-sm text-ink">
          <p>
            Estimated network fee: {Number(formatEther(fee)).toPrecision(3)}{" "}
            ETH. The final fee is shown in your wallet.
          </p>
          <p className="mt-2">
            The contract also claims any remaining staking rewards when
            returning your island. Review the transaction in your wallet before
            confirming.
          </p>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm font-semibold text-ink">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {hash && (
        <a
          href={`https://etherscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-sm font-bold text-ethereum underline"
        >
          View transaction
        </a>
      )}
      {!confirmed && (
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(fee !== undefined)}
            className={buttonClass}
          >
            {busy
              ? "Working…"
              : hash
                ? "Check confirmation"
                : fee === undefined
                  ? "Review unstake"
                  : "Confirm unstake"}
          </button>
          {fee !== undefined && !busy && !hash && (
            <button
              type="button"
              onClick={() => setFee(undefined)}
              className="rounded-full px-4 py-2 text-sm font-bold text-muted focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { erc20Abi, toHex, type Hex } from "viem";
import {
  useAccount,
  usePublicClient,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  arenaDomain,
  ARENA_STRATEGY_TYPES,
  canonicalStrategy,
  strategyCommitment,
  type ArenaTransactionAction,
  type ArenaTransactionStatus
} from "@protopals/yunipals-market-core/arena";
import {
  arenaRequest,
  type ArenaAdmission,
  type ArenaConfig
} from "@/lib/arenaLive";
import type { YunipalToken } from "@/lib/yunipalsIndexer";
import {
  newArenaTransaction,
  readArenaTransaction,
  saveArenaTransaction,
  transactionPending,
  transactionNeedsAudit,
  type PendingArenaTransaction
} from "@/lib/arenaTransactions";

class IndexingPending extends Error {}

export function useArenaWallet(
  config: ArenaConfig | undefined,
  refresh: () => Promise<unknown>
) {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [transaction, setTransaction] = useState<Hex | null>(null);
  const guard = useRef(false);
  const scope =
    address && config
      ? `${config.contract.toLowerCase()}/${address.toLowerCase()}`
      : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const tracker = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<PendingArenaTransaction | null>(
    null
  );
  const visibleOperation =
    operation &&
    operation.wallet.toLowerCase() === address?.toLowerCase() &&
    operation.contract.toLowerCase() === config?.contract.toLowerCase()
      ? operation
      : null;
  const resumeRef = useRef<(value: PendingArenaTransaction) => Promise<void>>(
    async () => {}
  );
  useEffect(() => {
    tracker.current?.abort();
    guard.current = false;
    setBusy(null);
    setError(null);
    setTransaction(null);
    pending.current = null;
    const value =
      address && config ? readArenaTransaction(address, config.contract) : null;
    setOperation(value);
    if (value && transactionPending(value)) void resumeRef.current(value);
    return () => {
      tracker.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    if (!transactionNeedsAudit(visibleOperation)) return;
    const value = visibleOperation!;
    const controller = new AbortController();
    const expectedScope = `${value.contract.toLowerCase()}/${value.wallet.toLowerCase()}`;
    const valid = () =>
      !controller.signal.aborted && currentScope.current === expectedScope;
    const audit = async () => {
      while (valid()) {
        await new Promise<void>((resolve) => {
          const stop = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", stop);
            resolve();
          }, 5000);
          controller.signal.addEventListener("abort", stop, { once: true });
        });
        if (!valid()) return;
        try {
          const status = await arenaRequest<ArenaTransactionStatus>(
            `/transactions/${value.hash}`,
            undefined,
            controller.signal
          );
          if (!valid()) return;
          const next = { ...value, ...status };
          if (transactionPending(next)) {
            remember(next);
            // Hand off before the state change cleans up this audit effect.
            // The recovery loop owns its own controller and scope checks.
            void refresh().catch(() => {});
            void resumeRef.current(next);
            return;
          }
          if (status.state !== value.state) await refresh();
          if (!valid()) return;
          remember(next);
          if (status.finalized !== false) return;
        } catch {
          if (valid())
            remember({
              ...value,
              state: "delayed",
              result: null,
              indexedThroughBlock: null
            });
          return;
        }
      }
    };
    void audit();
    return () => controller.abort();
  }, [
    scope,
    visibleOperation?.hash,
    visibleOperation?.state,
    visibleOperation?.finalized
  ]);
  // Keep the exact signed payload for an uncertain HTTP retry; never generate a new salt on retry.
  const pending = useRef<{
    key: string;
    body: {
      seat: number;
      text: string;
      salt: Hex;
      signature: Hex;
      incarnation?: Hex;
    };
  } | null>(null);
  async function execute(label: string, task: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(label);
    setError(null);
    const startedScope = scope;
    try {
      await task();
      await refresh();
    } catch (e) {
      if (
        currentScope.current === startedScope &&
        !(e instanceof IndexingPending)
      )
        setError(e instanceof Error ? e.message : "Wallet action failed.");
    } finally {
      if (currentScope.current === startedScope) {
        guard.current = false;
        setBusy(null);
      }
    }
  }
  async function signedIn() {
    if (!address || !config) throw new Error("Connect your wallet first.");
    assertCurrent();
    if (chainId !== 8453) await switchChainAsync({ chainId: 8453 });
    let existing: string | undefined;
    try {
      existing = (await arenaRequest<{ wallet: string }>("/me")).wallet;
    } catch {
      /* Expired sessions require a new challenge. */
    }
    if (existing?.toLowerCase() === address.toLowerCase()) return;
    const challenge = await arenaRequest<{ id: string; message: string }>(
      "/auth/challenge",
      { wallet: address }
    );
    assertCurrent();
    const signature = await signMessageAsync({
      message: challenge.message,
      account: address
    });
    assertCurrent();
    await arenaRequest("/auth/verify", { id: challenge.id, signature });
  }
  function assertCurrent() {
    if (currentScope.current !== scope) throw new IndexingPending();
  }
  function remember(value: PendingArenaTransaction) {
    saveArenaTransaction(value);
    if (
      currentScope.current ===
      `${value.contract.toLowerCase()}/${value.wallet.toLowerCase()}`
    )
      setOperation(value);
  }
  async function indexed(value: PendingArenaTransaction) {
    tracker.current?.abort();
    const controller = new AbortController();
    tracker.current = controller;
    const expectedScope = `${value.contract.toLowerCase()}/${value.wallet.toLowerCase()}`;
    const valid = () =>
      !controller.signal.aborted && currentScope.current === expectedScope;
    let latest = value;
    try {
      latest = {
        ...value,
        ...(await arenaRequest<ArenaTransactionStatus>(
          "/transactions",
          { hash: value.hash, action: value.action },
          controller.signal
        ))
      };
      const started = Date.now();
      while (valid()) {
        if (latest.state === "indexed") {
          // Query invalidation waits for active views to refetch before showing success.
          await refresh();
          if (!valid()) throw new IndexingPending();
          remember(latest);
          return;
        }
        if (latest.state === "failed") {
          remember(latest);
          throw new Error(
            "The transaction did not complete the expected action. Check its receipt before trying again."
          );
        }
        remember(latest);
        if (latest.state === "delayed" || Date.now() - started > 90_000) {
          remember({ ...latest, state: "delayed" });
          throw new IndexingPending();
        }
        await new Promise<void>((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(new IndexingPending());
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", stop);
            resolve();
          }, 5000);
          controller.signal.addEventListener("abort", stop, { once: true });
        });
        latest = {
          ...latest,
          ...(await arenaRequest<ArenaTransactionStatus>(
            `/transactions/${value.hash}`,
            undefined,
            controller.signal
          ))
        };
      }
      throw new IndexingPending();
    } catch (e) {
      if (valid() && latest.state !== "failed")
        remember({ ...latest, state: "delayed" });
      if (e instanceof IndexingPending) throw e;
      throw new Error(
        "Your transaction is retained. Sign in and check its status to finish updating the page."
      );
    }
  }
  resumeRef.current = async (value) => {
    try {
      const session = await arenaRequest<{ wallet: string }>("/me");
      if (session.wallet.toLowerCase() !== value.wallet.toLowerCase()) return;
      await indexed(value);
    } catch {
      /* Explicit status checking can renew an expired session. */
    }
  };

  async function confirmed(hash: Hex, action: ArenaTransactionAction) {
    if (!address || !config) throw new Error("Connect your wallet first.");
    if (currentScope.current === scope) setTransaction(hash);
    let value = newArenaTransaction(address, config.contract, hash, action);
    remember(value);
    if (!client) throw new Error("Base wallet connection is unavailable.");
    let cancelled = false;
    const receipt = await client.waitForTransactionReceipt({
      hash,
      onReplaced: (replacement) => {
        cancelled = replacement.reason === "cancelled";
        value = {
          ...value,
          hash: replacement.transactionReceipt.transactionHash
        };
        remember(value);
      }
    });
    if (cancelled) {
      remember({ ...value, state: "failed" });
      throw new Error("Transaction cancelled.");
    }
    value = { ...value, hash: receipt.transactionHash, state: "indexing" };
    remember(value);
    if (currentScope.current !== scope) throw new IndexingPending();
    setBusy("Updating tournament data");
    await indexed(value);
  }
  return {
    address,
    busy,
    error,
    transaction,
    operation: visibleOperation,
    pendingTransaction: transactionPending(visibleOperation),
    checkStatus: () =>
      execute("Checking transaction status", async () => {
        if (!visibleOperation || !transactionPending(visibleOperation)) return;
        await signedIn();
        await indexed(visibleOperation);
      }),
    join: (id: string, nft: YunipalToken, incarnation?: Hex) =>
      execute("Preparing your entry", async () => {
        if (!config?.entriesEnabled || !client || !address)
          throw new Error("Paid entry is not open yet.");
        if (transactionPending(visibleOperation))
          throw new Error(
            "Check your pending transaction before entering again."
          );
        await signedIn();
        const admission = (expected = incarnation) =>
          arenaRequest<ArenaAdmission>(`/tournaments/${id}/admission`, {
            nftChainId: nft.chainId,
            collection: nft.contractAddress,
            tokenId: nft.tokenId,
            incarnation: expected
          });
        // Verify ownership and the artwork snapshot before asking for approval gas.
        let permit = await admission();
        const allowance = await client.readContract({
          address: config.paymentToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, config.contract]
        });
        assertCurrent();
        if (allowance < BigInt(config.entryFee)) {
          setBusy("Approve USDC in your wallet");
          await confirmed(
            await writeContractAsync({
              chainId: 8453,
              account: address,
              address: config.paymentToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [config.contract, BigInt(config.entryFee)]
            }),
            {
              kind: "approval",
              tournamentId: id,
              incarnation: permit.incarnation
            }
          );
        }
        // Check the same opening again after any approval wallet interaction.
        permit = await admission(permit.incarnation);
        assertCurrent();
        setBusy("Confirm entry in your wallet");
        await confirmed(
          await writeContractAsync({
            chainId: 8453,
            account: address,
            address: config.contract,
            abi: arenaAbi,
            functionName: "join",
            args: [
              BigInt(id),
              {
                ...permit.entry,
                nftChainId: BigInt(permit.entry.nftChainId),
                tokenId: BigInt(permit.entry.tokenId)
              },
              BigInt(permit.expiry),
              permit.signature
            ]
          }),
          {
            kind: "entry",
            tournamentId: id,
            incarnation: permit.incarnation,
            nftChainId: nft.chainId,
            collection: nft.contractAddress,
            tokenId: nft.tokenId
          }
        );
      }),
    submit: (id: string, seat: number, text: string, incarnation?: Hex) =>
      execute("Signing your strategy", async () => {
        if (!config || !address) throw new Error("Connect your wallet first.");
        await signedIn();
        const normalized = canonicalStrategy(text);
        const key = `${config.contract}/${address}/${id}/${incarnation ?? "legacy"}/${seat}/${normalized}`;
        if (pending.current?.key !== key) {
          const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
          const commitment = strategyCommitment(
            config.contract,
            BigInt(id),
            seat,
            normalized,
            salt
          );
          const signature = await signTypedDataAsync({
            account: address,
            domain: arenaDomain(config.contract),
            types: ARENA_STRATEGY_TYPES,
            primaryType: "StrategyApproval",
            message: { tournamentId: BigInt(id), seat, commitment }
          });
          assertCurrent();
          pending.current = {
            key,
            body: { seat, text: normalized, salt, signature, incarnation }
          };
        }
        assertCurrent();
        await arenaRequest(
          `/tournaments/${id}/strategies`,
          pending.current.body
        );
        pending.current = null;
      }),
    claim: () =>
      execute("Claiming your USDC", async () => {
        if (!config || !address) throw new Error("Connect your wallet first.");
        if (transactionPending(visibleOperation))
          throw new Error(
            "Check your pending transaction before claiming again."
          );
        await signedIn();
        if (chainId !== 8453) await switchChainAsync({ chainId: 8453 });
        await confirmed(
          await writeContractAsync({
            chainId: 8453,
            account: address,
            address: config.contract,
            abi: arenaAbi,
            functionName: "claim",
            args: [address]
          }),
          { kind: "claim" }
        );
      }),
    signIn: () => execute("Signing in", signedIn)
  };
}

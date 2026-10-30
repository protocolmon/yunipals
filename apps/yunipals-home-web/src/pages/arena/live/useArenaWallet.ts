import { readArenaJoinPayment } from "@/lib/arenaPayment";
import {
  arenaCallsEntryHash,
  arenaCallsRejected,
  clearArenaCalls,
  readArenaCalls,
  saveArenaCalls,
  type PendingArenaCalls
} from "@/lib/arenaCalls";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { arenaMode } from "@protopals/yunipals-market-core/arenaProtocol";
import { base } from "viem/chains";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import { useEffect, useRef, useState } from "react";
import {
  BaseError,
  erc20Abi,
  toHex,
  isAddress,
  formatEther,
  type Address,
  type Hex
} from "viem";
import {
  useAccount,
  usePublicClient,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWalletClient,
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
  ArenaRequestError,
  type ArenaAdmission,
  type ArenaConfig
} from "@/lib/arenaLive";
import type { YunipalToken } from "@/lib/yunipalsIndexer";
import {
  readArenaStrategy,
  saveArenaStrategy,
  clearArenaStrategy,
  clearArenaStrategyWallet,
  type ArenaStrategyReceipt
} from "@/lib/arenaStrategies";
import {
  newArenaTransaction,
  readArenaTransaction,
  saveArenaTransaction,
  transactionPending,
  transactionFighter,
  arenaFighterKey,
  arenaTransactionScope,
  type ArenaEntryTarget,
  type PendingArenaTransaction
} from "@/lib/arenaTransactions";

export type ArenaApprovalEntries = 1 | 4 | 10;

class IndexingPending extends Error {}

const strategyStepLabels: Record<string, string> = {
  "Preparing your strategy": "Preparing…",
  "Confirm wallet ownership in your wallet · no gas fee": "Verify in wallet…",
  "Verifying your wallet": "Verifying…",
  "Switch to Base to sign your strategy": "Switch to Base…",
  "Checking your strategy receipt": "Checking receipt…",
  "Sign your strategy in your wallet": "Sign in wallet…",
  "Saving your strategy": "Saving strategy…",
  "Updating your strategy": "Updating strategy…",
  "Loading your locked strategy": "Loading your receipt…"
};

export function useArenaWallet(
  config: ArenaConfig | undefined,
  refresh: () => Promise<unknown>
) {
  const deployment = useArenaDeployment();
  const arenaRequest = useArenaRequest();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { data: walletClient } = useWalletClient({ chainId: 8453 });
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [transaction, setTransaction] = useState<Hex | null>(null);
  const [activeEntry, setActiveEntry] = useState<{
    scope: string | null;
    fighter: ArenaEntryTarget;
    label: string;
  } | null>(null);
  const [strategyTarget, setStrategyTarget] = useState<{
    scope: string | null;
    tournamentId: string;
    seat: number;
  } | null>(null);
  const guard = useRef(false);
  const scope =
    address && config
      ? arenaTransactionScope(
          address,
          config.contract,
          config.contractVersion === 2 ? deployment.kind : undefined
        )
      : null;
  const currentScope = useRef(scope);
  const privateScope = useRef<{
    contract: `0x${string}`;
    wallet: `0x${string}`;
  } | null>(null);
  currentScope.current = scope;
  const tracker = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<PendingArenaTransaction | null>(
    null
  );
  const [calls, setCalls] = useState<PendingArenaCalls | null>(null);
  const visibleCalls =
    calls &&
    arenaTransactionScope(calls.wallet, calls.contract, calls.mediaKind) ===
      scope
      ? calls
      : null;
  const visibleOperation =
    operation &&
    operation.wallet.toLowerCase() === address?.toLowerCase() &&
    operation.contract.toLowerCase() === config?.contract.toLowerCase() &&
    operation.mediaKind ===
      (config?.contractVersion === 2 ? deployment.kind : undefined)
      ? operation
      : null;
  const pendingFighter = transactionPending(visibleOperation)
    ? transactionFighter(visibleOperation)
    : null;
  const entryProgress = visibleCalls
    ? {
        key: arenaFighterKey(visibleCalls.fighter),
        label:
          busy === "Approve USDC and enter together in your wallet"
            ? "Confirm in wallet…"
            : "Confirming entry…"
      }
    : pendingFighter && visibleOperation
      ? {
          key: arenaFighterKey(pendingFighter),
          label:
            visibleOperation.state === "delayed"
              ? "Transaction pending…"
              : visibleOperation.state === "indexing"
                ? visibleOperation.action.kind === "approval"
                  ? "Updating approval…"
                  : "Updating entry…"
                : visibleOperation.action.kind === "approval"
                  ? "Confirming approval…"
                  : "Confirming entry…"
        }
      : activeEntry?.scope === scope && busy
        ? {
            key: arenaFighterKey(activeEntry.fighter),
            label: activeEntry.label
          }
        : null;
  const strategyFeedback =
    strategyTarget?.scope === scope
      ? {
          tournamentId: strategyTarget.tournamentId,
          seat: strategyTarget.seat,
          progress: busy ? (strategyStepLabels[busy] ?? "Working…") : null,
          error
        }
      : null;
  const resumeRef = useRef<(value: PendingArenaTransaction) => Promise<void>>(
    async () => {}
  );
  const resumeCallsRef = useRef<(value: PendingArenaCalls) => Promise<void>>(
    async () => {}
  );
  useEffect(() => {
    const prior = privateScope.current;
    if (
      prior &&
      (!address ||
        address.toLowerCase() !== prior.wallet.toLowerCase() ||
        (config &&
          config.contract.toLowerCase() !== prior.contract.toLowerCase()))
    )
      clearArenaStrategyWallet(prior.contract, prior.wallet);
    privateScope.current =
      address && config
        ? { contract: config.contract, wallet: address }
        : prior;
    tracker.current?.abort();
    guard.current = false;
    setBusy(null);
    setActiveEntry(null);
    setStrategyTarget(null);
    setError(null);
    setTransaction(null);
    const value =
      address && config
        ? readArenaTransaction(
            address,
            config.contract,
            config.contractVersion === 2 ? deployment.kind : undefined
          )
        : null;
    setOperation(value);
    const savedCalls =
      address && config
        ? readArenaCalls(
            address,
            config.contract,
            config.contractVersion === 2 ? deployment.kind : undefined
          )
        : null;
    setCalls(savedCalls);
    if (!savedCalls && value && transactionPending(value))
      void resumeRef.current(value);
    return () => {
      tracker.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    if (!walletClient || !address || !config || guard.current) return;
    const saved = readArenaCalls(
      address,
      config.contract,
      config.contractVersion === 2 ? deployment.kind : undefined
    );
    if (saved) void resumeCallsRef.current(saved);
  }, [scope, walletClient]);
  async function execute<T>(
    label: string,
    task: () => Promise<T>
  ): Promise<T | undefined> {
    if (guard.current) return;
    guard.current = true;
    setBusy(label);
    setStrategyTarget(null);
    setError(null);
    const startedScope = scope;
    try {
      const result = await task();
      assertCurrent();
      await refresh();
      assertCurrent();
      return result;
    } catch (e) {
      if (
        currentScope.current === startedScope &&
        !(e instanceof IndexingPending)
      )
        setError(
          e instanceof BaseError
            ? e.shortMessage
            : e instanceof Error
              ? e.message
              : "Wallet action failed."
        );
    } finally {
      if (currentScope.current === startedScope) {
        guard.current = false;
        setBusy(null);
        setActiveEntry(null);
      }
    }
  }
  async function ensureSession(label: string) {
    if (!address || !config) throw new Error("Connect your wallet first.");
    assertCurrent();
    let existing: string | undefined;
    try {
      existing = (await arenaRequest<{ wallet: string }>("/me")).wallet;
    } catch (error) {
      if (!(error instanceof ArenaRequestError) || error.status !== 401)
        throw error;
    }
    assertCurrent();
    if (existing?.toLowerCase() === address.toLowerCase()) return;
    setBusy("Confirm wallet ownership in your wallet · no gas fee");
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
    setBusy("Verifying your wallet");
    await arenaRequest("/auth/verify", { id: challenge.id, signature });
    assertCurrent();
    setBusy(label);
  }
  function assertCurrent() {
    if (currentScope.current !== scope) throw new IndexingPending();
  }
  function remember(value: PendingArenaTransaction) {
    saveArenaTransaction(value);
    if (
      currentScope.current ===
      arenaTransactionScope(value.wallet, value.contract, value.mediaKind)
    )
      setOperation(value);
  }
  async function indexed(value: PendingArenaTransaction) {
    tracker.current?.abort();
    const controller = new AbortController();
    tracker.current = controller;
    const expectedScope = arenaTransactionScope(
      value.wallet,
      value.contract,
      value.mediaKind
    );
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
        if (latest.state === "delayed") {
          remember({ ...latest, state: "delayed" });
          throw new IndexingPending();
        }
        // Indexing can take longer than the initial UI wait. Keep reading
        // the DB status until completion; these requests never trigger RPC reads.
        const interval = Date.now() - started < 90_000 ? 2000 : 5000;
        await new Promise<void>((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(new IndexingPending());
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", stop);
            resolve();
          }, interval);
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
        "Your transaction is retained. Check its status to finish updating the page."
      );
    }
  }
  resumeRef.current = async (value) => {
    try {
      const session = await arenaRequest<{ wallet: string }>("/me");
      if (session.wallet.toLowerCase() !== value.wallet.toLowerCase()) return;
      if (value.action.kind === "approval")
        await confirmed(value.hash, value.action, value.fighter);
      else await indexed(value);
    } catch {
      /* Explicit status checking can renew an expired session. */
    }
  };
  resumeCallsRef.current = async (value) => {
    await execute("Checking combined entry", async () => {
      await ensureSession("Checking combined entry");
      await finishCalls(value);
    });
  };

  function clearCalls(value: PendingArenaCalls) {
    clearArenaCalls(value);
    if (
      currentScope.current ===
      arenaTransactionScope(value.wallet, value.contract, value.mediaKind)
    )
      setCalls(null);
  }

  async function finishCalls(value: PendingArenaCalls) {
    if (!walletClient)
      throw new Error(
        "Reconnect the same wallet to check your combined entry."
      );
    let hash: Hex | null = null;
    try {
      const status = await walletClient.waitForCallsStatus({
        id: value.id,
        pollingInterval: 1500,
        timeout: 60_000
      });
      assertCurrent();
      if (
        status.chainId === 8453 &&
        (status.statusCode === 400 ||
          (status.statusCode === 500 && status.atomic))
      ) {
        clearCalls(value);
        throw new Error(
          "The combined entry did not complete. No entry fee was paid. You can try again."
        );
      }
      hash = arenaCallsEntryHash(value, status);
      if (!hash) throw new IndexingPending();
    } catch (error) {
      if (!readArenaCalls(value.wallet, value.contract, value.mediaKind))
        throw error;
      throw new Error(
        "Your combined entry is retained. Check its status before trying another entry."
      );
    }
    await confirmed(
      hash,
      { kind: "entry", ...value.fighter },
      value.fighter,
      (operation) => {
        // Keep the batch recovery ID until its transaction hash is durable too.
        if (
          readArenaTransaction(value.wallet, value.contract, value.mediaKind)
            ?.hash !== operation.hash
        )
          throw new Error(
            "Your entry is retained in your wallet. Check its status to finish updating the page."
          );
        clearCalls(value);
      }
    );
  }

  async function confirmed(
    hash: Hex,
    action: ArenaTransactionAction,
    fighter?: ArenaEntryTarget,
    recorded?: (value: PendingArenaTransaction) => void
  ) {
    if (!address || !config) throw new Error("Connect your wallet first.");
    if (currentScope.current === scope) setTransaction(hash);
    let value = {
      ...newArenaTransaction(
        address,
        config.contract,
        hash,
        action,
        config.contractVersion === 2 ? deployment.kind : undefined
      ),
      fighter
    };
    remember(value);
    recorded?.(value);
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
    if (receipt.status !== "success" || cancelled) {
      remember({ ...value, state: "failed" });
      throw new Error(
        cancelled
          ? "Transaction cancelled."
          : "Transaction reverted. This action did not complete."
      );
    }
    value = { ...value, hash: receipt.transactionHash, state: "indexing" };
    remember(value);
    if (currentScope.current !== scope) throw new IndexingPending();
    if (action.kind === "approval") {
      const allowance = await client.readContract({
        address: config.paymentToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, config.contract]
      });
      assertCurrent();
      if (allowance < BigInt(config.entryFee)) {
        remember({ ...value, state: "failed" });
        throw new Error(
          "The USDC allowance is too low for this entry. Please try again."
        );
      }
      remember({ ...value, approvalConfirmed: true });
      return;
    }
    setBusy("Updating tournament data");
    await indexed(value);
  }
  return {
    address,
    busy,
    error,
    transaction,
    operation: visibleOperation,
    pendingTransaction: !!visibleCalls || transactionPending(visibleOperation),
    batchPending: !!visibleCalls,
    entryProgress,
    strategyFeedback,
    checkStatus: () =>
      execute("Checking transaction status", async () => {
        if (visibleCalls) {
          await ensureSession("Checking combined entry");
          await finishCalls(visibleCalls);
          return;
        }
        if (!visibleOperation || !transactionPending(visibleOperation)) return;
        await ensureSession("Checking transaction status");
        if (visibleOperation.action.kind === "approval")
          await confirmed(
            visibleOperation.hash,
            visibleOperation.action,
            visibleOperation.fighter
          );
        else await indexed(visibleOperation);
      }),
    join: (
      id: string,
      nft: YunipalToken,
      approvalEntries: ArenaApprovalEntries = 1
    ) =>
      execute("Preparing your entry", async () => {
        const fighter: ArenaEntryTarget = {
          tournamentId: id,
          nftChainId: nft.chainId,
          collection: nft.contractAddress,
          tokenId: nft.tokenId
        };
        const progress = (label: string) => {
          assertCurrent();
          setActiveEntry({ scope, fighter, label });
        };
        progress("Preparing…");
        if (!config?.entriesEnabled || !client || !address)
          throw new Error("Paid entry is not open yet.");
        if (visibleCalls || transactionPending(visibleOperation))
          throw new Error(
            "Check your pending transaction before entering again."
          );
        if (![1, 4, 10].includes(approvalEntries))
          throw new Error("Choose an approval limit for 1, 4 or 10 entries.");
        await ensureSession("Preparing your entry");
        if (chainId !== 8453) {
          progress("Switch to Base…");
          await switchChainAsync({ chainId: 8453 });
        }
        progress("Checking fighter…");
        assertCurrent();
        const [allowance, balance, gasBalance] = await Promise.all([
          client.readContract({
            address: config.paymentToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, config.contract]
          }),
          client.readContract({
            address: config.paymentToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address]
          }),
          client.getBalance({ address })
        ]);
        assertCurrent();
        if (balance < BigInt(config.entryFee))
          throw new Error(
            `You need at least ${deployment.entry} USDC on Base to enter this fighter.`
          );
        if (gasBalance === 0n)
          throw new Error(
            "Add a little ETH on Base to cover the approval and entry transaction fees."
          );
        const admission = () =>
          arenaRequest<ArenaAdmission>(`/tournaments/${id}/admission`, {
            nftChainId: nft.chainId,
            collection: nft.contractAddress,
            tokenId: nft.tokenId
          });
        // Verify ownership and the artwork snapshot before asking for approval gas.
        const prepare = async () => {
          const result = await arenaRequest<
            ArenaAdmission | { identityState: "preparing"; key: string }
          >(`/tournaments/${id}/admission`, {
            nftChainId: nft.chainId,
            collection: nft.contractAddress,
            tokenId: nft.tokenId
          });
          if (!("identityState" in result)) return result;
          setBusy("Checking Yunipal artwork before payment");
          progress("Checking artwork…");
          const started = Date.now();
          while (Date.now() - started < 90_000) {
            assertCurrent();
            const status = await arenaRequest<{ state: string }>(
              `/identities/${result.key}`
            );
            if (status.state === "ready") return admission();
            if (status.state === "attention")
              throw new Error(
                "This artwork needs an anatomy review. No payment was requested."
              );
            await new Promise((resolve) => setTimeout(resolve, 2500));
          }
          throw new Error(
            "Your artwork check is saved and still processing. Try joining again shortly; no payment was requested."
          );
        };
        let permit = await prepare();
        assertCurrent();
        let atomic = false;
        if (
          allowance < BigInt(config.entryFee) &&
          walletClient?.account.address.toLowerCase() === address.toLowerCase()
        ) {
          try {
            const capabilities = await walletClient.getCapabilities<undefined>({
              account: address
            });
            atomic = ["supported", "ready"].includes(
              (capabilities[8453]?.atomic ?? capabilities[0]?.atomic)?.status ??
                "unsupported"
            );
          } catch {
            /* Conventional wallets use the two-confirmation flow. */
          }
          assertCurrent();
        }
        if (atomic && walletClient) {
          if (Number(permit.expiry) * 1000 < Date.now() + 60000)
            permit = await admission();
          const payment = await readArenaJoinPayment(client, config, id);
          if (gasBalance <= payment.value)
            throw new Error(
              "Add ETH on Base to cover the island draw and network gas."
            );
          assertCurrent();
          const batch: PendingArenaCalls = {
            id: toHex(crypto.getRandomValues(new Uint8Array(32))),
            wallet: address,
            contract: config.contract,
            mediaKind:
              config.contractVersion === 2 ? deployment.kind : undefined,
            fighter
          };
          // Refuse to send if the recovery record cannot be saved.
          saveArenaCalls(batch);
          setCalls(batch);
          progress("Confirm in wallet…");
          setBusy("Approve USDC and enter together in your wallet");
          let response;
          try {
            response = await walletClient.sendCalls({
              id: batch.id,
              account: address,
              chain: base,
              forceAtomic: true,
              experimental_fallback: false,
              calls: [
                {
                  to: config.paymentToken,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [
                    config.contract,
                    BigInt(config.entryFee) * BigInt(approvalEntries)
                  ]
                },
                {
                  to: config.contract,
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
                  ],
                  value: payment.value
                }
              ]
            });
          } catch (error) {
            if (arenaCallsRejected(error)) {
              clearCalls(batch);
              throw error;
            }
            throw new Error(
              "Your wallet may have submitted the combined entry. Check its status before trying again."
            );
          }
          const submitted = { ...batch, id: response.id };
          saveArenaCalls(submitted);
          assertCurrent();
          setCalls(submitted);
          setBusy("Confirming your entry on Base");
          await finishCalls(submitted);
          return;
        }
        if (allowance < BigInt(config.entryFee)) {
          progress("Approve in wallet…");
          setBusy(
            `Approve USDC for up to ${approvalEntries} ${approvalEntries === 1 ? "entry" : "entries"} in your wallet`
          );
          await confirmed(
            await writeContractAsync({
              chainId: 8453,
              account: address,
              address: config.paymentToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [
                config.contract,
                BigInt(config.entryFee) * BigInt(approvalEntries)
              ]
            }),
            { kind: "approval", tournamentId: id },
            fighter
          );
        }
        if (Number(permit.expiry) * 1000 < Date.now() + 60000)
          permit = await admission();
        assertCurrent();
        const payment = await readArenaJoinPayment(client, config, id);
        const joinArgs = [
          BigInt(id),
          {
            ...permit.entry,
            nftChainId: BigInt(permit.entry.nftChainId),
            tokenId: BigInt(permit.entry.tokenId)
          },
          BigInt(permit.expiry),
          permit.signature
        ] as const;
        if (config.contractVersion === 2 && payment.fees) {
          const [gas, balance] = await Promise.all([
            client.estimateContractGas({
              account: address,
              address: config.contract,
              abi: arenaV2Abi,
              functionName: "join",
              args: joinArgs,
              value: payment.value,
              ...payment.fees
            }),
            client.getBalance({ address })
          ]);
          if (
            balance <
            payment.value + ((gas * 125n) / 100n) * payment.fees.maxFeePerGas
          )
            throw new Error(
              `You need ${formatEther(payment.value)} ETH for the island draw, plus enough ETH for network gas.`
            );
        }
        assertCurrent();
        progress("Confirm in wallet…");
        setBusy(
          payment.firstEntry
            ? "Confirm entry and island draw fee in your wallet"
            : "Confirm entry in your wallet"
        );
        await confirmed(
          await writeContractAsync({
            chainId: 8453,
            account: address,
            address: config.contract,
            abi: arenaAbi,
            functionName: "join",
            ...(config.contractVersion === 2
              ? { value: payment.value, ...payment.fees }
              : {}),
            args: joinArgs
          }),
          {
            kind: "entry",
            tournamentId: id,
            nftChainId: nft.chainId,
            collection: nft.contractAddress,
            tokenId: nft.tokenId
          },
          fighter
        );
      }),
    submit: (
      id: string,
      seat: number,
      text: string,
      loadout?: import("@protopals/yunipals-market-core/anime").AnimeLoadout
    ) =>
      execute("Preparing your strategy", async () => {
        if (!config || !address) throw new Error("Connect your wallet first.");
        setStrategyTarget({ scope, tournamentId: id, seat });
        await ensureSession("Preparing your strategy");
        if (chainId !== 8453) {
          setBusy("Switch to Base to sign your strategy");
          await switchChainAsync({ chainId: 8453 });
        }
        assertCurrent();
        const normalized = canonicalStrategy(text);
        setBusy("Checking your strategy receipt");
        const prior = await arenaRequest<ArenaStrategyReceipt>(
          `/tournaments/${id}/strategies/${seat}/receipt`
        );
        assertCurrent();
        if (prior.locked) {
          clearArenaStrategy(config.contract, address, id, seat);
          if (
            prior.text !== normalized ||
            (loadout &&
              JSON.stringify(prior.loadout) !== JSON.stringify(loadout))
          )
            throw new Error(
              "Your earlier strategy is already locked. It cannot be replaced."
            );
          return;
        }
        const saved = readArenaStrategy(config.contract, address, id, seat);
        let body = saved.signed;
        if (
          body &&
          (body.text !== normalized ||
            JSON.stringify(body.loadout) !== JSON.stringify(loadout))
        )
          throw new Error(
            "A signed strategy is waiting for confirmation. Retry that saved strategy before making changes."
          );
        if (!body) {
          const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
          const commitment = strategyCommitment(
            config.contract,
            BigInt(id),
            seat,
            normalized,
            salt
          );
          setBusy("Sign your strategy in your wallet");
          const signature = await signTypedDataAsync({
            account: address,
            domain: arenaDomain(config.contract),
            types: ARENA_STRATEGY_TYPES,
            primaryType: "StrategyApproval",
            message: { tournamentId: BigInt(id), seat, commitment }
          });
          assertCurrent();
          body = {
            seat,
            text: normalized,
            salt,
            signature,
            ...(loadout ? { loadout } : {})
          };
          saveArenaStrategy(config.contract, address, id, seat, {
            text: normalized,
            ...(loadout ? { loadout } : {}),
            signed: body
          });
        }
        assertCurrent();
        setBusy("Saving your strategy");
        const receipt = await arenaRequest<ArenaStrategyReceipt>(
          `/tournaments/${id}/strategies`,
          body
        );
        if (
          !receipt.locked ||
          (body.loadout &&
            JSON.stringify(receipt.loadout) !== JSON.stringify(body.loadout)) ||
          receipt.commitment !==
            strategyCommitment(
              config.contract,
              BigInt(id),
              seat,
              body.text,
              body.salt
            )
        )
          throw new Error(
            "Strategy confirmation is incomplete. Retry the same saved strategy."
          );
        clearArenaStrategy(config.contract, address, id, seat);
        setBusy("Updating your strategy");
      }),
    claim: (refund = false, recipient?: Address) =>
      execute(
        refund ? "Claiming unused draw-fee ETH" : "Claiming your USDC",
        async () => {
          if (!config || !address)
            throw new Error("Connect your wallet first.");
          if (visibleCalls || transactionPending(visibleOperation))
            throw new Error(
              "Check your pending transaction before claiming again."
            );
          const target = recipient ?? address;
          if (
            !isAddress(target) ||
            /^0x0{40}$/i.test(target) ||
            target.toLowerCase() === config.contract.toLowerCase()
          )
            throw new Error("Choose a valid refund recipient.");
          if (refund && config.contractVersion !== 2)
            throw new Error("This arena has no entrant-funded draw refunds.");
          await ensureSession(
            refund ? "Claiming unused draw-fee ETH" : "Claiming your USDC"
          );
          if (chainId !== 8453) await switchChainAsync({ chainId: 8453 });
          const hash =
            config.contractVersion === 2
              ? await writeContractAsync({
                  chainId: 8453,
                  account: address,
                  address: config.contract,
                  abi: arenaV2Abi,
                  functionName: refund ? "claimRandomnessRefund" : "claim",
                  args: [arenaMode(deployment.kind), target]
                })
              : await writeContractAsync({
                  chainId: 8453,
                  account: address,
                  address: config.contract,
                  abi: arenaAbi,
                  functionName: "claim",
                  args: [address]
                });
          await confirmed(
            hash,
            refund
              ? { kind: "claim", asset: "randomness-refund", recipient: target }
              : { kind: "claim" }
          );
        }
      ),
    readStrategy: (id: string, seat: number) =>
      execute("Loading your locked strategy", async () => {
        setStrategyTarget({ scope, tournamentId: id, seat });
        await ensureSession("Loading your locked strategy");
        assertCurrent();
        return arenaRequest<ArenaStrategyReceipt>(
          `/tournaments/${id}/strategies/${seat}/receipt`
        );
      })
  };
}

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { BaseError, formatUnits, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { estimateL1Fee } from "viem/op-stack";

import {
  assertYpalWrapDeployment,
  parseYpalWrapAmount,
  parseYpalWrapPending,
  readYpalWrapBalances,
  resolveYpalWrapReceipt,
  ypalWrapTransaction,
  type YpalWrapDeployment,
  type YpalWrapKind,
  type YpalWrapPending
} from "@/lib/ypalWrap";

export type YpalWrapReview = {
  kind: YpalWrapKind;
  owner: Address;
  amount: bigint;
  to: Address;
  data: Hex;
  value: 0n;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  networkFee: bigint;
  expiresAt: number;
  version: number;
  storageKey: string;
};
export function useYpalWrap(deployment: YpalWrapDeployment) {
  assertYpalWrapDeployment(deployment);
  const { address, chainId } = useAccount(),
    wallet = useWalletClient();
  const client = usePublicClient({ chainId: 8453 }),
    queries = useQueryClient();
  const [amount, setAmountValue] = useState("1");
  const [review, setReview] = useState<YpalWrapReview | null>(null);
  const [pendingState, setPending] = useState<{
    key: string;
    value: YpalWrapPending | null;
  }>({ key: "", value: null });
  const [storageReady, setStorageReady] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0),
    mounted = useRef(true),
    working = useRef(false);
  const active = useRef<YpalWrapReview | null>(null);
  const pending = useRef<{ key: string; value: YpalWrapPending | null }>({
    key: "",
    value: null
  });
  const deploymentKey = `${deployment.manifestSha256}/${deployment.ypal.toLowerCase()}/${deployment.pmon.toLowerCase()}`;
  const storageKey = address
    ? `yunipals/ypal-wrap/v1/${deploymentKey}/${address.toLowerCase()}`
    : "";
  const latest = useRef({ address, chainId, wallet: wallet.data, storageKey });
  if (
    latest.current.address !== address ||
    latest.current.chainId !== chainId ||
    latest.current.wallet !== wallet.data ||
    latest.current.storageKey !== storageKey
  ) {
    version.current++;
    active.current = null;
  }
  latest.current = { address, chainId, wallet: wallet.data, storageKey };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    let restored: YpalWrapPending | null = null;
    if (address && storageKey) {
      try {
        const text = localStorage.getItem(storageKey);
        if (text && text.length <= 2000)
          restored = parseYpalWrapPending(JSON.parse(text), address);
      } catch {
        /* Failed storage reads never imply transaction success. */
      }
    }
    pending.current = { key: storageKey, value: restored };
    setPending(pending.current);
    setStorageReady(storageKey);
    active.current = null;
    setReview(null);
    setError(null);
    setMessage("");
  }, [storageKey, address]);
  useEffect(() => {
    active.current = null;
    setReview(null);
  }, [address, chainId, wallet.data]);
  const connected = Boolean(
    address && chainId === 8453 && client && wallet.data
  );
  const balances = useQuery({
    queryKey: ["ypal-wrap", deploymentKey, address?.toLowerCase()],
    enabled: connected,
    queryFn: () => readYpalWrapBalances(client!, deployment, address!),
    retry: false,
    staleTime: 10000,
    refetchInterval: 30000
  });
  let parsedAmount: bigint | null = null,
    inputError: string | null = null;
  try {
    parsedAmount = parseYpalWrapAmount(amount);
  } catch (cause) {
    inputError = cause instanceof Error ? cause.message : "Invalid amount.";
  }
  function dismissReview() {
    version.current++;
    active.current = null;
    setReview(null);
  }
  function setAmount(value: string) {
    dismissReview();
    setAmountValue(value);
    setError(null);
  }
  function remember(key: string, value: YpalWrapPending | null) {
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {
      /* Keep the in-memory hash when persistence is unavailable. */
    }
    if (latest.current.storageKey === key) {
      pending.current = { key, value };
      if (mounted.current) setPending({ key, value });
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
      if (mounted.current) {
        setError(
          cause instanceof BaseError
            ? cause.shortMessage
            : cause instanceof Error
              ? cause.message
              : "Wrapping could not finish."
        );
        setMessage("");
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function currentWallet(stamp: number, key: string, owner?: Address) {
    const now = latest.current;
    if (
      !mounted.current ||
      version.current !== stamp ||
      now.storageKey !== key ||
      !now.address ||
      now.chainId !== 8453 ||
      !now.wallet ||
      now.wallet.chain.id !== 8453 ||
      now.wallet.account.address.toLowerCase() !== now.address.toLowerCase() ||
      (owner && now.address.toLowerCase() !== owner.toLowerCase())
    )
      throw Error(
        "The wallet, network or wrapping form changed. Review the action again."
      );
    return now.wallet;
  }
  function currentReview(value: YpalWrapReview) {
    if (
      active.current !== value ||
      Date.now() >= value.expiresAt ||
      pending.current.key !== value.storageKey ||
      pending.current.value
    )
      throw Error(
        "This review expired, was dismissed, or has a pending transaction."
      );
    return currentWallet(value.version, value.storageKey, value.owner);
  }
  function storageFence(key: string) {
    if (localStorage.getItem(key))
      throw Error(
        "A saved transaction must be checked before starting another wrap or approval."
      );
    const probe = key + "/storage-check";
    localStorage.setItem(probe, "1");
    if (localStorage.getItem(probe) !== "1")
      throw Error(
        "Browser storage is unavailable for the pending transaction record."
      );
    localStorage.removeItem(probe);
  }
  async function checkAction(
    kind: YpalWrapKind,
    quantity: bigint,
    stamp: number,
    key: string,
    owner: Address
  ) {
    currentWallet(stamp, key, owner);
    if (
      storageReady !== key ||
      pending.current.key !== key ||
      pending.current.value
    )
      throw Error(
        "Resolve the saved transaction before submitting another transaction."
      );
    storageFence(key);
    const actual = await readYpalWrapBalances(client!, deployment, owner);
    currentWallet(stamp, key, owner);
    if (actual.pmonBalance < quantity)
      throw Error("This wallet needs more PMON on Base for that amount.");
    if (kind === "approve" && actual.allowance >= quantity)
      throw Error(
        "The PMON allowance is already sufficient. Review the wrap action instead."
      );
    if (kind === "wrap" && actual.allowance < quantity)
      throw Error(
        "Approve the exact PMON amount before reviewing the wrap action."
      );
    return ypalWrapTransaction(deployment, kind, quantity);
  }
  function prepare(kind: YpalWrapKind) {
    const stamp = version.current,
      key = storageKey,
      owner = address;
    void run(async () => {
      if (!owner || !connected) throw Error("Connect your wallet on Base.");
      const quantity = parseYpalWrapAmount(amount);
      setMessage("Checking balances, allowance and network fees…");
      const action = await checkAction(kind, quantity, stamp, key, owner),
        fees = await client!.estimateFeesPerGas();
      const transaction = { account: owner, ...action, ...fees };
      const gas = ((await client!.estimateGas(transaction)) * 120n) / 100n;
      await client!.call({ ...transaction, gas });
      const networkFee =
        gas * fees.maxFeePerGas +
        (await estimateL1Fee(client!, { ...transaction, gas }));
      if ((await client!.getBalance({ address: owner })) < networkFee)
        throw Error("This wallet needs more Base ETH for the network fee.");
      currentWallet(stamp, key, owner);
      const value = {
        kind,
        owner,
        amount: quantity,
        ...action,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        networkFee,
        expiresAt: Date.now() + 120000,
        version: stamp,
        storageKey: key
      };
      active.current = value;
      setReview(value);
      setMessage("");
    });
  }
  async function complete(record: YpalWrapPending, key: string) {
    if (!mounted.current || latest.current.storageKey !== key) return;
    let result = await resolveYpalWrapReceipt(client!, deployment, record);
    for (let retry = 0; result.status === "pending" && retry < 2; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!mounted.current || latest.current.storageKey !== key) return;
      result = await resolveYpalWrapReceipt(client!, deployment, record);
    }
    if (!mounted.current || latest.current.storageKey !== key) return;
    if (result.status === "pending") {
      setMessage("Confirming on Base. Your transaction hash is saved.");
      return;
    }
    remember(key, null);
    if (mounted.current && latest.current.storageKey === key) {
      setMessage(
        result.status === "failed"
          ? "The transaction is confirmed cancelled or reverted. Review a fresh action when ready."
          : record.kind === "approve"
            ? "PMON approval confirmed. Review the wrap action separately."
            : `Wrapped ${formatUnits(BigInt(record.amountRaw), 18)} PMON into ${formatUnits(BigInt(record.amountRaw), 18)} YPAL.`
      );
      await queries.invalidateQueries({
        queryKey: ["ypal-wrap", deploymentKey, record.owner.toLowerCase()]
      });
    }
  }
  function confirm() {
    const captured = review;
    if (!captured) return;
    void run(async () => {
      currentReview(captured);
      const action = await checkAction(
        captured.kind,
        captured.amount,
        captured.version,
        captured.storageKey,
        captured.owner
      );
      if (
        action.to.toLowerCase() !== captured.to.toLowerCase() ||
        action.data !== captured.data
      )
        throw Error("The exact wrapping action changed after review.");
      const transaction = {
        account: captured.owner,
        ...action,
        gas: captured.gas,
        maxFeePerGas: captured.maxFeePerGas,
        maxPriorityFeePerGas: captured.maxPriorityFeePerGas
      };
      await client!.call(transaction);
      const signer = currentReview(captured);
      const [actualChain, accounts] = await Promise.all([
        signer.getChainId(),
        signer.getAddresses()
      ]);
      if (
        actualChain !== 8453 ||
        !accounts.some(
          (account) => account.toLowerCase() === captured.owner.toLowerCase()
        )
      )
        throw Error("The wallet provider changed account or network.");
      storageFence(captured.storageKey);
      const finalSigner = currentReview(captured);
      if (finalSigner !== signer)
        throw Error("The signing wallet changed after review.");
      // Final synchronous ownership/lifecycle fence; no await before wallet entry.
      let hash = await finalSigner.sendTransaction({
        ...transaction,
        chain: base
      });
      let record: YpalWrapPending = {
        hash,
        kind: captured.kind,
        owner: captured.owner,
        amountRaw: captured.amount.toString(),
        manifestSha256: deployment.manifestSha256
      };
      remember(captured.storageKey, record);
      dismissReview();
      let foreignReplacement = false;
      await client!.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180000,
        onReplaced: ({ transaction: next, replacedTransaction: prior }) => {
          const sameNonce =
            prior.from.toLowerCase() === captured.owner.toLowerCase() &&
            next.from.toLowerCase() === captured.owner.toLowerCase() &&
            prior.nonce === next.nonce;
          const originalExact =
            prior.to?.toLowerCase() === action.to.toLowerCase() &&
            prior.input.toLowerCase() === action.data.toLowerCase() &&
            prior.value === 0n;
          const nextExact =
            next.to?.toLowerCase() === action.to.toLowerCase() &&
            next.input.toLowerCase() === action.data.toLowerCase() &&
            next.value === 0n;
          const cancelled =
            next.to?.toLowerCase() === captured.owner.toLowerCase() &&
            next.input === "0x" &&
            next.value === 0n;
          foreignReplacement =
            !sameNonce ||
            !originalExact ||
            next.chainId !== 8453 ||
            (!nextExact && !cancelled);
          hash = next.hash;
          record = { ...record, hash };
          remember(captured.storageKey, record);
        }
      });
      if (foreignReplacement)
        throw Error(
          "The replacement differs from the reviewed action. Its hash is retained for checking."
        );
      await complete(record, captured.storageKey);
    });
  }
  function resolvePending() {
    void run(async () => {
      const key = latest.current.storageKey,
        record = pending.current.value;
      if (!record || pending.current.key !== key || !client)
        throw Error("No saved transaction is available for this wallet.");
      await complete(record, key);
    });
  }
  const currentPending =
    pendingState.key === storageKey ? pendingState.value : null;
  const insufficient =
    parsedAmount !== null &&
    balances.data !== undefined &&
    balances.data.pmonBalance < parsedAmount;
  return {
    address,
    chainId,
    connected,
    amount,
    setAmount,
    parsedAmount,
    inputError,
    balances: balances.data,
    loading: balances.isPending || balances.isFetching,
    balanceError: balances.error,
    error,
    message,
    busy,
    review,
    pending: currentPending,
    needsApproval:
      parsedAmount !== null &&
      balances.data !== undefined &&
      balances.data.allowance < parsedAmount,
    insufficient,
    canPrepare: Boolean(
      connected &&
        storageReady === storageKey &&
        balances.data &&
        !balances.isFetching &&
        !inputError &&
        !insufficient &&
        !busy &&
        !currentPending &&
        !review
    ),
    prepare,
    confirm,
    dismissReview,
    resolvePending,
    refresh: () => balances.refetch()
  };
}

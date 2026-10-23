import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  BaseError,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex
} from "viem";
import { estimateL1Fee } from "viem/op-stack";
import {
  boosterPacksAbi,
  packRegistryAbi,
  yunipalMonstersAbi
} from "@protopals/yunipals-market-core/boosterAbi";
import {
  boosterAddresses,
  boosterQueryKey,
  saveBoosterTransaction
} from "@/lib/boosters";
import {
  boosterPurchaseAbi,
  boosterPurchaseData,
  readBoosterPurchaseLimit,
  validateBoosterPurchaseQuantity
} from "@/lib/boosterPurchase";
import {
  boosterPermitPurchaseData,
  boosterPermitTypedData,
  engineSupportsBoosterPermit,
  readBoosterPermit,
  validateBoosterPermitFreshness,
  type BoosterPermit
} from "@/lib/boosterPermit";

export type BoosterAction =
  | { kind: "open"; packTypeId: string; quantity?: number }
  | { kind: "claim"; packTypeId: string; originalId: string; quantity: number }
  | { kind: "recover"; requestId: string }
  | { kind: "burn"; tokenId: string }
  | { kind: "refund" };

type Review = {
  action: BoosterAction;
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  vrfPrice: bigint;
  networkFee: bigint | null;
  tokenPrice: bigint;
  tokenBalance: bigint | null;
  approvalAmount: bigint;
  tokenSymbol: string;
  tokenDecimals: number;
  approval: boolean;
  permitApproval: boolean;
  permitSigned: boolean;
  permit?: BoosterPermit;
  expiresAt: number;
};

export function useBoosterActions() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const wallet = useWalletClient();
  const queries = useQueryClient();
  const [review, setReview] = useState<Review | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "quoting" | "signing" | "confirming"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [submittedHash, setSubmittedHash] = useState<Hex | null>(null);
  const latest = useRef({ address, chainId, client, wallet: wallet.data });
  latest.current = { address, chainId, client, wallet: wallet.data };
  const reviewed = useRef<Review | null>(null);
  const preparing = useRef(0);
  const confirming = useRef(false);
  const activePage = useRef(true);
  useEffect(() => {
    activePage.current = true;
    return () => {
      activePage.current = false;
      reviewed.current = null;
      preparing.current++;
    };
  }, []);
  const updateReview = (value: Review | null) => {
    if (!activePage.current) return;
    reviewed.current = value;
    setReview(value);
  };

  async function checkedWallet(
    account: Address,
    expectedWallet?: NonNullable<typeof wallet.data>
  ) {
    const state = latest.current;
    if (
      !activePage.current ||
      !state.client ||
      !state.wallet ||
      (expectedWallet && state.wallet !== expectedWallet) ||
      state.chainId !== 8453 ||
      state.address?.toLowerCase() !== account.toLowerCase()
    )
      throw new Error("Your wallet changed. Review this transaction again.");
    const [actualChain, accounts] = await Promise.all([
      state.wallet.getChainId(),
      state.wallet.getAddresses()
    ]);
    if (
      !activePage.current ||
      actualChain !== 8453 ||
      accounts[0]?.toLowerCase() !== account.toLowerCase() ||
      latest.current.wallet !== state.wallet ||
      latest.current.chainId !== 8453 ||
      latest.current.address?.toLowerCase() !== account.toLowerCase()
    )
      throw new Error("Your wallet changed. Review this transaction again.");
    return { client: state.client, wallet: state.wallet };
  }

  async function currentPermit(
    current: Review,
    currentClient: NonNullable<typeof client>,
    timestamp: bigint,
    gasPrice: bigint
  ) {
    const deployment = boosterAddresses();
    const permit = current.permit;
    if (
      !deployment ||
      !permit ||
      current.action.kind !== "open" ||
      current.to.toLowerCase() !== deployment.engine ||
      permit.owner.toLowerCase() !== current.account.toLowerCase() ||
      permit.spender.toLowerCase() !== deployment.engine
    )
      throw new Error("Review these packs again.");
    const quantity = validateBoosterPurchaseQuantity(current.action.quantity);
    const [pack, fresh, allowance, balance, supported, quote] =
      await Promise.all([
        currentClient.readContract({
          address: deployment.registry,
          abi: packRegistryAbi,
          functionName: "getPack",
          args: [BigInt(current.action.packTypeId)]
        }),
        readBoosterPermit(currentClient, permit),
        currentClient.readContract({
          address: permit.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [current.account, deployment.engine]
        }),
        currentClient.readContract({
          address: permit.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [current.account]
        }),
        engineSupportsBoosterPermit(currentClient, deployment.engine),
        currentClient.readContract({
          address: deployment.engine,
          abi: boosterPurchaseAbi,
          functionName: "quoteOpenPacks",
          args: [BigInt(current.action.packTypeId), quantity, gasPrice]
        })
      ]);
    validateBoosterPermitFreshness(permit, fresh, timestamp, allowance);
    if (
      !supported ||
      !pack.active ||
      pack.salesPaused ||
      pack.rules.engine.toLowerCase() !== deployment.engine ||
      pack.rules.paymentToken.toLowerCase() !== permit.token.toLowerCase() ||
      pack.rules.price * BigInt(quantity) !== permit.value ||
      permit.value !== current.tokenPrice ||
      balance < current.tokenPrice ||
      (pack.rules.supplyCap > 0n &&
        pack.openings + BigInt(quantity) > pack.rules.supplyCap)
    )
      throw new Error(
        "This pack or your payment balance changed. Review these packs again."
      );
    if (quote[0] > current.value)
      throw new Error("The randomness fee changed. Review these packs again.");
    return { tokenBalance: balance, vrfPrice: quote[0] };
  }
  const fail = (cause: unknown) => {
    if (!activePage.current) return;
    const message =
      cause instanceof BaseError
        ? cause.shortMessage
        : cause instanceof Error
          ? cause.message
          : "The transaction could not be completed.";
    const known: [RegExp, string][] = [
      [/user rejected|user denied/i, "Transaction cancelled in your wallet."],
      [
        /requests paused or expired/i,
        "Requests are paused or this quote expired. Refresh the review."
      ],
      [/owner only/i, "Only this NFT’s current owner can perform this action."],
      [
        /unavailable credits/i,
        "These mint credits are already reserved or not yet available. Refresh the original."
      ],
      [
        /VRF price exceeds budget/i,
        "The randomness fee changed. Refresh the review."
      ],
      [/sold out/i, "This pack has sold out."]
    ];
    setError(
      known.find(([pattern]) => pattern.test(message))?.[1] ??
        message.slice(0, 400)
    );
    setPhase("idle");
  };

  async function prepare(action: BoosterAction, separateApproval = false) {
    if (!activePage.current || confirming.current) return;
    const preparation = ++preparing.current;
    setSubmittedHash(null);
    setError(null);
    updateReview(null);
    setPhase("quoting");
    try {
      const deployment = boosterAddresses();
      if (!deployment || !address || !client || chainId !== 8453)
        throw new Error("Connect your wallet on Base to continue.");
      const account = address;
      const [fees, block] = await Promise.all([
        client.estimateFeesPerGas(),
        client.getBlock({ blockTag: "latest" })
      ]);
      const gasPrice = fees.maxFeePerGas;
      let to = deployment.engine;
      let data: Hex;
      let value = 0n;
      let vrfPrice = 0n;
      let tokenPrice = 0n;
      let tokenBalance: bigint | null = null;
      let approvalAmount = 0n;
      let tokenSymbol = "PROTO";
      let tokenDecimals = 18;
      let approval = false;
      let permit: BoosterPermit | null = null;
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      const deadline = block.timestamp + 600n;
      if (action.kind === "open" || action.kind === "claim") {
        const packTypeId = BigInt(action.packTypeId);
        const pack = await client.readContract({
          address: deployment.registry,
          abi: packRegistryAbi,
          functionName: "getPack",
          args: [packTypeId]
        });
        if (
          !pack.active ||
          pack.rules.engine.toLowerCase() !== deployment.engine
        )
          throw new Error("This pack is unavailable.");
        if (action.kind === "open" && pack.salesPaused)
          throw new Error("New openings are paused for this pack.");
        const quantity =
          action.kind === "open"
            ? validateBoosterPurchaseQuantity(action.quantity)
            : action.quantity;
        if (action.kind === "open" && quantity > 1) {
          validateBoosterPurchaseQuantity(
            quantity,
            await readBoosterPurchaseLimit(client, deployment.engine)
          );
          [vrfPrice] = await client.readContract({
            address: deployment.engine,
            abi: boosterPurchaseAbi,
            functionName: "quoteOpenPacks",
            args: [packTypeId, quantity, gasPrice]
          });
        } else {
          [vrfPrice] = await client.readContract({
            address: deployment.engine,
            abi: boosterPacksAbi,
            functionName: "quote",
            args: [packTypeId, quantity, gasPrice]
          });
        }
        value = vrfPrice + vrfPrice / 10n + 1n;
        if (action.kind === "open") {
          tokenPrice = pack.rules.price * BigInt(quantity);
          if (
            pack.rules.supplyCap > 0n &&
            pack.openings + BigInt(quantity) > pack.rules.supplyCap
          )
            throw new Error(
              "There aren’t enough packs left for this quantity."
            );
          const token = pack.rules.paymentToken;
          const [balance, allowance, decimals, symbol] = await Promise.all([
            client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account]
            }),
            client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, deployment.engine]
            }),
            client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "decimals"
            }),
            client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "symbol"
            })
          ]);
          tokenDecimals = decimals;
          tokenSymbol = symbol;
          tokenBalance = balance;
          if (balance < tokenPrice)
            throw new Error(`You need more ${symbol} for these packs.`);
          approval = allowance < tokenPrice;
          if (approval) {
            if (
              !separateApproval &&
              (await engineSupportsBoosterPermit(client, deployment.engine))
            )
              permit = await readBoosterPermit(client, {
                owner: account,
                spender: deployment.engine,
                token,
                value: tokenPrice,
                deadline
              });
            if (permit) {
              approval = false;
              approvalAmount = tokenPrice;
              data = "0x";
            } else {
              const defaultApproval = 1000n * 10n ** BigInt(decimals);
              approvalAmount =
                tokenPrice > defaultApproval ? tokenPrice : defaultApproval;
              to = token;
              value = 0n;
              data = encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [deployment.engine, approvalAmount]
              });
            }
          } else
            data = boosterPurchaseData(packTypeId, quantity, value, deadline);
        } else
          data = encodeFunctionData({
            abi: boosterPacksAbi,
            functionName: "claim",
            args: [BigInt(action.originalId), quantity, value, deadline]
          });
      } else if (action.kind === "recover") {
        const request = await client.readContract({
          address: deployment.engine,
          abi: boosterPacksAbi,
          functionName: "getRequest",
          args: [BigInt(action.requestId)]
        });
        if (request.status !== 2)
          throw new Error("This request does not need recovery.");
        // recover() requires completion, so RPC estimation includes the full
        // saved-seed mint even when the original callback estimate was too low.
        data = encodeFunctionData({
          abi: boosterPacksAbi,
          functionName: "recover",
          args: [BigInt(action.requestId)]
        });
      } else if (action.kind === "burn") {
        to = deployment.monsters;
        data = encodeFunctionData({
          abi: yunipalMonstersAbi,
          functionName: "burn",
          args: [BigInt(action.tokenId)]
        });
      } else
        data = encodeFunctionData({
          abi: boosterPacksAbi,
          functionName: "withdrawRefund",
          args: [account]
        });
      const transaction = {
        account,
        to,
        data,
        value,
        ...fees
      };
      let gas = 0n;
      let networkFee: bigint | null = null;
      if (!permit) {
        await client.call(transaction);
        const estimate = await client.estimateGas(transaction);
        gas = (estimate * 120n) / 100n;
        const l1Fee = await estimateL1Fee(client, { ...transaction, gas });
        networkFee = gas * fees.maxFeePerGas + l1Fee;
      }
      if (
        (await client.getBalance({ address: account })) <
        value + (networkFee ?? 0n)
      )
        throw new Error("You need more ETH for randomness and network gas.");
      if (preparation !== preparing.current) return;
      if (
        latest.current.chainId !== 8453 ||
        latest.current.address?.toLowerCase() !== account.toLowerCase()
      )
        throw new Error("Your wallet changed. Review this transaction again.");
      updateReview({
        action,
        account,
        to,
        data,
        value,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        vrfPrice,
        networkFee,
        tokenPrice,
        tokenBalance,
        approvalAmount,
        tokenSymbol,
        tokenDecimals,
        approval,
        permitApproval: permit !== null,
        permitSigned: false,
        ...(permit ? { permit } : {}),
        expiresAt
      });
      setPhase("idle");
    } catch (cause) {
      if (preparation === preparing.current) fail(cause);
    }
  }

  async function confirm() {
    if (!activePage.current || confirming.current) return;
    confirming.current = true;
    const current = reviewed.current;
    let broadcast = false;
    let permitSendAttempted = false;
    try {
      const deployment = boosterAddresses();
      if (
        !current ||
        !deployment ||
        !wallet.data ||
        !client ||
        chainId !== 8453 ||
        address?.toLowerCase() !== current.account.toLowerCase()
      )
        throw new Error("Your wallet changed. Review this transaction again.");
      if (Date.now() / 1000 >= current.expiresAt)
        throw new Error("The quote expired. Review this transaction again.");
      const active = await checkedWallet(current.account);
      setError(null);
      setPhase("signing");
      if (current.permitApproval && !current.permitSigned) {
        if (!current.permit || current.action.kind !== "open")
          throw new Error("Review these packs again.");
        const permit = current.permit!;
        const before = await active.client.getBlock({ blockTag: "latest" });
        await currentPermit(
          current,
          active.client,
          before.timestamp,
          current.maxFeePerGas
        );
        await checkedWallet(current.account, active.wallet);
        const signature = await active.wallet.signTypedData({
          account: current.account,
          ...boosterPermitTypedData(permit)
        });
        const signed = await checkedWallet(current.account, active.wallet);
        const data = await boosterPermitPurchaseData(
          permit,
          signature,
          BigInt(current.action.packTypeId),
          current.action.quantity ?? 1,
          current.value
        );
        setPhase("quoting");
        const [fees, block] = await Promise.all([
          signed.client.estimateFeesPerGas(),
          signed.client.getBlock({ blockTag: "latest" })
        ]);
        const refreshed = await currentPermit(
          current,
          signed.client,
          block.timestamp,
          fees.maxFeePerGas
        );
        const transaction = {
          account: current.account,
          to: current.to,
          data,
          value: current.value,
          ...fees
        };
        await signed.client.call(transaction);
        const estimate = await signed.client.estimateGas(transaction);
        const gas = (estimate * 120n) / 100n;
        const l1Fee = await estimateL1Fee(signed.client, {
          ...transaction,
          gas
        });
        const networkFee = gas * fees.maxFeePerGas + l1Fee;
        if (
          (await signed.client.getBalance({ address: current.account })) <
          current.value + networkFee
        )
          throw new Error("You need more ETH for randomness and network gas.");
        await checkedWallet(current.account, active.wallet);
        if (
          Date.now() / 1000 >= current.expiresAt ||
          reviewed.current !== current
        )
          throw new Error("The quote expired. Review this transaction again.");
        updateReview({
          ...current,
          ...refreshed,
          data,
          gas,
          networkFee,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          permitSigned: true
        });
        setPhase("idle");
        return;
      }
      if (current.permitApproval) {
        const block = await active.client.getBlock({ blockTag: "latest" });
        await currentPermit(
          current,
          active.client,
          block.timestamp,
          current.maxFeePerGas
        );
        await active.client.call({
          account: current.account,
          to: current.to,
          data: current.data,
          value: current.value,
          maxFeePerGas: current.maxFeePerGas,
          maxPriorityFeePerGas: current.maxPriorityFeePerGas
        });
        if (
          current.networkFee === null ||
          (await active.client.getBalance({ address: current.account })) <
            current.value + current.networkFee
        )
          throw new Error("You need more ETH for randomness and network gas.");
        await checkedWallet(current.account, active.wallet);
        permitSendAttempted = true;
      }
      if (
        !activePage.current ||
        Date.now() / 1000 >= current.expiresAt ||
        reviewed.current !== current ||
        latest.current.wallet !== active.wallet ||
        latest.current.chainId !== 8453 ||
        latest.current.address?.toLowerCase() !== current.account.toLowerCase()
      )
        throw new Error(
          "The quote expired or your wallet changed. Review this transaction again."
        );
      const hash = await active.wallet.sendTransaction({
        account: current.account,
        chain: client.chain,
        to: current.to,
        data: current.data,
        value: current.value,
        gas: current.gas,
        maxFeePerGas: current.maxFeePerGas,
        maxPriorityFeePerGas: current.maxPriorityFeePerGas
      });
      broadcast = true;
      setSubmittedHash(hash);
      const kind = current.approval
        ? ("approval" as const)
        : current.action.kind;
      const expectation = current.approval
        ? {}
        : current.action.kind === "open"
          ? {
              expectedRequestCount: current.action.quantity ?? 1,
              packTypeId: current.action.packTypeId,
              quantity: 1
            }
          : current.action.kind === "claim"
            ? {
                expectedRequestCount: 1,
                packTypeId: current.action.packTypeId,
                quantity: current.action.quantity,
                originalId: current.action.originalId
              }
            : {};
      saveBoosterTransaction(current.account, deployment.engine, {
        hash,
        kind,
        ...expectation
      });
      setPhase("confirming");
      let trackedHash = hash;
      let cancelled = false;
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        onReplaced: ({ transaction, reason }) => {
          cancelled = reason === "cancelled";
          saveBoosterTransaction(
            current.account,
            deployment.engine,
            {
              hash: transaction.hash,
              kind,
              cancelled,
              ...expectation
            },
            undefined,
            trackedHash
          );
          trackedHash = transaction.hash;
        }
      });
      if (cancelled)
        throw new Error("The transaction was cancelled in your wallet.");
      if (receipt.status !== "success")
        throw new Error(
          "The transaction reverted. Its onchain changes were rolled back."
        );
      updateReview(null);
      setPhase("idle");
      await queries.invalidateQueries({ queryKey: boosterQueryKey });
      if (
        current.approval &&
        latest.current.address?.toLowerCase() === current.account.toLowerCase()
      ) {
        confirming.current = false;
        await prepare(current.action);
      }
      if (!current.approval) return receipt.transactionHash;
    } catch (cause) {
      if (broadcast || permitSendAttempted || current?.permitSigned)
        updateReview(null);
      fail(cause);
    } finally {
      confirming.current = false;
    }
  }

  return {
    prepare,
    confirm,
    review,
    phase,
    error,
    submittedHash,
    useSeparateApproval: () => {
      if (!confirming.current && reviewed.current?.action.kind === "open")
        return prepare(reviewed.current.action, true);
    },
    dismiss: () => {
      if (!activePage.current || confirming.current) return;
      preparing.current++;
      updateReview(null);
      setError(null);
    }
  };
}

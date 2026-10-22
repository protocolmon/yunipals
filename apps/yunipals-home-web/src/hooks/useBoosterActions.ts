import { useState } from "react";
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

export type BoosterAction =
  | { kind: "open"; packTypeId: string }
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
  networkFee: bigint;
  tokenPrice: bigint;
  tokenSymbol: string;
  tokenDecimals: number;
  approval: boolean;
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
  const fail = (cause: unknown) => {
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

  async function prepare(action: BoosterAction) {
    setSubmittedHash(null);
    setError(null);
    setReview(null);
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
      let tokenSymbol = "PROTO";
      let tokenDecimals = 18;
      let approval = false;
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
        const quantity = action.kind === "open" ? 1 : action.quantity;
        [vrfPrice] = await client.readContract({
          address: deployment.engine,
          abi: boosterPacksAbi,
          functionName: "quote",
          args: [packTypeId, quantity, gasPrice]
        });
        value = vrfPrice + vrfPrice / 10n + 1n;
        if (action.kind === "open") {
          tokenPrice = pack.rules.price;
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
          if (balance < tokenPrice)
            throw new Error(`You need ${symbol} to open this pack.`);
          approval = allowance < tokenPrice;
          if (approval) {
            to = token;
            value = 0n;
            data = encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [deployment.engine, tokenPrice]
            });
          } else
            data = encodeFunctionData({
              abi: boosterPacksAbi,
              functionName: "openPack",
              args: [packTypeId, value, deadline]
            });
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
      await client.call(transaction);
      const estimate = await client.estimateGas(transaction);
      const gas = (estimate * 120n) / 100n;
      const l1Fee = await estimateL1Fee(client, { ...transaction, gas });
      const networkFee = gas * fees.maxFeePerGas + l1Fee;
      if ((await client.getBalance({ address: account })) < value + networkFee)
        throw new Error("You need more ETH for randomness and network gas.");
      setReview({
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
        tokenSymbol,
        tokenDecimals,
        approval,
        expiresAt
      });
      setPhase("idle");
    } catch (cause) {
      fail(cause);
    }
  }

  async function confirm() {
    const current = review;
    let broadcast = false;
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
      setError(null);
      setPhase("signing");
      const hash = await wallet.data.sendTransaction({
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
      saveBoosterTransaction(current.account, deployment.engine, {
        hash,
        kind
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
              cancelled
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
      setReview(null);
      setPhase("idle");
      await queries.invalidateQueries({ queryKey: boosterQueryKey });
      if (
        current.approval &&
        address?.toLowerCase() === current.account.toLowerCase()
      )
        await prepare(current.action);
    } catch (cause) {
      if (broadcast) setReview(null);
      fail(cause);
    }
  }

  return {
    prepare,
    confirm,
    review,
    phase,
    error,
    submittedHash,
    dismiss: () => {
      setReview(null);
      setError(null);
    }
  };
}

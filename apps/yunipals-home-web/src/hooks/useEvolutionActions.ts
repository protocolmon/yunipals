import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, parseEventLogs, type Hex } from "viem";
import {
  adventureAbi,
  evolutionAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import { environment } from "@/environment";
import {
  fetchEvolutionQuote,
  validateEvolutionQuote,
  type EvolutionAction,
  type EvolutionQuote
} from "@/lib/evolution";

type PendingAction = {
  hash: Hex;
  kind: EvolutionAction;
  tokenId: string;
  requestId?: string;
};
export function useEvolutionActions() {
  const account = useAccount();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const wallet = useWalletClient();
  const queries = useQueryClient();
  const [review, setReview] = useState<{
    quote: EvolutionQuote;
    tokenId: string;
    partnerId?: string;
  } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const current = useRef(account.address);
  current.current = account.address;
  const network = useRef(account.chainId);
  network.current = account.chainId;
  const key = `yunipals:evolution:${environment.portalChainId}:${environment.evolutionAddress.toLowerCase()}:${account.address?.toLowerCase()}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  useEffect(() => {
    setReview(null);
    setError(null);
    setPending(null);
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        raw &&
        typeof raw === "object" &&
        "hash" in raw &&
        /^0x[0-9a-fA-F]{64}$/.test(String(raw.hash)) &&
        "tokenId" in raw &&
        /^[1-9][0-9]*$/.test(String(raw.tokenId)) &&
        "kind" in raw &&
        ["adventure", "serum", "fusion"].includes(String(raw.kind))
      )
        setPending(raw as PendingAction);
    } catch {
      /* The onchain reservation remains authoritative if storage is unavailable. */
    }
  }, [key, account.chainId]);
  const savePending = useCallback(
    (value: PendingAction | null) => {
      try {
        if (value) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
      } catch {
        /* Still recoverable from card state. */
      }
      if (activeKey.current === key) setPending(value);
    },
    [key]
  );
  const clearPending = useCallback(() => savePending(null), [savePending]);
  useEffect(() => {
    if (!pending || pending.requestId || !client) return;
    let stopped = false;
    const poll = async () => {
      try {
        const receipt = await client.getTransactionReceipt({
          hash: pending.hash
        });
        if (stopped) return;
        if (receipt.status !== "success") {
          savePending(null);
          setError("The transaction reverted. Your card remains unchanged.");
          return;
        }
        const requestId =
          pending.kind === "adventure"
            ? parseEventLogs({
                abi: adventureAbi,
                eventName: "AdventureRequested",
                logs: receipt.logs
              }).find(
                (v) =>
                  v.address.toLowerCase() ===
                  environment.adventuresAddress.toLowerCase()
              )?.args.requestId
            : parseEventLogs({
                abi: evolutionAbi,
                eventName: "EvolutionRequested",
                logs: receipt.logs
              }).find(
                (v) =>
                  v.address.toLowerCase() ===
                  environment.evolutionAddress.toLowerCase()
              )?.args.requestId;
        if (requestId)
          savePending({ ...pending, requestId: requestId.toString() });
        void queries.invalidateQueries({ queryKey: ["evolution"] });
      } catch {
        /* Ambiguous receipt failures retain the transaction; never resubmit it. */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, client, key, queries, savePending]);
  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The action could not be completed.";
      setError(
        /reject|denied/i.test(message)
          ? "The wallet request was cancelled."
          : message.slice(0, 240)
      );
    } finally {
      busy.current = false;
      setPhase(null);
    }
  }
  async function prepare(
    kind: EvolutionAction,
    tokenId: string,
    partnerId?: string
  ) {
    return run(async () => {
      if (!account.address || !wallet.data || !client)
        throw new Error("Connect your wallet to continue.");
      if (account.chainId !== environment.portalChainId)
        throw new Error("Switch your wallet to the card's network.");
      if (pending && !pending.requestId)
        throw new Error("Wait for your previous transaction to be confirmed.");
      const owner = account.address;
      setPhase("Checking your cards and fees…");
      const quote = await fetchEvolutionQuote(kind, tokenId, owner, partnerId);
      if (
        current.current !== owner ||
        network.current !== environment.portalChainId
      )
        throw new Error("Your wallet changed. Please try again.");
      validateEvolutionQuote(quote, owner, kind, tokenId, partnerId);
      setReview({ quote, tokenId, partnerId });
    });
  }
  async function confirm() {
    if (!review) return;
    const selected = review;
    return run(async () => {
      if (
        !client ||
        !wallet.data ||
        !account.address ||
        account.chainId !== environment.portalChainId
      )
        throw new Error("Connect the correct wallet and network.");
      const owner = account.address;
      const check = () => {
        if (
          current.current !== owner ||
          network.current !== environment.portalChainId
        )
          throw new Error("Your wallet changed. Please try again.");
      };
      const quote = selected.quote;
      validateEvolutionQuote(
        quote,
        owner,
        quote.kind,
        selected.tokenId,
        selected.partnerId
      );
      const [cards, usdc] = await Promise.all([
        client.readContract({
          address: environment.evolutionAddress as Hex,
          abi: evolutionAbi,
          functionName: "cards"
        }),
        client.readContract({
          address: environment.evolutionAddress as Hex,
          abi: evolutionAbi,
          functionName: "usdc"
        })
      ]);
      if (
        cards.toLowerCase() !== environment.boosterMonsters.toLowerCase() ||
        usdc.toLowerCase() !== quote.usdc.toLowerCase()
      )
        throw new Error("The collection or payment contract changed.");
      const fee = BigInt(quote.fee);
      if (quote.kind === "serum") {
        const currentFee = await client.readContract({
          address: quote.to,
          abi: evolutionAbi,
          functionName: "serumApplicationFee"
        });
        if (currentFee > fee) {
          setReview(null);
          throw new Error(
            "The sponsored serum allowance has been used. Review a new quote to continue."
          );
        }
      }
      if (fee > 0n) {
        const allowance = await client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, quote.to]
        });
        if (allowance < fee) {
          setPhase("Approve 0.10 USDC in your wallet…");
          check();
          const hash = await wallet.data.writeContract({
            account: owner,
            chain: client.chain,
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.to, fee]
          });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success")
            throw new Error("The USDC approval failed.");
        }
      }
      check();
      if ((await client.getBlock()).timestamp >= BigInt(quote.deadline)) {
        setReview(null);
        throw new Error(
          "The quote expired while approving. Review a new quote to continue."
        );
      }
      setPhase("Confirm the action in your wallet…");
      const transaction = {
        account: owner,
        to: quote.to,
        data: quote.data,
        value: BigInt(quote.value)
      };
      await client.call({
        ...transaction,
        gasPrice: BigInt(quote.fees.maxFeePerGas)
      });
      check();
      const hash = await wallet.data.sendTransaction({
        ...transaction,
        chain: client.chain,
        maxFeePerGas: BigInt(quote.fees.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(quote.fees.maxPriorityFeePerGas)
      });
      savePending({ hash, kind: quote.kind, tokenId: selected.tokenId });
      setReview(null);
      void queries.invalidateQueries({ queryKey: ["evolution"] });
    });
  }
  return {
    prepare,
    confirm,
    review,
    closeReview: () => setReview(null),
    pending,
    clearPending,
    phase,
    error
  };
}

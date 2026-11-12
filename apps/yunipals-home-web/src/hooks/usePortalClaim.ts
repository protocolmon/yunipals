import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { portalTransactionPending } from "@/lib/portalTransactions";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { BaseError, encodeFunctionData, parseEventLogs, type Hex } from "viem";
import { z } from "zod";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import { environment } from "@/environment";
import { readPortalClaim } from "@/lib/portalClaims";

const pendingSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  tokenId: z
    .string()
    .max(78)
    .regex(/^[1-9][0-9]*$/),
  owner: z.string(),
  grading: z.string(),
  chainId: z.number()
});
type PendingClaim = z.infer<typeof pendingSchema>;
type Review = Awaited<ReturnType<typeof readPortalClaim>>;
const storageKey = (owner: string) =>
  `yunipals.portalClaim.v2:${environment.portalChainId}:${environment.portalGrading?.toLowerCase()}:${owner.toLowerCase()}`;
const message = (error: unknown) =>
  error instanceof BaseError
    ? error.shortMessage
    : error instanceof Error
      ? error.message
      : "The portal claim could not be completed.";

export function usePortalClaim() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const wallet = useWalletClient();
  const queries = useQueryClient();
  const { tracker } = usePortalTransactions();
  const [review, setReview] = useState<Review | null>(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingClaim | null>(null);
  const [success, setSuccess] = useState<{
    tokenId: string;
    amount: string;
    hash: Hex;
    block: bigint;
    blockHash: Hex;
  } | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const current = useRef({ address, chainId });
  current.current = { address, chainId };

  function persist(value: PendingClaim) {
    try {
      localStorage.setItem(storageKey(value.owner), JSON.stringify(value));
    } catch {
      /* Receipt tracking still works in memory. */
    }
  }
  function forget(value: PendingClaim) {
    try {
      localStorage.removeItem(storageKey(value.owner));
    } catch {
      /* Storage can be disabled. */
    }
  }
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setReview(null);
    setSuccess(null);
    setError(null);
    setPhase("idle");
    setPending(null);
    if (!address) return;
    try {
      const saved = pendingSchema.safeParse(
        JSON.parse(localStorage.getItem(storageKey(address)) ?? "null")
      );
      if (
        saved.success &&
        saved.data.owner.toLowerCase() === address.toLowerCase() &&
        saved.data.chainId === environment.portalChainId &&
        saved.data.grading.toLowerCase() ===
          environment.portalGrading?.toLowerCase()
      ) {
        setPending(saved.data);
        setPhase("Waiting for the burn transaction…");
      }
    } catch {
      /* Ignore invalid or unavailable browser storage. */
    }
  }, [address, chainId]);

  useEffect(() => {
    if (!pending || !client) return;
    let stopped = false;
    busy.current = true;
    async function watch() {
      try {
        if (!tracker) throw new Error("Transaction tracking is unavailable.");
        // Older saved claims contain only a hash. Recover their original intent
        // from the chain before using the common index-evidence lifecycle.
        let tracked = tracker
          .getSnapshot()
          .find((v) => v.id === pending!.hash || v.hash === pending!.hash);
        if (!tracked) {
          const transaction = await client!.getTransaction({
            hash: pending!.hash as Hex
          });
          if (
            transaction.from.toLowerCase() !== pending!.owner.toLowerCase() ||
            transaction.to?.toLowerCase() !== pending!.grading.toLowerCase()
          )
            throw new Error("Saved claim does not match this wallet.");
          tracked = tracker.add(pending!.hash as Hex, {
            to: pending!.grading,
            data: transaction.input,
            value: transaction.value.toString(),
            actionKey: `claim:${pending!.tokenId}`,
            label: `Burn and claim portal #${pending!.tokenId}`
          });
        }
        const receipt = await tracker.wait(tracked.id, (value) => {
          if (!stopped) setPhase(value);
        });
        if (stopped) return;
        const claimed = parseEventLogs({
          abi: portalGradingAbi,
          logs: receipt.logs,
          eventName: "PortalClaimed"
        }).find(
          (log) =>
            log.address.toLowerCase() === pending!.grading.toLowerCase() &&
            log.args.portalId?.toString() === pending!.tokenId &&
            log.args.owner?.toLowerCase() === pending!.owner.toLowerCase()
        );
        if (receipt.status !== "success" || claimed?.args.amount === undefined)
          throw new Error(
            "The burn was cancelled or reverted. Your portal was not redeemed by this transaction."
          );
        forget(pending!);
        setSuccess({
          tokenId: pending!.tokenId,
          amount: claimed.args.amount.toString(),
          hash: receipt.transactionHash,
          block: receipt.blockNumber,
          blockHash: receipt.blockHash
        });
        setPending(null);
        setPhase("idle");
        busy.current = false;
        await Promise.all([
          queries.invalidateQueries({ queryKey: ["portals"] }),
          queries.invalidateQueries({ queryKey: ["balance"] }),
          queries.invalidateQueries({ queryKey: ["readContract"] }),
          queries.invalidateQueries({ queryKey: ["collector"] })
        ]);
      } catch (e) {
        if (stopped) return;
        const tracked = tracker
          ?.getSnapshot()
          .find((v) => v.id === pending!.hash || v.hash === pending!.hash);
        if (
          (tracked && portalTransactionPending(tracked)) ||
          (e instanceof BaseError &&
            /timeout|timed out|not found|fetch|network|rate limit/i.test(
              e.message
            ))
        ) {
          timer = setTimeout(() => {
            if (!stopped) void watch();
          }, 3000);
          return;
        }
        forget(pending!);
        setPending(null);
        setPhase("idle");
        busy.current = false;
        setError(message(e));
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    void watch();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pending, client, queries, tracker]);

  useEffect(() => {
    if (!success || !client) return;
    let stopped = false;
    const timer = setInterval(() => {
      void client
        .getBlock({ blockNumber: success.block })
        .then((block) => {
          if (stopped || block.hash === success.blockHash || !address) return;
          const retry = {
            hash: success.hash,
            tokenId: success.tokenId,
            owner: address,
            grading: environment.portalGrading!,
            chainId: environment.portalChainId
          };
          setSuccess(null);
          setError("The chain changed. Rechecking your burn transaction…");
          persist(retry);
          setPending(retry);
          setPhase("Rechecking the burn transaction…");
          void queries.invalidateQueries({ queryKey: ["portals"] });
        })
        .catch(() => {});
    }, 12000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [success, client, address, queries]);

  function guard(id: number, owner: string) {
    if (
      generation.current !== id ||
      current.current.address?.toLowerCase() !== owner.toLowerCase() ||
      current.current.chainId !== environment.portalChainId
    )
      throw new Error("Your wallet changed. Review the portal again.");
  }
  async function prepare(tokenId: string) {
    if (busy.current || pending) return;
    busy.current = true;
    setError(null);
    setPhase("Checking portal ownership and balance…");
    const id = generation.current;
    try {
      if (!client || !address)
        throw new Error("Connect the wallet that owns this portal.");
      if (chainId !== environment.portalChainId)
        throw new Error("Switch to the portal network.");
      const value = await readPortalClaim(client, tokenId);
      guard(id, address);
      if (value.token.retired)
        throw new Error("This portal has already been burned.");
      if (value.owner.toLowerCase() !== address.toLowerCase())
        throw new Error("Only the current portal owner can burn and claim.");
      setReview(value);
      setSuccess(null);
    } catch (e) {
      if (generation.current === id) setError(message(e));
    } finally {
      if (generation.current === id) {
        busy.current = false;
        setPhase("idle");
      }
    }
  }
  async function confirm() {
    if (
      !review ||
      !client ||
      !address ||
      !wallet.data ||
      busy.current ||
      pending
    )
      return;
    busy.current = true;
    setError(null);
    setPhase("Rechecking your portal…");
    const id = generation.current,
      owner = address;
    let submitted = false;
    try {
      const fresh = await readPortalClaim(client, review.token.id);
      guard(id, owner);
      if (
        fresh.token.retired ||
        fresh.owner.toLowerCase() !== owner.toLowerCase()
      ) {
        setReview(null);
        throw new Error("Portal ownership changed. Refresh your portals.");
      }
      if (fresh.token.claimable !== review.token.claimable) {
        setReview(fresh);
        throw new Error(
          "The balance changed. Review the updated payout and confirm again."
        );
      }
      if (!tracker) throw new Error("Transaction tracking is unavailable.");
      tracker.assertAvailable(`claim:${fresh.token.id}`);
      const deadline = fresh.block.timestamp + 600n;
      const simulated = await client.simulateContract({
        address: fresh.deployment.grading,
        abi: portalGradingAbi,
        functionName: "burnAndClaim",
        account: owner,
        args: [BigInt(fresh.token.id), BigInt(fresh.token.claimable), deadline]
      });
      guard(id, owner);
      setPhase("Confirm burning this portal in your wallet…");
      const hash = await wallet.data.writeContract({
        ...simulated.request,
        chain: client.chain
      });
      tracker.add(hash, {
        to: fresh.deployment.grading,
        data: encodeFunctionData({
          abi: portalGradingAbi,
          functionName: "burnAndClaim",
          args: [
            BigInt(fresh.token.id),
            BigInt(fresh.token.claimable),
            deadline
          ]
        }),
        value: "0",
        actionKey: `claim:${fresh.token.id}`,
        label: `Burn and claim portal #${fresh.token.id}`
      });
      const saved = {
        hash,
        tokenId: fresh.token.id,
        owner,
        grading: fresh.deployment.grading,
        chainId: environment.portalChainId
      };
      persist(saved);
      submitted = true;
      if (generation.current !== id) return;
      setReview(null);
      setPending(saved);
      setPhase("Waiting for the burn transaction…");
    } catch (e) {
      if (generation.current === id) {
        setError(
          /reject|denied/i.test(e instanceof Error ? e.message : message(e))
            ? "The wallet request was cancelled."
            : message(e)
        );
        setPhase("idle");
      }
    } finally {
      if (generation.current === id && !submitted) busy.current = false;
    }
  }
  return {
    address,
    chainId,
    review,
    phase,
    error,
    pending,
    success,
    busy: phase !== "idle",
    prepare,
    confirm,
    dismiss: () => {
      if (!busy.current) {
        setReview(null);
        setError(null);
      }
    }
  };
}

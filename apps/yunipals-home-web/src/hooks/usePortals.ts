import { usePortalTransactions } from "@/hooks/usePortalTransactions";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  BaseError,
  UserRejectedRequestError,
  erc20Abi,
  encodeFunctionData,
  decodeFunctionData,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex
} from "viem";
import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalSpellCommitment,
  portalAdmissionHash,
  portalSpellSigningData
} from "@protopals/yunipals-market-core/portals";
import { readPortalContracts } from "@/lib/portalClaims";
import { environment } from "@/environment";
import {
  fetchPortalQuote,
  portalAdmission,
  portalDeploymentMatches,
  portalRequest,
  portalSpellReceiptSchema,
  type ActivePortalStatus,
  type PortalQuote
} from "@/lib/portals";

export function usePortals(status: ActivePortalStatus | null) {
  const { address, chainId } = useAccount();
  const client = usePublicClient({
    chainId: status?.deployment.chainId ?? environment.portalChainId
  });
  const wallet = useWalletClient();
  const queries = useQueryClient();
  const { tracker } = usePortalTransactions();
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    quote: PortalQuote;
    spell: string;
  } | null>(null);
  const [submitted, setSubmitted] = useState<{
    tokenId: string;
    requestId: string;
    hash: Hex;
  } | null>(null);
  const busy = useRef(false),
    generation = useRef(0);
  const current = useRef({ address, chainId });
  current.current = { address, chainId };
  useEffect(() => {
    generation.current++;
    setReview(null);
  }, [address, chainId]);

  function requireWallet() {
    if (!address || !client || !wallet.data || !status)
      throw new Error("Connect your wallet to continue.");
    if (chainId !== status.deployment.chainId)
      throw new Error("Switch to the portal's network in your wallet.");
    if (!portalDeploymentMatches(status))
      throw new Error("Portal payments are being prepared.");
    return { account: address, client, signer: wallet.data, status };
  }
  async function checkedContracts() {
    const context = requireWallet();
    const { deployment } = context.status;
    const { deployment: checked } = await readPortalContracts(context.client);
    const { registry, usdc, collection } = checked;
    if (
      registry.toLowerCase() !== deployment.registry.toLowerCase() ||
      collection.toLowerCase() !== deployment.collection.toLowerCase() ||
      usdc.toLowerCase() !== deployment.usdc.toLowerCase()
    )
      throw new Error("Portal configuration changed. Please refresh.");
    return context;
  }
  async function perform<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("Checking the portal…");
    try {
      return await action();
    } catch (e) {
      const message =
        e instanceof BaseError
          ? e.shortMessage
          : e instanceof Error
            ? e.message
            : "The portal action could not be completed.";
      setError(
        /reject|denied/i.test(message)
          ? "The wallet request was cancelled."
          : message.slice(0, 280)
      );
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }
  const guard = (id: number, account: Address) => {
    if (generation.current !== id || current.current.address !== account)
      throw new Error("Your wallet changed. Please try again.");
  };

  async function prepare(tokenId: string, spell: string) {
    return perform(async () => {
      if (
        !/^[1-9][0-9]*$/.test(tokenId) ||
        !spell.trim() ||
        spell.length > 6000
      )
        throw new Error(
          "Enter a card number and a spell of up to 6,000 characters."
        );
      setPhase("Checking your card…");
      const { account } = requireWallet();
      const id = generation.current;
      const quote = await fetchPortalQuote(tokenId, account);
      guard(id, account);
      if (!portalDeploymentMatches(quote))
        throw new Error("Portal payments are being prepared.");
      setReview({ quote, spell });
    });
  }

  async function confirm() {
    if (!review) return;
    return perform(async () => {
      const { account, client, signer } = await checkedContracts();
      if (!tracker) throw new Error("Transaction tracking is unavailable.");
      tracker.assertAvailable(`grade:${review.quote.tokenId}`);
      const id = generation.current;
      const fresh = await fetchPortalQuote(review.quote.tokenId, account);
      if (
        fresh.round.id !== review.quote.round.id ||
        fresh.portal?.payment.version !==
          review.quote.portal?.payment.version ||
        fresh.rubricId !== review.quote.rubricId ||
        fresh.artVersion !== review.quote.artVersion ||
        fresh.input.hash !== review.quote.input.hash ||
        fresh.competition?.address !== review.quote.competition?.address ||
        fresh.competition?.admissionHash !==
          review.quote.competition?.admissionHash
      )
        throw new Error(
          "The portal, challenge theme, price or artwork changed. Please review your spell again."
        );
      guard(id, account);
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const input = {
        chainId: fresh.deployment.chainId,
        grading: fresh.deployment.grading as Address,
        submitter: account,
        tokenId: BigInt(fresh.tokenId),
        artVersion: BigInt(fresh.artVersion),
        nonce: BigInt(fresh.nonce),
        spell: review.spell,
        salt
      };
      const expires = BigInt(
        Math.min(fresh.now + 600, Number(fresh.round.endsAt))
      );
      setPhase("Sign your spell in your wallet…");
      const signature = await signer.signTypedData({
        ...portalSpellSigningData(input, expires),
        account
      });
      guard(id, account);
      const commitment = portalSpellCommitment(input);
      const admission = portalAdmission(fresh, commitment);
      const uploadSpell = async () =>
        portalSpellReceiptSchema.parse(
          await portalRequest("/spells", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              submitter: account,
              tokenId: fresh.tokenId,
              artVersion: fresh.artVersion,
              nonce: fresh.nonce,
              spell: review.spell,
              salt,
              expiresAt: expires.toString(),
              signature,
              admissionHash: portalAdmissionHash(admission)
            })
          })
        );
      await uploadSpell();
      const allowance = await client.readContract({
        address: fresh.deployment.usdc as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, fresh.deployment.grading as Address]
      });
      guard(id, account);
      if (allowance < admission.maximumFee) {
        setPhase("Approve the USDC payment in your wallet…");
        const approval = await signer.writeContract({
          chain: client.chain,
          account,
          address: fresh.deployment.usdc as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [fresh.deployment.grading as Address, admission.maximumFee]
        });
        const approved = await client.waitForTransactionReceipt({
          hash: approval
        });
        const freshAllowance = await client.readContract({
          address: fresh.deployment.usdc as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, fresh.deployment.grading as Address],
          blockNumber: approved.blockNumber
        });
        if (
          approved.status !== "success" ||
          freshAllowance < admission.maximumFee
        )
          throw new Error("The USDC approval was not completed.");
        guard(id, account);
      }
      // Refresh after approval so wallet delays cannot silently reuse an old quote/receipt.
      setPhase("Verifying your saved spell…");
      const acknowledged = await uploadSpell();
      if (acknowledged.commitment.toLowerCase() !== commitment.toLowerCase())
        throw new Error("The saved spell does not match this submission.");
      const intakeReceipt = {
        expiresAt: BigInt(acknowledged.receipt.expiresAt),
        signature: acknowledged.receipt.signature as Hex
      };
      guard(id, account);
      setPhase("Confirm your spell submission…");
      const data = fresh.competition
        ? encodeFunctionData({
            abi: portalGradingAbi,
            functionName: "admitCompetition",
            args: [
              admission,
              fresh.competition.address as Address,
              fresh.competition.admissionHash as Hex,
              intakeReceipt
            ]
          })
        : encodeFunctionData({
            abi: portalGradingAbi,
            functionName: "admit",
            args: [admission, intakeReceipt]
          });
      let hash: Hex;
      if (fresh.competition) {
        const simulated = await client.simulateContract({
          account,
          address: fresh.deployment.grading as Address,
          abi: portalGradingAbi,
          functionName: "admitCompetition",
          args: [
            admission,
            fresh.competition.address as Address,
            fresh.competition.admissionHash as Hex,
            intakeReceipt
          ]
        });
        guard(id, account);
        hash = await signer.writeContract({
          ...simulated.request,
          chain: client.chain
        });
      } else {
        const simulated = await client.simulateContract({
          account,
          address: fresh.deployment.grading as Address,
          abi: portalGradingAbi,
          functionName: "admit",
          args: [admission, intakeReceipt]
        });
        guard(id, account);
        hash = await signer.writeContract({
          ...simulated.request,
          chain: client.chain
        });
      }
      setPhase("Waiting for confirmation…");
      const tracked = tracker.add(hash, {
        to: fresh.deployment.grading,
        data,
        value: "0",
        actionKey: `grade:${fresh.tokenId}`,
        label: `Submit card #${fresh.tokenId}`
      });
      setReview(null);
      const receipt = await tracker.wait(tracked.id, (value) => {
        if (generation.current === id) setPhase(value);
      });
      guard(id, account);
      const event = parseEventLogs({
        abi: portalGradingAbi,
        logs: receipt.logs,
        eventName: "GradingRequested"
      }).find(
        (log) =>
          log.address.toLowerCase() ===
            fresh.deployment.grading.toLowerCase() &&
          log.args.submitter?.toLowerCase() === account.toLowerCase() &&
          log.args.tokenId?.toString() === fresh.tokenId
      );
      if (receipt.status !== "success" || event?.args.requestId === undefined)
        throw new Error(
          "The submission was not accepted. Please check your wallet transaction."
        );
      setSubmitted({
        tokenId: fresh.tokenId,
        requestId: event.args.requestId.toString(),
        hash: receipt.transactionHash
      });
      setReview(null);
      await queries.invalidateQueries({ queryKey: ["portals"] });
    });
  }

  async function send(
    to: Address,
    data: Hex,
    value = 0n,
    intent?: {
      actionKey: string;
      validate: () => Promise<void>;
      onWalletRequest: () => void;
      onWalletRejected: () => void;
      onSubmitted: (hash: Hex) => void;
    }
  ) {
    return perform(async () => {
      const { account, client, signer, status } = await checkedContracts();
      const id = generation.current;
      if (
        ![
          status.deployment.collection,
          status.deployment.registry,
          status.deployment.grading
        ].some((a) => a.toLowerCase() === to.toLowerCase())
      )
        throw new Error("Unrecognized portal contract.");
      if (!tracker) throw new Error("Transaction tracking is unavailable.");
      const actionKey =
        intent?.actionKey ?? `${to.toLowerCase()}:${keccak256(data)}`;
      tracker.assertAvailable(actionKey);
      const decoded = decodeFunctionData({
        abi: [
          ...portalCollectionAbi,
          ...portalRegistryAbi,
          ...portalGradingAbi
        ],
        data
      });
      const labels: Record<string, string> = {
        configureKind: "Configure portal kind",
        mintBatch: "Commit portal mint",
        finishMint: "Deliver portal NFTs",
        setPaymentPolicy: "Update future portal fees",
        requestRotation: "Request next portal",
        activateNext: "Activate next portal"
      };
      if (intent) await intent.validate();
      guard(id, account);
      tracker.assertAvailable(actionKey);
      setPhase("Confirm in your wallet…");
      intent?.onWalletRequest();
      let hash: Hex;
      try {
        hash = await signer.sendTransaction({
          account,
          chain: client.chain,
          to,
          data,
          value
        });
      } catch (error) {
        const rejected =
          error instanceof BaseError &&
          error.walk((cause) => cause instanceof UserRejectedRequestError);
        const cancelled =
          rejected instanceof UserRejectedRequestError ||
          (error as { code?: unknown })?.code === 4001;
        if (cancelled) intent?.onWalletRejected();
        else if (intent)
          throw new Error(
            "The wallet did not return a transaction hash. The batch is saved; check its status before continuing."
          );
        throw error;
      }
      setPhase("Waiting for confirmation…");
      const tracked = tracker.add(hash, {
        to,
        data,
        value: value.toString(),
        actionKey,
        label: labels[decoded.functionName] ?? "Portal administration"
      });
      intent?.onSubmitted(hash);
      const receipt = await tracker.wait(tracked.id, (value) => {
        if (generation.current === id) setPhase(value);
      });
      guard(id, account);
      if (receipt.status !== "success")
        throw new Error("The portal transaction did not complete.");
      await queries.invalidateQueries({ queryKey: ["portals"] });
      return receipt;
    });
  }
  async function rotate() {
    if (!status || !client) return;
    if (status.rotation.canActivate)
      return send(
        status.deployment.registry as Address,
        encodeFunctionData({
          abi: portalRegistryAbi,
          functionName: "activateNext"
        })
      );
    if (status.rotation.requestId !== "0") {
      setError("The next portal is already being prepared.");
      return;
    }
    try {
      const gasPrice = await client.getGasPrice();
      const estimate = await client.readContract({
        address: status.deployment.registry as Address,
        abi: portalRegistryAbi,
        functionName: "quoteRandomness",
        args: [gasPrice]
      });
      const maximum = (estimate * 125n) / 100n;
      return send(
        status.deployment.registry as Address,
        encodeFunctionData({
          abi: portalRegistryAbi,
          functionName: "requestRotation",
          args: [maximum]
        }),
        maximum
      );
    } catch {
      setError("Could not estimate the next portal's randomness fee.");
    }
  }
  return {
    address,
    chainId,
    client,
    phase,
    busy: phase !== "idle",
    error,
    review,
    submitted,
    prepare,
    confirm,
    send,
    rotate,
    dismiss: () => {
      if (!busy.current) {
        setReview(null);
        setError(null);
      }
    },
    clearError: () => setError(null)
  };
}

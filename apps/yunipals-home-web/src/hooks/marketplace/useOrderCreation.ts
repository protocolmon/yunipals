import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  bytesToHex,
  getAddress,
  zeroAddress,
  type Address,
  type Hash
} from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient, signTypedData } from "wagmi/actions";

import { marketClient } from "@/hooks/marketplace/useMarketplace";
import { analyticsOperations } from "@/lib/analytics/operations";
import { inspectOrderCreation } from "@/lib/marketplace/creationState";
import {
  assertWalletContext,
  executeMarketTransaction,
  SubmittedTransactionError,
  type MarketExecutionStage
} from "@/lib/marketplace/executeTransaction";
import type {
  MarketAsset,
  MarketAssetId,
  MarketCapabilities,
  MarketOrder
} from "@/lib/marketplace/marketApi";
import type { OwnOrderPolicy } from "@/lib/marketplace/orderPolicy";
import type { OpenSeaOrderPolicy } from "@/lib/marketplace/openseaOrderPolicy";
import {
  createBnbPublicationIntent,
  publicationRequest,
  type PublicationIntent
} from "@/lib/marketplace/orderPublication";
import {
  readRecoverableOrders,
  saveRecoverableOrder
} from "@/lib/marketplace/orderRecovery";
import {
  pendingTransaction,
  readPendingTransactions,
  savePendingTransaction
} from "@/lib/marketplace/pendingTransactions";
import {
  publishOrder,
  retryPublication,
  SignedOrderPublicationError,
  type PublicationDependencies,
  type PublicationStage,
  type SignedOrder
} from "@/lib/marketplace/publishOrder";
import {
  marketplaceAssetKey,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  seaportReadAbi,
  type SeaportOrderComponents
} from "@/lib/marketplace/seaport";
import {
  buildBnbValidation,
  assertMarketReceipt,
  type MarketTransactionIntent
} from "@/lib/marketplace/transactionIntent";
import { verifySeaportOrderMaker } from "@/lib/marketplace/verifyOrderMaker";
import {
  isOpenSeaChain,
  openseaCurrencies
} from "@/lib/marketplace/openseaRegistry";
import { createOpenSeaPublicationIntent } from "@/lib/marketplace/openseaPublication";
import {
  acquireMarketplaceWallet,
  marketplaceWallet
} from "@/lib/marketplace/walletExecution";

type CreationStage =
  | "form"
  | "review"
  | "error"
  | "publication-unknown"
  | "needs-confirmation"
  | PublicationStage
  | MarketExecutionStage;
export function useOrderCreation(input: {
  asset: MarketAssetId;
  lifecycle: number;
  side: "listing" | "offer";
  replacing?: MarketOrder;
}) {
  const config = useConfig();
  const queries = useQueryClient();
  const [stage, setStage] = useState<CreationStage>("form");
  const [message, setMessage] = useState<string>();
  const [hash, setHash] = useState<Hash>();
  const [intent, setIntent] = useState<PublicationIntent>();
  const [prerequisite, setPrerequisite] =
    useState<MarketTransactionIntent | null>(null);
  const [published, setPublished] = useState<MarketOrder>();
  const [bnbOnchain, setBnbOnchain] = useState(false);
  const [needsRequirementsRefresh, setNeedsRequirementsRefresh] =
    useState(false);
  const signed = useRef<SignedOrder>();
  const replacementOrder = useRef<SeaportOrderComponents>();
  const signatureRequested = useRef(false);
  const running = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const clock = useRef({ timestamp: 0n, observedAt: 0 });
  useEffect(() => () => operation.current?.abort(), []);
  const now = () =>
    clock.current.timestamp +
    BigInt(
      Math.max(0, Math.floor((Date.now() - clock.current.observedAt) / 1000))
    );
  const client = getPublicClient(config, { chainId: input.asset.chainId });
  const api = marketClient;

  function requireClients() {
    if (!api || !client) throw new Error("Order creation is unavailable.");
    return { api, client };
  }
  async function source(signal: AbortSignal): Promise<{
    capabilities: MarketCapabilities;
    asset: MarketAsset;
    policy: OwnOrderPolicy | OpenSeaOrderPolicy;
  }> {
    const { api } = requireClients();
    const [capabilities, asset, policy] = await Promise.all([
      api.capabilities(signal),
      api.asset(input.asset, signal),
      isOpenSeaChain(input.asset.chain)
        ? api.openSeaPolicy(input.asset.chain, signal)
        : api.bnbPolicy(signal)
    ]);
    return { capabilities, asset, policy };
  }
  async function checkLocalOrders(
    value: PublicationIntent,
    blockNumber: bigint,
    timestamp: bigint
  ) {
    const { client } = requireClients();
    const records = readRecoverableOrders().filter(
      (record) =>
        marketplaceAssetKey(record.asset) ===
          marketplaceAssetKey(value.asset) &&
        getAddress(record.order.offerer) === getAddress(value.order.offerer) &&
        (record.order.offer[0]?.itemType === 2 ? "listing" : "offer") ===
          input.side &&
        record.orderHash.toLowerCase() !== value.orderHash.toLowerCase() &&
        record.orderHash.toLowerCase() !==
          input.replacing?.orderHash.toLowerCase() &&
        record.order.counter === value.order.counter &&
        record.order.endTime > timestamp
    );
    const unresolved = await Promise.all(
      records.map(async (record) => {
        const status = await client.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "getOrderStatus",
          args: [record.orderHash],
          blockNumber
        });
        return !status[1] && !(status[3] > 0n && status[2] >= status[3]);
      })
    );
    if (unresolved.some(Boolean))
      throw new Error(
        "A previous order for this NFT is saved in this browser. Check or cancel it in order recovery before publishing another."
      );
  }
  async function inspect(value: PublicationIntent, signal: AbortSignal) {
    const { client } = requireClients();
    const checked = await inspectOrderCreation(
      client,
      value,
      await source(signal),
      input.replacing && replacementOrder.current
        ? { summary: input.replacing, order: replacementOrder.current }
        : undefined
    );
    clock.current = { timestamp: checked.timestamp, observedAt: Date.now() };
    await checkLocalOrders(value, checked.blockNumber, checked.timestamp);
    signal.throwIfAborted();
    return checked;
  }
  async function pendingCheck(value: PublicationIntent) {
    const { client } = requireClients();
    for (const record of readPendingTransactions()) {
      const expected = record.expectation;
      if (
        expected.chainId !== input.asset.chainId ||
        getAddress(expected.account) !== getAddress(value.order.offerer)
      )
        continue;
      const sameAsset =
        "asset" in expected &&
        marketplaceAssetKey(expected.asset) ===
          marketplaceAssetKey(value.asset);
      const sameReplacement =
        expected.kind === "cancel" &&
        expected.orderHash.toLowerCase() ===
          input.replacing?.orderHash.toLowerCase();
      if (
        !sameAsset &&
        !sameReplacement &&
        expected.kind !== "wrap" &&
        expected.kind !== "approve-currency"
      )
        continue;
      try {
        const receipt = await client.getTransactionReceipt({
          hash: record.hash
        });
        if (receipt.status === "success")
          assertMarketReceipt(expected, receipt);
      } catch (error) {
        throw new SubmittedTransactionError(record.hash, error);
      }
    }
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    const release = acquireMarketplaceWallet();
    if (!release) {
      setMessage("Finish the current wallet request before starting another.");
      return;
    }
    running.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setMessage(undefined);
    setStage("preparing");
    try {
      await action(controller.signal);
    } catch (error) {
      if (error instanceof SignedOrderPublicationError) {
        signed.current = error.signed;
        setStage("publication-unknown");
        setMessage(error.message);
      } else if (error instanceof SubmittedTransactionError) {
        setHash(error.transactionHash);
        setStage("needs-confirmation");
        setMessage(error.message);
      } else {
        setStage("error");
        setMessage(
          error instanceof Error &&
            /user rejected|user denied/i.test(error.message)
            ? "Request rejected in your wallet. You can retry the same step."
            : error instanceof Error && error.name === "Error"
              ? error.message
              : "The order could not be prepared. Check your wallet, balance and network, then try again."
        );
      }
    } finally {
      running.current = false;
      release();
    }
  }

  const review = (grossAmount: bigint, duration: bigint, currency?: Address) =>
    run(async (signal) => {
      if (signatureRequested.current)
        throw new Error(
          "Retry or cancel the existing signing request before changing this order."
        );
      const { api, client } = requireClients();
      const maker = getAccount(config).address;
      if (!maker)
        throw new Error("Connect your wallet before reviewing an order.");
      const [initial, block] = await Promise.all([
        source(signal),
        client.getBlock()
      ]);
      clock.current = { timestamp: block.timestamp, observedAt: Date.now() };
      const counter = await client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [maker],
        blockNumber: block.number
      });
      const draft = {
        asset: input.asset,
        lifecycle: input.lifecycle,
        maker,
        side: input.side,
        grossAmount,
        endTime: block.timestamp + duration
      };
      const chainState = { timestamp: block.timestamp, counter };
      const salt = BigInt(
        bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
      );
      const value =
        "chain" in initial.policy
          ? createOpenSeaPublicationIntent(
              {
                ...draft,
                currency:
                  currency ??
                  (input.side === "offer" || input.asset.chain === "polygon"
                    ? openseaCurrencies[initial.policy.chain].address
                    : zeroAddress)
              },
              initial.policy,
              chainState,
              salt
            )
          : createBnbPublicationIntent(draft, initial.policy, chainState, salt);
      await pendingCheck(value);
      if (input.replacing) {
        if (
          getAddress(input.replacing.maker) !== getAddress(maker) ||
          input.replacing.side !== input.side ||
          marketplaceAssetKey(input.replacing.asset) !==
            marketplaceAssetKey(input.asset)
        )
          throw new Error(
            "The replacement must match your existing NFT order."
          );
        const raw = await api.cancellationOrder(input.replacing, maker, signal);
        replacementOrder.current = raw;
        // Cancellation remains possible even if recovery storage is unavailable.
        try {
          saveRecoverableOrder(
            {
              asset: input.replacing.asset,
              lifecycle: input.replacing.lifecycle,
              order: raw,
              orderHash: input.replacing.orderHash,
              summary: input.replacing
            },
            "accepted"
          );
        } catch {
          /* Existing recovery data is preserved. */
        }
      }
      const next = (await inspect(value, signal)).prerequisite;
      const discovery =
        value.asset.chain === "bnb"
          ? await api.bnbDiscoveryStatus(signal)
          : null;
      signal.throwIfAborted();
      if (
        getAddress(
          getAccount(config).address ??
            "0x0000000000000000000000000000000000000000"
        ) !== getAddress(maker)
      )
        throw new Error("Your wallet changed. Review the order again.");
      setIntent(value);
      setBnbOnchain(discovery?.mode === "live");
      setPrerequisite(next);
      setStage("review");
      setHash(undefined);
    });

  const act = () =>
    run(async (signal) => {
      const { api, client } = requireClients();
      if (!intent) throw new Error("Review the order before continuing.");
      assertWalletContext(
        marketplaceWallet(config).context(),
        { chainId: intent.asset.chainId, account: intent.order.offerer },
        false
      );
      if (!signed.current) await pendingCheck(intent);
      if (needsRequirementsRefresh) {
        const next = await inspect(intent, signal);
        setPrerequisite(next.prerequisite);
        setNeedsRequirementsRefresh(false);
        setStage("review");
        setMessage("Transaction confirmed. Review the next step when ready.");
        return;
      }
      if (prerequisite) {
        if (prerequisite.kind === "cancel") {
          const previous = await client.readContract({
            address: seaportDeployment.address,
            abi: seaportReadAbi,
            functionName: "getOrderStatus",
            args: [prerequisite.orderHash]
          });
          if (previous[1]) {
            setPrerequisite((await inspect(intent, signal)).prerequisite);
            setStage("review");
            setMessage(
              "Previous order is already cancelled. Review the next step."
            );
            return;
          }
        }
        if (prerequisite.kind !== "cancel") {
          const current = (await inspect(intent, signal)).prerequisite;
          if (
            !current ||
            current.to.toLowerCase() !== prerequisite.to.toLowerCase() ||
            current.data !== prerequisite.data ||
            current.value !== prerequisite.value
          ) {
            setPrerequisite(current);
            setStage("review");
            setMessage(
              "Balances or approvals changed. Review the updated next step."
            );
            return;
          }
        }
        let previousHash: Hash | undefined;
        await executeMarketTransaction(
          prerequisite,
          marketplaceWallet(config),
          {
            signal,
            revalidate:
              prerequisite.kind === "cancel"
                ? undefined
                : async () => {
                    const current = (await inspect(intent, signal))
                      .prerequisite;
                    if (
                      !current ||
                      current.data !== prerequisite.data ||
                      current.value !== prerequisite.value
                    )
                      throw new Error(
                        "The approval or wrapping amount changed. Review the step again."
                      );
                  },
            onStage: setStage,
            onSubmitted: (nextHash) => {
              savePendingTransaction(
                pendingTransaction(nextHash, prerequisite),
                previousHash
              );
              previousHash = nextHash;
              setHash(nextHash);
            }
          }
        );
        // The transaction is already confirmed even if the market source is
        // briefly behind. A failed refresh must not leave its old wallet action
        // on screen or turn a later retry into an unexpected signing request.
        setPrerequisite(null);
        setNeedsRequirementsRefresh(true);
        const next = await inspect(intent, signal);
        setPrerequisite(next.prerequisite);
        setNeedsRequirementsRefresh(false);
        setStage("review");
        setMessage(
          prerequisite.kind === "cancel"
            ? "Previous order cancelled. Review the replacement before signing."
            : "Transaction confirmed. Review the next step when ready."
        );
        return;
      }
      const bnbDiscovery =
        intent.asset.chain === "bnb"
          ? await api.bnbDiscoveryStatus(signal)
          : null;
      if (bnbOnchain && bnbDiscovery?.mode !== "live")
        throw new Error(
          "BNB publication mode changed. Close and review the order again."
        );
      if (bnbDiscovery?.mode === "live") {
        if (bnbDiscovery.coverage !== "complete")
          throw new Error(
            "BNB on-chain order publication is still syncing. Try again after discovery catches up."
          );
        const current = await inspect(intent, signal);
        if (current.prerequisite) {
          setPrerequisite(current.prerequisite);
          throw new Error(
            "An approval or balance changed. Complete the updated step before publishing."
          );
        }
        const validation = buildBnbValidation(
          intent.order,
          intent.asset,
          intent.orderHash,
          intent.order.offerer
        );
        // Persist cancellation parameters before the wallet request. A missing
        // receipt can be checked from the saved transaction after a reload.
        saveRecoverableOrder(intent, "publication-unknown");
        let previousHash: Hash | undefined;
        await executeMarketTransaction(validation, marketplaceWallet(config), {
          signal,
          onStage: setStage,
          revalidate: async () => {
            const refreshed = await inspect(intent, signal);
            if (refreshed.prerequisite)
              throw new Error(
                "Order requirements changed. Review the action again."
              );
            const status = await api.bnbDiscoveryStatus(signal);
            if (status.mode !== "live" || status.coverage !== "complete")
              throw new Error("BNB discovery is temporarily unavailable.");
          },
          onSubmitted: (nextHash) => {
            savePendingTransaction(
              pendingTransaction(nextHash, validation),
              previousHash
            );
            previousHash = nextHash;
            setHash(nextHash);
          }
        });
        saveRecoverableOrder(intent, "accepted");
        let indexed: MarketOrder | null = null;
        try {
          indexed = await api.publishedOwnOrder(
            intent.orderHash,
            signal,
            "bnb"
          );
        } catch {
          // The receipt is authoritative; indexer availability can lag it.
        }
        setPublished(indexed ?? intent.summary);
        analyticsOperations.published(
          intent.asset.chainId,
          intent.orderHash,
          input.side
        );
        setStage("published");
        setMessage(
          indexed
            ? "Order validated on chain and indexed."
            : "Order validated on chain. It will appear when the shared indexer catches up; your receipt and cancellation parameters are saved."
        );
        void Promise.allSettled(
          ["marketplace", "collection", "collector"].map((key) =>
            queries.invalidateQueries({ queryKey: [key] })
          )
        );
        return;
      }
      const dependencies: PublicationDependencies = {
        wallet: {
          context: marketplaceWallet(config).context,
          switchChain: marketplaceWallet(config).switchChain,
          sign: (data) =>
            signTypedData(config, { ...data, account: intent.order.offerer }),
          verify: async (_, signature) =>
            verifySeaportOrderMaker(
              client,
              intent.asset.chain,
              intent.order,
              signature,
              await client.getBlockNumber({ cacheTime: 0 })
            )
        },
        api: {
          lookup: (value, requestSignal) =>
            api.publishedOwnOrder(
              value.orderHash,
              requestSignal,
              value.asset.chain
            ),
          prepare: (value, requestSignal) =>
            api.prepareOwnOrder(value, requestSignal),
          submit: (value, requestSignal) =>
            api.publishOwnOrder(
              {
                ...publicationRequest(value.intent),
                preparationId: value.preparationId,
                signature: value.signature
              },
              requestSignal
            )
        },
        revalidate: async (value) => {
          const current = await inspect(value, signal);
          if (current.prerequisite) {
            setPrerequisite(current.prerequisite);
            throw new Error(
              "An approval or balance changed. Complete the updated step before signing."
            );
          }
        },
        save: saveRecoverableOrder,
        onStage: (nextStage) => {
          if (nextStage === "signing") signatureRequested.current = true;
          setStage(nextStage);
        },
        now,
        signal
      };
      const result = signed.current
        ? await retryPublication(signed.current, dependencies)
        : await publishOrder(intent, dependencies);
      setPublished(result);
      analyticsOperations.published(
        intent.asset.chainId,
        intent.orderHash,
        input.side
      );
      setStage("published");
      signed.current = undefined;
      // Refresh read views after success without holding the wallet lock on
      // unrelated history/provider requests. Each new action revalidates itself.
      void Promise.allSettled(
        ["marketplace", "collection", "collector"].map((key) =>
          queries.invalidateQueries({ queryKey: [key] })
        )
      );
    });
  return {
    stage,
    message,
    hash,
    intent,
    prerequisite,
    published,
    bnbOnchain,
    needsRequirementsRefresh,
    review,
    act,
    canEdit:
      !signatureRequested.current &&
      !running.current &&
      stage !== "needs-confirmation",
    edit: () => {
      if (!signatureRequested.current && !running.current) {
        setStage("form");
        setIntent(undefined);
        setBnbOnchain(false);
        setPrerequisite(null);
        setNeedsRequirementsRefresh(false);
        setMessage(undefined);
      }
    }
  };
}

import { decodeEventLog, erc721Abi, parseEventLogs, type Hex } from "viem";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { seaportRuntimeHashes } from "@protopals/yunipals-market-core/seaportRuntime";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { validateTransactionReceipt } from "@protopals/yunipals-market-core/receiptEvidence";
import { observeMarketSale } from "@protopals/yunipals-market-core/settledSale";

import {
  saleProofJson,
  type CollectionSaleProof
} from "./collectionSaleProjection";
import type { SharedMarketPage } from "./sharedCollectionSales";

export class SharedBnbSalePageCapacityError extends Error {}

export type SharedBnbAdmittedOrder = {
  order_hash: Hex;
  summary: unknown;
  components: unknown;
};
const protocol = seaportDeployment.address.toLowerCase();
const collection = marketplaceChains.bnb.contractAddress.toLowerCase();
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);

/** Validate complete shared receipts before selecting an admitted order. A
 * receipt-level fulfillment is considered even when its transfer is on a later
 * page, so multi-transfer transactions cannot lose accepted-order settlements. */
export function sharedBnbReceiptCandidates(page: SharedMarketPage) {
  if (
    page.status.source.id !== "ownership:bnb" ||
    page.status.source.chainId !== 56 ||
    page.status.source.address !== collection ||
    page.status.source.feature !== "ownership"
  )
    throw new Error("Shared BNB sale page belongs to another collection.");
  const groups = new Map<string, SharedMarketPage["events"]>();
  for (const event of page.events.filter(
    (event) => event.name === "Transfer"
  )) {
    if (
      event.chainId !== 56 ||
      event.address !== collection ||
      event.data !== "0x" ||
      event.topics.length !== 4 ||
      !record(event.args)
    )
      throw new Error("Invalid shared BNB transfer.");
    const decoded = decodeEventLog({
      abi: erc721Abi,
      eventName: "Transfer",
      data: event.data,
      topics: event.topics as [Hex, ...Hex[]],
      strict: true
    });
    if (
      decoded.args.from.toLowerCase() !== event.args.from ||
      decoded.args.to.toLowerCase() !== event.args.to ||
      decoded.args.tokenId.toString() !== event.args.tokenId
    )
      throw new Error("Shared BNB transfer differs from its ABI payload.");
    const key = `${event.blockHash}:${event.transactionHash}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups].map(([key, events]) => {
    const evidence = page.receipts.find(
      (row) => `${row.block_hash}:${row.transaction_hash}` === key
    );
    const rawBlock = evidence?.block;
    if (
      !evidence ||
      evidence.chain_id !== 56 ||
      !record(rawBlock) ||
      !decimal(rawBlock.number) ||
      !decimal(rawBlock.timestamp) ||
      !hash(rawBlock.hash) ||
      !hash(rawBlock.parentHash) ||
      events.some(
        (event) =>
          event.blockNumber !== rawBlock.number ||
          event.blockHash !== rawBlock.hash ||
          event.timestamp !== rawBlock.timestamp
      )
    )
      throw new Error("Shared BNB sale lacks its receipt/block evidence.");
    const block = {
      number: BigInt(rawBlock.number),
      hash: rawBlock.hash,
      timestamp: BigInt(rawBlock.timestamp)
    };
    const { receipt, hasSeaport } = validateTransactionReceipt(
      {
        chainId: 56,
        blockNumber: block.number,
        blockHash: block.hash,
        transactionHash: evidence.transaction_hash
      },
      evidence.receipt,
      { ...block, parentHash: rawBlock.parentHash },
      events.map((event) => ({
        address: event.address,
        logIndex: event.logIndex,
        transactionIndex: event.transactionIndex,
        data: event.data,
        topics: event.topics
      }))
    );
    if (hasSeaport && rawBlock.seaportRuntimeHash !== seaportRuntimeHashes[56])
      throw new Error(
        "Shared BNB receipt lacks the approved Seaport runtime proof."
      );
    const logs = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: receipt.logs,
      strict: true
    }).filter((log) => log.address.toLowerCase() === protocol);
    return { receipt, block, logs, evidence, event: events[0]! };
  });
}

export function decodeSharedBnbSaleProofs(
  candidates: ReturnType<typeof sharedBnbReceiptCandidates>,
  orders: readonly SharedBnbAdmittedOrder[]
): CollectionSaleProof[] {
  const known = new Map(
    orders.map((order) => [order.order_hash.toLowerCase(), order])
  );
  const proofs: CollectionSaleProof[] = [];
  for (const candidate of candidates) {
    for (const log of candidate.logs) {
      const row = known.get(log.args.orderHash.toLowerCase());
      if (!row) continue;
      const order = parseMarketOrder(row.summary);
      if (
        order.asset.chainId !== 56 ||
        order.asset.contractAddress.toLowerCase() !== collection ||
        order.source !== "yunipals" ||
        order.orderHash.toLowerCase() !== row.order_hash ||
        seaportOrderHash(decodeSeaportOrder(row.components)).toLowerCase() !==
          row.order_hash
      )
        throw new Error("Stored shared BNB sale order provenance mismatch.");
      const sale = observeMarketSale(order, candidate.receipt, candidate.block);
      if (
        sale.fulfillmentLogIndex !== log.logIndex ||
        sale.blockHash !== candidate.block.hash ||
        sale.transactionHash !== candidate.receipt.transactionHash
      )
        throw new Error("Shared BNB receipt differs from its fulfillment.");
      if (proofs.length === 512)
        throw new SharedBnbSalePageCapacityError(
          "Shared BNB sale page exceeds fulfillment capacity."
        );
      const receipt = saleProofJson(candidate.receipt),
        block = saleProofJson(candidate.block);
      if (
        Buffer.byteLength(receipt) > 1048576 ||
        Buffer.byteLength(block) > 4096
      )
        throw new Error(
          "Shared BNB sale proof exceeds retained receipt capacity."
        );
      proofs.push({
        sale,
        receipt,
        block,
        blockNumber: candidate.block.number,
        blockHash: candidate.block.hash,
        transactionHash: candidate.receipt.transactionHash,
        logIndex: sale.fulfillmentLogIndex
      });
    }
  }
  return proofs;
}

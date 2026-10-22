import { decodeEventLog, erc721Abi, parseEventLogs, type Hex } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { seaportRuntimeHashes } from "@protopals/yunipals-market-core/seaportRuntime";
import { observeCollectionSales } from "@protopals/yunipals-market-core/settledSale";
import { validateTransactionReceipt } from "@protopals/yunipals-market-core/receiptEvidence";
import type { readMarketplacePage } from "@protopals/yunipals-indexer-server/marketplace";
import {
  saleProofJson,
  type CollectionSaleProof
} from "./collectionSaleProjection";

export type SharedMarketPage = Awaited<ReturnType<typeof readMarketplacePage>>;
export class SalePageCapacityError extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);

/** Same receipt parser and price/exclusion rules as the RPC replay. This
 * adapter hydrates the shared raw RPC evidence, never fetches another receipt. */
export function decodeSharedCollectionSales(
  chain: OpenSeaChain,
  page: SharedMarketPage
): CollectionSaleProof[] {
  const config = marketplaceChains[chain],
    collection = config.contractAddress.toLowerCase(),
    protocol = seaportDeployment.address.toLowerCase();
  if (
    page.status.source.chainId !== config.chainId ||
    page.status.source.address !== collection ||
    page.status.source.feature !== "ownership"
  )
    throw new Error("Shared sale page belongs to another collection.");
  const transfers = page.events.filter((event) => event.name === "Transfer");
  const groups = new Map<string, typeof transfers>();
  for (const event of transfers) {
    if (
      event.chainId !== config.chainId ||
      event.address !== collection ||
      event.data !== "0x" ||
      event.topics.length !== 4 ||
      !record(event.args)
    )
      throw new Error("Invalid indexed collection transfer.");
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
      throw new Error("Indexed transfer differs from its ABI payload.");
    const key = `${event.blockHash}:${event.transactionHash}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const proofs: CollectionSaleProof[] = [];
  for (const [key, events] of groups) {
    const evidence = page.receipts.find(
      (row) => `${row.block_hash}:${row.transaction_hash}` === key
    );
    const rawBlock = evidence?.block;
    if (
      !evidence ||
      !record(rawBlock) ||
      !decimal(rawBlock.number) ||
      !decimal(rawBlock.timestamp) ||
      !hash(rawBlock.hash) ||
      !hash(rawBlock.parentHash) ||
      evidence.chain_id !== config.chainId ||
      events.some(
        (event) =>
          event.blockNumber !== rawBlock.number ||
          event.blockHash !== rawBlock.hash ||
          event.timestamp !== rawBlock.timestamp
      )
    )
      throw new Error(
        "Indexed sale is missing its canonical receipt/block evidence."
      );
    const block = {
      number: BigInt(rawBlock.number),
      hash: rawBlock.hash,
      timestamp: BigInt(rawBlock.timestamp)
    };
    const { receipt, hasSeaport } = validateTransactionReceipt(
      {
        chainId: config.chainId,
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
    if (
      hasSeaport &&
      rawBlock.seaportRuntimeHash !==
        seaportRuntimeHashes[
          config.chainId as keyof typeof seaportRuntimeHashes
        ]
    )
      throw new Error(
        "Shared receipt lacks the approved Seaport runtime proof."
      );
    const logs = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: receipt.logs,
      strict: true
    }).filter(
      (log) =>
        log.address.toLowerCase() === protocol &&
        [...log.args.offer, ...log.args.consideration].some(
          (item) =>
            item.itemType >= 2 && item.token.toLowerCase() === collection
        )
    );
    if (!logs.length) continue;
    if (proofs.length + logs.length > 512)
      throw new SalePageCapacityError(
        "Shared sale page exceeds bounded fulfillment capacity."
      );
    const encoded = saleProofJson(receipt),
      encodedBlock = saleProofJson(block);
    if (
      Buffer.byteLength(encoded) > 1048576 ||
      Buffer.byteLength(encodedBlock) > 4096
    )
      throw new Error("Receipt exceeds durable proof capacity.");
    for (const { logIndex, sale } of observeCollectionSales(
      chain,
      receipt,
      block,
      logs.map((log) => log.logIndex!)
    ))
      proofs.push({
        sale,
        receipt: encoded,
        block: encodedBlock,
        blockNumber: block.number,
        blockHash: block.hash,
        transactionHash: receipt.transactionHash,
        logIndex
      });
  }
  return proofs;
}

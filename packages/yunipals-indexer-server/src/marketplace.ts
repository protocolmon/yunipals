import type { ConfirmationPolicy } from "../../yunipals-indexer-client/src/sources.js";
import type { CanonicalCursor } from "../../yunipals-indexer-client/src/events.js";
import type { IndexerReader, CanonicalPageOptions } from "./readers.js";
import { CanonicalSourceUnavailable } from "./paging.js";
import { transactionEvidenceHash } from "./identity.js";

export type MarketplaceReadDefinition = {
  sourceId: string;
  chainId: number;
  address: string;
  abiHash: string;
  feature: "ownership" | "marketplace";
};

/** Collection-transfer discovery and BNB publication discovery share the
 * canonical pager. Required full receipts must never become an empty scan. */
export async function readMarketplacePage(
  reader: IndexerReader,
  definition: MarketplaceReadDefinition,
  policy: ConfirmationPolicy,
  cursor: CanonicalCursor | null,
  options: Pick<CanonicalPageOptions, "limit" | "verifyOldAnchor"> = {}
) {
  const source = reader.release.manifest.sources.find(
    (source) => source.id === definition.sourceId
  );
  if (
    !source?.enabled ||
    source.chainId !== definition.chainId ||
    source.address !== definition.address ||
    source.abiHash !== definition.abiHash ||
    source.feature !== definition.feature ||
    source.receiptRequirement !== "full" ||
    ![1, 56, 137, 8453].includes(definition.chainId) ||
    !/^0x[0-9a-f]{40}$/.test(definition.address) ||
    !/^0x[0-9a-f]{64}$/.test(definition.abiHash) ||
    !source.startBlock ||
    (definition.feature === "ownership" &&
      !source.events.includes("Transfer")) ||
    (definition.feature === "marketplace" &&
      (!source.events.includes("OrderValidated") ||
        !source.events.includes("CounterIncremented")))
  )
    throw new CanonicalSourceUnavailable(
      "Marketplace source differs from the registered decoder."
    );
  const page = await reader.page(source.id, policy, {
    ...options,
    cursor,
    includeReceipts: true
  });
  const receipts = new Map(
    page.receipts.map((receipt) => [
      `${receipt.block_hash}:${receipt.transaction_hash}`,
      receipt
    ])
  );
  if (
    receipts.size !== page.receipts.length ||
    page.receipts.some(
      (receipt) =>
        receipt.chain_id !== definition.chainId ||
        transactionEvidenceHash(receipt.receipt, receipt.block) !==
          receipt.payload_hash
    )
  )
    throw new CanonicalSourceUnavailable(
      "Marketplace receipt evidence is invalid."
    );
  for (const event of page.events)
    if (
      event.sourceId !== source.id ||
      event.chainId !== source.chainId ||
      event.address !== source.address ||
      event.abiHash !== source.abiHash ||
      ((definition.feature === "marketplace" || event.name === "Transfer") &&
        !receipts.has(`${event.blockHash}:${event.transactionHash}`))
    )
      throw new CanonicalSourceUnavailable(
        "Marketplace event is missing its complete receipt."
      );
  const status = await reader.status(source.id, policy);
  if (
    !["ready", "catching_up"].includes(status.readiness.reason) ||
    !status.anchor
  )
    throw new CanonicalSourceUnavailable("Marketplace source is unavailable.");
  return { ...page, status };
}

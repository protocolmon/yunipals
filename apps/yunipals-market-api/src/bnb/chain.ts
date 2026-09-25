import {
  erc20Abi,
  erc721Abi,
  getAddress,
  parseAbiItem,
  zeroAddress,
  type PublicClient
} from "viem";
import type { OwnOrderSummary } from "@protopals/yunipals-market-core/orderPolicy";
import {
  bnbOfferCurrency,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { verifySeaportOrderMaker } from "@protopals/yunipals-market-core/verifyOrderMaker";

import type { IndexedBnbAsset } from "@/bnb/indexer";
import { BnbOrderError, type BnbOrderRequest } from "@/bnb/orders";
import {
  assertBnbObservationCurrent,
  readBnbProtocolState,
  type BnbObservation,
  type BnbProtocolState
} from "@/bnb/protocol";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

export type BnbAdmissionObservation = BnbObservation;

export async function inspectBnbAdmission(
  client: PublicClient,
  input: BnbOrderRequest,
  summary: OwnOrderSummary,
  indexed: IndexedBnbAsset,
  options: {
    confirmations: bigint;
    indexerMaxAgeMs: number;
    finality?: "confirmations" | "finalized";
    now?: () => number;
    deferCurrentCheck?: boolean;
  },
  protocolState?: BnbProtocolState
): Promise<BnbAdmissionObservation> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  if (
    options.confirmations < 1n ||
    (options.finality !== undefined &&
      options.finality !== "confirmations" &&
      options.finality !== "finalized") ||
    !Number.isSafeInteger(options.indexerMaxAgeMs) ||
    options.indexerMaxAgeMs < 1000 ||
    options.indexerMaxAgeMs > 720000
  )
    throw new Error("Invalid BNB observation configuration.");
  if (
    indexed.burned ||
    indexed.hidden ||
    indexed.lifecycle !== input.lifecycle ||
    indexed.owner === zeroAddress
  )
    throw new BnbOrderError("asset_changed");
  const state =
    protocolState ??
    (await readBnbProtocolState(client, input, now, options.finality));
  if (state.orderHash.toLowerCase() !== input.hash.toLowerCase())
    throw new BnbOrderError("protocol_observation_mismatch", 503);
  const block = state.observed;
  const finalityNumber =
    options.finality === "finalized"
      ? block.finalizedNumber
      : block.number - options.confirmations;
  if (finalityNumber === undefined)
    throw new BnbOrderError("chain_finality_unavailable", 503);
  if (
    indexed.checkpoint.number > block.number ||
    indexed.lastTransfer.blockNumber > finalityNumber ||
    indexed.checkpoint.updatedAt.getTime() > startedAt + 30000 ||
    startedAt - indexed.checkpoint.updatedAt.getTime() > options.indexerMaxAgeMs
  )
    throw new BnbOrderError("indexer_not_finalized_or_stale", 503);
  if (
    input.order.startTime > block.timestamp ||
    input.order.endTime <= block.timestamp
  )
    throw new BnbOrderError("order_not_active");
  const [cursor, owner, transfers] = await Promise.all([
    client.getBlock({ blockNumber: indexed.checkpoint.number }),
    client.readContract({
      address: input.asset.contractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [summary.tokenId],
      blockNumber: block.number
    }),
    client.getLogs({
      address: input.asset.contractAddress,
      event: transferEvent,
      args: { tokenId: summary.tokenId },
      fromBlock: indexed.checkpoint.number + 1n,
      toBlock: block.number,
      strict: true
    })
  ]);
  if (
    cursor.hash?.toLowerCase() !== indexed.checkpoint.hash.toLowerCase() ||
    cursor.timestamp > block.timestamp ||
    (block.timestamp - cursor.timestamp) * 1000n >
      BigInt(options.indexerMaxAgeMs)
  )
    throw new BnbOrderError("indexer_checkpoint_invalid", 503);
  // Ownership can return to the same address after a transfer or burn/remint.
  // Do not mistake equal ownerOf values for an up-to-date lifecycle observation.
  if (transfers.length || getAddress(owner) !== indexed.owner)
    throw new BnbOrderError("asset_still_syncing", 503);
  const owns = getAddress(owner) === getAddress(summary.maker);
  if (summary.side === "listing" ? !owns : owns)
    throw new BnbOrderError("maker_ownership_mismatch");
  if (
    state.counter !== input.order.counter ||
    state.cancelled ||
    state.filled > 0n
  )
    throw new BnbOrderError("order_invalidated");
  if (input.signature === "0x" && !state.validated)
    throw new BnbOrderError("order_not_validated");
  if (summary.side === "listing") {
    const [operator, approved] = await Promise.all([
      client.readContract({
        address: input.asset.contractAddress,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [summary.maker, seaportDeployment.address],
        blockNumber: block.number
      }),
      client.readContract({
        address: input.asset.contractAddress,
        abi: erc721Abi,
        functionName: "getApproved",
        args: [summary.tokenId],
        blockNumber: block.number
      })
    ]);
    if (
      !operator &&
      getAddress(approved) !== getAddress(seaportDeployment.address)
    )
      throw new BnbOrderError("nft_approval_required");
  } else {
    const [balance, allowance] = await Promise.all([
      client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [summary.maker],
        blockNumber: block.number
      }),
      client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [summary.maker, seaportDeployment.address],
        blockNumber: block.number
      })
    ]);
    if (balance < summary.grossAmount || allowance < summary.grossAmount)
      throw new BnbOrderError("offer_funding_required");
  }
  if (
    input.signature && input.signature !== "0x" &&
    !(await verifySeaportOrderMaker(
      client,
      "bnb",
      input.order,
      input.signature,
      block.number
    ))
  )
    throw new BnbOrderError("invalid_maker_signature", 400);
  // Fulfillment checks the same anchor after its settlement simulation, so
  // checking it here as well only duplicates RPC reads on that path.
  if (!options.deferCurrentCheck)
    await assertBnbObservationCurrent(client, block, now);
  return block;
}

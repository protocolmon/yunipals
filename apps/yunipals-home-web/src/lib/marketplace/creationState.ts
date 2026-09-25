import { erc20Abi, erc721Abi, getAddress, type PublicClient } from "viem";

import type {
  MarketAsset,
  MarketCapabilities,
  MarketOrder
} from "@/lib/marketplace/marketApi";
import {
  assertOrderActiveAt,
  validateOwnSeaportOrder,
  type OwnOrderPolicy
} from "@/lib/marketplace/orderPolicy";
import type { PublicationIntent } from "@/lib/marketplace/orderPublication";
import type { OpenSeaOrderPolicy } from "@/lib/marketplace/openseaOrderPolicy";
import { assertOpenSeaCreationPolicy } from "@/lib/marketplace/openseaPublication";
import {
  buildOpenSeaApproval,
  buildOpenSeaWrap
} from "@/lib/marketplace/openseaActions";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openseaConduit
} from "@/lib/marketplace/openseaRegistry";
import { assertOpenSeaDeployment } from "@/lib/marketplace/openseaTradeState";
import {
  bnbOfferCurrency,
  marketplaceAssetKey,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  seaportReadAbi,
  type SeaportOrderComponents
} from "@/lib/marketplace/seaport";
import {
  buildBnbCurrencyAction,
  buildBnbNftApproval,
  buildSeaportCancellation,
  type MarketTransactionIntent
} from "@/lib/marketplace/transactionIntent";

export type OrderCreationState = {
  blockNumber: bigint;
  timestamp: bigint;
  prerequisite: MarketTransactionIntent | null;
};

/** Fresh API identity and pinned chain state are required before each signing step. */
export async function inspectOrderCreation(
  client: PublicClient,
  intent: PublicationIntent,
  source: {
    capabilities: MarketCapabilities;
    asset: MarketAsset;
    policy: OwnOrderPolicy | OpenSeaOrderPolicy;
  },
  replacement?: { summary: MarketOrder; order: SeaportOrderComponents }
): Promise<OrderCreationState> {
  const replacing = replacement?.summary;
  const chain = intent.asset.chain;
  const viaOpenSea = isOpenSeaChain(chain);
  if (viaOpenSea !== "chain" in source.policy)
    throw new Error("Unexpected order policy source.");
  const checked =
    "chain" in source.policy
      ? {
          side: intent.summary.side,
          grossAmount: BigInt(intent.summary.grossAmount)
        }
      : validateOwnSeaportOrder(intent.order, source.policy);
  const { asset } = source;
  const action = checked.side === "listing" ? "createListing" : "createOffer";
  if (
    !source.capabilities[chain]?.[action] ||
    asset.availability.evidence !== "current"
  )
    throw new Error("New orders are temporarily unavailable.");
  if (
    marketplaceAssetKey(asset.asset) !== marketplaceAssetKey(intent.asset) ||
    asset.lifecycle !== intent.lifecycle ||
    asset.burned ||
    asset.hidden
  )
    throw new Error(
      "This NFT changed or is hidden. Refresh it before creating an order."
    );
  if ((await client.getChainId()) !== intent.asset.chainId)
    throw new Error("The chain connection is on a different network.");
  const block = await client.getBlock();
  if ("chain" in source.policy)
    assertOpenSeaCreationPolicy(intent, source.policy, block.timestamp);
  assertOrderActiveAt(intent.order, block.timestamp);
  const spender = viaOpenSea
    ? openseaConduit.address
    : seaportDeployment.address;
  const [owner, counter, status] = await Promise.all([
    client.readContract({
      address: intent.asset.contractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(intent.asset.tokenId)],
      blockNumber: block.number
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getCounter",
      args: [intent.order.offerer],
      blockNumber: block.number
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [intent.orderHash],
      blockNumber: block.number
    })
  ]);
  if (getAddress(owner) !== getAddress(asset.owner))
    throw new Error(
      "Ownership is still syncing. Refresh the NFT before signing."
    );
  const owns = getAddress(owner) === getAddress(intent.order.offerer);
  if (checked.side === "listing" ? !owns : owns)
    throw new Error(
      checked.side === "listing"
        ? "Only the current NFT owner can list it."
        : "You already own this NFT."
    );
  if (counter !== intent.order.counter || status[1] || status[2] > 0n)
    throw new Error("The order counter or status changed. Review a new order.");
  if (viaOpenSea)
    await assertOpenSeaDeployment(client, block.number, intent.order.zone, [
      spender
    ]);
  const orders = checked.side === "listing" ? asset.listings : asset.offers;
  if (
    orders.some(
      (order) =>
        getAddress(order.maker) === getAddress(intent.order.offerer) &&
        order.orderHash.toLowerCase() !== intent.orderHash.toLowerCase() &&
        order.orderHash.toLowerCase() !== replacing?.orderHash.toLowerCase() &&
        (order.status === "active" || order.status === "unavailable") &&
        BigInt(order.endTime) > block.timestamp
    )
  )
    throw new Error(
      "Review and cancel your existing order for this NFT before creating another."
    );
  if (replacing) {
    if (
      replacing.side !== checked.side ||
      getAddress(replacing.maker) !== getAddress(intent.order.offerer) ||
      marketplaceAssetKey(replacing.asset) !== marketplaceAssetKey(intent.asset)
    )
      throw new Error("The replacement must match your existing NFT order.");
    const previous = await client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [replacing.orderHash],
      blockNumber: block.number
    });
    const cancellation = buildSeaportCancellation(
      chain,
      replacement!.order,
      replacing.orderHash,
      intent.order.offerer
    );
    if (!previous[1])
      return {
        blockNumber: block.number,
        timestamp: block.timestamp,
        prerequisite: cancellation
      };
  }
  if (checked.side === "listing") {
    const [operator, approved] = await Promise.all([
      client.readContract({
        address: intent.asset.contractAddress,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [intent.order.offerer, spender],
        blockNumber: block.number
      }),
      client.readContract({
        address: intent.asset.contractAddress,
        abi: erc721Abi,
        functionName: "getApproved",
        args: [BigInt(intent.asset.tokenId)],
        blockNumber: block.number
      })
    ]);
    return {
      blockNumber: block.number,
      timestamp: block.timestamp,
      prerequisite:
        operator || getAddress(approved) === getAddress(spender)
          ? null
          : viaOpenSea
            ? buildOpenSeaApproval(intent.asset, intent.order.offerer, {
                kind: "nft",
                token: intent.asset.contractAddress,
                tokenId: intent.asset.tokenId,
                spender
              })
            : buildBnbNftApproval(intent.asset, intent.order.offerer)
    };
  }
  const currency = viaOpenSea
    ? openSeaCurrency(chain, intent.summary.currency.address)
    : bnbOfferCurrency;
  const [balance, allowance] = await Promise.all([
    client.readContract({
      address: currency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [intent.order.offerer],
      blockNumber: block.number
    }),
    client.readContract({
      address: currency.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [intent.order.offerer, spender],
      blockNumber: block.number
    })
  ]);
  if (viaOpenSea && balance < checked.grossAmount) {
    if (!openSeaCurrency(chain, currency.address).canWrapNative)
      throw new Error(
        "You need more WETH on Polygon for this offer. Native POL cannot be wrapped into WETH."
      );
    if (
      (await client.getBalance({
        address: intent.order.offerer,
        blockNumber: block.number
      })) <
      checked.grossAmount - balance
    )
      throw new Error("Your ETH balance does not cover the missing WETH.");
  }
  return {
    blockNumber: block.number,
    timestamp: block.timestamp,
    prerequisite:
      balance < checked.grossAmount
        ? viaOpenSea
          ? buildOpenSeaWrap(
              chain,
              intent.order.offerer,
              currency.address,
              checked.grossAmount - balance
            )
          : buildBnbCurrencyAction(
              "wrap",
              intent.order.offerer,
              checked.grossAmount - balance
            )
        : allowance < checked.grossAmount
          ? viaOpenSea
            ? buildOpenSeaApproval(intent.asset, intent.order.offerer, {
                kind: "currency",
                token: currency.address,
                spender,
                amount: checked.grossAmount,
                fundedByOffer: false
              })
            : buildBnbCurrencyAction(
                "approve-currency",
                intent.order.offerer,
                checked.grossAmount
              )
          : null
  };
}

import {
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  maxUint256,
  zeroAddress,
  type Address
} from "viem";

import type { MarketAssetId } from "@/lib/marketplace/marketApi";
import type { OpenSeaApproval } from "@/lib/marketplace/openseaFulfillment";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openseaConduit,
  type OpenSeaChain
} from "@/lib/marketplace/openseaRegistry";
import {
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  wrappedNativeAbi,
  type MarketTransactionIntent
} from "@/lib/marketplace/transactionIntent";

export function isOpenSeaApprovalSpender(spender: Address) {
  return [
    getAddress(seaportDeployment.address),
    getAddress(openseaConduit.address)
  ].includes(getAddress(spender));
}

export function buildOpenSeaApproval(
  asset: MarketAssetId,
  actor: Address,
  approval: OpenSeaApproval
): MarketTransactionIntent {
  const chain = asset.chain;
  if (
    !isOpenSeaChain(chain) ||
    asset.chainId !== marketplaceChains[chain].chainId ||
    getAddress(asset.contractAddress) !==
      getAddress(marketplaceChains[chain].contractAddress) ||
    !isOpenSeaApprovalSpender(approval.spender)
  )
    throw new Error("Unsupported OpenSea approval target.");
  marketplaceAssetKey(asset);
  const common = {
    chainId: asset.chainId,
    account: getAddress(actor),
    to: getAddress(approval.token),
    value: 0n,
    spender: getAddress(approval.spender)
  };
  if (approval.kind === "nft") {
    if (
      getAddress(approval.token) !== getAddress(asset.contractAddress) ||
      approval.tokenId !== asset.tokenId
    )
      throw new Error("The NFT approval changed.");
    return {
      ...common,
      kind: "approve-nft",
      asset,
      data: encodeFunctionData({
        abi: erc721Abi,
        functionName: "approve",
        args: [common.spender, BigInt(asset.tokenId)]
      })
    };
  }
  const currency = openSeaCurrency(chain, approval.token);
  if (
    currency.address === zeroAddress ||
    approval.amount <= 0n ||
    approval.amount > maxUint256
  )
    throw new Error("The currency approval amount is invalid.");
  return {
    ...common,
    kind: "approve-currency",
    token: currency.address,
    amount: approval.amount,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [common.spender, approval.amount]
    })
  };
}

export function buildOpenSeaWrap(
  chain: OpenSeaChain,
  actor: Address,
  token: Address,
  amount: bigint
): MarketTransactionIntent {
  const currency = openSeaCurrency(chain, token);
  if (!currency.canWrapNative || amount <= 0n || amount > maxUint256)
    throw new Error(
      "This currency cannot be obtained by wrapping this chain's native token."
    );
  return {
    kind: "wrap",
    chainId: marketplaceChains[chain].chainId,
    account: getAddress(actor),
    to: currency.address,
    token: currency.address,
    amount,
    value: amount,
    data: encodeFunctionData({ abi: wrappedNativeAbi, functionName: "deposit" })
  };
}

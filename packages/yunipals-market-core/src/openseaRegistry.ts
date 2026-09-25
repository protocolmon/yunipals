import {
  getAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex
} from "viem";

import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";

// Official OpenSea SDK c32ad91f3e600fea376f7005781701b7b4b91c4e,
// src/constants.ts and src/utils/chain.ts. Deployment checks are separate from
// capability flags and must pass against the selected chain before trading.
export const openseaConduit = {
  key: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000",
  address: "0x1e0049783f008a0085193e00003d00cd54003c71",
  controller: "0x00000000f9490004c11cef243f5400493c00ad63"
} as const;
export const openseaSignedZone =
  "0x000056f7000000ece9003ca63978907a00ffd100" as const;
export const openseaCurrencies = {
  ethereum: {
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    symbol: "WETH",
    decimals: 18,
    canWrapNative: true
  },
  base: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: 18,
    canWrapNative: true
  },
  // Polygon WETH is bridged ETH; depositing native POL cannot produce WETH.
  polygon: {
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    symbol: "WETH",
    decimals: 18,
    canWrapNative: false
  }
} as const;
export type OpenSeaChain = keyof typeof openseaCurrencies;

export function isOpenSeaChain(chain: MarketplaceChain): chain is OpenSeaChain {
  return chain === "ethereum" || chain === "base" || chain === "polygon";
}
export function openSeaSpender(key: Hex): Address {
  if (key.toLowerCase() === zeroHash)
    return getAddress(seaportDeployment.address);
  if (key.toLowerCase() === openseaConduit.key)
    return getAddress(openseaConduit.address);
  throw new Error("This OpenSea transfer conduit is not supported.");
}
export function openSeaCurrency(chain: OpenSeaChain, address: Address) {
  if (getAddress(address) === zeroAddress)
    return {
      address: zeroAddress,
      symbol: marketplaceChains[chain].nativeSymbol,
      decimals: 18,
      canWrapNative: false
    };
  const currency = openseaCurrencies[chain];
  if (getAddress(address) === getAddress(currency.address))
    return { ...currency, address: getAddress(currency.address) };
  throw new Error("This OpenSea payment currency is not supported.");
}

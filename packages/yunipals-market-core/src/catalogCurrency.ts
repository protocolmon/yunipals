import { getAddress, zeroAddress, type Address } from "viem";

import { isOpenSeaChain, openseaCurrencies } from "./openseaRegistry";
import { marketplaceChains, type MarketplaceChain } from "./registry";

export type CatalogCurrencySelection =
  | "all"
  | "native"
  | "weth"
  | "unsupported";
export type CatalogPaymentCurrency = {
  key: "native" | "weth";
  address: Address;
  symbol: string;
  decimals: 18;
};

/** Prices are compared in one actual token on one chain, never by symbol alone. */
export function catalogCurrencies(
  chain: MarketplaceChain
): CatalogPaymentCurrency[] {
  return [
    {
      key: "native",
      address: zeroAddress,
      symbol: marketplaceChains[chain].nativeSymbol,
      decimals: 18
    },
    ...(isOpenSeaChain(chain)
      ? [
          {
            key: "weth" as const,
            address: getAddress(openseaCurrencies[chain].address),
            symbol: "WETH",
            decimals: 18 as const
          }
        ]
      : [])
  ];
}

export function catalogCurrency(
  chain: MarketplaceChain,
  selection: CatalogCurrencySelection
) {
  const currency = catalogCurrencies(chain).find(
    (currency) => currency.key === selection
  );
  if (!currency)
    throw new Error("Choose a supported listing currency for this chain.");
  return currency;
}

export function defaultCatalogCurrency(
  chain?: MarketplaceChain
): "native" | "weth" {
  return chain === "polygon" ? "weth" : "native";
}

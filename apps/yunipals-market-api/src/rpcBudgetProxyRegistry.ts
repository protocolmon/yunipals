import type { MarketplaceChain } from "@protopals/yunipals-market-core/registry";

export const rpcBudgetProxyPorts: Readonly<Record<MarketplaceChain, number>> = {
  ethereum: 19101,
  base: 19102,
  polygon: 19103,
  bnb: 19104
};

export const productionRpcBudgetProxyPorts: Readonly<
  Record<MarketplaceChain, number>
> = {
  ethereum: 19201,
  base: 19202,
  polygon: 19203,
  bnb: 19204
};

export const rpcBudgetWorkloadHeader = "x-yunipals-rpc-workload";

export type DelegatedRpcComputeWorkload =
  | "order_projection"
  | "sale"
  | "foreground";

export function isDelegatedRpcComputeWorkload(
  value: unknown
): value is DelegatedRpcComputeWorkload {
  return (
    value === "order_projection" || value === "sale" || value === "foreground"
  );
}

export function rpcBudgetProxyUrl(
  chain: MarketplaceChain,
  deployment: "staging" | "production" = "staging"
) {
  const ports =
    deployment === "production"
      ? productionRpcBudgetProxyPorts
      : rpcBudgetProxyPorts;
  return `http://127.0.0.1:${ports[chain]}`;
}

export function isRpcBudgetProxyUrl(value: string, chain?: MarketplaceChain) {
  try {
    const url = new URL(value);
    const ports = chain
      ? [rpcBudgetProxyPorts[chain], productionRpcBudgetProxyPorts[chain]]
      : [
          ...Object.values(rpcBudgetProxyPorts),
          ...Object.values(productionRpcBudgetProxyPorts)
        ];
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      ports.includes(Number(url.port)) &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isProductionRpcBudgetProxyUrl(
  value: string,
  chain?: MarketplaceChain
) {
  try {
    const url = new URL(value);
    const ports = chain
      ? [productionRpcBudgetProxyPorts[chain]]
      : Object.values(productionRpcBudgetProxyPorts);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      ports.includes(Number(url.port)) &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

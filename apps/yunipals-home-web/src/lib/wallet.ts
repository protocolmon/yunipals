import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { fallback } from "viem";
import { createConfig, http } from "wagmi";
import { base, bsc, mainnet, polygon } from "wagmi/chains";

import { environment } from "@/environment";

const rpcTransport = (urls: string[]) =>
  fallback(
    urls.map((url) =>
      http(url, {
        batch: true,
        retryCount: 1,
        timeout: 8_000
      })
    )
  );

const chainConfig = {
  chains: [mainnet, base, polygon, bsc] as const,
  transports: {
    [mainnet.id]: rpcTransport([
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org"
    ]),
    [base.id]: rpcTransport([
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org"
    ]),
    [polygon.id]: rpcTransport([
      "https://polygon.drpc.org",
      "https://polygon-bor-rpc.publicnode.com"
    ]),
    [bsc.id]: rpcTransport([
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed-public.bnbchain.org"
    ])
  }
};

export const walletConfig = environment.fixtures
  ? createConfig({
      ...chainConfig,
      connectors: [],
      multiInjectedProviderDiscovery: false
    })
  : getDefaultConfig({
      ...chainConfig,
      appName: "Yunipals",
      projectId: environment.walletConnectProjectId,
      wallets: environment.walletConnectProjectId
        ? undefined
        : [{ groupName: "Browser wallets", wallets: [injectedWallet] }]
    });

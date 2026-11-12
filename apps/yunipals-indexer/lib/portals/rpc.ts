import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type Hex
} from "viem";

export function portalRpcUrls(env: NodeJS.ProcessEnv) {
  const values = [
    env.PORTALS_RPC_URL,
    ...(env.PORTALS_RPC_FALLBACK_URLS ?? "").split(",")
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  const urls = [...new Set(values)];
  if (!env.PORTALS_RPC_URL?.trim() || urls.length > 3)
    throw new Error(
      "Configure a portal RPC and at most two fallback endpoints."
    );
  for (const value of urls) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid portal RPC configuration.");
    }
    const local =
      env.PORTALS_ALLOW_LOCAL_CHAIN === "true" &&
      Number(env.PORTALS_CHAIN_ID) === 31337 &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        "Portal RPC endpoints must use HTTPS without URL user information."
      );
  }
  return urls;
}

export function portalRpcTransport(urls: readonly string[]) {
  if (!urls.length) throw new Error("A portal RPC endpoint is required.");
  return fallback(
    urls.map((url) =>
      http(url, {
        timeout: 15_000,
        retryCount: 0
      })
    ),
    {
      rank: false,
      retryCount: 1,
      retryDelay: 500,
      // Public gateways sometimes misclassify missing receipts as invalid params.
      // A second endpoint may answer; an error is never converted into null.
      shouldThrow: () => false
    }
  );
}

export async function verifyPortalRpcChains(
  urls: readonly string[],
  chainId: number
) {
  for (const [index, url] of urls.entries()) {
    try {
      const client = createPublicClient({
        transport: http(url, { retryCount: 0, timeout: 15_000 })
      });
      if ((await client.getChainId()) !== chainId)
        throw new Error("wrong chain");
    } catch {
      // Endpoint URLs can contain API keys. Do not forward transport errors.
      throw new Error(
        `Portal RPC ${index + 1} is unavailable or on the wrong chain.`
      );
    }
  }
}

export type PortalRpcPreflightInput = {
  chainId: number;
  grading: Address;
  startBlock: bigint;
  knownTransaction: Hex;
  absentTransaction: Hex;
};

/** Read-only: no database, provider inference, wallet signing or broadcast. */
export async function preflightPortalRpc(
  urls: readonly string[],
  input: PortalRpcPreflightInput
) {
  if (
    input.startBlock < 1n ||
    input.absentTransaction === input.knownTransaction
  )
    throw new Error("Invalid RPC probe inputs.");
  const reports = [];
  for (const [index, url] of urls.entries()) {
    const client = createPublicClient({
      transport: http(url, { retryCount: 0, timeout: 15_000 })
    });
    const checks: Record<string, boolean> = {};
    let blockNumber: string | null = null;
    const check = async (name: string, action: () => Promise<boolean>) => {
      try {
        checks[name] = await action();
      } catch {
        checks[name] = false;
      }
    };
    await check(
      "chain",
      async () => (await client.getChainId()) === input.chainId
    );
    if (checks.chain) {
      await check("historicalCode", async () => {
        const code = await client.getCode({
          address: input.grading,
          blockNumber: input.startBlock
        });
        return !!code && code !== "0x";
      });
      await check("knownReceipt", async () => {
        const receipt = await client.getTransactionReceipt({
          hash: input.knownTransaction
        });
        const header = await client.getBlock({
          blockNumber: receipt.blockNumber
        });
        return (
          receipt.transactionHash.toLowerCase() ===
            input.knownTransaction.toLowerCase() &&
          receipt.status === "success" &&
          header.hash === receipt.blockHash
        );
      });
      await check(
        "missingTransaction",
        async () =>
          (await client.request({
            method: "eth_getTransactionByHash",
            params: [input.absentTransaction]
          })) === null
      );
      await check(
        "missingReceipt",
        async () =>
          (await client.request({
            method: "eth_getTransactionReceipt",
            params: [input.absentTransaction]
          })) === null
      );
      await check("historicalLogs", async () => {
        const head = await client.getBlockNumber({ cacheTime: 0 });
        if (head < input.startBlock) return false;
        const end =
          head < input.startBlock + 1999n ? head : input.startBlock + 1999n;
        const before = await client.getBlock({ blockNumber: end });
        const logs = await client.getLogs({
          address: input.grading,
          fromBlock: input.startBlock,
          toBlock: end
        });
        const after = await client.getBlock({ blockNumber: end });
        blockNumber = end.toString();
        return (
          before.hash === after.hash &&
          logs.every(
            (log) =>
              log.blockNumber !== null &&
              log.blockNumber >= input.startBlock &&
              log.blockNumber <= end &&
              log.address.toLowerCase() === input.grading.toLowerCase()
          )
        );
      });
    }
    reports.push({
      endpoint: index + 1,
      checks,
      blockNumber,
      ready:
        Object.keys(checks).length === 6 && Object.values(checks).every(Boolean)
    });
  }
  return {
    ready: reports.length > 0 && reports.every((report) => report.ready),
    reports
  };
}

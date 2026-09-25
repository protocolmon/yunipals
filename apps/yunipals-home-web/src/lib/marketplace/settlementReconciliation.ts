import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { TransactionReceipt } from "viem";

import { fetchToken } from "@/lib/yunipalsIndexer";
import {
  forgetSettlement,
  recordSettlement,
  settlementsKey,
  type ConfirmedSettlement
} from "@/lib/marketplace/confirmedSettlements";
import type { MarketReceiptExpectation } from "@/lib/marketplace/transactionIntent";
import type { createMarketClient } from "@/lib/marketplace/marketApi";

const running = new WeakMap<QueryClient, Map<string, AbortController>>();
const restarting = new WeakMap<QueryClient, Promise<void>>();
export async function restartMarketCatalog(
  client: QueryClient,
  resetPages = false
) {
  const existing = restarting.get(client);
  if (existing) return existing;
  const task = (async () => {
    const filters = {
      queryKey: ["marketplace", "catalog"],
      type: "active" as const
    };
    await client.cancelQueries(filters);
    // Normal infinite-query refetch starts at page one and follows fresh cursors,
    // retaining the loaded page count and viewport. Only a broken snapshot needs
    // to discard pagination explicitly.
    for (const [key] of resetPages ? client.getQueriesData(filters) : []) {
      client.setQueryData<InfiniteData<unknown>>(key, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.slice(0, 1),
              pageParams: [undefined]
            }
          : data
      );
    }
    await client.invalidateQueries(filters);
  })();
  restarting.set(client, task);
  try {
    await task;
  } finally {
    if (restarting.get(client) === task) restarting.delete(client);
  }
}
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
export function confirmSettlement(
  client: QueryClient,
  api: Pick<ReturnType<typeof createMarketClient>, "asset"> | null,
  expectation: MarketReceiptExpectation,
  receipt: TransactionReceipt,
  lifecycle?: number,
  readToken: typeof fetchToken = fetchToken
) {
  const entry = recordSettlement(client, expectation, receipt, lifecycle);
  if (!entry || !api) return;
  const tasks = running.get(client) ?? new Map<string, AbortController>();
  running.set(client, tasks);
  tasks.get(entry.id)?.abort();
  const controller = new AbortController();
  tasks.set(entry.id, controller);
  // Independent of modal/account changes. The existing receipt tracker verifies
  // recovery and rejects contradictory receipts; no extra recurring RPC loop.
  void (async () => {
    const started = Date.now();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(60_000)
    ]);
    void restartMarketCatalog(client).catch(() => {});
    try {
      for (const at of [0, 2000, 5000, 10000, 20000, 30000]) {
        await delay(Math.max(0, started + at - Date.now()), signal);
        const current = client
          .getQueryData<ConfirmedSettlement[]>(settlementsKey)
          ?.find((item) => item.id === entry.id);
        if (!current || current.blockHash !== entry.blockHash) return;
        try {
          // Collection visibility follows the ownership index directly. Do not
          // gate it on the separate marketplace read path, which can recover at
          // a different speed after the same confirmed transfer.
          const { token } = await readToken(
            entry.asset.chain,
            entry.asset.tokenId,
            signal
          );
          const transferBlock = /^\d+$/.test(token.lastTransferBlock)
            ? BigInt(token.lastTransferBlock)
            : null;
          if (
            transferBlock !== null &&
            transferBlock > BigInt(entry.blockNumber) &&
            token.owner.toLowerCase() !== entry.to.toLowerCase()
          ) {
            forgetSettlement(
              client,
              expectation.chainId,
              receipt.transactionHash
            );
            await restartMarketCatalog(client);
            await client.invalidateQueries({ queryKey: ["collector"] });
            return;
          }
          const indexed = Boolean(
            transferBlock !== null &&
              transferBlock >= BigInt(entry.blockNumber) &&
              token.owner.toLowerCase() === entry.to.toLowerCase()
          );
          client.setQueryData<ConfirmedSettlement[]>(
            settlementsKey,
            (items = []) =>
              items.map((item) =>
                item.id === entry.id && item.blockHash === entry.blockHash
                  ? {
                      ...item,
                      token: indexed
                        ? token
                        : {
                            ...token,
                            owner: item.to,
                            lastTransferBlock: item.blockNumber,
                            hidden: false
                          },
                      synced: indexed
                    }
                  : item
              )
          );
          if (!indexed) continue;
          await restartMarketCatalog(client);
          await Promise.all(
            ["marketplace", "collection", "collector"].map((key) =>
              client.invalidateQueries({
                queryKey: [key],
                predicate: (query) => query.queryKey[1] !== "catalog"
              })
            )
          );
          return;
        } catch {
          if (signal.aborted) return;
        }
      }
    } finally {
      if (tasks.get(entry.id) === controller) tasks.delete(entry.id);
    }
  })().catch(() => {});
}

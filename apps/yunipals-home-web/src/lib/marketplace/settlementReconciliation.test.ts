import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  confirmSettlement,
  restartMarketCatalog
} from "@/lib/marketplace/settlementReconciliation";
import {
  forgetSettlement,
  settlementsKey,
  type ConfirmedSettlement
} from "@/lib/marketplace/confirmedSettlements";
import {
  marketFixture,
  receiptFixture,
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import type { MarketReceiptExpectation } from "@/lib/marketplace/transactionIntent";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function fixture() {
  const { summary } = marketFixture();
  const client = new QueryClient();
  const receipt = receiptFixture();
  const expectation: MarketReceiptExpectation = {
    kind: "buy",
    chainId: 56,
    account: testBuyer,
    asset: summary.asset,
    orderHash: summary.orderHash,
    order: { offerer: testSeller }
  };
  const token = {
    ...summary.asset,
    owner: testSeller,
    lifecycle: summary.lifecycle,
    lastTransferBlock: "0",
    mintBlock: "0",
    burned: false,
    name: "Test Yunipal",
    image: null,
    attributes: [],
    tokenUri: null,
    rarityPoints: "1",
    rarityPointsCapped: "1"
  };
  return { client, receipt, expectation, token };
}

test("duplicate confirmations share six bounded ownership checks; exhaustion retains sold-order protection", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture();
  const api = {
    asset: async () => ({}) as never
  };
  let reads = 0;
  const delayedToken = async () => {
    reads++;
    throw new Error("Indexer delayed");
  };
  confirmSettlement(
    f.client,
    api,
    f.expectation,
    f.receipt,
    undefined,
    delayedToken
  );
  confirmSettlement(
    f.client,
    api,
    f.expectation,
    f.receipt,
    2,
    delayedToken
  );
  t.mock.timers.tick(0);
  await flush();
  assert.equal(reads, 1);
  for (const delta of [2000, 3000, 5000, 10000, 10000]) {
    t.mock.timers.tick(delta);
    await flush();
  }
  assert.equal(reads, 6);
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(reads, 6);
  const changes = f.client.getQueryData<ConfirmedSettlement[]>(settlementsKey)!;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].lifecycle, 2);
  f.client.clear();
});

test("contradictory receipt withdrawal stops reconciliation at the next bounded check", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture();
  let reads = 0;
  const api = {
    asset: async () => ({}) as never
  };
  confirmSettlement(
    f.client,
    api,
    f.expectation,
    f.receipt,
    undefined,
    async () => {
      reads++;
      throw new Error("Delayed");
    }
  );
  t.mock.timers.tick(0);
  await flush();
  forgetSettlement(f.client, 56, f.receipt.transactionHash);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(reads, 1);
  f.client.clear();
});

test("a verified purchase exposes an immediate holding until indexed ownership catches up", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture();
  let tokenReads = 0;
  confirmSettlement(
    f.client,
    { asset: async () => ({}) as never },
    f.expectation,
    f.receipt,
    1,
    async () => ({
      token: {
        ...f.token,
        owner: tokenReads++ === 0 ? testSeller : testBuyer,
        lastTransferBlock: tokenReads === 1 ? "0" : "1"
      },
      transfers: [],
      lifecycles: []
    })
  );
  t.mock.timers.tick(0);
  await flush();
  let settlement = f.client.getQueryData<ConfirmedSettlement[]>(
    settlementsKey
  )![0];
  assert.equal(settlement.synced, false);
  assert.equal(settlement.token?.owner, testBuyer);
  assert.equal(settlement.token?.lastTransferBlock, "1");
  t.mock.timers.tick(2000);
  await flush();
  settlement = f.client.getQueryData<ConfirmedSettlement[]>(settlementsKey)![0];
  assert.equal(settlement.synced, true);
  assert.equal(settlement.token?.owner, testBuyer);
  f.client.clear();
});

test("catalog restart coalesces callers, discards old cursors and only refreshes active catalog queries", async () => {
  const client = new QueryClient();
  const key = ["marketplace", "catalog", "ethereum-listed"];
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    initialData: {
      pages: ["first", "second"],
      pageParams: [undefined, "old-cursor"]
    },
    queryFn: async () => {
      reads++;
      return { pages: ["fresh"], pageParams: [undefined] };
    }
  });
  const unsubscribe = observer.subscribe(() => {});
  client.setQueryData(["marketplace", "catalog", "inactive"], {
    pages: ["cached"],
    pageParams: [undefined]
  });
  await Promise.all([
    restartMarketCatalog(client),
    restartMarketCatalog(client)
  ]);
  assert.equal(reads, 1);
  assert.deepEqual(client.getQueryData(key), {
    pages: ["fresh"],
    pageParams: [undefined]
  });
  assert.deepEqual(
    client.getQueryData(["marketplace", "catalog", "inactive"]),
    { pages: ["cached"], pageParams: [undefined] }
  );
  unsubscribe();
  client.clear();
});

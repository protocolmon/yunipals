import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress, zeroHash, type PublicClient } from "viem";

import {
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import { openSeaFixture } from "@/lib/marketplace/opensea.testFixtures";
import { buildOpenSeaFulfillment } from "@/lib/marketplace/openseaFulfillment";
import { openseaConduit } from "@/lib/marketplace/openseaRegistry";
import { inspectOpenSeaTrade } from "@/lib/marketplace/openseaTradeState";

function stateFixture(options: Parameters<typeof openSeaFixture>[0] = {}) {
  const fixture = openSeaFixture(options);
  const trade = buildOpenSeaFulfillment(
    fixture.quote,
    fixture.reviewed,
    fixture.actor,
    120n
  );
  const state = {
    chainId: trade.intent.chainId,
    timestamp: 120n,
    owner: testSeller,
    counter: 0n,
    validated: true,
    cancelled: false,
    filled: 0n,
    conduitExists: true,
    channelOpen: true,
    controller: openseaConduit.controller as string,
    makerBalance: 10n ** 18n,
    actorBalance: 10n ** 18n,
    makerAllowance: 10n ** 18n,
    actorAllowance: 10n ** 18n,
    nativeBalance: 10n ** 18n,
    nftApproved: true
  };
  const client = {
    getChainId: async () => state.chainId,
    getBlock: async () => ({ number: 42n, timestamp: state.timestamp }),
    getCode: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, 42n);
      return "0x";
    },
    getBalance: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, 42n);
      return state.nativeBalance;
    },
    readContract: async ({
      functionName,
      args,
      blockNumber
    }: {
      functionName: string;
      args?: readonly unknown[];
      blockNumber: bigint;
    }) => {
      assert.equal(blockNumber, 42n, "Every state read uses the same block.");
      const maker =
        String(args?.[0]).toLowerCase() ===
        trade.intent.order.offerer.toLowerCase();
      switch (functionName) {
        case "ownerOf":
          return state.owner;
        case "getCounter":
          return state.counter;
        case "getOrderStatus":
          return [state.validated, state.cancelled, state.filled, 1n];
        case "information":
          return ["1.6", zeroHash, state.controller];
        case "getConduit":
          return [openseaConduit.address, state.conduitExists];
        case "getChannelStatus":
          return state.channelOpen;
        case "isApprovedForAll":
          return false;
        case "getApproved":
          return state.nftApproved ? openseaConduit.address : zeroAddress;
        case "balanceOf":
          return maker ? state.makerBalance : state.actorBalance;
        case "allowance":
          return maker ? state.makerAllowance : state.actorAllowance;
        default:
          throw new Error(`Unexpected read: ${functionName}`);
      }
    }
  } as unknown as PublicClient;
  return { state, client, trade };
}

test("OpenSea preflight binds ownership, counter, fill, signature and time to current chain state", async () => {
  for (const change of [
    { chainId: 8453 },
    { owner: testBuyer },
    { counter: 1n },
    { cancelled: true },
    { filled: 1n },
    { validated: false },
    { timestamp: 99n },
    { timestamp: 160n }
  ]) {
    const { state, client, trade } = stateFixture();
    Object.assign(state, change);
    await assert.rejects(inspectOpenSeaTrade(client, trade));
  }
  const { client, trade } = stateFixture();
  assert.deepEqual(await inspectOpenSeaTrade(client, trade), {
    blockNumber: 42n
  });
});

test("OpenSea preflight rejects incorrect deployments, closed conduits and missing maker approvals", async () => {
  for (const change of [
    { controller: zeroAddress },
    { conduitExists: false },
    { channelOpen: false },
    { nftApproved: false },
    { nativeBalance: 0n }
  ]) {
    const { state, client, trade } = stateFixture();
    Object.assign(state, change);
    await assert.rejects(inspectOpenSeaTrade(client, trade));
  }
});

test("WETH purchases wrap only the ETH deficit, then require an exact conduit allowance", async () => {
  const { state, client, trade } = stateFixture({ currency: "weth" });
  state.actorBalance = 4n * 10n ** 17n;
  state.actorAllowance = 0n;
  const wrap = (await inspectOpenSeaTrade(client, trade)).next!.intent;
  assert.equal(wrap.kind, "wrap");
  assert.equal(wrap.value, 6n * 10n ** 17n);
  state.nativeBalance = 0n;
  await assert.rejects(inspectOpenSeaTrade(client, trade), /ETH balance/);
  state.actorBalance = 10n ** 18n;
  const approval = (await inspectOpenSeaTrade(client, trade)).next!.intent;
  assert.equal(approval.kind, "approve-currency");
  if (approval.kind === "approve-currency") {
    assert.equal(approval.amount, 10n ** 18n);
    assert.equal(
      approval.spender?.toLowerCase(),
      openseaConduit.address.toLowerCase()
    );
  }
  state.actorAllowance = 10n ** 18n;
  assert.equal((await inspectOpenSeaTrade(client, trade)).next, undefined);
});

test("Polygon WETH shortfalls never suggest wrapping native POL", async () => {
  const { state, client, trade } = stateFixture({
    chain: "polygon",
    currency: "weth"
  });
  state.actorBalance = 0n;
  await assert.rejects(
    inspectOpenSeaTrade(client, trade),
    /Native POL cannot be wrapped into WETH/
  );
});

test("OpenSea offers recheck maker funds and approvals before requesting seller approvals", async () => {
  for (const change of [
    { makerBalance: 0n },
    { makerAllowance: 0n },
    { owner: testBuyer }
  ]) {
    const { state, client, trade } = stateFixture({ side: "offer" });
    Object.assign(state, change, { nftApproved: false });
    await assert.rejects(inspectOpenSeaTrade(client, trade));
  }
});

test("Advanced offer fees use incoming WETH and require only the seller's exact fee allowance", async () => {
  const { state, client, trade } = stateFixture({ side: "offer" });
  state.actorBalance = 0n;
  state.nativeBalance = 0n;
  state.actorAllowance = 0n;
  state.nftApproved = false;
  assert.equal(
    (await inspectOpenSeaTrade(client, trade)).next!.intent.kind,
    "approve-nft"
  );
  state.nftApproved = true;
  const approval = (await inspectOpenSeaTrade(client, trade)).next!.intent;
  assert.equal(approval.kind, "approve-currency");
  if (approval.kind === "approve-currency")
    assert.equal(approval.amount, 25n * 10n ** 15n);
  state.actorAllowance = 25n * 10n ** 15n;
  assert.equal((await inspectOpenSeaTrade(client, trade)).next, undefined);
});

test("Seaport simulation verifies bulk maker signatures without sending validate", async () => {
  const { state, client, trade } = stateFixture();
  state.validated = false;
  let calls = 0;
  Object.assign(client, {
    simulateContract: async (request: {
      functionName: string;
      account: string;
      blockNumber: bigint;
      args: { signature: string }[][];
    }) => {
      calls++;
      assert.equal(request.functionName, "validate");
      assert.equal(request.account, trade.intent.account);
      assert.equal(request.blockNumber, 42n);
      assert.equal(request.args[0][0].signature, trade.signature);
      return { result: true };
    }
  });
  await inspectOpenSeaTrade(client, trade);
  assert.equal(calls, 1);
  Object.assign(client, { simulateContract: async () => ({ result: false }) });
  await assert.rejects(inspectOpenSeaTrade(client, trade), /signature/);
});

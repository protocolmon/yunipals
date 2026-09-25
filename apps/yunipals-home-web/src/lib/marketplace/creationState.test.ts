import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  erc721Abi,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex
} from "viem";

import { inspectOrderCreation } from "./creationState";
import {
  parseCancellationOrder,
  type MarketAsset,
  type MarketCapabilities
} from "./marketApi";
import {
  marketFixture,
  testBuyer,
  testPolicy,
  testSeller
} from "./marketplace.testFixtures";
import {
  createBnbPublicationIntent,
  parseOrderPrice
} from "./orderPublication";
import { seaportDeployment } from "./registry";
import { seaportReadAbi } from "./seaport";
import { encodeSeaportOrder } from "./seaportWire";

function setup(side: "listing" | "offer" = "listing") {
  const fixture = marketFixture(side);
  const intent = createBnbPublicationIntent(
    {
      asset: fixture.summary.asset,
      lifecycle: 2,
      maker: fixture.order.offerer,
      side,
      grossAmount: fixture.input.totalPrice,
      endTime: 3700n
    },
    testPolicy,
    { timestamp: 100n, counter: 0n },
    777n
  );
  const capabilities: MarketCapabilities = {
    bnb: {
      read: true,
      buy: true,
      createListing: true,
      createOffer: true,
      acceptOffer: true,
      cancel: true
    }
  };
  const asset: MarketAsset = {
    asset: intent.asset,
    lifecycle: 2,
    owner: testSeller,
    hidden: false,
    burned: false,
    sourceStatus: "available",
    availability: {
      chain: "bnb",
      evidence: "current",
      listings: { status: "complete", completedAt: null, revision: null },
      offers: { status: "complete", completedAt: null, revision: null }
    },
    listingState: "unlisted",
    offerAvailability: "complete",
    updatedAt: "2026-09-05T08:00:00Z",
    listings: [],
    offers: []
  };
  const state = {
    owner: testSeller as Address,
    counter: 0n,
    operator: true,
    approved: zeroAddress as Address,
    balance: fixture.input.totalPrice,
    allowance: fixture.input.totalPrice,
    cancelled: new Set<string>(),
    filled: false
  };
  const abi = [...seaportReadAbi, ...erc20Abi, ...erc721Abi];
  const client = createPublicClient({
    cacheTime: 0,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return "0x38";
        if (method === "eth_getBlockByNumber")
          return {
            number: "0x64",
            timestamp: "0x64",
            hash: zeroHash,
            parentHash: zeroHash,
            sha3Uncles: zeroHash,
            logsBloom: `0x${"0".repeat(512)}`,
            transactionsRoot: zeroHash,
            stateRoot: zeroHash,
            receiptsRoot: zeroHash,
            miner: zeroAddress,
            difficulty: "0x0",
            totalDifficulty: "0x0",
            extraData: "0x",
            size: "0x0",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            transactions: [],
            uncles: [],
            baseFeePerGas: "0x0",
            mixHash: zeroHash,
            nonce: "0x0000000000000000"
          };
        if (method === "eth_call") {
          const [call, block] = params as [{ data: Hex }, string];
          assert.equal(block, "0x64", "All related reads use the same block");
          const decoded = decodeFunctionData({ abi, data: call.data });
          switch (decoded.functionName) {
            case "ownerOf":
              return encodeAbiParameters([{ type: "address" }], [state.owner]);
            case "getCounter":
              return encodeAbiParameters(
                [{ type: "uint256" }],
                [state.counter]
              );
            case "getOrderStatus":
              return encodeAbiParameters(
                [
                  { type: "bool" },
                  { type: "bool" },
                  { type: "uint256" },
                  { type: "uint256" }
                ],
                [
                  false,
                  state.cancelled.has(String(decoded.args[0])),
                  state.filled ? 1n : 0n,
                  state.filled ? 1n : 0n
                ]
              );
            case "isApprovedForAll":
              return encodeAbiParameters([{ type: "bool" }], [state.operator]);
            case "getApproved":
              return encodeAbiParameters(
                [{ type: "address" }],
                [state.approved]
              );
            case "balanceOf":
              return encodeAbiParameters(
                [{ type: "uint256" }],
                [state.balance]
              );
            case "allowance":
              return encodeAbiParameters(
                [{ type: "uint256" }],
                [state.allowance]
              );
            default:
              throw new Error(`Unexpected test read ${decoded.functionName}`);
          }
        }
        throw new Error(`Unexpected test RPC method ${method}`);
      }
    })
  });
  return {
    fixture,
    intent,
    source: { capabilities, asset, policy: testPolicy },
    state,
    client
  };
}

test("price parsing rejects rounding, exponent notation and nonpositive values", () => {
  assert.equal(parseOrderPrice("0.000000000000000001"), 1n);
  assert.equal(parseOrderPrice(" 0.1 "), 10n ** 17n);
  for (const value of [
    "0",
    "-1",
    "+1",
    "1e3",
    "0.0000000000000000001",
    "1,000",
    "1.",
    "01",
    "9".repeat(79)
  ])
    assert.throws(() => parseOrderPrice(value), value);
});

test("creation requests exact NFT approval, WBNB wrapping deficit, and limited currency approval", async () => {
  const listing = setup();
  assert.equal(
    (await inspectOrderCreation(listing.client, listing.intent, listing.source))
      .prerequisite,
    null
  );
  listing.state.operator = false;
  assert.equal(
    (await inspectOrderCreation(listing.client, listing.intent, listing.source))
      .prerequisite?.kind,
    "approve-nft"
  );
  const offer = setup("offer");
  offer.state.balance = offer.fixture.input.totalPrice / 4n;
  const wrapping = (
    await inspectOrderCreation(offer.client, offer.intent, offer.source)
  ).prerequisite;
  assert.equal(wrapping?.kind, "wrap");
  assert.equal(wrapping?.value, (offer.fixture.input.totalPrice * 3n) / 4n);
  offer.state.balance = offer.fixture.input.totalPrice;
  offer.state.allowance = 0n;
  const approval = (
    await inspectOrderCreation(offer.client, offer.intent, offer.source)
  ).prerequisite;
  assert.equal(approval?.kind, "approve-currency");
  assert.ok(approval && "amount" in approval);
  assert.equal(approval.amount, offer.fixture.input.totalPrice);
  offer.state.allowance = offer.fixture.input.totalPrice;
  assert.equal(
    (await inspectOrderCreation(offer.client, offer.intent, offer.source))
      .prerequisite,
    null
  );
});

test("hidden, stale-owner, unavailable, counter-changed and filled assets cannot be signed", async () => {
  for (const mode of [
    "hidden",
    "owner",
    "source",
    "counter",
    "filled"
  ] as const) {
    const run = setup();
    if (mode === "hidden") run.source.asset.hidden = true;
    if (mode === "owner") run.state.owner = testBuyer;
    if (mode === "source")
      run.source.asset.availability.evidence = "unavailable";
    if (mode === "counter") run.state.counter = 1n;
    if (mode === "filled") run.state.filled = true;
    await assert.rejects(
      inspectOrderCreation(run.client, run.intent, run.source),
      mode
    );
  }
});

test("replacing an order requires its exact onchain cancellation before approval or signing", async () => {
  const run = setup();
  run.source.asset.listings = [run.fixture.summary];
  run.state.operator = false;
  await assert.rejects(
    inspectOrderCreation(run.client, run.intent, run.source),
    /existing order/
  );
  const replacement = {
    summary: run.fixture.summary,
    order: run.fixture.order
  };
  const cancel = (
    await inspectOrderCreation(run.client, run.intent, run.source, replacement)
  ).prerequisite;
  assert.equal(cancel?.kind, "cancel");
  assert.equal(cancel?.value, 0n);
  run.state.cancelled.add(run.fixture.summary.orderHash);
  assert.equal(
    (
      await inspectOrderCreation(
        run.client,
        run.intent,
        run.source,
        replacement
      )
    ).prerequisite?.kind,
    "approve-nft"
  );
  run.state.operator = true;
  assert.equal(
    (
      await inspectOrderCreation(
        run.client,
        run.intent,
        run.source,
        replacement
      )
    ).prerequisite,
    null
  );
  await assert.rejects(
    inspectOrderCreation(run.client, run.intent, run.source, {
      ...replacement,
      order: { ...run.fixture.order, salt: 10n }
    }),
    /reviewed order/
  );
});

test("cancellation parameter responses bind chain, maker and exact order without applying expiry policy", () => {
  const { summary, order } = marketFixture();
  const response = {
    schemaVersion: 1,
    chainId: 56,
    protocolAddress: seaportDeployment.address,
    orderHash: summary.orderHash,
    order: encodeSeaportOrder(order)
  };
  assert.deepEqual(parseCancellationOrder(response, summary), order);
  assert.throws(() =>
    parseCancellationOrder({ ...response, chainId: 1 }, summary)
  );
  assert.throws(() =>
    parseCancellationOrder(
      { ...response, order: encodeSeaportOrder({ ...order, salt: 88n }) },
      summary
    )
  );
});

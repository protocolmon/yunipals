import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc721Abi,
  getAddress,
  zeroAddress,
  zeroHash,
  type TransactionReceipt
} from "viem";

import { catalogCurrency } from "./catalogCurrency";
import { type MarketOrder } from "./marketApi";
import {
  marketFixture,
  receiptFixture,
  testBuyer,
  testSeller,
  testFeeRecipient
} from "./marketplace.testFixtures";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";
import { seaportOrderHash } from "./seaport";
import {
  observeCollectionSale,
  observeMarketSale,
  UnsupportedCollectionSaleError,
  type SaleBlock
} from "@protopals/yunipals-market-core/settledSale";
import { seaportEventAbi } from "./transactionIntent";

const block: SaleBlock = {
  number: 100n,
  hash: `0x${"11".repeat(32)}`,
  timestamp: 120n
};
function fixture(
  chain: MarketplaceChain = "bnb",
  side: "listing" | "offer" = "listing",
  weth = false
) {
  const { order, summary } = marketFixture(side);
  const config = marketplaceChains[chain];
  const currency =
    chain === "bnb" && side === "offer"
      ? bnbOfferCurrency
      : catalogCurrency(chain, weth || side === "offer" ? "weth" : "native");
  const asset = {
    ...summary.asset,
    chain,
    chainId: config.chainId,
    contractAddress: config.contractAddress
  };
  for (const item of [...order.offer, ...order.consideration]) {
    item.token = item.itemType === 2 ? asset.contractAddress : currency.address;
    if (item.itemType !== 2)
      item.itemType = currency.address === zeroAddress ? 0 : 1;
  }
  const known: MarketOrder = {
    ...summary,
    asset,
    source: config.source,
    currency,
    orderHash: seaportOrderHash(order)
  };
  const event = {
    recipient: side === "listing" ? testBuyer : testSeller,
    offer: order.offer.map((item) => ({
      itemType: item.itemType,
      token: item.token,
      identifier: item.identifierOrCriteria,
      amount: item.startAmount
    })),
    consideration: order.consideration.map((item) => ({
      itemType: item.itemType,
      token: item.token,
      identifier: item.identifierOrCriteria,
      amount: item.startAmount,
      recipient: item.recipient
    }))
  };
  const receipt = {
    ...receiptFixture(),
    from: testFeeRecipient,
    blockNumber: block.number,
    blockHash: block.hash
  };
  function encode() {
    const abi = seaportEventAbi.find((item) => item.name === "OrderFulfilled")!;
    receipt.logs = [
      {
        ...receipt.logs[0],
        address: seaportDeployment.address,
        topics: encodeEventTopics({
          abi: seaportEventAbi,
          eventName: "OrderFulfilled",
          args: { offerer: known.maker, zone: zeroAddress }
        }) as TransactionReceipt["logs"][number]["topics"],
        data: encodeAbiParameters(
          abi.inputs.filter((item) => !("indexed" in item && item.indexed)),
          [known.orderHash, event.recipient, event.offer, event.consideration]
        ),
        blockHash: block.hash,
        blockNumber: block.number,
        logIndex: 3
      },
      {
        ...receipt.logs[1],
        address: asset.contractAddress,
        topics: encodeEventTopics({
          abi: erc721Abi,
          eventName: "Transfer",
          args: {
            from: testSeller,
            to: side === "listing" ? event.recipient : known.maker,
            tokenId: BigInt(asset.tokenId)
          }
        }) as TransactionReceipt["logs"][number]["topics"],
        data: "0x",
        blockHash: block.hash,
        blockNumber: block.number,
        logIndex: 4
      }
    ];
    return receipt;
  }
  encode();
  return { known, receipt, event, encode };
}

test("sale observations bind settlement price, seller, recipient and proof identity on all four chains", () => {
  for (const chain of Object.keys(marketplaceChains) as MarketplaceChain[]) {
    for (const side of ["listing", "offer"] as const) {
      const { known, receipt } = fixture(chain, side);
      const sale = observeMarketSale(known, receipt, block);
      assert.equal(sale.seller, testSeller);
      assert.equal(sale.nftRecipient, testBuyer);
      assert.notEqual(sale.nftRecipient, receipt.from);
      assert.equal(sale.grossAmount, known.grossAmount);
      assert.deepEqual(sale.fees, known.fees);
      assert.equal(sale.eventId, `${known.asset.chainId}:${block.hash}:3`);
      assert.equal(sale.transferLogIndex, 4);
      assert.equal(
        sale.kind,
        side === "listing" ? "listing-filled" : "offer-accepted"
      );
    }
    if (chain !== "bnb") {
      const { known, receipt } = fixture(chain, "listing", true);
      assert.equal(
        observeMarketSale(known, receipt, block).currency.symbol,
        "WETH"
      );
    }
  }
});

test("collection receipt observations recover native and wrapped-currency sales without admitted orders", () => {
  for (const chain of Object.keys(marketplaceChains) as MarketplaceChain[]) {
    for (const side of ["listing", "offer"] as const) {
      const { known, receipt } = fixture(chain, side);
      assert.deepEqual(
        observeCollectionSale(chain, receipt, block, 3),
        observeMarketSale(known, receipt, block)
      );
    }
    if (chain !== "bnb") {
      const { known, receipt } = fixture(chain, "listing", true);
      assert.deepEqual(
        observeCollectionSale(chain, receipt, block, 3),
        observeMarketSale(known, receipt, block)
      );
    }
  }
});

test("collection receipts use execution amounts rather than inventing historical signed prices", () => {
  const { known, event, encode } = fixture("base", "listing", true);
  event.consideration[0]!.amount += 123n;
  const receipt = encode();
  assert.throws(() => observeMarketSale(known, receipt, block));
  const sale = observeCollectionSale("base", receipt, block, 3)!;
  assert.equal(BigInt(sale.grossAmount), BigInt(known.grossAmount) + 123n);
  assert.equal(
    BigInt(sale.sellerProceeds),
    BigInt(known.sellerProceeds) + 123n
  );
  assert.deepEqual(sale.fees, known.fees);
  assert.notEqual(sale.nftRecipient, receipt.from);
});

test("collection replay distinguishes unrelated events, unsupported bundles and broken receipt proof", () => {
  const { known, receipt, event, encode } = fixture("ethereum");
  const unrelated = fixture("ethereum");
  unrelated.event.offer[0]!.token = testFeeRecipient;
  assert.equal(
    observeCollectionSale("ethereum", unrelated.encode(), block, 3),
    null
  );
  assert.throws(() => observeCollectionSale("ethereum", receipt, block, 4));
  assert.throws(() =>
    observeCollectionSale(
      "ethereum",
      { ...receipt, logs: receipt.logs.slice(0, 1) },
      block,
      3
    )
  );
  assert.throws(() =>
    observeCollectionSale(
      "ethereum",
      { ...receipt, status: "reverted" },
      block,
      3
    )
  );
  assert.throws(() =>
    observeCollectionSale("ethereum", receipt, { ...block, hash: zeroHash }, 3)
  );
  event.offer.push({ ...event.offer[0]!, identifier: 999n });
  assert.throws(
    () => observeCollectionSale("ethereum", encode(), block, 3),
    UnsupportedCollectionSaleError
  );
  assert.equal(known.asset.chain, "ethereum");
});

test("ordinary transfers, outer success without settlement and forged contracts are not sales", () => {
  const { known, receipt } = fixture();
  for (const change of [
    { status: "reverted" as const },
    { logs: [] },
    { logs: receipt.logs.slice(1) },
    { logs: receipt.logs.slice(0, 1) },
    { logs: receipt.logs.map((log) => ({ ...log, address: testFeeRecipient })) }
  ])
    assert.throws(() =>
      observeMarketSale(known, { ...receipt, ...change }, block)
    );
  assert.throws(() =>
    observeMarketSale({ ...known, orderHash: zeroHash }, receipt, block)
  );
  assert.throws(() =>
    observeMarketSale({ ...known, maker: testBuyer }, receipt, block)
  );
});

test("sale observations reject changed amounts, fee recipients, currencies and multi-NFT consideration", () => {
  for (const side of ["listing", "offer"] as const) {
    for (const scenario of [
      "amount",
      "fee-recipient",
      "currency",
      "identifier",
      "extra-nft"
    ]) {
      const { known, event, encode } = fixture("ethereum", side, true);
      const fee = event.consideration.find((item) => item.itemType === 1)!;
      if (scenario === "amount") fee.amount += 1n;
      if (scenario === "fee-recipient") fee.recipient = testBuyer;
      if (scenario === "currency") fee.token = bnbOfferCurrency.address;
      if (scenario === "identifier") fee.identifier = 1n;
      if (scenario === "extra-nft")
        event.consideration.push({
          itemType: 2,
          token: known.asset.contractAddress,
          identifier: 999n,
          amount: 1n,
          recipient: testBuyer
        });
      assert.throws(() => observeMarketSale(known, encode(), block));
    }
  }
});

test("receipt proof requires one unremoved event and transfer with matching transaction/block metadata", () => {
  const { known, receipt } = fixture();
  for (const change of [
    { blockHash: zeroHash },
    { blockNumber: 99n },
    { transactionHash: zeroHash },
    { transactionIndex: 1 },
    { removed: true },
    { logIndex: null },
    { logIndex: -1 }
  ]) {
    for (const index of [0, 1]) {
      const logs = receipt.logs.map((log, i) =>
        i === index ? { ...log, ...change } : log
      );
      assert.throws(() =>
        observeMarketSale(
          known,
          { ...receipt, logs } as TransactionReceipt,
          block
        )
      );
    }
  }
  for (const log of receipt.logs)
    assert.throws(() =>
      observeMarketSale(
        known,
        { ...receipt, logs: [...receipt.logs, { ...log, logIndex: 5 }] },
        block
      )
    );
  assert.throws(() =>
    observeMarketSale(
      known,
      {
        ...receipt,
        logs: receipt.logs.map((log) => ({ ...log, logIndex: 3 }))
      },
      block
    )
  );
  assert.throws(() =>
    observeMarketSale(known, receipt, { ...block, hash: zeroHash })
  );
  assert.throws(() =>
    observeMarketSale(known, receipt, { ...block, number: 99n })
  );
});

test("sale observations preserve a gift recipient and do not infer a payer from the outer sender", () => {
  const { known, event, encode } = fixture("base");
  event.recipient = testFeeRecipient;
  const receipt = { ...encode(), from: testBuyer };
  const sale = observeMarketSale(known, receipt, block);
  assert.equal(sale.nftRecipient, getAddress(testFeeRecipient));
  assert.equal("payer" in sale, false);
  event.recipient = zeroAddress;
  assert.throws(() => observeMarketSale(known, encode(), block));
});

test("historical sales use settlement time and survive later order status changes", () => {
  const { known, receipt } = fixture();
  for (const status of [
    "filled",
    "expired",
    "unavailable",
    "cancelled"
  ] as const)
    assert.doesNotThrow(() =>
      observeMarketSale({ ...known, status }, receipt, block)
    );
  assert.throws(() =>
    observeMarketSale(known, receipt, {
      ...block,
      timestamp: BigInt(known.startTime) - 1n
    })
  );
  assert.throws(() =>
    observeMarketSale(known, receipt, {
      ...block,
      timestamp: BigInt(known.endTime)
    })
  );
  const changed = { ...receipt, blockHash: `0x${"22".repeat(32)}` as const };
  changed.logs = changed.logs.map((log) => ({
    ...log,
    blockHash: changed.blockHash
  }));
  assert.notEqual(
    observeMarketSale(known, receipt, block).eventId,
    observeMarketSale(known, changed, { ...block, hash: changed.blockHash })
      .eventId
  );
});

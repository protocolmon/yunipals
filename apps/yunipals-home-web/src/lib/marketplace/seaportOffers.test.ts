import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  encodeFunctionData,
  maxUint256,
  zeroAddress,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { bnbOfferCurrency, marketplaceChains } from "./registry";
import {
  createItemOffer,
  seaportBasicOfferParameters,
  seaportOrderHash,
  seaportWriteAbi,
  type SeaportOrderComponents
} from "./seaport";
import { decodeSeaportOrder, encodeSeaportOrder } from "./seaportWire";

const buyer = privateKeyToAccount(`0x${"2".padStart(64, "0")}`).address;
const feeRecipient = privateKeyToAccount(`0x${"3".padStart(64, "0")}`).address;
const input = {
  buyer,
  collection: marketplaceChains.bnb.contractAddress,
  tokenId: maxUint256,
  paymentToken: bnbOfferCurrency.address,
  totalPrice: 10n ** 18n,
  startTime: 1_780_000_000n,
  endTime: 1_780_086_400n,
  counter: 2n,
  salt: maxUint256,
  fees: [{ recipient: feeRecipient, amount: 25_000_000_000_000_000n }]
};

test("item offer binds the NFT recipient and includes fees in the buyer total", () => {
  const order = createItemOffer(input);
  assert.equal(order.offerer, buyer);
  assert.equal(order.offer[0].startAmount, input.totalPrice);
  assert.equal(order.consideration[0].recipient, buyer);
  assert.equal(order.consideration[0].identifierOrCriteria, maxUint256);
  assert.equal(order.consideration[1].token, bnbOfferCurrency.address);
  const basic = seaportBasicOfferParameters(order, "0x1234");
  const calldata = encodeFunctionData({
    abi: seaportWriteAbi,
    functionName: "fulfillBasicOrder",
    args: [basic]
  });
  const decoded = decodeFunctionData({ abi: seaportWriteAbi, data: calldata });
  assert.equal(decoded.functionName, "fulfillBasicOrder");
  assert.equal(decoded.args[0].basicOrderType, 16);
  assert.equal(decoded.args[0].offerAmount, input.totalPrice);
  assert.equal(decoded.args[0].totalOriginalAdditionalRecipients, 1n);
  assert.equal(
    decoded.args[0].additionalRecipients[0].amount,
    input.fees[0].amount
  );
  assert.equal(decoded.args[0].fulfillerConduitKey, zeroHash);
});

test("item offer rejects native payment, zero price, and fees consuming the proceeds", () => {
  for (const invalid of [
    { buyer: zeroAddress },
    { paymentToken: zeroAddress },
    { totalPrice: 0n },
    { totalPrice: -1n },
    { totalPrice: maxUint256 + 1n },
    { fees: [{ recipient: feeRecipient, amount: input.totalPrice }] },
    { fees: [{ recipient: zeroAddress, amount: 1n }] }
  ])
    assert.throws(() => createItemOffer({ ...input, ...invalid }));
});

test("basic conversion rejects transformations that would alter the signed order", () => {
  const order = createItemOffer(input);
  const mutations: Array<(order: SeaportOrderComponents) => void> = [
    (o) => {
      o.orderType = 1;
    },
    (o) => {
      o.zone = feeRecipient;
    },
    (o) => {
      o.zoneHash = `0x${"1".repeat(64)}`;
    },
    (o) => {
      o.conduitKey = `0x${"1".repeat(64)}`;
    },
    (o) => {
      o.offer[0].endAmount += 1n;
    },
    (o) => {
      o.offer[0].identifierOrCriteria = 1n;
    },
    (o) => {
      o.offer = [...o.offer, o.offer[0]];
    },
    (o) => {
      o.consideration[0].recipient = feeRecipient;
    },
    (o) => {
      o.consideration[0].itemType = 4;
    },
    (o) => {
      o.consideration[0].startAmount = 2n;
    },
    (o) => {
      o.consideration[1].token = feeRecipient;
    },
    (o) => {
      o.consideration[1].endAmount += 1n;
    }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(order);
    mutate(changed);
    assert.throws(() => seaportBasicOfferParameters(changed, "0x1234"));
  }
});

test("JSON round trip preserves full uint256 precision and the exact signed hash", () => {
  const order = createItemOffer(input);
  const wire = JSON.parse(JSON.stringify(encodeSeaportOrder(order)));
  const decoded = decodeSeaportOrder(wire);
  assert.equal(decoded.salt, maxUint256);
  assert.equal(decoded.consideration[0].identifierOrCriteria, maxUint256);
  assert.equal(seaportOrderHash(decoded), seaportOrderHash(order));
});

test("JSON decoding rejects ambiguous integers, extra fields, invalid bytes and unbounded arrays", () => {
  const wire = encodeSeaportOrder(createItemOffer(input));
  for (const bad of [
    0,
    1.1,
    "01",
    "-1",
    "1e18",
    "0x1",
    " 1",
    (maxUint256 + 1n).toString(),
    "1".repeat(1000)
  ]) {
    assert.throws(() => decodeSeaportOrder({ ...wire, counter: bad }));
  }
  for (const changed of [
    { ...wire, counter: undefined },
    { ...wire, unknown: "field" },
    { ...wire, zoneHash: "0x0" },
    { ...wire, offerer: "0x1234" },
    { ...wire, orderType: "0" },
    { ...wire, orderType: 256 },
    { ...wire, offer: [] },
    { ...wire, offer: Array(33).fill(wire.offer[0]) },
    { ...wire, offer: [{ ...wire.offer[0], recipient: buyer }] },
    { ...wire, consideration: [{ ...wire.consideration[0], startAmount: 1 }] }
  ])
    assert.throws(() => decodeSeaportOrder(changed));
});

import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, erc721Abi } from "viem";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";

import {
  marketFixture,
  receiptFixture,
  testBuyer,
  testFeeRecipient,
  testPolicy
} from "./marketplace.testFixtures";
import {
  assertMarketReceipt,
  buildBnbCurrencyAction,
  buildBnbFulfillment,
  buildBnbNftApproval,
  buildBnbValidation,
  buildSeaportCancellation,
  transactionCall
} from "./transactionIntent";
import {
  decodePendingTransactions,
  pendingTransaction
} from "./pendingTransactions";
import { seaportWriteAbi } from "./seaport";
import { seaportDeployment } from "./registry";

test("fulfillment rejects changed identity, actor, lifecycle, price, currency and quote lifetime", () => {
  const { summary, quote } = marketFixture();
  for (const changed of [
    { ...quote, actor: testFeeRecipient },
    { ...quote, lifecycle: 3 },
    { ...quote, expiresAt: "100" },
    { ...quote, expiresAt: "9999" },
    { ...quote, asset: { ...quote.asset, tokenId: "124" } }
  ])
    assert.throws(() =>
      buildBnbFulfillment(changed, summary, testBuyer, testPolicy, 100n)
    );
  for (const changed of [
    { ...summary, grossAmount: "1" },
    { ...summary, maker: testFeeRecipient },
    { ...summary, currency: { ...summary.currency, decimals: 9 } },
    { ...summary, fees: [{ recipient: testFeeRecipient, amount: "1" }] }
  ])
    assert.throws(() =>
      buildBnbFulfillment(quote, changed, testBuyer, testPolicy, 100n)
    );
  assert.throws(() =>
    buildBnbFulfillment(
      quote,
      summary,
      testBuyer,
      { ...testPolicy, offerCurrency: testFeeRecipient },
      100n
    )
  );
  const tampered = structuredClone(quote);
  tampered.order.offer[0].identifierOrCriteria = "124";
  assert.throws(() =>
    buildBnbFulfillment(tampered, summary, testBuyer, testPolicy, 100n)
  );
});

test("wallet requests contain only local calldata and exact native value", () => {
  for (const side of ["listing", "offer"] as const) {
    const { summary, quote } = marketFixture(side);
    const intent = buildBnbFulfillment(
      quote,
      summary,
      quote.actor,
      testPolicy,
      100n
    );
    const call = transactionCall(intent);
    assert.deepEqual(Object.keys(call).sort(), [
      "account",
      "chainId",
      "data",
      "to",
      "value"
    ]);
    assert.equal(call.to, seaportDeployment.address);
    assert.equal(call.value, side === "listing" ? 10n ** 18n : 0n);
    assert.equal(
      decodeFunctionData({ abi: seaportWriteAbi, data: call.data })
        .functionName,
      side === "listing" ? "fulfillOrder" : "fulfillBasicOrder"
    );
  }
  const { summary } = marketFixture();
  const approval = buildBnbNftApproval(summary.asset, testBuyer);
  assert.deepEqual(
    decodeFunctionData({ abi: erc721Abi, data: approval.data }).args,
    [seaportDeployment.address, 123n]
  );
  const allowance = buildBnbCurrencyAction("approve-currency", testBuyer, 15n);
  assert.deepEqual(
    decodeFunctionData({ abi: erc20Abi, data: allowance.data }).args,
    [seaportDeployment.address, 15n]
  );
  assert.equal(buildBnbCurrencyAction("wrap", testBuyer, 15n).value, 15n);
});

test("a successful receipt must confirm the intended order, wallet and NFT at the real contracts", () => {
  const { summary, quote } = marketFixture();
  const intent = buildBnbFulfillment(
    quote,
    summary,
    testBuyer,
    testPolicy,
    100n
  );
  const receipt = receiptFixture();
  assert.doesNotThrow(() => assertMarketReceipt(intent, receipt));
  assert.throws(() =>
    assertMarketReceipt(intent, { ...receipt, status: "reverted" })
  );
  assert.throws(() => assertMarketReceipt(intent, { ...receipt, logs: [] }));
  assert.throws(() =>
    assertMarketReceipt(intent, { ...receipt, logs: receipt.logs.slice(0, 1) })
  );
  assert.throws(() =>
    assertMarketReceipt(intent, {
      ...receipt,
      logs: receipt.logs.map((log) => ({ ...log, address: testFeeRecipient }))
    })
  );
  assert.throws(() =>
    assertMarketReceipt({ ...intent, account: testFeeRecipient }, receipt)
  );
});

test("single-order cancellation remains possible after expiry and requires the maker", () => {
  const { order, summary } = marketFixture();
  const cancellation = buildSeaportCancellation(
    "bnb",
    order,
    summary.orderHash,
    order.offerer
  );
  const decoded = decodeFunctionData({
    abi: seaportWriteAbi,
    data: cancellation.data
  });
  assert.equal(decoded.functionName, "cancel");
  if (decoded.functionName === "cancel")
    assert.equal(decoded.args[0].length, 1);
  assert.throws(() =>
    buildSeaportCancellation("bnb", order, summary.orderHash, testBuyer)
  );
});

test("BNB publication validates the reviewed order and recovers from its chain event", () => {
  const { order, summary } = marketFixture();
  const intent = buildBnbValidation(
    order,
    summary.asset,
    summary.orderHash,
    order.offerer
  );
  const decoded = decodeFunctionData({ abi: seaportWriteAbi, data: intent.data });
  assert.equal(decoded.functionName, "validate");
  if (decoded.functionName === "validate") {
    assert.equal(decoded.args[0].length, 1);
    assert.equal(decoded.args[0][0].signature, "0x");
  }
  assert.throws(() =>
    buildBnbValidation(order, summary.asset, summary.orderHash, testBuyer)
  );
  const event = seaportEventAbi.find(
    (item) => item.type === "event" && item.name === "OrderValidated"
  );
  assert.ok(event && event.type === "event");
  const { counter: _counter, ...parameters } = order;
  const receipt = receiptFixture();
  const published = {
    ...receipt,
    logs: [{
      ...receipt.logs[0],
      address: seaportDeployment.address,
      topics: [encodeEventTopics({ abi: seaportEventAbi, eventName: "OrderValidated" })[0]!] as [`0x${string}`],
      data: encodeAbiParameters(event.inputs, [
        summary.orderHash,
        { ...parameters, totalOriginalConsiderationItems: BigInt(order.consideration.length) }
      ])
    }]
  };
  assert.doesNotThrow(() => assertMarketReceipt(intent, published));
  const stored = decodePendingTransactions(JSON.stringify([
    pendingTransaction(receipt.transactionHash, intent)
  ]));
  assert.equal(stored[0]?.expectation.kind, "validate");
  assert.doesNotThrow(() => assertMarketReceipt(stored[0]!.expectation, published));
});

test("refresh recovery stores receipt expectations without order signatures or transaction calldata", () => {
  const { summary, quote } = marketFixture();
  const intent = buildBnbFulfillment(
    quote,
    summary,
    testBuyer,
    testPolicy,
    100n
  );
  const receipt = receiptFixture();
  const encoded = JSON.stringify([
    pendingTransaction(receipt.transactionHash, intent)
  ]);
  assert.ok(!encoded.includes('"signature"'));
  assert.ok(!encoded.includes('"data"'));
  const decoded = decodePendingTransactions(encoded);
  assert.equal(decoded.length, 1);
  assert.doesNotThrow(() =>
    assertMarketReceipt(decoded[0].expectation, receipt)
  );
  assert.deepEqual(decodePendingTransactions("invalid"), []);
  assert.deepEqual(
    decodePendingTransactions(encoded.replace('"chainId":56', '"chainId":1')),
    []
  );
});

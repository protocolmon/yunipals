import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, getAddress, zeroAddress, zeroHash } from "viem";

import { openSeaAuthorizationExpiry } from "@protopals/yunipals-market-core/openseaFulfillment";
import { createMarketClient } from "@/lib/marketplace/marketApi";
import {
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import {
  buildOpenSeaApproval,
  buildOpenSeaWrap
} from "@/lib/marketplace/openseaActions";
import { openSeaFixture } from "@/lib/marketplace/opensea.testFixtures";
import { buildOpenSeaFulfillment } from "@/lib/marketplace/openseaFulfillment";
import {
  openseaConduit,
  openseaCurrencies,
  openseaSignedZone
} from "@/lib/marketplace/openseaRegistry";
import {
  decodePendingTransactions,
  pendingTransaction
} from "@/lib/marketplace/pendingTransactions";
import { seaportDeployment } from "@/lib/marketplace/registry";
import { seaportOrderHash, seaportWriteAbi } from "@/lib/marketplace/seaport";

test("OpenSea native and WETH listing routes retain exact NFT, price and conduit on all three chains", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const)
    for (const currency of ["native", "weth"] as const)
      for (const method of [
        "fulfillOrder",
        "fulfillAdvancedOrder",
        "fulfillBasicOrder",
        "fulfillBasicOrder_efficient_6GL6yc"
      ] as const) {
        const { quote, reviewed, actor, order } = openSeaFixture({
          chain,
          currency,
          method
        });
        const trade = buildOpenSeaFulfillment(quote, reviewed, actor, 120n);
        assert.equal(trade.intent.chainId, reviewed.asset.chainId);
        assert.equal(
          trade.intent.value,
          currency === "native" ? 10n ** 18n : 0n
        );
        assert.equal(trade.intent.orderHash, seaportOrderHash(order));
        assert.equal(
          decodeFunctionData({ abi: seaportWriteAbi, data: trade.intent.data })
            .functionName,
          method
        );
        assert.ok(trade.intent.data.endsWith("cdb44011"));
        assert.equal(trade.makerSpender, getAddress(openseaConduit.address));
        assert.equal(trade.approvals.length, currency === "native" ? 0 : 1);
        if (trade.approvals[0]?.kind === "currency") {
          assert.equal(trade.approvals[0].amount, 10n ** 18n);
          assert.equal(trade.approvals[0].fundedByOffer, false);
        }
      }
});

test("OpenSea item-offer routes distinguish buyer-funded basic fees from seller fee approvals", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const)
    for (const method of [
      "fulfillOrder",
      "fulfillAdvancedOrder",
      "fulfillBasicOrder",
      "fulfillBasicOrder_efficient_6GL6yc"
    ] as const) {
      const { quote, reviewed, actor } = openSeaFixture({
        chain,
        side: "offer",
        method
      });
      const trade = buildOpenSeaFulfillment(quote, reviewed, actor, 120n);
      assert.equal(trade.intent.kind, "accept-offer");
      assert.equal(trade.intent.value, 0n);
      assert.equal(trade.approvals[0].kind, "nft");
      const general =
        method === "fulfillOrder" || method === "fulfillAdvancedOrder";
      assert.equal(trade.approvals.length, general ? 2 : 1);
      if (trade.approvals[1]?.kind === "currency") {
        assert.equal(trade.approvals[1].amount, 25n * 10n ** 15n);
        assert.equal(trade.approvals[1].fundedByOffer, true);
      }
    }
});

test("protected advanced orders retain the signed zone, hash and provider authorization bytes", () => {
  const fixture = openSeaFixture();
  const payload = fixture.quote.fulfillment.fulfillment_data;
  const advanced = payload.transaction.input_data.advancedOrder!;
  const order = { ...fixture.order, zone: openseaSignedZone, orderType: 2 };
  Object.assign(payload.orders[0].parameters, {
    zone: openseaSignedZone,
    orderType: 2
  });
  Object.assign(advanced.parameters, { zone: openseaSignedZone, orderType: 2 });
  const authorization =
    `0x00${fixture.actor.slice(2)}${160n.toString(16).padStart(16, "0")}${"11".repeat(64)}` as const;
  advanced.extraData = authorization;
  const hash = seaportOrderHash(order);
  const trade = buildOpenSeaFulfillment(
    { ...fixture.quote, orderHash: hash },
    { ...fixture.reviewed, orderHash: hash },
    fixture.actor,
    120n
  );
  const decoded = decodeFunctionData({
    abi: seaportWriteAbi,
    data: trade.intent.data
  });
  assert.equal(decoded.functionName, "fulfillAdvancedOrder");
  if (decoded.functionName === "fulfillAdvancedOrder") {
    assert.equal(decoded.args[0].extraData, authorization.toLowerCase());
    assert.equal(
      getAddress(decoded.args[0].parameters.zone),
      getAddress(openseaSignedZone)
    );
    assert.equal(decoded.args[2], openseaConduit.key);
    assert.equal(getAddress(decoded.args[3]), getAddress(fixture.actor));
  }
});

test("OpenSea quote scoping rejects changed NFT, chain, actor, hash, expiry and native value", () => {
  const { quote, reviewed, actor } = openSeaFixture();
  for (const change of [
    { actor: testSeller },
    { lifecycle: 3 },
    { orderHash: zeroHash },
    { expiresAt: "120" },
    { expiresAt: "241" },
    { asset: { ...quote.asset, tokenId: "999" } }
  ])
    assert.throws(() =>
      buildOpenSeaFulfillment({ ...quote, ...change }, reviewed, actor, 120n)
    );
  for (const change of [
    { chain: 8453 },
    { to: testBuyer },
    { value: "0" },
    { value_hex: "0x0" }
  ]) {
    const changed = structuredClone(quote);
    Object.assign(changed.fulfillment.fulfillment_data.transaction, change);
    assert.throws(() =>
      buildOpenSeaFulfillment(changed, reviewed, actor, 120n)
    );
  }
});

test("advanced transaction validation rejects redirected recipients, rewritten economics and unsigned tips", () => {
  const { quote, reviewed, actor } = openSeaFixture();
  for (const mutate of [
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.recipient =
        testSeller;
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.parameters.offer[0].identifierOrCriteria =
        "999";
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.parameters.consideration[0].recipient =
        testBuyer;
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.parameters.totalOriginalConsiderationItems =
        "1";
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.numerator = 2;
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.signature =
        "0xabcd";
    },
    (q: typeof quote) => {
      Object.assign(q.fulfillment.fulfillment_data.transaction.input_data, {
        fulfillerConduitKey: zeroHash
      });
      q.fulfillment.fulfillment_data.transaction.input_data.recipient =
        testSeller;
    }
  ]) {
    const changed = structuredClone(quote);
    mutate(changed);
    assert.throws(() =>
      buildOpenSeaFulfillment(changed, reviewed, actor, 120n)
    );
  }
  const direct = structuredClone(quote);
  Object.assign(direct.fulfillment.fulfillment_data.transaction.input_data, {
    fulfillerConduitKey: zeroHash,
    recipient: zeroAddress
  });
  assert.doesNotThrow(() =>
    buildOpenSeaFulfillment(direct, reviewed, actor, 120n)
  );
});

test("basic-order flattening cannot change the route, signature, approvals, payment or fee recipients", () => {
  const { quote, reviewed, actor } = openSeaFixture({
    method: "fulfillBasicOrder"
  });
  for (const change of [
    { basicOrderType: 16 },
    { considerationAmount: "1" },
    { offerAmount: "2" },
    { signature: "0xabcd" },
    { totalOriginalAdditionalRecipients: "0" },
    { fulfillerConduitKey: `0x${"f".repeat(64)}` },
    {
      additionalRecipients: [
        { amount: "25000000000000000", recipient: testBuyer }
      ]
    }
  ]) {
    const changed = structuredClone(quote);
    Object.assign(
      changed.fulfillment.fulfillment_data.transaction.input_data.parameters!,
      change
    );
    assert.throws(() =>
      buildOpenSeaFulfillment(changed, reviewed, actor, 120n)
    );
  }
});

test("provider envelopes reject unsafe numbers, unsupported routes, extra calls and oversized bytes", () => {
  const { quote, reviewed, actor } = openSeaFixture();
  for (const mutate of [
    (q: typeof quote) => {
      Object.assign(q.fulfillment.fulfillment_data.orders[0].parameters, {
        counter: Number.MAX_SAFE_INTEGER + 1
      });
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.orders.push(
        q.fulfillment.fulfillment_data.orders[0]
      );
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.function =
        "matchOrders(fixture)";
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.calldata_suffix =
        "0x1234567890";
    },
    (q: typeof quote) => {
      q.fulfillment.fulfillment_data.transaction.input_data.advancedOrder!.extraData = `0x${"a".repeat(32770)}`;
    },
    (q: typeof quote) => {
      Object.assign(q.fulfillment.fulfillment_data.transaction.input_data, {
        authorizationList: []
      });
    }
  ]) {
    const changed = structuredClone(quote);
    mutate(changed);
    assert.throws(() =>
      buildOpenSeaFulfillment(changed, reviewed, actor, 120n)
    );
  }
  assert.throws(() =>
    buildOpenSeaFulfillment(
      quote,
      { ...reviewed, currency: { ...reviewed.currency, symbol: "USD" } },
      actor,
      120n
    )
  );
  assert.throws(() =>
    buildOpenSeaFulfillment(
      quote,
      { ...reviewed, fees: [{ ...reviewed.fees[0], recipient: testBuyer }] },
      actor,
      120n
    )
  );
});

test("OpenSea approval and wrap recovery preserve exact chain, spender, token and amount", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const { quote, reviewed, actor } = openSeaFixture({ chain, side: "offer" });
    const trade = buildOpenSeaFulfillment(quote, reviewed, actor, 120n);
    for (const approval of trade.approvals) {
      const intent = buildOpenSeaApproval(reviewed.asset, actor, approval);
      const json = JSON.stringify(
        [pendingTransaction(`0x${"a".repeat(64)}`, intent)],
        (_, value) => (typeof value === "bigint" ? value.toString() : value)
      );
      const restored = decodePendingTransactions(json);
      assert.equal(restored.length, 1);
      if (
        restored[0].expectation.kind === "approve-nft" ||
        restored[0].expectation.kind === "approve-currency"
      )
        assert.equal(
          restored[0].expectation.spender,
          getAddress(openseaConduit.address)
        );
      assert.equal(
        decodePendingTransactions(
          json
            .replaceAll(openseaConduit.address, testBuyer)
            .replaceAll(getAddress(openseaConduit.address), testBuyer)
        ).length,
        0
      );
    }
    if (chain === "polygon")
      assert.throws(() =>
        buildOpenSeaWrap(chain, actor, openseaCurrencies[chain].address, 1n)
      );
    else {
      const wrap = buildOpenSeaWrap(
        chain,
        actor,
        openseaCurrencies[chain].address,
        1n
      );
      assert.equal(wrap.value, 1n);
      assert.equal(
        decodePendingTransactions(
          JSON.stringify(
            [pendingTransaction(`0x${"a".repeat(64)}`, wrap)],
            (_, value) => (typeof value === "bigint" ? value.toString() : value)
          )
        ).length,
        1
      );
    }
  }
});

test("the gateway client posts actor and lifecycle to the exact OpenSea order and rejects another provider", async () => {
  const fixture = openSeaFixture({ chain: "polygon" });
  let source = "opensea";
  const client = createMarketClient(
    "https://example.test",
    async (url, init) => {
      assert.equal(
        String(url),
        `https://example.test/v1/market/orders/polygon/${getAddress(seaportDeployment.address)}/${fixture.reviewed.orderHash}/fulfillment`
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "omit");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        actor: fixture.actor,
        lifecycle: fixture.reviewed.lifecycle
      });
      return Response.json({
        schemaVersion: 1,
        source,
        purpose: "fulfillment",
        simulated: true,
        ...fixture.quote
      });
    }
  );
  assert.equal(
    (await client.openSeaFulfillment(fixture.reviewed, fixture.actor))
      .orderHash,
    fixture.reviewed.orderHash
  );
  source = "yunipals";
  await assert.rejects(
    client.openSeaFulfillment(fixture.reviewed, fixture.actor)
  );
});

test("preflight and executable responses cannot be substituted for each other", async () => {
  const fixture = openSeaFixture();
  for (const action of ["preflight", "fulfillment"] as const) {
    let purpose: string = action;
    let simulated = action === "fulfillment";
    const client = createMarketClient("https://example.test", async (url) => {
      assert.ok(String(url).endsWith(`/${action}`));
      return Response.json({
        schemaVersion: 1,
        source: "opensea",
        purpose,
        simulated,
        ...fixture.quote
      });
    });
    const run = () =>
      action === "preflight"
        ? client.openSeaPreflight(fixture.reviewed, fixture.actor)
        : client.openSeaFulfillment(fixture.reviewed, fixture.actor);
    assert.equal((await run()).orderHash, fixture.reviewed.orderHash);
    simulated = !simulated;
    await assert.rejects(run());
    simulated = !simulated;
    purpose = action === "preflight" ? "fulfillment" : "preflight";
    await assert.rejects(run());
  }
});

test("zone authorization headers bind version, fulfiller and expiry before calldata construction", () => {
  const header = (actor: string, expiry: bigint, version = "00") =>
    `0x${version}${actor.slice(2)}${expiry.toString(16).padStart(16, "0")}${"11".repeat(64)}`;
  assert.equal(
    openSeaAuthorizationExpiry(header(testBuyer, 150n), testBuyer, 120n),
    150n
  );
  assert.equal(
    openSeaAuthorizationExpiry(header(zeroAddress, 150n), testBuyer, 120n),
    150n
  );
  for (const invalid of [
    "0x",
    "0x12345678",
    header(testBuyer, 120n),
    header(testSeller, 150n),
    header(testBuyer, 150n, "01")
  ])
    assert.throws(() => openSeaAuthorizationExpiry(invalid, testBuyer, 120n));
});

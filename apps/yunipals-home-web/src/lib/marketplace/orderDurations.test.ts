import assert from "node:assert/strict";
import test from "node:test";

import { supportedOrderDurations } from "@/lib/marketplace/orderDurations";
import { createBnbPublicationIntent } from "@/lib/marketplace/orderPublication";
import { createOpenSeaPublicationIntent } from "@/lib/marketplace/openseaPublication";
import { openSeaPublicationFixture } from "@/lib/marketplace/openseaPublication.testFixtures";
import {
  testPolicy,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import { marketplaceChains } from "@/lib/marketplace/registry";

const maximum = 30n * 86400n;
test("expiry choices stay within the loaded policy and never offer more than 30 days", () => {
  assert.deepEqual(supportedOrderDurations(), []);
  assert.deepEqual(
    supportedOrderDurations(86400n).map((x) => x.value),
    ["3600", "86400"]
  );
  assert.equal(supportedOrderDurations(maximum).at(-1)?.label, "30 days");
  assert.equal(supportedOrderDurations(maximum - 1n).at(-1)?.label, "14 days");
  assert.deepEqual(
    supportedOrderDurations(365n * 86400n),
    supportedOrderDurations(maximum)
  );
});

test("BNB listing construction accepts exactly 30 days and rejects one extra second", () => {
  const timestamp = 100n;
  const draft = {
    asset: {
      chain: "bnb" as const,
      chainId: 56,
      contractAddress: marketplaceChains.bnb.contractAddress,
      tokenId: "123"
    },
    lifecycle: 1,
    maker: testSeller,
    side: "listing" as const,
    grossAmount: 10n ** 18n,
    endTime: timestamp + maximum
  };
  const policy = { ...testPolicy, maxDurationSeconds: maximum };
  const state = { timestamp, counter: 0n };
  for (const duration of [3600n, 86400n, 604800n, maximum]) {
    const intent = createBnbPublicationIntent(
      { ...draft, endTime: timestamp + duration },
      policy,
      state,
      123n
    );
    assert.equal(intent.order.endTime - intent.order.startTime, duration);
  }
  assert.throws(
    () =>
      createBnbPublicationIntent(
        { ...draft, endTime: draft.endTime + 1n },
        policy,
        state,
        123n
      ),
    /duration|expiry/
  );
  assert.throws(
    () => createBnbPublicationIntent(draft, testPolicy, state, 123n),
    /duration|expiry/
  );
});

test("Ethereum, Base and Polygon listing construction enforce the same 30-day boundary", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const fixture = openSeaPublicationFixture({ chain });
    const policy = { ...fixture.policy, maxDurationSeconds: maximum };
    const state = { timestamp: 100n, counter: 0n };
    const draft = { ...fixture.draft, endTime: state.timestamp + maximum };
    const intent = createOpenSeaPublicationIntent(draft, policy, state, 123n);
    assert.equal(intent.order.endTime - intent.order.startTime, maximum);
    assert.throws(
      () =>
        createOpenSeaPublicationIntent(
          { ...draft, endTime: draft.endTime + 1n },
          policy,
          state,
          123n
        ),
      /duration|expiry/
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress } from "viem";

import { bnbOfferCurrency, marketplaceChains } from "./registry";
import {
  createNativeListing,
  createItemOffer,
  type NativeListingInput,
  type ItemOfferInput,
  type SeaportOrderComponents
} from "./seaport";
import {
  assertOrderActiveAt,
  calculateOrderFees,
  validateOwnSeaportOrder,
  type OwnOrderPolicy,
  type OrderFeePolicy
} from "./orderPolicy";

const maker = "0x0000000000000000000000000000000000000001";
const feeRecipient = "0x0000000000000000000000000000000000000002";
const other = "0x0000000000000000000000000000000000000003";
const policy: OwnOrderPolicy = {
  collection: marketplaceChains.bnb.contractAddress,
  offerCurrency: bnbOfferCurrency.address,
  fees: [{ recipient: feeRecipient, basisPoints: 250 }],
  maxDurationSeconds: 86400n
};
const input = {
  seller: maker,
  buyer: maker,
  collection: policy.collection,
  paymentToken: policy.offerCurrency,
  tokenId: 123n,
  totalPrice: 10001n,
  startTime: 100n,
  endTime: 1000n,
  salt: 10n,
  counter: 0n,
  fees: calculateOrderFees(10001n, policy.fees)
} satisfies NativeListingInput & ItemOfferInput;

test("admission computes matching listing and offer proceeds from trusted fee policy", () => {
  const listing = validateOwnSeaportOrder(createNativeListing(input), policy);
  const offer = validateOwnSeaportOrder(createItemOffer(input), policy);
  assert.equal(listing.grossAmount, 10001n);
  assert.equal(listing.sellerProceeds, 9751n);
  assert.equal(offer.sellerProceeds, listing.sellerProceeds);
  assert.equal(listing.currency, zeroAddress);
  assert.equal(offer.currency, bnbOfferCurrency.address);
  assert.equal(listing.side, "listing");
  assert.equal(offer.side, "offer");
});

test("admission rejects unsupported assets, arbitrary fee splits, routes and durations", () => {
  const mutations: Array<(order: SeaportOrderComponents) => void> = [
    (o) => {
      o.consideration[0].recipient = other;
    },
    (o) => {
      o.consideration[1].recipient = other;
    },
    (o) => {
      o.consideration[1].startAmount++;
      o.consideration[1].endAmount++;
    },
    (o) => {
      o.consideration = [...o.consideration, o.consideration[1]];
    },
    (o) => {
      o.consideration[1].token = other;
    },
    (o) => {
      o.consideration[1].identifierOrCriteria = 1n;
    },
    (o) => {
      o.offer[0].endAmount++;
    },
    (o) => {
      o.orderType = 1;
    },
    (o) => {
      o.zone = other;
    },
    (o) => {
      o.zoneHash = `0x${"1".repeat(64)}`;
    },
    (o) => {
      o.conduitKey = `0x${"1".repeat(64)}`;
    },
    (o) => {
      o.endTime = o.startTime + policy.maxDurationSeconds + 1n;
    },
    (o) => {
      o.counter = -1n;
    }
  ];
  for (const create of [createNativeListing, createItemOffer]) {
    for (const mutate of mutations) {
      const order = create(input);
      mutate(order);
      assert.throws(() => validateOwnSeaportOrder(order, policy));
    }
    assert.throws(() =>
      validateOwnSeaportOrder(create({ ...input, collection: other }), policy)
    );
    assert.throws(() =>
      validateOwnSeaportOrder(create({ ...input, fees: [] }), policy)
    );
  }
  assert.throws(() =>
    validateOwnSeaportOrder(
      createItemOffer({ ...input, paymentToken: other }),
      policy
    )
  );
  const nft = createItemOffer(input);
  nft.consideration[0].itemType = 4;
  assert.throws(() => validateOwnSeaportOrder(nft, policy));
});

test("fee rounding handles dust without zero-value transfers and rejects invalid configuration", () => {
  assert.deepEqual(calculateOrderFees(1n, policy.fees), []);
  assert.doesNotThrow(() =>
    validateOwnSeaportOrder(
      createNativeListing({ ...input, totalPrice: 1n, fees: [] }),
      policy
    )
  );
  const invalidPolicies: OrderFeePolicy[] = [
    [{ recipient: feeRecipient, basisPoints: 10000 }],
    [{ recipient: feeRecipient, basisPoints: -1 }],
    [{ recipient: feeRecipient, basisPoints: 1.5 }],
    [{ recipient: zeroAddress, basisPoints: 10 }],
    [...policy.fees, ...policy.fees],
    [
      { recipient: maker, basisPoints: 6000 },
      { recipient: other, basisPoints: 4000 }
    ]
  ];
  for (const fees of invalidPolicies)
    assert.throws(() => calculateOrderFees(10000n, fees));
});

test("order activation uses inclusive start and exclusive expiry separately from static policy", () => {
  const order = createNativeListing(input);
  assert.throws(() => assertOrderActiveAt(order, order.startTime - 1n));
  assert.doesNotThrow(() => assertOrderActiveAt(order, order.startTime));
  assert.doesNotThrow(() => assertOrderActiveAt(order, order.endTime - 1n));
  assert.throws(() => assertOrderActiveAt(order, order.endTime));
  assert.doesNotThrow(() => validateOwnSeaportOrder(order, policy));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  hashTypedData,
  maxUint256,
  verifyTypedData,
  zeroAddress,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment
} from "./registry";
import {
  assertSeaportSigningIntent,
  createNativeListing,
  seaportOrderHash,
  seaportSigningData,
  type NativeListingInput,
  type SeaportOrderComponents
} from "./seaport";

// Public, deterministic fixture key. Used only for offline signatures.
const seller = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const recipient = "0x0000000000000000000000000000000000000002";
const input = {
  seller: seller.address,
  collection: marketplaceChains.bnb.contractAddress,
  tokenId: 123n,
  totalPrice: 10n ** 18n,
  startTime: 1_780_000_000n,
  endTime: 1_780_086_400n,
  counter: 0n,
  salt: 123456n
};
const domain = {
  name: seaportDeployment.name,
  version: seaportDeployment.version,
  chainId: 56,
  verifyingContract: seaportDeployment.address
};

test("native listing fixes the NFT quantity and splits the exact buyer total", () => {
  const order = createNativeListing({
    ...input,
    fees: [{ recipient, amount: 25_000_000_000_000_000n }]
  });
  assert.equal(order.offer[0].startAmount, 1n);
  assert.equal(order.offer[0].endAmount, 1n);
  assert.equal(order.consideration[0].startAmount, 975_000_000_000_000_000n);
  assert.equal(
    order.consideration.reduce((sum, item) => sum + item.startAmount, 0n),
    input.totalPrice
  );
  assert.ok(
    order.consideration.every(
      (item) =>
        item.token === zeroAddress && item.startAmount === item.endAmount
    )
  );
});

test("rejects invalid amounts and identities before requesting a signature", () => {
  for (const invalid of [
    { totalPrice: 0n },
    { totalPrice: maxUint256 + 1n },
    { tokenId: -1n },
    { tokenId: 12.5 },
    { counter: -1n },
    { salt: maxUint256 + 1n },
    { seller: zeroAddress },
    { collection: zeroAddress },
    { endTime: input.startTime },
    { fees: [{ recipient, amount: input.totalPrice }] },
    { fees: [{ recipient: zeroAddress, amount: 1n }] }
  ]) {
    // Deliberately bypass compile-time checks to test hostile runtime input.
    assert.throws(() =>
      createNativeListing({ ...input, ...invalid } as NativeListingInput)
    );
  }
});

test("review guard rejects changed fees, recipient, NFT, counter or expiry", () => {
  const order = createNativeListing(input);
  const reviewed = seaportSigningData(domain, order);
  assert.doesNotThrow(() =>
    assertSeaportSigningIntent(reviewed, structuredClone(reviewed))
  );
  const changes: SeaportOrderComponents[] = [
    { ...order, counter: 1n },
    { ...order, endTime: order.endTime + 1n },
    { ...order, offer: [{ ...order.offer[0], identifierOrCriteria: 124n }] },
    { ...order, consideration: [{ ...order.consideration[0], recipient }] },
    {
      ...order,
      consideration: [{ ...order.consideration[0], startAmount: 1n }]
    }
  ];
  for (const changed of changes) {
    assert.throws(
      () =>
        assertSeaportSigningIntent(
          reviewed,
          seaportSigningData(domain, changed)
        ),
      /differs/
    );
  }
});

test("signing digest binds chain and deployment even though order hash does not", () => {
  const order = createNativeListing(input);
  const bnb = seaportSigningData(domain, order);
  const ethereum = seaportSigningData({ ...domain, chainId: 1 }, order);
  const wrongContract = seaportSigningData(
    { ...domain, verifyingContract: recipient },
    order
  );
  assert.equal(
    seaportOrderHash(bnb.message),
    seaportOrderHash(ethereum.message)
  );
  assert.notEqual(hashTypedData(bnb), hashTypedData(ethereum));
  assert.throws(() => assertSeaportSigningIntent(bnb, ethereum), /differs/);
  assert.throws(
    () => assertSeaportSigningIntent(bnb, wrongContract),
    /differs/
  );
});

test("signed listing authenticates the maker and fails on another chain", async () => {
  const data = seaportSigningData(domain, createNativeListing(input));
  const signature = await seller.signTypedData(data);
  assert.equal(
    await verifyTypedData({ ...data, address: seller.address, signature }),
    true
  );
  assert.equal(
    await verifyTypedData({ ...data, address: recipient, signature }),
    false
  );
  assert.equal(
    await verifyTypedData({
      ...data,
      domain: { ...domain, chainId: 1 },
      address: seller.address,
      signature
    }),
    false
  );
});

test("asset identity distinguishes chains and collections without address-case duplicates", () => {
  const asset = {
    chainId: 56,
    contractAddress: input.collection,
    tokenId: "123"
  };
  const key = marketplaceAssetKey(asset);
  assert.equal(
    key,
    marketplaceAssetKey({
      ...asset,
      contractAddress: input.collection
        .toUpperCase()
        .replace("0X", "0x") as Address
    })
  );
  assert.notEqual(key, marketplaceAssetKey({ ...asset, chainId: 1 }));
  assert.notEqual(
    key,
    marketplaceAssetKey({ ...asset, contractAddress: recipient })
  );
  assert.throws(() => marketplaceAssetKey({ ...asset, tokenId: "0123" }));
  assert.throws(() =>
    marketplaceAssetKey({ ...asset, tokenId: (maxUint256 + 1n).toString() })
  );
});

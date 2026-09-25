import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import {
  decodeValidatedPublication,
  observeValidatedPublication,
  supportedValidatedPublication,
  type ValidatedPublication
} from "@protopals/yunipals-market-core/bnbDiscovery";
import { marketplaceChains, bnbOfferCurrency } from "@protopals/yunipals-market-core/registry";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash
} from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";

import { reconstructPublishedComponents } from "@/bnb/discovery";

const maker = "0x2222222222222222222222222222222222222222";
const policy = {
  collection: marketplaceChains.bnb.contractAddress,
  offerCurrency: bnbOfferCurrency.address,
  fees: [],
  maxDurationSeconds: 2_592_000n
} as const;
const start = 2_000_000_000n;

function listing(): ValidatedPublication {
  const { counter: _counter, ...parameters } = createNativeListing({
    seller: maker,
    collection: policy.collection,
    tokenId: 27n,
    totalPrice: 1_000_000_000_000_000n,
    startTime: start,
    endTime: start + 3600n,
    counter: 19n,
    salt: 77n
  });
  return {
    orderHash: seaportOrderHash({ ...parameters, counter: 19n }),
    parameters: {
      ...parameters,
      totalOriginalConsiderationItems: BigInt(parameters.consideration.length)
    }
  };
}

test("decodes a Solidity-shaped OrderValidated event", () => {
  const publication = listing();
  const event = seaportEventAbi.find(
    (item) => item.type === "event" && item.name === "OrderValidated"
  );
  assert.ok(event && event.type === "event");
  const topics = encodeEventTopics({
    abi: seaportEventAbi,
    eventName: "OrderValidated"
  });
  const data = encodeAbiParameters(event.inputs, [
    publication.orderHash,
    publication.parameters
  ]);
  assert.deepEqual(
    decodeValidatedPublication({ topics: topics as readonly Hex[], data }),
    publication
  );
});

test("accepts only supported immediately active BNB publications", () => {
  const publication = listing();
  assert.equal(
    supportedValidatedPublication(publication, start, policy)?.tokenId,
    27n
  );
  assert.equal(
    supportedValidatedPublication(publication, start - 1n, policy),
    null
  );
  assert.equal(
    supportedValidatedPublication(publication, start + 3600n, policy),
    null
  );
  assert.equal(
    supportedValidatedPublication(
      {
        ...publication,
        parameters: {
          ...publication.parameters,
          totalOriginalConsiderationItems: 0n
        }
      },
      start,
      policy
    ),
    null
  );
  assert.equal(
    supportedValidatedPublication(publication, start, {
      ...policy,
      collection: zeroAddress
    }),
    null
  );
  const { counter: _counter, ...offer } = createItemOffer({
    buyer: maker,
    collection: policy.collection,
    tokenId: 27n,
    paymentToken: bnbOfferCurrency.address,
    totalPrice: 1_000_000_000_000_000n,
    startTime: start,
    endTime: start + 3600n,
    counter: 19n,
    salt: 78n
  });
  assert.equal(
    supportedValidatedPublication(
      {
        orderHash: seaportOrderHash({ ...offer, counter: 19n }),
        parameters: {
          ...offer,
          totalOriginalConsiderationItems: BigInt(offer.consideration.length)
        }
      },
      start,
      policy
    )?.side,
    "offer"
  );
});

test("requires a hash-matched counter and derives protocol status", () => {
  const publication = listing();
  const open = {
    isValidated: true,
    isCancelled: false,
    totalFilled: 0n,
    totalSize: 0n
  };
  const active = observeValidatedPublication(
    publication,
    19n,
    open,
    start + 1n
  );
  assert.equal(active.state, "active");
  assert.equal(active.components?.counter, 19n);
  const changed = observeValidatedPublication(
    publication,
    987654321n,
    open,
    start + 1n
  );
  assert.equal(changed.state, "counter-changed");
  assert.equal(changed.components, null);
  assert.equal(
    observeValidatedPublication(
      publication,
      19n,
      { ...open, isCancelled: true, totalFilled: 1n, totalSize: 1n },
      start + 1n
    ).state,
    "filled"
  );
  assert.equal(
    observeValidatedPublication(
      publication,
      19n,
      { ...open, isCancelled: true },
      start + 1n
    ).state,
    "cancelled"
  );
  assert.equal(
    observeValidatedPublication(publication, 19n, open, start + 3600n).state,
    "expired"
  );
  assert.equal(
    observeValidatedPublication(
      publication,
      19n,
      { ...open, isValidated: false },
      start + 1n
    ).state,
    "inconsistent"
  );
});

test("reconstructs the publication counter before a later same-block increment", async () => {
  const publication = listing();
  const blockHash = `0x${"ab".repeat(32)}` as Hex;
  const counterLog = {
    blockHash,
    logIndex: 2,
    topics: encodeEventTopics({
      abi: seaportEventAbi,
      eventName: "CounterIncremented",
      args: { offerer: maker }
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [20n])
  };
  const logClient = {
    getLogs: async () => [counterLog]
  } as unknown as PublicClient;
  const stateClient = {
    readContract: async ({ blockNumber }: { blockNumber: bigint }) =>
      blockNumber === 101n ? 20n : 19n
  } as unknown as PublicClient;
  const result = await reconstructPublishedComponents(
    publication,
    { blockNumber: 101n, blockHash, logIndex: 1 },
    logClient,
    stateClient
  );
  assert.equal(result.counter, 19n);
  assert.equal(seaportOrderHash(result.components), publication.orderHash);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  getAddress,
  verifyTypedData,
  zeroAddress,
  zeroHash,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { inspectOrderCreation } from "@/lib/marketplace/creationState";
import {
  createMarketClient,
  parsePreparedOrder,
  parsePublishedOrder,
  type MarketAsset,
  type MarketOrder
} from "@/lib/marketplace/marketApi";
import { testBuyer } from "@/lib/marketplace/marketplace.testFixtures";
import { parseOpenSeaOrderPolicy } from "@/lib/marketplace/openseaOrderPolicy";
import {
  assertOpenSeaCreationPolicy,
  createOpenSeaPublicationIntent
} from "@/lib/marketplace/openseaPublication";
import { openSeaPublicationFixture } from "@/lib/marketplace/openseaPublication.testFixtures";
import {
  openseaConduit,
  openseaSignedZone,
  type OpenSeaChain
} from "@/lib/marketplace/openseaRegistry";
import {
  orderSigningData,
  publicationRequest
} from "@/lib/marketplace/orderPublication";
import {
  encodeRecoverableOrders,
  importRecoverableOrders,
  readRecoverableOrders,
  saveRecoverableOrder
} from "@/lib/marketplace/orderRecovery";
import {
  publishOrder,
  retryPublication,
  SignedOrderPublicationError,
  type PublicationDependencies,
  type SignedOrder
} from "@/lib/marketplace/publishOrder";
import { seaportOrderHash } from "@/lib/marketplace/seaport";

const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
function setup(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing"
) {
  const fixture = openSeaPublicationFixture({ chain, side });
  const { intent } = fixture;
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    }
  };
  let wallet = { address: signer.address, chainId: 56 };
  let signatures = 0;
  const submitted: SignedOrder[] = [];
  const published: MarketOrder = { ...intent.summary, status: "active" };
  const deps: PublicationDependencies = {
    wallet: {
      context: () => wallet,
      switchChain: async (chainId) => {
        wallet = { ...wallet, chainId };
      },
      sign: async (data) => {
        signatures++;
        return signer.signTypedData(data);
      },
      verify: (data, signature) =>
        verifyTypedData({ ...data, signature, address: signer.address })
    },
    api: {
      lookup: async () => null,
      prepare: async (input) =>
        parsePreparedOrder({
          schemaVersion: 1,
          source: "opensea",
          ...input,
          id: "fixture-preparation",
          orderHash: intent.orderHash,
          expiresAt: "160"
        }),
      submit: async (signed) => {
        submitted.push(signed);
        return parsePublishedOrder({
          schemaVersion: 1,
          persisted: true,
          providerAccepted: true,
          order: published
        });
      }
    },
    revalidate: async () =>
      assertOpenSeaCreationPolicy(intent, fixture.policy, 100n),
    save: (value, state) => saveRecoverableOrder(value, state, storage),
    onStage: () => {},
    now: () => 100n
  };
  return {
    ...fixture,
    storage,
    deps,
    submitted,
    published,
    signatures: () => signatures,
    wallet: () => wallet,
    changeWallet: () => {
      wallet = { ...wallet, address: testBuyer };
    }
  };
}

test("OpenSea creation signs the correct chain, conduit, fees and protected offer on all three chains", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const)
    for (const side of ["listing", "offer"] as const) {
      const run = setup(chain, side);
      const published = await publishOrder(run.intent, run.deps);
      assert.equal(run.signatures(), 1);
      assert.equal(run.wallet().chainId, run.intent.asset.chainId);
      assert.equal(published.sellerProceeds, "975000000000000000");
      assert.equal(run.intent.order.conduitKey, openseaConduit.key);
      assert.equal(
        getAddress(run.intent.order.zone),
        side === "listing" ? zeroAddress : getAddress(openseaSignedZone)
      );
      assert.equal(run.intent.order.orderType, side === "listing" ? 0 : 2);
      assert.equal(readRecoverableOrders(run.storage)[0].state, "accepted");
      const data = orderSigningData(run.intent);
      assert.equal(
        await verifyTypedData({
          ...data,
          domain: { ...data.domain, chainId: 56 },
          address: signer.address,
          signature: run.submitted[0].signature
        }),
        false
      );
      if (chain === "polygon") assert.equal(published.currency.symbol, "WETH");
    }
});

test("OpenSea policy rejects foreign collections, currencies, zones, fees and stale requirements", () => {
  const fixture = openSeaPublicationFixture();
  for (const patch of [
    { chainId: 56 },
    { collection: testBuyer },
    { source: "yunipals" },
    { listingCurrencies: [] },
    { listingCurrencies: [zeroAddress, zeroAddress] },
    { listingCurrencies: [testBuyer] },
    { offerCurrency: zeroAddress },
    { offerZone: testBuyer },
    { listingZone: testBuyer },
    { maxDurationSeconds: "0" },
    { fees: [{ recipient: testBuyer, basisPoints: 10_000 }] }
  ])
    assert.throws(() =>
      parseOpenSeaOrderPolicy({ ...fixture.rawPolicy, ...patch }, "ethereum")
    );
  for (const patch of [
    { version: "new" },
    { expiresAt: 100n },
    { listingZone: openseaSignedZone },
    { fees: [{ recipient: testBuyer, basisPoints: 250 }] }
  ])
    assert.throws(() =>
      assertOpenSeaCreationPolicy(
        fixture.intent,
        { ...fixture.policy, ...patch },
        100n
      )
    );
  assert.throws(() =>
    createOpenSeaPublicationIntent(
      { ...fixture.draft, currency: testBuyer },
      fixture.policy,
      { timestamp: 100n, counter: 0n },
      1n
    )
  );
});

test("Changed preparation policy, components or wallet prevent an OpenSea signature", async () => {
  for (const mode of ["policy", "order", "wallet"] as const) {
    const run = setup();
    const original = run.deps.api.prepare;
    run.deps.api.prepare = async (input) => {
      const prepared = await original(input);
      if (mode === "policy") prepared.policyVersion = "changed";
      if (mode === "order") prepared.order.conduitKey = zeroHash;
      if (mode === "wallet") run.changeWallet();
      return prepared;
    };
    await assert.rejects(publishOrder(run.intent, run.deps));
    assert.equal(run.signatures(), 0);
    assert.equal(run.submitted.length, 0);
  }
});

test("OpenSea publication requires both persistence and provider acceptance, then retries the same signature", async () => {
  const run = setup("base", "offer");
  for (const flags of [
    { persisted: false, providerAccepted: true },
    { persisted: true, providerAccepted: false },
    { persisted: true }
  ])
    assert.throws(() =>
      parsePublishedOrder({ schemaVersion: 1, ...flags, order: run.published })
    );
  const submit = run.deps.api.submit;
  run.deps.api.submit = async (signed) => {
    await submit(signed);
    throw new Error("Lost provider acknowledgement");
  };
  let failed: SignedOrderPublicationError | undefined;
  await assert.rejects(publishOrder(run.intent, run.deps), (error) => {
    assert.ok(error instanceof SignedOrderPublicationError);
    failed = error;
    return true;
  });
  assert.equal(
    readRecoverableOrders(run.storage)[0].state,
    "publication-unknown"
  );
  run.deps.api.lookup = async () => ({ ...run.published, status: "filled" });
  run.deps.revalidate = async () => {
    throw new Error("Already sold");
  };
  const recovered = await retryPublication(failed!.signed, run.deps);
  assert.equal(recovered.status, "filled");
  assert.equal(run.signatures(), 1);
  assert.equal(run.submitted.length, 1);
  assert.equal(readRecoverableOrders(run.storage)[0].state, "accepted");
});

test("Cancellation recovery preserves identical order hashes on different chains through save and import", () => {
  const run = setup();
  const eth = openSeaPublicationFixture({
    chain: "ethereum",
    currency: zeroAddress
  }).intent;
  const polygon = openSeaPublicationFixture({
    chain: "polygon",
    currency: zeroAddress
  }).intent;
  assert.equal(
    eth.orderHash,
    polygon.orderHash,
    "The struct hash excludes the EIP-712 chain domain."
  );
  saveRecoverableOrder(eth, "signed", run.storage);
  saveRecoverableOrder(polygon, "signature-requested", run.storage);
  saveRecoverableOrder(eth, "accepted", run.storage);
  const records = readRecoverableOrders(run.storage);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.state),
    ["accepted", "signature-requested"]
  );
  const other = setup().storage;
  assert.deepEqual(
    importRecoverableOrders(
      encodeRecoverableOrders(records),
      signer.address,
      other
    ),
    { added: 2, existing: 0 }
  );
  assert.deepEqual(
    importRecoverableOrders(
      encodeRecoverableOrders(records),
      signer.address,
      other
    ),
    { added: 0, existing: 2 }
  );
  assert.deepEqual(
    readRecoverableOrders(other).map((record) => record.asset.chain),
    ["ethereum", "polygon"]
  );
});

test("OpenSea publication API keeps policy and durable lookup scoped to the selected chain", async () => {
  const { intent, rawPolicy } = openSeaPublicationFixture({ chain: "polygon" });
  const calls: string[] = [];
  const api = createMarketClient(
    "https://market.example",
    async (input, init) => {
      calls.push(String(input));
      if (String(input).endsWith("/policies/polygon"))
        return Response.json(rawPolicy);
      if (String(input).endsWith("/orders/prepare")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.policyVersion, intent.policyVersion);
        return Response.json({
          schemaVersion: 1,
          source: "opensea",
          ...body,
          id: "prepared",
          orderHash: intent.orderHash,
          expiresAt: "160"
        });
      }
      return Response.json({
        schemaVersion: 1,
        persisted: true,
        providerAccepted: true,
        order: intent.summary
      });
    }
  );
  assert.equal((await api.openSeaPolicy("polygon")).chain, "polygon");
  assert.equal(
    (await api.prepareOwnOrder(publicationRequest(intent))).policyVersion,
    intent.policyVersion
  );
  assert.equal(
    (await api.publishedOwnOrder(intent.orderHash, undefined, "polygon"))
      ?.orderHash,
    intent.orderHash
  );
  assert.ok(calls[2].includes("/orders/polygon/"));
});

test("OpenSea creation rechecks source, policy, owner, conduit, funds and cancellation before a replacement", async () => {
  const { intent, policy } = openSeaPublicationFixture({ side: "offer" });
  const asset: MarketAsset = {
    asset: intent.asset,
    lifecycle: intent.lifecycle,
    owner: testBuyer,
    hidden: false,
    burned: false,
    sourceStatus: "available",
    availability: {
      chain: "ethereum",
      evidence: "current",
      listings: { status: "complete", completedAt: null, revision: null },
      offers: { status: "complete", completedAt: null, revision: null }
    },
    listingState: "unlisted",
    offerAvailability: "complete",
    updatedAt: "2026-09-05T00:00:00Z",
    listings: [],
    offers: []
  };
  const source = {
    asset,
    policy,
    capabilities: {
      ethereum: {
        read: true,
        buy: true,
        acceptOffer: true,
        createListing: true,
        createOffer: true,
        cancel: true
      }
    }
  };
  const state = {
    balance: 0n,
    allowance: 0n,
    counter: 0n,
    owner: testBuyer,
    open: true,
    cancelled: new Set<string>()
  };
  const client = {
    getChainId: async () => 1,
    getBlock: async () => ({ timestamp: 100n, number: 42n }),
    getCode: async () => "0x1234",
    getBalance: async () => 10n ** 18n,
    readContract: async ({
      functionName,
      args,
      blockNumber
    }: {
      functionName: string;
      args?: readonly unknown[];
      blockNumber: bigint;
    }) => {
      assert.equal(blockNumber, 42n);
      switch (functionName) {
        case "ownerOf":
          return state.owner;
        case "getCounter":
          return state.counter;
        case "getOrderStatus":
          return [false, state.cancelled.has(String(args?.[0])), 0n, 0n];
        case "information":
          return ["1.6", zeroHash, openseaConduit.controller];
        case "getConduit":
          return [openseaConduit.address, true];
        case "getChannelStatus":
          return state.open;
        case "balanceOf":
          return state.balance;
        case "allowance":
          return state.allowance;
        default:
          throw new Error(`Unexpected call: ${functionName}`);
      }
    }
  } as unknown as PublicClient;
  assert.equal(
    (await inspectOrderCreation(client, intent, source)).prerequisite?.kind,
    "wrap"
  );
  state.balance = 10n ** 18n;
  assert.equal(
    (await inspectOrderCreation(client, intent, source)).prerequisite?.kind,
    "approve-currency"
  );
  state.allowance = state.balance;
  assert.equal(
    (await inspectOrderCreation(client, intent, source)).prerequisite,
    null
  );
  for (const patch of [
    { owner: signer.address },
    { counter: 1n },
    { open: false }
  ]) {
    const old = { ...state };
    Object.assign(state, patch);
    await assert.rejects(inspectOrderCreation(client, intent, source));
    Object.assign(state, old);
  }
  source.asset.hidden = true;
  await assert.rejects(inspectOrderCreation(client, intent, source));
  source.asset.hidden = false;
  const previous = { ...intent.order, salt: intent.order.salt + 1n };
  const hash = seaportOrderHash(previous);
  const replacement = {
    summary: { ...intent.summary, orderHash: hash },
    order: previous
  };
  assert.equal(
    (await inspectOrderCreation(client, intent, source, replacement))
      .prerequisite?.kind,
    "cancel"
  );
  state.cancelled.add(hash);
  assert.equal(
    (await inspectOrderCreation(client, intent, source, replacement))
      .prerequisite,
    null
  );
});

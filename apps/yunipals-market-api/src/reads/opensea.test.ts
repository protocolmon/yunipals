import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, afterEach, test } from "node:test";
import pg from "pg";
import { zeroAddress } from "viem";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { createOpenSeaTestDatabase } from "@/opensea/fixtures/database";
import { seller, buyer, fixtureNow } from "@/opensea/fixtures/admission";
import { testUrl } from "@/bnb/fixtures/database";
import {
  claimOpenSeaDiscovery,
  processOpenSeaDiscoveryPage
} from "@/opensea/discovery";
import { parseOpenSeaDiscoveredOrder } from "@/opensea/discoveryOrder";
import {
  claimDiscoveredOpenSeaOrder,
  reconcileDiscoveredOpenSeaOrder
} from "@/opensea/discoveredReconciliation";
import {
  observeOpenSeaHeadHealth,
  observeOpenSeaReadHealth
} from "@/opensea/readHealth";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { OpenSeaRecoveryService } from "@/opensea/recovery";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { OrderReadService, readOrderSources } from "@/reads/orders";
import { CatalogService } from "@/reads/catalog";

const db = createOpenSeaTestDatabase();
const hashes: string[] = [];
const scans: string[] = [];
const catalogs: CatalogService[] = [];
const tokens: string[] = [];
const discoveredItems: Item[] = [];
const reads = new OrderReadService(db.runtime);
const recovery = new OpenSeaRecoveryService(db.runtime);
before(db.initialize);
afterEach(async () => {
  await Promise.all(catalogs.splice(0).map((catalog) => catalog.close()));
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.job WHERE payload->>'orderHash'=ANY($1::text[])",
    [hashes]
  );
  for (const table of ["submission_attempt", "orders", "preparation"])
    await db.owner.query(
      `DELETE FROM yunipals_market.${table} WHERE order_hash=ANY($1::text[])`,
      [hashes]
    );
  for (const table of ["opensea_discovered_state", "opensea_discovered_order"])
    await db.owner.query(
      `DELETE FROM yunipals_market.${table} WHERE order_hash=ANY($1::text[])`,
      [hashes]
    );
  await db.owner.query(
    "DELETE FROM yunipals_market.opensea_discovery_page WHERE run_id=ANY($1::uuid[])",
    [scans]
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.opensea_discovery_scan WHERE run_id=ANY($1::uuid[])",
    [scans]
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.checkpoint WHERE name IN ('opensea-order-worker','opensea-read-reorg')"
  );
  discoveredItems.length = 0;
  hashes.length = 0;
  scans.length = 0;
});
after(async () => {
  for (const table of ["token_trait", "token_metadata"])
    await db.owner.query(
      `DELETE FROM metadata.${table} WHERE token_id=ANY($1::numeric[])`,
      [tokens]
    );
  await db.close();
});
type Item = Awaited<ReturnType<typeof db.setup>>;
const policies = (item: Item): Pick<OpenSeaPolicyResolver, "resolve"> => ({
  async resolve() {
    return {
      policy: item.policy,
      collectionSlug: marketplaceChains[item.input.asset.chain].collectionSlug
    } as Awaited<ReturnType<OpenSeaPolicyResolver["resolve"]>>;
  }
});
async function discover(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing",
  signed = true
) {
  const item = await db.setup(chain, side);
  tokens.push(item.input.asset.tokenId);
  discoveredItems.push(item);
  const parsed = parseOpenSeaDiscoveredOrder(
    {
      chain,
      order_hash: item.input.hash,
      protocol_address: seaportDeployment.address,
      protocol_data: {
        parameters: {
          ...item.draft.order,
          totalOriginalConsiderationItems: item.draft.order.consideration.length
        },
        signature: signed ? item.signature : "0x"
      },
      status: "ACTIVE",
      remaining_quantity: 1
    },
    chain,
    side
  );
  hashes.push(parsed.orderHash);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_discovered_order
    (chain_id,protocol_address,order_hash,contract_address,side,token_id,maker,classification,provider_status,components,signature,provider_observation,last_seen_run_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      parsed.chainId,
      parsed.protocolAddress,
      parsed.orderHash,
      parsed.contractAddress,
      parsed.side,
      parsed.tokenId,
      parsed.maker,
      parsed.classification,
      parsed.providerStatus,
      JSON.stringify(parsed.components),
      parsed.signature,
      JSON.stringify(parsed.observation),
      randomUUID()
    ]
  );
  return item;
}
async function reconcile(item: Item) {
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET next_reconcile_at=clock_timestamp() WHERE order_hash=$1",
    [item.input.hash]
  );
  const claim = await claimDiscoveredOpenSeaOrder(
    db.runtime,
    item.input.asset.chain,
    30000,
    item.input.hash
  );
  assert.ok(claim);
  return reconcileDiscoveredOpenSeaOrder(
    db.runtime,
    item.client,
    item.input.asset.chain,
    policies(item),
    { ...item.options, providerMaxAgeMs: 300000 },
    claim
  );
}
async function healthy(item: Item) {
  const chain = item.input.asset.chain;
  for (const side of ["listing", "offer"] as const) {
    const scan = await claimOpenSeaDiscovery(
      db.runtime,
      chain,
      side,
      marketplaceChains[chain].collectionSlug
    );
    assert.ok(scan);
    scans.push(scan.run_id);
    const rows = (
      await db.owner.query<{ provider_observation: unknown }>(
        "SELECT provider_observation FROM yunipals_market.opensea_discovered_order WHERE chain_id=$1 AND side=$2",
        [item.input.asset.chainId, side]
      )
    ).rows;
    assert.ok(rows.length <= 50);
    await processOpenSeaDiscoveryPage(
      db.runtime,
      {
        async listCollectionOrders() {
          return {
            orders: rows.map((row) => row.provider_observation),
            next: null
          };
        }
      },
      chain,
      scan
    );
  }
  for (const current of discoveredItems.filter(
    (value) => value.input.asset.chain === chain
  ))
    await reconcile(current);
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      chain,
      policies(item),
      () => fixtureNow
    ),
    true
  );
}
async function wallet(...args: Parameters<OrderReadService["wallet"]>) {
  const page = await reads.wallet(...args);
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      order: parseMarketOrder(row.order)
    }))
  };
}
const walletParams = (chain: OpenSeaChain, view = "listings") =>
  new URLSearchParams({ chain, view, limit: "25" });
async function source(chain: OpenSeaChain) {
  return (await readOrderSources(db.runtime, new Date())).statuses[chain];
}
function catalog() {
  const keepers = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
    max: 3
  });
  keepers.on("error", () => {});
  const service = new CatalogService(db.runtime, keepers);
  catalogs.push(service);
  return service;
}
async function tag(item: Item, marker: string) {
  const attributes = [{ trait_type: "ReadFixture", value: marker }];
  await db.owner.query(
    "INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,attributes) VALUES($1,$2,1,$3)",
    [
      item.input.asset.chain,
      item.input.asset.tokenId,
      JSON.stringify(attributes)
    ]
  );
  await db.owner.query(
    "INSERT INTO metadata.token_trait VALUES($1,$2,1,'ReadFixture',$3)",
    [item.input.asset.chain, item.input.asset.tokenId, marker]
  );
}

test("all OpenSea chains merge verified discovered listings and offers into asset and wallet reads", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const listing = await discover(chain);
    const offer = await discover(chain, "offer");
    assert.equal((await reconcile(listing)).state, "eligible");
    assert.equal(
      (await reconcile(offer)).reason,
      "provider_authorization_required"
    );
    await healthy(listing);
    assert.equal(await source(chain), "available");
    const asset = await reads.asset(listing.input.asset);
    assert.equal(asset.sourceStatus, "available");
    assert.equal(asset.listings[0]?.orderHash, listing.input.hash);
    const made = await wallet(
      buyer.address,
      walletParams(chain, "offers-made")
    );
    assert.ok(
      made.items.some((row) => row.order.orderHash === offer.input.hash)
    );
    const received = await wallet(
      seller.address,
      walletParams(chain, "offers-received")
    );
    assert.ok(
      received.items.some((row) => row.order.orderHash === offer.input.hash)
    );
    assert.equal(JSON.stringify(received).includes(listing.signature), false);
  }
});

test("missing signatures remain cancellable but prevent false unlisted counts and executable asset books", async () => {
  const item = await discover("ethereum", "listing", false);
  await reconcile(item);
  await healthy(item);
  assert.equal(await source("ethereum"), "syncing");
  const asset = await reads.asset(item.input.asset);
  assert.deepEqual(asset.listings, []);
  const page = await wallet(seller.address, walletParams("ethereum"));
  assert.equal(page.items[0]?.order.status, "unavailable");
  const cancellation = await recovery.cancellation(
    "ethereum",
    item.input.hash,
    { actor: seller.address }
  );
  assert.deepEqual(cancellation.order, item.draft.order);
  const marker = randomUUID();
  await tag(item, marker);
  const unfiltered = await catalog().tokens(
    new URLSearchParams({ chain: "ethereum", "t.ReadFixture": marker })
  );
  assert.equal(unfiltered.listedTotal, null);
  assert.equal(unfiltered.items[0]?.market.status, "unknown");
  await assert.rejects(
    catalog().tokens(
      new URLSearchParams({
        chain: "ethereum",
        sale: "unlisted",
        "t.ReadFixture": marker
      })
    )
  );
});

test("unreconciled discovery and missing provider signatures do not erase cancellation recovery after transfer or hiding", async () => {
  const item = await discover("base", "listing", false);
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET owner=$1,burned=true,lifecycle=2 WHERE collection='base' AND token_id=$2",
    [zeroAddress, item.input.asset.tokenId]
  );
  const page = await wallet(seller.address, walletParams("base"));
  assert.equal(page.items[0]?.order.lifecycle, 0);
  assert.equal(page.items[0]?.order.status, "unavailable");
  assert.deepEqual(
    (
      await recovery.cancellation("base", item.input.hash, {
        actor: seller.address
      })
    ).order,
    item.draft.order
  );
  await assert.rejects(
    recovery.cancellation("base", item.input.hash, { actor: buyer.address }),
    { code: "cancellation_maker_mismatch" }
  );
});

test("complete-catalog counts and pages include discovered listings beyond the first 24 NFTs", async () => {
  const marker = randomUUID();
  let last: Item | undefined;
  for (let n = 0; n < 27; n++) {
    const item = await discover();
    await tag(item, marker);
    await reconcile(item);
    last = item;
  }
  assert.ok(last);
  await healthy(last);
  const service = catalog();
  const query = new URLSearchParams({
    chain: "ethereum",
    sale: "listed",
    currency: "native",
    sort: "price-asc",
    "t.ReadFixture": marker
  });
  const first = await service.tokens(query);
  assert.equal(first.total, 27);
  assert.equal(first.listedTotal, 27);
  assert.equal(first.items.length, 24);
  assert.ok(first.nextCursor);
  query.set("cursor", first.nextCursor);
  query.set("snapshot", first.snapshot.id);
  const second = await service.tokens(query);
  assert.equal(second.items.length, 3);
  assert.equal(second.total, 27);
});

test("retained pending publication shadows discovery in wallet reads and preserves exact cancellation", async () => {
  const item = await discover();
  await reconcile(item);
  const admission = new OpenSeaAdmissionService(
    db.runtime,
    { ethereum: item.client },
    policies(item),
    item.options
  );
  await healthy(item);
  const prepared = await admission.prepare(item.draft);
  await admission.submit({ ...item.request, preparationId: prepared.id });
  assert.equal(await source("ethereum"), "syncing");
  const page = await wallet(seller.address, walletParams("ethereum"));
  assert.equal(
    page.items.filter((row) => row.order.orderHash === item.input.hash).length,
    1
  );
  assert.equal(
    page.items.find((row) => row.order.orderHash === item.input.hash)?.order
      .status,
    "unavailable"
  );
  assert.deepEqual(
    (
      await recovery.cancellation("ethereum", item.input.hash, {
        actor: seller.address
      })
    ).order,
    item.draft.order
  );
});

test("chain-prevalidated discovery does not need an omitted provider signature", async () => {
  const item = await discover("polygon", "listing", false);
  item.state.validated = true;
  assert.equal((await reconcile(item)).state, "eligible");
  await healthy(item);
  assert.equal(await source("polygon"), "available");
  assert.equal((await reads.asset(item.input.asset)).listings.length, 1);
});

test("unchanged refresh preserves availability while actual changes and stale observations revoke it", async () => {
  const item = await discover();
  await reconcile(item);
  await healthy(item);
  assert.equal(await source("ethereum"), "available");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_order SET last_seen_at=last_seen_at+interval '1 microsecond' WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal(await source("ethereum"), "available");
  for (const present of [false, true])
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=$2 WHERE order_hash=$1",
      [item.input.hash, present]
    );
  assert.equal(await source("ethereum"), "syncing");
  await reconcile(item);
  assert.equal(await source("ethereum"), "available");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET state='syncing',run_started_at=clock_timestamp() WHERE chain_id=1 AND side='offer'"
  );
  assert.equal(await source("ethereum"), "available");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET completed_at=clock_timestamp()-interval '301 seconds' WHERE chain_id=1 AND side='offer'"
  );
  assert.equal(await source("ethereum"), "syncing");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET state='available',completed_at=clock_timestamp() WHERE chain_id=1 AND side='offer'"
  );
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp()-interval '121 seconds' WHERE chain_id=1 AND name='opensea-order-worker'"
  );
  assert.equal(await source("ethereum"), "available");
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp()-interval '181 seconds' WHERE chain_id=1 AND name='opensea-order-worker'"
  );
  assert.equal(await source("ethereum"), "unavailable");
});

test("read health fails closed on RPC and policy failure, and a reorg requires new order observations", async () => {
  const item = await discover();
  await reconcile(item);
  await healthy(item);
  item.state.rpcFailure = true;
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      "ethereum",
      policies(item),
      () => fixtureNow
    ),
    false
  );
  assert.equal(await source("ethereum"), "available");
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=$1 WHERE source='chain' AND chain_id=1 AND name='opensea-order-worker'",
    [new Date(fixtureNow - 181000)]
  );
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      "ethereum",
      policies(item),
      () => fixtureNow
    ),
    false
  );
  assert.equal(await source("ethereum"), "unavailable");
  item.state.rpcFailure = false;
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      "ethereum",
      policies(item),
      () => fixtureNow
    ),
    true
  );
  const denied = {
    async resolve(): Promise<never> {
      throw new Error("private provider credential failure");
    }
  };
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=$1 WHERE source='chain' AND chain_id=1 AND name='opensea-order-worker'",
    [new Date(fixtureNow - 181000)]
  );
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      "ethereum",
      denied,
      () => fixtureNow
    ),
    false
  );
  assert.equal(await source("ethereum"), "unavailable");
  item.state.headHash = `0x${"bc".repeat(32)}`;
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      item.client,
      "ethereum",
      policies(item),
      () => fixtureNow
    ),
    true
  );
  assert.equal(await source("ethereum"), "syncing");
  item.options.now = () => fixtureNow + 1000;
  await reconcile(item);
  assert.equal(await source("ethereum"), "available");
});

test("deep read health accepts bounded public RPC pacing without claiming scan coverage", async () => {
  const item = await discover();
  let pacedNow = fixtureNow;
  const getBlock = item.client.getBlock.bind(item.client);
  const client = {
    ...item.client,
    async getBlock(args: Parameters<typeof item.client.getBlock>[0]) {
      const block = await getBlock(args);
      pacedNow += 4000;
      return block;
    }
  } as typeof item.client;
  assert.equal(
    await observeOpenSeaReadHealth(
      db.runtime,
      client,
      "ethereum",
      policies(item),
      () => pacedNow
    ),
    true
  );
  assert.ok(pacedNow - fixtureNow > 10000);
  assert.equal(await source("ethereum"), "syncing");
});

test("v2 keeps verified listings visible when offer or listing coverage is partial", async () => {
  const item = await discover();
  await reconcile(item);
  await healthy(item);
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET completed_at=clock_timestamp()-interval '301 seconds' WHERE chain_id=1 AND side='offer'"
  );
  const service = catalog();
  const listed = await service.tokensV2(
    new URLSearchParams({
      chain: "ethereum",
      sale: "listed",
      sort: "token-id-asc",
      limit: "24"
    })
  );
  assert.equal(listed.schemaVersion, 2);
  assert.equal(listed.listingCompleteness, "complete");
  assert.equal(listed.availability.ethereum?.offers.status, "partial");
  assert.equal(listed.items[0]?.market.status, "listed");
  const asset = await reads.assetV2(item.input.asset);
  assert.equal(asset.listingState, "listed");
  assert.equal(asset.offerAvailability, "partial");
  assert.equal(asset.listings[0]?.orderHash, item.input.hash);

  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET completed_at=clock_timestamp()-interval '301 seconds' WHERE chain_id=1 AND side='listing'"
  );
  const partialService = catalog();
  const partial = await partialService.tokensV2(
    new URLSearchParams({
      chain: "ethereum",
      sale: "listed",
      sort: "token-id-asc",
      limit: "24"
    })
  );
  assert.equal(partial.listingCompleteness, "partial");
  assert.equal(partial.listedTotal, null);
  assert.equal(partial.verifiedListedTotal, 1);
  assert.equal(partial.items[0]?.market.status, "listed");

  const unknown = await catalog().tokensV2(
    new URLSearchParams({
      chain: "ethereum",
      sale: "unlisted",
      sort: "token-id-asc",
      limit: "24"
    })
  );
  assert.equal(unknown.total, 0);
  assert.deepEqual(unknown.items, []);

  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp()-interval '181 seconds' WHERE source='chain' AND chain_id=1 AND name='opensea-order-worker'"
  );
  const unavailable = await catalog().tokensV2(
    new URLSearchParams({
      chain: "ethereum",
      sale: "listed",
      sort: "token-id-asc",
      limit: "24"
    })
  );
  assert.equal(unavailable.listingCompleteness, "unavailable");
  assert.equal(unavailable.verifiedListedTotal, 0);
  assert.deepEqual(unavailable.items, []);
});

test("one transient discovery failure preserves recent complete listing coverage", async () => {
  const item = await discover();
  await reconcile(item);
  await healthy(item);
  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovery_scan SET state='unavailable',
    failures=1,last_error_code='provider_timeout',checked_at=clock_timestamp()
    WHERE chain_id=1 AND side='listing'`
  );
  const retained = await catalog().tokensV2(
    new URLSearchParams({
      chain: "ethereum",
      sale: "listed",
      sort: "token-id-desc",
      limit: "24"
    })
  );
  assert.equal(retained.sources.ethereum, "available");
  assert.equal(retained.listingCompleteness, "complete");
  assert.equal(retained.availability.ethereum?.listings.status, "complete");
  assert.equal(retained.items[0]?.market.status, "listed");

  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovery_scan SET failures=2
    WHERE chain_id=1 AND side='listing'`
  );
  const repeated = await catalog().tokensV2(
    new URLSearchParams({ chain: "ethereum", limit: "24" })
  );
  assert.equal(repeated.listingCompleteness, "partial");
  assert.equal(repeated.availability.ethereum?.listings.status, "partial");

  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovery_scan SET failures=1,
    last_error_code='provider_invalid_response'
    WHERE chain_id=1 AND side='listing'`
  );
  const invalid = await catalog().tokensV2(
    new URLSearchParams({ chain: "ethereum", limit: "24" })
  );
  assert.equal(invalid.listingCompleteness, "partial");

  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovery_scan SET
    last_error_code='provider_timeout',completed_at=clock_timestamp()-interval '601 seconds'
    WHERE chain_id=1 AND side='listing'`
  );
  const stale = await catalog().tokensV2(
    new URLSearchParams({ chain: "ethereum", limit: "24" })
  );
  assert.equal(stale.listingCompleteness, "partial");
});

test("one transient head failure preserves a recent canonical checkpoint", async () => {
  const item = await discover();
  await healthy(item);
  item.state.rpcFailure = true;
  assert.equal(
    await observeOpenSeaHeadHealth(
      db.runtime,
      item.client,
      "ethereum",
      () => fixtureNow + 60000
    ),
    false
  );
  assert.equal(await source("ethereum"), "available");
  assert.equal(
    await observeOpenSeaHeadHealth(
      db.runtime,
      item.client,
      "ethereum",
      () => fixtureNow + 181000
    ),
    false
  );
  assert.equal(await source("ethereum"), "unavailable");
});

test("a scan for another collection or a missing committed page cannot establish completeness", async () => {
  const item = await discover();
  await reconcile(item);
  await healthy(item);
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET collection_slug='another-collection' WHERE chain_id=1 AND side='listing'"
  );
  assert.equal(await source("ethereum"), "syncing");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET collection_slug='yunipals' WHERE chain_id=1 AND side='listing'"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.opensea_discovery_page WHERE chain_id=1 AND side='listing'"
  );
  assert.equal(await source("ethereum"), "syncing");
});

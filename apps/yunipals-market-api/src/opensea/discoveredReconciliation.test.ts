import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg, { type PoolClient } from "pg";
import { zeroHash, type Hex, type PublicClient } from "viem";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import {
  seaportOrderHash,
  seaportSigningData
} from "@protopals/yunipals-market-core/seaport";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";

import { createOpenSeaTestDatabase } from "@/opensea/fixtures/database";
import {
  fixtureNow,
  fixtureTimestamp,
  seller
} from "@/opensea/fixtures/admission";
import {
  parseOpenSeaDiscoveredOrder,
  summarizeDiscoveredOpenSeaOrder
} from "@/opensea/discoveryOrder";
import {
  claimDiscoveredOpenSeaOrder,
  reconcileDiscoveredOpenSeaOrder,
  checkDiscoveredOpenSeaPolicy,
  openSeaProjectionAuditDelayMs
} from "@/opensea/discoveredReconciliation";
import { LostJobLeaseError } from "@/db/jobs";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { runOpenSeaSubmissionWorker } from "@/opensea/worker";
import { testUrl } from "@/bnb/fixtures/database";
import { marketOrderRowsSql } from "@/reads/orderRows";
import {
  assertOpenSeaReadWorkerReady,
  runOpenSeaReadWorker
} from "@/opensea/readWorker";
import { observeOpenSeaReadHealth } from "@/opensea/readHealth";

const db = createOpenSeaTestDatabase();
const hashes: string[] = [];
let held: PoolClient;
const readRole = `market_test_read_${process.pid}`;
let readPool: pg.Pool;
before(async () => {
  await db.initialize();
  await db.owner.query(
    `CREATE ROLE ${readRole} LOGIN NOINHERIT PASSWORD 'local-read-test-only'`
  );
  await db.owner.query(
    (
      await readFile(
        new URL("../../scripts/grant-opensea-read-worker.sql", import.meta.url),
        "utf8"
      )
    ).replaceAll(':"market_runtime_role"', `"${readRole}"`)
  );
  const url = new URL(testUrl("MARKET_TEST_DATABASE_URL"));
  url.username = readRole;
  url.password = "local-read-test-only";
  readPool = new pg.Pool({
    connectionString: url.href,
    max: 4,
    statement_timeout: 5000
  });
  held = await db.owner.connect();
  await held.query("BEGIN");
  await held.query(
    "SELECT id FROM yunipals_market.job WHERE kind IN ('opensea_submission','opensea_order_reconcile') FOR UPDATE"
  );
});
async function clear() {
  for (const table of ["opensea_discovered_state", "opensea_discovered_order"])
    await db.owner.query(
      `DELETE FROM yunipals_market.${table} WHERE order_hash=ANY($1::text[])`,
      [hashes]
    );
  hashes.length = 0;
}
beforeEach(clear);
after(async () => {
  await clear();
  await held.query("ROLLBACK");
  held.release();
  await readPool.end();
  await db.owner.query(`DROP OWNED BY ${readRole}; DROP ROLE ${readRole}`);
  await db.close();
});
type Item = Awaited<ReturnType<typeof db.setup>>;
async function providerPresenceRoundTrip(hash: string) {
  for (const present of [false, true])
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=$2 WHERE order_hash=$1",
      [hash, present]
    );
}

async function discover(item: Item, signed = false) {
  const envelope = {
    chain: item.input.asset.chain,
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
  };
  const parsed = parseOpenSeaDiscoveredOrder(
    envelope,
    item.input.asset.chain,
    item.intent.summary.side
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
function policies(item: Item): Pick<OpenSeaPolicyResolver, "resolve"> {
  return {
    async resolve() {
      return {
        policy: item.policy,
        collectionSlug: marketplaceChains[item.input.asset.chain].collectionSlug
      } as Awaited<ReturnType<OpenSeaPolicyResolver["resolve"]>>;
    }
  };
}
const options = (item: Item) => ({ ...item.options, providerMaxAgeMs: 300000 });
async function claim(item: Item) {
  const value = await claimDiscoveredOpenSeaOrder(
    db.runtime,
    item.input.asset.chain,
    30000,
    item.input.hash
  );
  assert.ok(value);
  return value;
}
async function due(item: Item) {
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET next_reconcile_at=clock_timestamp() WHERE order_hash=$1",
    [item.input.hash]
  );
}
async function saved(item: Item) {
  return (
    await db.owner.query(
      "SELECT *,block_number::text FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
      [item.input.hash]
    )
  ).rows[0];
}
async function reconcile(
  item: Item,
  config = options(item),
  policy = policies(item),
  client = item.client
) {
  await due(item);
  await reconcileDiscoveredOpenSeaOrder(
    db.runtime,
    client,
    item.input.asset.chain,
    policy,
    config,
    await claim(item)
  );
  return saved(item);
}

test("all three chains bind unsigned discovery to indexed lifecycle without inventing acceptance or checkout readiness", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await discover(await db.setup(chain));
    const row = await reconcile(item);
    assert.equal(row.state, "authorization-required");
    assert.equal(row.reason, "maker_signature_required");
    assert.equal(row.bound_lifecycle, 1);
    assert.equal(row.bound_mint_hash, item.indexed.mint.transactionHash);
    assert.equal(row.block_number, "121");
    assert.equal(row.summary.status, "unavailable");
    assert.equal(row.summary.asset.chain, chain);
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.submission_attempt WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].n,
      0
    );
  }
});

test("a verified maker signature permits an open listing observation; protected offers still need actor authorization", async () => {
  const listing = await discover(await db.setup("base"), true);
  assert.equal((await reconcile(listing)).state, "eligible");
  listing.state.approved = false;
  assert.equal((await reconcile(listing)).reason, "nft_approval_required");
  listing.state.approved = true;
  assert.equal((await reconcile(listing)).state, "eligible");
  const offer = await db.setup("polygon", "offer");
  offer.signature = "0x1234";
  offer.state.erc1271 = true;
  await discover(offer, true);
  assert.equal(
    (await reconcile(offer)).reason,
    "provider_authorization_required"
  );
  offer.state.allowance = 0n;
  assert.equal((await reconcile(offer)).reason, "offer_funding_required");
  offer.state.allowance = 10n ** 18n;
  assert.equal((await reconcile(offer)).state, "authorization-required");
  offer.state.erc1271 = true;
  offer.state.signatureValid = false;
  assert.equal((await reconcile(offer)).reason, "invalid_maker_signature");
});

test("catalog discovery accepts fresh five-minute browse policies for listings and offers", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      const item = await discover(await db.setup(chain, side));
      for (const remaining of [300n, 182n]) {
        item.policy.expiresAt = fixtureTimestamp + remaining;
        const row = await reconcile(item);
        assert.equal(row.state, "authorization-required");
        assert.equal(row.reason, "maker_signature_required");
      }
      item.policy.expiresAt = fixtureTimestamp;
      assert.equal((await reconcile(item)).reason, "order_policy_rejected");
      item.policy.expiresAt = fixtureTimestamp + 301n;
      assert.equal((await reconcile(item)).reason, "order_policy_rejected");
    }
  }
});

test("canonical protocol termination remains observable without provider visibility, policy or indexer availability", async () => {
  for (const status of [
    "filled",
    "cancelled",
    "counter-changed",
    "expired"
  ] as const) {
    const item = await discover(await db.setup());
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE order_hash=$1",
      [item.input.hash]
    );
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET burned=true WHERE token_id=$1",
      [item.input.asset.tokenId]
    );
    if (status === "filled") {
      item.state.filled = 1n;
      item.state.cancelled = true;
    }
    if (status === "cancelled") item.state.cancelled = true;
    if (status === "counter-changed") item.state.counter = 1n;
    if (status === "expired")
      item.state.headTimestamp = item.input.order.endTime;
    const row = await reconcile(
      item,
      { ...options(item), now: () => Number(item.state.headTimestamp) * 1000 },
      {
        async resolve() {
          throw new Error("offline");
        }
      }
    );
    assert.equal(row.state, status);
    assert.equal(row.bound_lifecycle, null);
    assert.equal(row.block_number, "121");
    if (status === "expired") {
      const terminal = (
        await db.owner.query(
          "SELECT terminal_reason,next_reconcile_at='infinity'::timestamptz AS retired FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0];
      assert.deepEqual(terminal, { terminal_reason: "expired", retired: true });
      assert.equal(
        await claimDiscoveredOpenSeaOrder(
          db.runtime,
          "ethereum",
          30000,
          item.input.hash
        ),
        null
      );
    }
  }
});

test("missing or stale provider evidence cannot enable an order; a provider cancellation is not an onchain cancellation", async () => {
  const item = await discover(await db.setup());
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_order SET last_seen_at=clock_timestamp()-interval '1 hour' WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal((await reconcile(item)).reason, "provider_observation_stale");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_order SET last_seen_at=clock_timestamp(),provider_status='CANCELLED',provider_observation=jsonb_set(provider_observation,'{status}','\"CANCELLED\"') WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal((await reconcile(item)).reason, "provider_order_unavailable");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_order SET provider_status='ACTIVE',provider_observation=jsonb_set(provider_observation,'{status}','\"ACTIVE\"') WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal((await reconcile(item)).state, "authorization-required");
});

test("bound lifecycle and mint identity never silently follow a burn/remint or changed canonical mint", async () => {
  const item = await discover(await db.setup());
  await reconcile(item);
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET lifecycle=2 WHERE token_id=$1",
    [item.input.asset.tokenId]
  );
  await db.owner.query(
    "UPDATE yunipals_read_v4.token_lifecycle SET lifecycle=2 WHERE token_id=$1",
    [item.input.asset.tokenId]
  );
  await db.owner.query(
    "UPDATE yunipals_read_v4.transfer_event SET lifecycle=2 WHERE token_id=$1",
    [item.input.asset.tokenId]
  );
  const changed = await reconcile(item);
  assert.equal(changed.reason, "asset_changed");
  assert.equal(changed.bound_lifecycle, 1);
  assert.equal(changed.summary, null);
  for (const table of ["token", "token_lifecycle", "transfer_event"])
    await db.owner.query(
      `UPDATE yunipals_read_v4.${table} SET lifecycle=1 WHERE token_id=$1`,
      [item.input.asset.tokenId]
    );
  await db.owner.query(
    "UPDATE yunipals_read_v4.token_lifecycle SET mint_transaction_hash=$2 WHERE token_id=$1",
    [item.input.asset.tokenId, `0x${"ef".repeat(32)}`]
  );
  assert.equal((await reconcile(item)).reason, "asset_changed");
  await db.owner.query(
    "UPDATE yunipals_read_v4.token_lifecycle SET mint_transaction_hash=$2 WHERE token_id=$1",
    [item.input.asset.tokenId, item.indexed.mint.transactionHash]
  );
  assert.equal((await reconcile(item)).state, "authorization-required");
});

test("an initially discovered signature predating the current mint cannot be rebound to that lifecycle", async () => {
  const item = await discover(await db.setup());
  const client = {
    ...item.client,
    async getBlock(args: Parameters<PublicClient["getBlock"]>[0]) {
      const block = await item.client.getBlock(args);
      return args?.blockNumber === 50n
        ? { ...block, timestamp: fixtureTimestamp }
        : block;
    }
  } as PublicClient;
  const row = await reconcile(item, options(item), policies(item), client);
  assert.equal(row.reason, "order_predates_lifecycle");
  assert.equal(row.bound_lifecycle, null);
});

test("collector changes during chain inspection fence the entire projection and preserve provider provenance", async () => {
  const item = await discover(await db.setup());
  item.state.afterReceipt = async () => {
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=false,last_seen_at=clock_timestamp() WHERE order_hash=$1",
      [item.input.hash]
    );
  };
  const row = await reconcile(item);
  assert.equal(row.reason, "discovery_changed_during_observation");
  assert.equal(row.observed_at, null);
  assert.equal(row.bound_lifecycle, null);
  assert.equal(row.summary, null);
  assert.equal(
    (
      await db.owner.query(
        "SELECT present FROM yunipals_market.opensea_discovered_order WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].present,
    false
  );
});

test("reorgs, stale observations and wrong deployment cannot publish eligibility and terminal states are revisited", async () => {
  const item = await discover(await db.setup());
  item.state.cancelled = true;
  assert.equal((await reconcile(item)).state, "cancelled");
  item.state.cancelled = false;
  item.state.afterReceipt = async () => {
    item.state.headHash = `0x${"ef".repeat(32)}` as Hex;
  };
  assert.equal((await reconcile(item)).reason, "observation_expired");
  item.state.afterReceipt = undefined;
  assert.equal((await reconcile(item)).state, "authorization-required");
  item.state.code = "0x6000";
  assert.equal((await reconcile(item)).reason, "deployment_or_hash_mismatch");
  const slow = await discover(await db.setup());
  let now = fixtureNow;
  slow.state.afterReceipt = async () => {
    now += 10001;
  };
  assert.equal(
    (await reconcile(slow, { ...options(slow), now: () => now })).state,
    "authorization-required"
  );
  const expired = await discover(await db.setup());
  now = fixtureNow;
  expired.state.afterReceipt = async () => {
    now += 60001;
  };
  assert.equal(
    (await reconcile(expired, { ...options(expired), now: () => now })).reason,
    "observation_expired"
  );
});

test("unchanged provider refresh during reconciliation preserves eligibility and the normal due time", async () => {
  const item = await discover(await db.setup("base"), true);
  item.state.afterReceipt = async () => {
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET last_seen_at=clock_timestamp(),last_seen_run_id=$2 WHERE order_hash=$1",
      [item.input.hash, randomUUID()]
    );
  };
  assert.equal((await reconcile(item)).state, "eligible");
  const binding = (
    await db.owner.query(
      "SELECT s.provider_seen_at=d.last_changed_at AS current FROM yunipals_market.opensea_discovered_state s JOIN yunipals_market.opensea_discovered_order d USING(chain_id,protocol_address,order_hash) WHERE s.order_hash=$1",
      [item.input.hash]
    )
  ).rows[0];
  assert.equal(binding.current, true);
  assert.equal(
    await claimDiscoveredOpenSeaOrder(readPool, "base", 30000, item.input.hash),
    null
  );
});

test("healthy projections use a staggered six-hour audit and indexed transfers wake only their token", async () => {
  const item = await discover(await db.setup("base"), true);
  await reconcile(item);
  const state = await saved(item);
  assert.equal(
    state.bound_transfer_hash,
    item.indexed.lastTransfer.transactionHash.toLowerCase()
  );
  const delayMs = openSeaProjectionAuditDelayMs(item.input.hash);
  assert.ok(delayMs >= 6 * 60 * 60 * 1000);
  assert.ok(delayMs < 7 * 60 * 60 * 1000);
  assert.ok(
    state.next_reconcile_at.getTime() > Date.now() + 5.9 * 60 * 60 * 1000
  );
  assert.equal(
    await claimDiscoveredOpenSeaOrder(readPool, "base", 30000, item.input.hash),
    null
  );
  const changed = `0x${"ef".repeat(32)}`;
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET last_transaction_hash=$3 WHERE collection=$1 AND token_id=$2",
    ["base", item.input.asset.tokenId, changed]
  );
  const claim = await claimDiscoveredOpenSeaOrder(
    readPool,
    "base",
    30000,
    item.input.hash
  );
  assert.ok(claim);
  assert.equal(claim.order_hash, item.input.hash);
});

test("a substantive provider change wakes a healthy projection without source write permission", async () => {
  const item = await discover(await db.setup("base"));
  await reconcile(item);
  assert.equal(
    await claimDiscoveredOpenSeaOrder(readPool, "base", 30000, item.input.hash),
    null
  );
  await providerPresenceRoundTrip(item.input.hash);
  const before = await saved(item);
  assert.ok(before.next_reconcile_at.getTime() > Date.now());
  const early = await claimDiscoveredOpenSeaOrder(
    readPool,
    "base",
    30000,
    item.input.hash
  );
  assert.ok(early);
  assert.equal(
    await claimDiscoveredOpenSeaOrder(readPool, "base", 30000, item.input.hash),
    null
  );
  await reconcileDiscoveredOpenSeaOrder(
    readPool,
    item.client,
    "base",
    policies(item),
    options(item),
    early
  );
  assert.equal((await saved(item)).reason, "maker_signature_required");
  assert.equal(
    await claimDiscoveredOpenSeaOrder(readPool, "base", 30000, item.input.hash),
    null
  );
});

test("a stream notice arriving during reconciliation remains due after the captured wake is acknowledged", async () => {
  const item = await discover(await db.setup("base"), true);
  await reconcile(item);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_stream_wakeup(chain_id,target,version,reason)
    VALUES(8453,$1,1,'item_listed') ON CONFLICT(chain_id,target) DO UPDATE SET
      version=1,requested_at=clock_timestamp(),reason='item_listed'`,
    [`order:${item.input.hash}`]
  );
  const first = await claimDiscoveredOpenSeaOrder(
    readPool,
    "base",
    30000,
    item.input.hash
  );
  assert.ok(first);
  assert.equal(first.stream_sequence, "1");
  item.state.afterReceipt = async () => {
    await db.owner.query(
      `UPDATE yunipals_market.opensea_stream_wakeup SET version=2,
      requested_at=clock_timestamp(),reason='item_sold' WHERE chain_id=8453 AND target=$1`,
      [`order:${item.input.hash}`]
    );
  };
  await reconcileDiscoveredOpenSeaOrder(
    readPool,
    item.client,
    "base",
    policies(item),
    options(item),
    first
  );
  item.state.afterReceipt = undefined;
  assert.equal((await saved(item)).stream_ack_seq, "1");
  const second = await claimDiscoveredOpenSeaOrder(
    readPool,
    "base",
    30000,
    item.input.hash
  );
  assert.ok(second);
  assert.equal(second.stream_sequence, "2");
});

test("substantive provider changes do not bypass failure backoff or older due work", async () => {
  const changed = await discover(await db.setup("base"));
  const older = await discover(await db.setup("base"));
  await reconcile(changed);
  await reconcile(older);
  await providerPresenceRoundTrip(changed.input.hash);
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET failures=1 WHERE order_hash=$1",
    [changed.input.hash]
  );
  assert.equal(
    await claimDiscoveredOpenSeaOrder(
      readPool,
      "base",
      30000,
      changed.input.hash
    ),
    null
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET failures=0 WHERE order_hash=$1",
    [changed.input.hash]
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET next_reconcile_at=clock_timestamp()-interval '1 second' WHERE order_hash=$1",
    [older.input.hash]
  );
  const first = await claimDiscoveredOpenSeaOrder(readPool, "base");
  assert.equal(first?.order_hash, older.input.hash);
  const second = await claimDiscoveredOpenSeaOrder(readPool, "base");
  assert.equal(second?.order_hash, changed.input.hash);
});

test("concurrent claims select one writer and reclaimed leases reject old results", async () => {
  const item = await discover(await db.setup("base"));
  const claims = await Promise.all(
    Array.from({ length: 5 }, () =>
      claimDiscoveredOpenSeaOrder(db.runtime, "base", 30000, item.input.hash)
    )
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const old = claims.find(Boolean)!;
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET lease_until=clock_timestamp()-interval '1 second' WHERE order_hash=$1",
    [item.input.hash]
  );
  const current = await claim(item);
  await assert.rejects(
    reconcileDiscoveredOpenSeaOrder(
      db.runtime,
      item.client,
      "base",
      policies(item),
      options(item),
      old
    ),
    LostJobLeaseError
  );
  assert.equal((await saved(item)).observed_at, null);
  await reconcileDiscoveredOpenSeaOrder(
    db.runtime,
    item.client,
    "base",
    policies(item),
    options(item),
    current
  );
  assert.equal((await saved(item)).state, "authorization-required");
});

test("database commit failure rolls back binding and leaves a recoverable lease", async () => {
  const item = await discover(await db.setup());
  const lease = await claim(item);
  await db.owner
    .query(`CREATE FUNCTION yunipals_market.test_discovered_state_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.summary IS NOT NULL THEN RAISE EXCEPTION 'isolated state failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_discovered_state_failure BEFORE UPDATE ON yunipals_market.opensea_discovered_state FOR EACH ROW EXECUTE FUNCTION yunipals_market.test_discovered_state_failure()`);
  try {
    await assert.rejects(
      reconcileDiscoveredOpenSeaOrder(
        db.runtime,
        item.client,
        "ethereum",
        policies(item),
        options(item),
        lease
      ),
      /isolated state failure/
    );
    const row = await saved(item);
    assert.equal(row.bound_lifecycle, null);
    assert.equal(row.summary, null);
    assert.equal(row.lease_token, lease.lease_token);
  } finally {
    await db.owner.query(
      "DROP TRIGGER test_discovered_state_failure ON yunipals_market.opensea_discovered_state; DROP FUNCTION yunipals_market.test_discovered_state_failure()"
    );
  }
  await reconcileDiscoveredOpenSeaOrder(
    db.runtime,
    item.client,
    "ethereum",
    policies(item),
    options(item),
    lease
  );
  assert.equal((await saved(item)).state, "authorization-required");
});

test("imported economics retain optional signed fees and duration while enforcing current required payments", async () => {
  const item = await db.setup();
  const order = decodeSeaportOrder(item.draft.order);
  order.orderType = 1;
  order.endTime += 200000n;
  order.consideration = [
    ...order.consideration,
    {
      ...order.consideration[1]!,
      recipient: "0x4444444444444444444444444444444444444444",
      startAmount: 100n,
      endAmount: 100n
    }
  ];
  order.consideration[0]!.startAmount -= 100n;
  order.consideration[0]!.endAmount -= 100n;
  const summary = summarizeDiscoveredOpenSeaOrder(
    order,
    "ethereum",
    "listing",
    seaportDeployment.address,
    1
  );
  assert.doesNotThrow(() =>
    checkDiscoveredOpenSeaPolicy(summary, order, item.policy, fixtureTimestamp)
  );
  const stricter = {
    ...item.policy,
    fees: [{ ...item.policy.fees[0]!, basisPoints: 251 }]
  };
  assert.throws(
    () =>
      checkDiscoveredOpenSeaPolicy(summary, order, stricter, fixtureTimestamp),
    /order_policy_rejected/
  );
});

test("direct Seaport orders check approvals against the signed spender", async () => {
  const item = await db.setup();
  item.input.order.conduitKey = zeroHash;
  item.draft.order.conduitKey = zeroHash;
  item.input.hash = seaportOrderHash(item.input.order);
  item.intent.orderHash = item.input.hash;
  item.intent.summary.orderHash = item.input.hash;
  item.signature = await seller.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: 1,
        verifyingContract: seaportDeployment.address
      },
      item.input.order
    )
  );
  await discover(item, true);
  const baseRead = item.client.readContract.bind(item.client);
  const approvalTargets: unknown[] = [];
  const client = {
    ...item.client,
    async readContract(args: Parameters<PublicClient["readContract"]>[0]) {
      if (args.functionName === "isApprovedForAll")
        approvalTargets.push(args.args?.[1]);
      return baseRead(args);
    }
  } as PublicClient;
  assert.equal(
    (await reconcile(item, options(item), policies(item), client)).state,
    "eligible"
  );
  assert.deepEqual(approvalTargets, [seaportDeployment.address]);
});

test("the running worker reconciles discovered orders without posting or fabricating local admission", async () => {
  const item = await discover(await db.setup("polygon"));
  const abort = new AbortController();
  let writes = 0;
  const running = runOpenSeaSubmissionWorker({
    pool: db.runtime,
    chain: "polygon",
    concurrency: 1,
    signal: abort.signal,
    provider: {
      async lookup() {
        return null;
      },
      async publish() {
        writes++;
        throw new Error("No writes expected");
      }
    },
    reconciliation: {
      client: item.client,
      policies: policies(item),
      options: item.options,
      discoveryProviderMaxAgeMs: 300000
    }
  });
  try {
    const deadline = Date.now() + 5000;
    while (
      (await saved(item))?.state !== "authorization-required" &&
      Date.now() < deadline
    )
      await delay(25);
    assert.equal((await saved(item)).state, "authorization-required");
    assert.equal(writes, 0);
  } finally {
    abort.abort();
    await running;
  }
});

test("the restricted read worker binds all chains without admission or provider-observation writes", async () => {
  await assertOpenSeaReadWorkerReady(readPool, "staging");
  await assert.rejects(
    assertOpenSeaReadWorkerReady(db.runtime, "staging"),
    /unexpected database write privileges/
  );
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await discover(await db.setup(chain));
    const before = (
      await db.owner.query(
        "SELECT row_to_json(d)::text AS value FROM yunipals_market.opensea_discovered_order d WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].value;
    const abort = new AbortController();
    assert.equal(
      await observeOpenSeaReadHealth(
        readPool,
        item.client,
        chain,
        policies(item),
        item.options.now
      ),
      true,
      `${chain} read health`
    );
    const running = runOpenSeaReadWorker({
      pool: readPool,
      client: item.client,
      chain,
      policies: policies(item),
      options: options(item),
      concurrency: 2,
      signal: abort.signal
    });
    try {
      const deadline = Date.now() + 5000;
      while (
        (await saved(item))?.state !== "authorization-required" &&
        Date.now() < deadline
      )
        await delay(25);
      const projection = await saved(item);
      assert.ok(projection, `${chain} projection was not claimed`);
      assert.equal(projection.reason, "maker_signature_required");
    } finally {
      abort.abort();
    }
    const report = await running;
    assert.ok(report.processed >= 1);
    assert.ok(report.reasons.maker_signature_required! >= 1);
    assert.equal((await saved(item)).lease_token, null);
    assert.equal(
      (
        await db.owner.query(
          "SELECT row_to_json(d)::text AS value FROM yunipals_market.opensea_discovered_order d WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].value,
      before
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.submission_attempt WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].n,
      0
    );
  }
});

test("an aborted read worker makes no claims or health requests", async () => {
  const item = await discover(await db.setup("base"));
  const before = (
    await db.owner.query(
      "SELECT count(*)::int AS n FROM yunipals_market.opensea_discovered_state"
    )
  ).rows[0].n;
  const abort = new AbortController();
  abort.abort();
  const report = await runOpenSeaReadWorker({
    pool: readPool,
    client: item.client,
    chain: "base",
    policies: policies(item),
    options: options(item),
    concurrency: 1,
    signal: abort.signal
  });
  assert.equal(report.processed, 0);
  assert.equal(report.healthPassed + report.healthFailed, 0);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS n FROM yunipals_market.opensea_discovered_state"
      )
    ).rows[0].n,
    before
  );
});

test("a collector commit after the final source read cannot expose stale eligibility", async () => {
  const item = await discover(await db.setup("base"), true);
  const lock = await db.owner.connect();
  await lock.query("SELECT pg_advisory_lock(178858, 99123)");
  await db.owner
    .query(`CREATE FUNCTION yunipals_market.test_projection_commit_wait() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(178858,99123); RETURN NEW; END $$;
    CREATE TRIGGER test_projection_commit_wait BEFORE UPDATE OF provider_seen_at ON yunipals_market.opensea_discovered_state
    FOR EACH ROW EXECUTE FUNCTION yunipals_market.test_projection_commit_wait()`);
  let running: Promise<unknown> | undefined;
  try {
    const lease = await claim(item);
    running = reconcileDiscoveredOpenSeaOrder(
      readPool,
      item.client,
      "base",
      policies(item),
      options(item),
      lease
    );
    void running.catch(() => {});
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      waiting = (
        await db.owner.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=178858 AND objid=99123 AND NOT granted) AS waiting"
        )
      ).rows[0].waiting;
      if (!waiting) await delay(10);
    }
    assert.equal(waiting, true);
    await providerPresenceRoundTrip(item.input.hash);
    await lock.query("SELECT pg_advisory_unlock(178858,99123)");
    await running;
    const state = await saved(item);
    assert.equal(state.state, "eligible");
    const visible = (
      await db.owner.query(
        `SELECT o.state,o.state_reason FROM ${marketOrderRowsSql} o WHERE order_hash=$2`,
        [new Date(), item.input.hash]
      )
    ).rows[0];
    assert.deepEqual(visible, {
      state: "unavailable",
      state_reason: "discovery_projection_stale"
    });
  } finally {
    await lock.query("SELECT pg_advisory_unlock(178858,99123)");
    await running?.catch(() => {});
    lock.release();
    await db.owner.query(
      "DROP TRIGGER test_projection_commit_wait ON yunipals_market.opensea_discovered_state; DROP FUNCTION yunipals_market.test_projection_commit_wait()"
    );
  }
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { decodeOpenSeaParameters } from "@protopals/yunipals-market-core/openseaOrder";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { readOpenSeaDiscoveryEnvironment } from "@/environment";
import {
  fixtureProvider,
  fixtureJsonResponse
} from "@/opensea/fixtures/provider";
import {
  publicationFixture,
  acknowledgmentFixture
} from "@/opensea/fixtures/orders";
import { OpenSeaClient, OpenSeaError } from "@/opensea/client";
import { parseOpenSeaDiscoveredOrder } from "@/opensea/discoveryOrder";
import {
  claimOpenSeaDiscovery,
  isOpenSeaDiscoveryDue,
  processOpenSeaDiscoveryPage,
  readOpenSeaDiscoveryStatus,
  DiscoveryLeaseLostError,
  pruneOpenSeaDiscoveryPages
} from "@/opensea/discovery";

const db = createBnbTestDatabase();
const scans: { chainId: number; side: string }[] = [];
before(async () => {
  await db.initialize();
  await db.owner
    .query(`GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_discovery_scan,
    yunipals_market.opensea_discovery_page,yunipals_market.opensea_discovered_order TO market_test_runtime`);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS n FROM yunipals_market.opensea_discovery_scan"
      )
    ).rows[0].n,
    0,
    "Discovery tests require unused discovery tables in the isolated test database."
  );
});
async function clear() {
  await db.owner.query(
    "DELETE FROM yunipals_market.opensea_stream_wakeup WHERE target='scan'"
  );
  for (const { chainId, side } of scans.splice(0)) {
    for (const table of [
      "opensea_discovery_page",
      "opensea_discovered_order",
      "opensea_discovery_scan"
    ])
      await db.owner.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=$1 AND side=$2`,
        [chainId, side]
      );
  }
}
beforeEach(clear);
after(async () => {
  await clear();
  await db.close();
});
function envelope(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing",
  salt = "7"
) {
  const value = acknowledgmentFixture(publicationFixture(chain, side));
  value.protocol_data.parameters.salt = salt;
  value.order_hash = seaportOrderHash(
    decodeOpenSeaParameters(value.protocol_data.parameters)
  );
  return value;
}
async function claim(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing"
) {
  const chainId = marketplaceChains[chain].chainId;
  if (!scans.some((s) => s.chainId === chainId && s.side === side))
    scans.push({ chainId, side });
  const scan = await claimOpenSeaDiscovery(
    db.runtime,
    chain,
    side,
    `yunipals-${chain}`
  );
  assert.ok(scan);
  return scan;
}
async function due(chain: OpenSeaChain = "ethereum", side = "listing") {
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET next_scan_at=clock_timestamp() WHERE chain_id=$1 AND side=$2",
    [marketplaceChains[chain].chainId, side]
  );
}
const providerPage = (orders: unknown[], next: string | null = null) => ({
  async listCollectionOrders() {
    return { orders, next };
  }
});

test("scheduled discovery skips provider work during scan intervals, live leases and backoff", async () => {
  assert.equal(await isOpenSeaDiscoveryDue(db.runtime, "ethereum"), true);
  const listing = await claim("ethereum", "listing");
  const offer = await claim("ethereum", "offer");
  assert.equal(await isOpenSeaDiscoveryDue(db.runtime, "ethereum"), false);
  for (const scan of [listing, offer])
    await processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([]),
      "ethereum",
      scan,
      { scanIntervalMs: 240000 }
    );
  assert.equal(await isOpenSeaDiscoveryDue(db.runtime, "ethereum"), false);
  await due();
  assert.equal(await isOpenSeaDiscoveryDue(db.runtime, "ethereum"), true);
  const next = await claim();
  await assert.rejects(
    processOpenSeaDiscoveryPage(
      db.runtime,
      {
        async listCollectionOrders() {
          throw new OpenSeaError("provider_rate_limited", 429, 120000);
        }
      },
      "ethereum",
      next
    )
  );
  assert.equal(await isOpenSeaDiscoveryDue(db.runtime, "ethereum"), false);
  const rows = await readOpenSeaDiscoveryStatus(db.runtime, "ethereum");
  assert.equal(
    rows.scans.find((row) => row.side === "listing")!.discovery_state,
    "unavailable"
  );
  assert.equal(
    readOpenSeaDiscoveryEnvironment({ MARKET_DISCOVERY_CHAIN: "ethereum" })
      .scanIntervalMs,
    240000
  );
  for (const value of ["0", "59999", "240001", "300000"])
    assert.throws(() =>
      readOpenSeaDiscoveryEnvironment({
        MARKET_DISCOVERY_CHAIN: "ethereum",
        MARKET_DISCOVERY_INTERVAL_MS: value
      })
    );
});

test("a full scan acknowledges only its captured stream gap and debounces another scan", async () => {
  const initial = await claim("base", "listing");
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([]),
    "base",
    initial,
    { scanIntervalMs: 240000 }
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_stream_wakeup(chain_id,target,version,reason)
    VALUES(8453,'scan',1,'stream_connection_closed') ON CONFLICT(chain_id,target) DO UPDATE SET
      version=1,requested_at=clock_timestamp(),reason='stream_connection_closed';
    UPDATE yunipals_market.opensea_discovery_scan SET completed_at=clock_timestamp()-interval '20 seconds'
    WHERE chain_id=8453 AND side='listing'`
  );
  const first = await claim("base", "listing");
  assert.equal(first.stream_scan_seq, "1");
  await db.owner.query(
    `UPDATE yunipals_market.opensea_stream_wakeup SET version=2,
    requested_at=clock_timestamp(),reason='stream_connection_error'
    WHERE chain_id=8453 AND target='scan'`
  );
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([]),
    "base",
    first,
    { scanIntervalMs: 240000 }
  );
  assert.deepEqual(
    (
      await db.owner.query(
        `SELECT stream_scan_seq::text,stream_ack_seq::text
        FROM yunipals_market.opensea_discovery_scan WHERE chain_id=8453 AND side='listing'`
      )
    ).rows[0],
    { stream_scan_seq: "1", stream_ack_seq: "1" }
  );
  assert.equal(
    await claimOpenSeaDiscovery(db.runtime, "base", "listing", "yunipals-base"),
    null
  );
  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovery_scan SET completed_at=clock_timestamp()-interval '20 seconds'
    WHERE chain_id=8453 AND side='listing'`
  );
  assert.equal((await claim("base", "listing")).stream_scan_seq, "2");
});

test("changing collection scope cannot reuse a completed scan", async () => {
  const initial = await claim();
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([]),
    "ethereum",
    initial
  );
  await due();
  const changed = await claimOpenSeaDiscovery(
    db.runtime,
    "ethereum",
    "listing",
    "different-collection"
  );
  assert.ok(changed);
  assert.equal(
    (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum")).scans[0]!
      .completed_at,
    null
  );
});

async function saved(chain: OpenSeaChain = "ethereum") {
  return (
    await db.owner.query(
      "SELECT * FROM yunipals_market.opensea_discovered_order WHERE chain_id=$1 ORDER BY order_hash",
      [marketplaceChains[chain].chainId]
    )
  ).rows;
}

test("collection GETs encode opaque cursors, bound pages and honor rate-limit reset without exposing credentials", async () => {
  let mode = "ok";
  const requests: string[] = [];
  const cursor = "opaque/?next=x&limit=200+cursor";
  const server = await fixtureProvider((req, res) => {
    assert.equal(req.method, "GET");
    requests.push(req.url!);
    if (mode === "limited") {
      res.writeHead(429, {
        "X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + 60)
      });
      res.end();
      return;
    }
    const url = new URL(req.url!, "http://fixture");
    assert.equal(url.pathname, "/api/v2/listings/collection/yunipals/all");
    assert.equal(url.searchParams.get("next"), cursor);
    assert.equal(url.searchParams.get("limit"), "2");
    if (mode === "array") {
      fixtureJsonResponse(res, []);
      return;
    }
    fixtureJsonResponse(res, {
      listings: [envelope()],
      next: mode === "bad" ? 42 : null
    });
  });
  try {
    const client = new OpenSeaClient({
      apiKey: "yunipals-fixture-only",
      fixtureOrigin: server.origin
    });
    const input = {
      slug: "yunipals",
      side: "listing" as const,
      cursor,
      limit: 2
    };
    assert.equal((await client.listCollectionOrders(input)).orders.length, 1);
    mode = "bad";
    await assert.rejects(
      client.listCollectionOrders(input),
      /provider_invalid_response/
    );
    mode = "array";
    await assert.rejects(
      client.listCollectionOrders(input),
      /provider_invalid_response/
    );
    mode = "limited";
    await assert.rejects(
      client.listCollectionOrders(input),
      (e: unknown) =>
        e instanceof OpenSeaError &&
        e.code === "provider_rate_limited" &&
        (e.retryAfterMs ?? 0) >= 59000
    );
    await assert.rejects(
      client.listCollectionOrders({ ...input, slug: "../other" })
    );
    await assert.rejects(client.listCollectionOrders({ ...input, limit: 51 }));
    assert.equal(requests.length, 4);
  } finally {
    await server.close();
  }
});

test("all chains retain missing signatures, explicit criteria and unsupported economics without inventing lifecycle or acceptance", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const raw = envelope(chain);
    const parsed = parseOpenSeaDiscoveredOrder(raw, chain, "listing");
    assert.equal(parsed.classification, "item");
    assert.equal(parsed.signature, null);
    assert.equal(Object.hasOwn(parsed, "lifecycle"), false);
    await processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([raw]),
      chain,
      await claim(chain)
    );
    assert.equal((await saved(chain))[0].signature, null);
    const criterion = envelope(chain, "offer");
    criterion.protocol_data.parameters.consideration[0]!.itemType = 4;
    criterion.order_hash = seaportOrderHash(
      decodeOpenSeaParameters(criterion.protocol_data.parameters)
    );
    await processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([criterion]),
      chain,
      await claim(chain, "offer")
    );
    const unsupported = parseOpenSeaDiscoveredOrder(criterion, chain, "offer");
    assert.equal(unsupported.classification, "criteria");
    assert.equal(unsupported.tokenId, null);
    const otherProtocol = {
      ...raw,
      protocol_address: "0x1111111111111111111111111111111111111111"
    };
    assert.equal(
      parseOpenSeaDiscoveredOrder(otherProtocol, chain, "listing")
        .classification,
      "unsupported"
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
          [raw.order_hash]
        )
      ).rows[0].n,
      0
    );
    const status = await readOpenSeaDiscoveryStatus(db.runtime, chain);
    assert.equal(status.scans.length, 2);
    assert.equal(
      status.scans.find((s) => s.side === "offer")!.unsupported_orders,
      1
    );
  }
});

test("identical normalized scans renew freshness without changing the exact source version", async () => {
  const raw = envelope();
  const scanPage = async (orders: unknown[]) => {
    await due();
    await processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage(orders),
      "ethereum",
      await claim()
    );
  };
  await scanPage([raw]);
  const current = async () =>
    (
      await db.owner.query(
        "SELECT last_changed_at::text AS version,last_seen_at::text AS seen,last_seen_run_id,present FROM yunipals_market.opensea_discovered_order WHERE order_hash=$1",
        [raw.order_hash]
      )
    ).rows[0];
  const initial = await current();
  assert.equal(initial.version, initial.seen);
  await scanPage([
    { ...raw, artwork: { name: "irrelevant provider metadata" } }
  ]);
  const refreshed = await current();
  assert.equal(refreshed.version, initial.version);
  assert.notEqual(refreshed.seen, initial.seen);
  assert.notEqual(refreshed.last_seen_run_id, initial.last_seen_run_id);
  await scanPage([{ ...raw, remaining_quantity: 0 }]);
  const exhausted = await current();
  assert.notEqual(exhausted.version, initial.version);
  await scanPage([raw]);
  const restored = await current();
  assert.notEqual(restored.version, initial.version);
  assert.notEqual(restored.version, exhausted.version);
  await scanPage([]);
  const missing = await current();
  assert.equal(missing.present, false);
  assert.notEqual(missing.version, restored.version);
  await scanPage([]);
  assert.equal((await current()).version, missing.version);
  await scanPage([raw]);
  assert.equal((await current()).present, true);
  assert.notEqual((await current()).version, missing.version);
  // A caller cannot manually restore an old version or force identical updates
  // to rotate it. Only substantive contents determine the trigger transition.
  const beforeOverride = await current();
  await db.runtime.query(
    "UPDATE yunipals_market.opensea_discovered_order SET last_changed_at=$2 WHERE order_hash=$1",
    [raw.order_hash, initial.version]
  );
  assert.equal((await current()).version, beforeOverride.version);
  const connection = await db.owner.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE order_hash=$1",
      [raw.order_hash]
    );
    await connection.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=true WHERE order_hash=$1",
      [raw.order_hash]
    );
    const changed = (
      await connection.query(
        "SELECT last_changed_at>$2::timestamptz AS advanced FROM yunipals_market.opensea_discovered_order WHERE order_hash=$1",
        [raw.order_hash, beforeOverride.version]
      )
    ).rows[0];
    assert.equal(changed.advanced, true);
    await connection.query("ROLLBACK");
  } finally {
    connection.release();
  }
  assert.equal((await current()).version, beforeOverride.version);
});

test("page/cursor commits are atomic, deduplicate overlaps and resume after process-level state is discarded", async () => {
  const first = envelope();
  const second = envelope("ethereum", "listing", "8");
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([first], "page-two"),
    "ethereum",
    await claim()
  );
  assert.equal(
    (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum")).scans[0]!
      .discovery_state,
    "syncing"
  );
  assert.equal(
    await claimOpenSeaDiscovery(
      db.runtime,
      "ethereum",
      "listing",
      "yunipals-ethereum"
    ),
    null
  );
  await due();
  const resumed = await claim();
  assert.equal(resumed.provider_cursor, "page-two");
  assert.equal(resumed.page_count, 1);
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([first, second]),
    "ethereum",
    resumed
  );
  assert.equal((await saved()).length, 2);
  const status = (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum"))
    .scans[0]!;
  assert.equal(status.discovery_state, "available");
  assert.equal(status.page_count, 2);
});

test("a malformed later row rolls back the whole page and keeps the previous cursor and orders", async () => {
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([envelope()], "second"),
    "ethereum",
    await claim()
  );
  await due();
  const second = envelope("ethereum", "listing", "8");
  const wrong = { ...envelope("ethereum", "listing", "9"), chain: "base" };
  await assert.rejects(
    processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([second, wrong]),
      "ethereum",
      await claim()
    ),
    /discovery_invalid_page/
  );
  assert.equal((await saved()).length, 1);
  const row = (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum"))
    .scans[0]!;
  assert.equal(row.page_count, 1);
  assert.equal(row.discovery_state, "unavailable");
  assert.ok(row.next_scan_at.getTime() > Date.now() + 15000);
  await due();
  const retry = await claim();
  assert.equal(retry.provider_cursor, "second");
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([second]),
    "ethereum",
    retry
  );
  assert.equal((await saved()).length, 2);
});

test("a reclaimed lease fences the previous worker, including its late page and absence updates", async () => {
  const scan = await claim();
  assert.equal(
    await claimOpenSeaDiscovery(
      db.runtime,
      "ethereum",
      "listing",
      "yunipals-ethereum"
    ),
    null
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_scan SET lease_until=clock_timestamp()-interval '1 second' WHERE chain_id=1 AND side='listing'"
  );
  const newer = await claim();
  assert.notEqual(newer.lease_token, scan.lease_token);
  await assert.rejects(
    processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([envelope()]),
      "ethereum",
      scan
    ),
    DiscoveryLeaseLostError
  );
  assert.equal((await saved()).length, 0);
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([envelope()]),
    "ethereum",
    newer
  );
  assert.equal((await saved()).length, 1);
});

test("multi-page cursor cycles restart the scan explicitly without claiming completeness or removing records", async () => {
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([envelope()], "a"),
    "ethereum",
    await claim()
  );
  await due();
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([], "b"),
    "ethereum",
    await claim()
  );
  await due();
  const old = await claim();
  await assert.rejects(
    processOpenSeaDiscoveryPage(
      db.runtime,
      providerPage([], "a"),
      "ethereum",
      old
    ),
    /discovery_cursor_cycle/
  );
  const status = (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum"))
    .scans[0]!;
  assert.equal(status.discovery_state, "unavailable");
  assert.equal(status.page_count, 0);
  assert.notEqual(status.run_id, old.run_id);
  assert.equal((await saved())[0].present, true);
});

test("only a complete subsequent scan marks absence; reappearance preserves the original signature", async () => {
  const first = envelope(),
    second = envelope("ethereum", "listing", "8");
  first.protocol_data.signature = "0x1234";
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([first, second]),
    "ethereum",
    await claim()
  );
  await due();
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([second], "end"),
    "ethereum",
    await claim()
  );
  assert.equal(
    (await saved()).find((r) => r.order_hash === first.order_hash)!.present,
    true
  );
  await due();
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([]),
    "ethereum",
    await claim()
  );
  const missing = (await saved()).find(
    (r) => r.order_hash === first.order_hash
  )!;
  assert.equal(missing.present, false);
  assert.equal(missing.signature, "0x1234");
  await due();
  first.protocol_data.signature = "0x";
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([first]),
    "ethereum",
    await claim()
  );
  const returned = (await saved()).find(
    (r) => r.order_hash === first.order_hash
  )!;
  assert.equal(returned.present, true);
  assert.equal(returned.signature, "0x1234");
});

test("provider rate limiting preserves the cursor with persisted retry timing", async () => {
  const scan = await claim();
  await assert.rejects(
    processOpenSeaDiscoveryPage(
      db.runtime,
      {
        async listCollectionOrders() {
          throw new OpenSeaError("provider_rate_limited", 429, 120000);
        }
      },
      "ethereum",
      scan
    ),
    /provider_rate_limited/
  );
  const status = (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum"))
    .scans[0]!;
  assert.equal(status.last_error_code, "provider_rate_limited");
  assert.ok(status.next_scan_at.getTime() > Date.now() + 115000);
  assert.equal(
    await claimOpenSeaDiscovery(
      db.runtime,
      "ethereum",
      "listing",
      "yunipals-ethereum"
    ),
    null
  );
});

test("concurrent claims choose one writer and old-page cleanup preserves current cursors and discovered orders", async () => {
  scans.push({ chainId: 1, side: "listing" });
  const claims = await Promise.all(
    Array.from({ length: 5 }, () =>
      claimOpenSeaDiscovery(
        db.runtime,
        "ethereum",
        "listing",
        "yunipals-ethereum"
      )
    )
  );
  assert.equal(claims.filter(Boolean).length, 1);
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([envelope()]),
    "ethereum",
    claims.find(Boolean)!
  );
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovery_page SET observed_at=clock_timestamp()-interval '8 days' WHERE chain_id=1 AND side='listing'"
  );
  assert.equal(await pruneOpenSeaDiscoveryPages(db.runtime), 0);
  await due();
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([envelope()]),
    "ethereum",
    await claim()
  );
  assert.equal(await pruneOpenSeaDiscoveryPages(db.runtime), 1);
  assert.equal((await saved()).length, 1);
});

test("a database failure after the first insert rolls back orders, page proof and cursor together", async () => {
  const first = envelope(),
    second = envelope("ethereum", "listing", "88");
  const scan = await claim();
  await db.owner
    .query(`CREATE FUNCTION yunipals_market.test_discovery_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.order_hash='${second.order_hash}' THEN RAISE EXCEPTION 'isolated insert failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_discovery_insert_failure BEFORE INSERT ON yunipals_market.opensea_discovered_order
    FOR EACH ROW EXECUTE FUNCTION yunipals_market.test_discovery_insert_failure()`);
  try {
    await assert.rejects(
      processOpenSeaDiscoveryPage(
        db.runtime,
        providerPage([first, second]),
        "ethereum",
        scan
      ),
      /discovery_processing_failed/
    );
    assert.equal((await saved()).length, 0);
    const status = (await readOpenSeaDiscoveryStatus(db.runtime, "ethereum"))
      .scans[0]!;
    assert.equal(status.page_count, 0);
    assert.equal(status.discovery_state, "unavailable");
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.opensea_discovery_page WHERE chain_id=1"
        )
      ).rows[0].n,
      0
    );
  } finally {
    await db.owner.query(
      "DROP TRIGGER test_discovery_insert_failure ON yunipals_market.opensea_discovered_order; DROP FUNCTION yunipals_market.test_discovery_insert_failure()"
    );
  }
  await due();
  const retry = await claim();
  assert.equal(retry.provider_cursor, null);
  await processOpenSeaDiscoveryPage(
    db.runtime,
    providerPage([first, second]),
    "ethereum",
    retry
  );
  assert.equal((await saved()).length, 2);
});

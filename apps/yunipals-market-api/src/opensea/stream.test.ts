import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";
import { readOpenSeaStreamEnvironment } from "@/environment";
import {
  assertOpenSeaStreamReady,
  claimOpenSeaStreamLease,
  markOpenSeaStreamConnected,
  parseOpenSeaStreamNotice,
  recordOpenSeaStreamHeartbeat,
  recordOpenSeaStreamNotice,
  releaseOpenSeaStreamLease
} from "@/opensea/stream";
import {
  runOpenSeaStreamWorker,
  type OpenSeaStreamSocket
} from "@/opensea/streamTransport";

const db = createBnbTestDatabase();
const streamRole = `market_test_stream_${process.pid}`;
let streamPool: pg.Pool;

before(async () => {
  await db.initialize();
  await db.owner.query(
    `CREATE ROLE ${streamRole} LOGIN NOINHERIT PASSWORD 'local-stream-test-only'`
  );
  const grants = await readFile(
    new URL("../../scripts/grant-opensea-stream.sql", import.meta.url),
    "utf8"
  );
  await db.owner.query(
    grants.replaceAll(':"market_runtime_role"', `"${streamRole}"`)
  );
  const url = new URL(testUrl("MARKET_TEST_DATABASE_URL"));
  url.username = streamRole;
  url.password = "local-stream-test-only";
  streamPool = new pg.Pool({
    connectionString: url.href,
    max: 3,
    statement_timeout: 5000
  });
});

beforeEach(async () => {
  await db.owner.query(
    `DELETE FROM yunipals_market.opensea_stream_notice;
    DELETE FROM yunipals_market.opensea_stream_wakeup;
    UPDATE yunipals_market.opensea_stream_state SET sequence=0,generation=0,
      lease_token=NULL,lease_until=NULL,connected=false,connected_at=NULL,
      heartbeat_at=NULL,last_gap_at=NULL,last_error_code=NULL WHERE singleton`
  );
});

after(async () => {
  await streamPool.end();
  await db.owner.query(`DROP OWNED BY ${streamRole}; DROP ROLE ${streamRole}`);
  await db.close();
});

const order = `0x${"ab".repeat(32)}`;
const contract = "0x98433df878e8c898cb907345c3a7756e5f72240f";
const event = (payload: object, type = "item_sold") =>
  JSON.stringify(["1", "4", "collection:yunipals-base", type, payload]);

test("stream configuration fixes the provider endpoint and rejects trading settings", () => {
  assert.deepEqual(
    readOpenSeaStreamEnvironment({
      MARKET_OPENSEA_API_KEY: "fixture-key",
      MARKET_OPENSEA_STREAM_MAX_SECONDS: "90"
    }),
    { apiKey: "fixture-key", maxSeconds: 90 }
  );
  for (const input of [
    {},
    {
      MARKET_OPENSEA_API_KEY: "fixture-key",
      MARKET_OPENSEA_STREAM_URL: "wss://example.invalid"
    },
    {
      MARKET_OPENSEA_API_KEY: "fixture-key",
      MARKET_OPENSEA_STREAM_TOPICS: "collection:other"
    },
    {
      MARKET_OPENSEA_API_KEY: "fixture-key",
      MARKET_OPENSEA_VALIDATION_RPC: "http://127.0.0.1"
    }
  ])
    assert.throws(() => readOpenSeaStreamEnvironment(input));
});

test("validated stream events canonicalize redelivery and retain only reconciliation coordinates", () => {
  const first = parseOpenSeaStreamNotice(
    event({ order_hash: order, item: { nft_id: `base/${contract}/42` } })
  );
  const reordered = parseOpenSeaStreamNotice(
    event({ item: { nft_id: `base/${contract}/42` }, order_hash: order })
  );
  assert.ok(first);
  assert.ok(reordered);
  assert.equal(first.eventHash, reordered.eventHash);
  assert.equal(first.orderHash, order);
  assert.equal(first.tokenId, "42");
  assert.equal(
    parseOpenSeaStreamNotice(
      event({ item: { nft_id: `base/0x${"11".repeat(20)}/42` } })
    )?.tokenId,
    null
  );
  assert.rejects(
    async () => parseOpenSeaStreamNotice(event({ value: 9007199254740992 })),
    /stream_event_unsafe_number/
  );
  assert.throws(
    () => parseOpenSeaStreamNotice(event({}, "invented_event")),
    /stream_event_unknown_scope/
  );
});

test("the restricted stream role deduplicates events and cannot change an order", async () => {
  await assertOpenSeaStreamReady(streamPool, "staging");
  await assert.rejects(
    streamPool.query(
      "UPDATE yunipals_market.orders SET updated_at=clock_timestamp() WHERE false"
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "42501"
  );
  const lease = await claimOpenSeaStreamLease(streamPool, 30000);
  assert.ok(lease);
  assert.equal(await claimOpenSeaStreamLease(streamPool, 30000), null);
  assert.equal(await markOpenSeaStreamConnected(streamPool, lease), true);
  assert.equal(await recordOpenSeaStreamHeartbeat(streamPool, lease), true);
  const notice = parseOpenSeaStreamNotice(
    event({ order_hash: order, item: { nft_id: `base/${contract}/42` } })
  );
  assert.ok(notice);
  assert.deepEqual(await recordOpenSeaStreamNotice(streamPool, lease, notice), {
    duplicate: false,
    sequence: "2"
  });
  assert.deepEqual(await recordOpenSeaStreamNotice(streamPool, lease, notice), {
    duplicate: true,
    sequence: null
  });
  const state = (
    await db.owner.query(
      `SELECT sequence::text,connected,
      (SELECT count(*)::int FROM yunipals_market.opensea_stream_notice) AS notices,
      (SELECT count(*)::int FROM yunipals_market.opensea_stream_wakeup) AS wakeups
      FROM yunipals_market.opensea_stream_state WHERE singleton`
    )
  ).rows[0];
  assert.deepEqual(state, {
    sequence: "2",
    connected: true,
    notices: 1,
    wakeups: 5
  });
  assert.equal(await releaseOpenSeaStreamLease(streamPool, lease), true);
});

test("lifecycle stream events use targeted wakeups while order discovery keeps a scan fallback", async () => {
  const lease = await claimOpenSeaStreamLease(streamPool, 30000);
  assert.ok(lease);
  const initialScan = await db.owner.query<{ version: string }>(
    "SELECT version::text FROM yunipals_market.opensea_stream_wakeup WHERE chain_id=8453 AND target='scan'"
  );
  assert.equal(initialScan.rows[0]!.version, "1");

  const transfer = parseOpenSeaStreamNotice(
    event(
      { order_hash: order, item: { nft_id: `base/${contract}/42` } },
      "item_transferred"
    )
  );
  assert.ok(transfer);
  assert.deepEqual(
    await recordOpenSeaStreamNotice(streamPool, lease, transfer),
    {
      duplicate: false,
      sequence: "2"
    }
  );
  const targeted = await db.owner.query<{
    target: string;
    version: string;
  }>(
    "SELECT target,version::text FROM yunipals_market.opensea_stream_wakeup WHERE chain_id=8453 ORDER BY target"
  );
  assert.deepEqual(targeted.rows, [
    { target: `order:${order}`, version: "2" },
    { target: "scan", version: "1" },
    { target: "token:42", version: "2" }
  ]);

  const listed = parseOpenSeaStreamNotice(
    event(
      {
        order_hash: `0x${"cd".repeat(32)}`,
        item: { nft_id: `base/${contract}/43` }
      },
      "item_listed"
    )
  );
  assert.ok(listed);
  assert.deepEqual(await recordOpenSeaStreamNotice(streamPool, lease, listed), {
    duplicate: false,
    sequence: "3"
  });
  const scanned = await db.owner.query<{ version: string }>(
    "SELECT version::text FROM yunipals_market.opensea_stream_wakeup WHERE chain_id=8453 AND target='scan'"
  );
  assert.equal(scanned.rows[0]!.version, "3");

  const unscopedCancellation = parseOpenSeaStreamNotice(
    event({}, "item_cancelled")
  );
  assert.ok(unscopedCancellation);
  assert.deepEqual(
    await recordOpenSeaStreamNotice(streamPool, lease, unscopedCancellation),
    { duplicate: false, sequence: "4" }
  );
  const fallback = await db.owner.query<{ version: string }>(
    "SELECT version::text FROM yunipals_market.opensea_stream_wakeup WHERE chain_id=8453 AND target='scan'"
  );
  assert.equal(fallback.rows[0]!.version, "4");
});

type Listener = (event: { data?: unknown }) => void;
class FakeSocket implements OpenSeaStreamSocket {
  readyState = 0;
  private listeners = new Map<string, Set<Listener>>();
  private joins = 0;
  constructor(private readonly closeAfterJoin: boolean) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  send(raw: string) {
    const value = JSON.parse(raw) as unknown[];
    if (value[3] !== "phx_join") return;
    this.joins++;
    queueMicrotask(() => {
      this.emit("message", {
        data: JSON.stringify([
          value[0],
          value[1],
          value[2],
          "phx_reply",
          { status: "ok", response: {} }
        ])
      });
      if (this.closeAfterJoin && this.joins === 3)
        setTimeout(() => this.close(1006), 5);
    });
  }
  close(_code?: number, _reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", {}));
  }
  private emit(type: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("an unexpected disconnect persists a scan gap before reconnecting", async () => {
  const stop = new AbortController();
  let sockets = 0;
  const running = runOpenSeaStreamWorker({
    pool: streamPool,
    apiKey: randomUUID(),
    signal: stop.signal,
    socketFactory() {
      sockets++;
      return new FakeSocket(sockets === 1);
    }
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (
      await db.owner.query(
        "SELECT connected,sequence::text FROM yunipals_market.opensea_stream_state WHERE singleton"
      )
    ).rows[0];
    if (sockets >= 2 && state.connected && state.sequence === "2") break;
    await delay(20);
  }
  const state = (
    await db.owner.query(
      "SELECT connected,sequence::text,last_error_code FROM yunipals_market.opensea_stream_state WHERE singleton"
    )
  ).rows[0];
  assert.equal(sockets, 2);
  assert.deepEqual(state, {
    connected: true,
    sequence: "2",
    last_error_code: null
  });
  stop.abort();
  assert.deepEqual(await running, { leaseClaims: 1, connections: 2, gaps: 1 });
});

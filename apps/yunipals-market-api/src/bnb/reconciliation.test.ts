import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import type { PoolClient } from "pg";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { now, policy, seller } from "@/bnb/fixtures/admission";
import { BnbRecoveryService } from "@/bnb/recovery";
import {
  bnbProjectionAuditDelayMs,
  bnbReconcileKind,
  pruneBnbReconcileJobs,
  reconcileBnbJob,
  scheduleBnbReconciliation
} from "@/bnb/reconciliation";
import { claimJob, LostJobLeaseError } from "@/db/jobs";
import {
  writeBnbWorkerHeartbeat,
  writeBnbWorkerUnavailable
} from "@/bnb/workerStatus";

const db = createBnbTestDatabase();
before(db.initialize);
let existingJobs: PoolClient | undefined;
before(async () => {
  // Previous fork runs can leave valid recovery jobs in the isolated DB. Hold
  // their rows so SKIP LOCKED tests claim only jobs admitted by this test file.
  // Rolling back releases them unchanged, including their original leases.
  existingJobs = await db.owner.connect();
  await existingJobs.query("BEGIN");
  await existingJobs.query(
    "SELECT id FROM yunipals_market.job WHERE kind='bnb_order_reconcile' FOR UPDATE"
  );
});
afterEach(db.clear);
after(async () => {
  if (existingJobs) {
    try {
      await existingJobs.query("ROLLBACK");
    } finally {
      existingJobs.release();
    }
  }
  await db.close();
});
const options = { confirmations: 20n, indexerMaxAgeMs: 720000, now: () => now };

test("worker heartbeat persists available and failed RPC observations with the restricted role", async () => {
  const item = await db.setup();
  await writeBnbWorkerHeartbeat(db.runtime, item.client);
  const heartbeat = async () =>
    (
      await db.owner.query(
        "SELECT state,block_number::text,last_error_code FROM yunipals_market.checkpoint WHERE source='chain' AND chain_id=56 AND name='bnb-order-worker'"
      )
    ).rows[0];
  assert.equal((await heartbeat()).state, "available");
  assert.equal((await heartbeat()).block_number, "121");
  item.state.rpcFailure = true;
  await writeBnbWorkerHeartbeat(db.runtime, item.client);
  assert.equal((await heartbeat()).state, "unavailable");
  assert.equal((await heartbeat()).block_number, null);
  assert.equal((await heartbeat()).last_error_code, "chain_unavailable");
  item.state.rpcFailure = false;
  await writeBnbWorkerHeartbeat(db.runtime, item.client);
  assert.equal((await heartbeat()).state, "available");
  await writeBnbWorkerUnavailable(db.runtime);
  assert.equal((await heartbeat()).state, "unavailable");
  assert.equal((await heartbeat()).last_error_code, "worker_stopped");
});

async function admitted(side: "listing" | "offer" = "listing") {
  const item = await db.setup(side);
  const prepared = await item.service.prepare(item.draft);
  await item.service.submit({ ...item.request, preparationId: prepared.id });
  return item;
}
type Item = Awaited<ReturnType<typeof admitted>>;

async function row(item: Item) {
  return (
    await db.owner.query(
      `SELECT state,state_reason,state_observed_at,state_block_number::text,reconcile_generation::text,
    reconcile_failures,signature,components,bound_transfer_hash,next_reconcile_at
    FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1`,
      [item.input.hash.toLowerCase()]
    )
  ).rows[0];
}
async function claimed(item: Item) {
  const job = await claimJob(db.runtime, bnbReconcileKind);
  assert.ok(job);
  assert.equal(job.payload.orderHash, item.input.hash.toLowerCase());
  return job;
}
async function reconcile(item: Item, observationOptions = options) {
  return reconcileBnbJob(
    db.runtime,
    item.client,
    policy,
    observationOptions,
    await claimed(item)
  );
}
async function due(item: Item) {
  await db.owner.query(
    "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE chain_id=56 AND order_hash=$1",
    [item.input.hash.toLowerCase()]
  );
  await scheduleBnbReconciliation(db.runtime, 100, item.input.hash);
}

test("worker observes fills, cancellation, counter changes and expiry independently of current NFT visibility", async () => {
  for (const state of [
    "filled",
    "cancelled",
    "counter-changed",
    "expired"
  ] as const) {
    const item = await admitted();
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET burned=true,lifecycle=1 WHERE collection='bnb' AND token_id=$1",
      [item.input.asset.tokenId]
    );
    if (state === "filled") {
      item.state.filled = 1n;
      item.state.cancelled = true;
    }
    if (state === "cancelled") item.state.cancelled = true;
    if (state === "counter-changed") item.state.counter = 1n;
    if (state === "expired")
      item.state.blockTimestamp = item.input.order.endTime;
    await reconcile(item, {
      ...options,
      now: () => Number(item.state.blockTimestamp) * 1000
    });
    const saved = await row(item);
    assert.equal(saved.state, state);
    assert.equal(saved.state_block_number, "121");
    assert.equal(saved.reconcile_generation, "1");
    assert.equal(saved.signature, item.request.signature);
    assert.deepEqual(saved.components, item.request.order);
  }
});

test("indexed transfers do not repeatedly wake terminal BNB orders", async () => {
  const item = await admitted();
  item.state.filled = 1n;
  await reconcile(item);
  assert.equal((await row(item)).state, "filled");

  await db.owner.query(
    `UPDATE yunipals_read_v4.token SET last_transaction_hash=$1
    WHERE collection='bnb' AND token_id=$2`,
    [`0x${"cc".repeat(32)}`, item.input.asset.tokenId]
  );
  await db.owner.query(
    `UPDATE yunipals_market.orders SET
      indexed_transfer_checked_at=clock_timestamp()-interval '1 minute'
    WHERE chain_id=56 AND order_hash=$1`,
    [item.input.hash.toLowerCase()]
  );

  assert.equal(await scheduleBnbReconciliation(db.runtime), 0);
});

test("lost funds and RPC failures remain temporary, and recovery retains signed order evidence", async () => {
  const item = await admitted("offer");
  item.state.balance = 0n;
  await reconcile(item);
  assert.equal((await row(item)).state, "unavailable");
  assert.equal((await row(item)).state_reason, "offer_funding_required");
  item.state.balance = 10n ** 18n;
  await due(item);
  await reconcile(item);
  assert.equal((await row(item)).state, "active");
  item.state.rpcFailure = true;
  await due(item);
  await reconcile(item);
  const unavailable = await row(item);
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.state_observed_at, null);
  assert.equal(unavailable.reconcile_failures, 1);
  assert.ok(unavailable.next_reconcile_at.getTime() > Date.now() + 15000);
  item.state.rpcFailure = false;
  await due(item);
  await reconcile(item);
  assert.equal((await row(item)).state, "active");
  assert.equal((await row(item)).reconcile_failures, 0);
});

test("cost-capped validation may use the full shared observation window", async () => {
  const item = await admitted();
  let checks = 0;
  await reconcile(item, {
    ...options,
    now: () => (++checks < 5 ? now : now + 15000)
  });
  const saved = await row(item);
  assert.equal(saved.state, "active");
  assert.equal(saved.state_reason, null);
  assert.equal(saved.reconcile_failures, 0);
});

test("healthy orders use a jittered safety audit and indexed transfers wake only their projection", async () => {
  const item = await admitted();
  await reconcile(item);
  const saved = await row(item);
  const delay = saved.next_reconcile_at.getTime() - Date.now();
  assert.ok(delay > 5.9 * 60 * 60 * 1000);
  assert.ok(delay <= 7 * 60 * 60 * 1000);
  assert.equal(
    bnbProjectionAuditDelayMs(item.input.hash),
    bnbProjectionAuditDelayMs(item.input.hash)
  );
  assert.equal(saved.bound_transfer_hash, `0x${"aa".repeat(32)}`);
  assert.equal(await scheduleBnbReconciliation(db.runtime), 0);
  await db.owner.query(
    `UPDATE yunipals_read_v4.token SET last_transaction_hash=$1
    WHERE collection='bnb' AND token_id=$2`,
    [`0x${"cc".repeat(32)}`, item.input.asset.tokenId]
  );
  // The fallback is durably throttled; confirmed sales have their own exact
  // wakeup and do not wait for this safety check.
  assert.equal(await scheduleBnbReconciliation(db.runtime), 0);
  await db.owner.query(
    `UPDATE yunipals_market.orders SET
      indexed_transfer_checked_at=clock_timestamp()-interval '1 minute'
    WHERE chain_id=56 AND order_hash=$1`,
    [item.input.hash.toLowerCase()]
  );
  assert.equal(await scheduleBnbReconciliation(db.runtime), 1);
  const job = await claimed(item);
  assert.equal(job.payload.orderHash, item.input.hash.toLowerCase());
});

test("a reorg discards noncanonical terminal evidence and a later observation can revive a cancelled order", async () => {
  const item = await admitted();
  item.state.cancelled = true;
  item.state.canonicalMismatch = true;
  await reconcile(item);
  assert.equal((await row(item)).state, "unavailable");
  assert.equal((await row(item)).state_block_number, null);
  item.state.canonicalMismatch = false;
  await due(item);
  await reconcile(item);
  assert.equal((await row(item)).state, "cancelled");
  item.state.cancelled = false;
  await due(item);
  await reconcile(item);
  assert.equal((await row(item)).state, "active");
});

test("concurrent schedulers create one job for the next generation and only one worker claims it", async () => {
  const item = await admitted();
  await reconcile(item);
  await db.owner.query(
    "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE order_hash=$1",
    [item.input.hash.toLowerCase()]
  );
  await Promise.all(
    Array.from({ length: 8 }, () =>
      scheduleBnbReconciliation(db.runtime, 100, item.input.hash)
    )
  );
  const jobs = await Promise.all([
    claimJob(db.runtime, bnbReconcileKind),
    claimJob(db.runtime, bnbReconcileKind)
  ]);
  assert.equal(jobs.filter(Boolean).length, 1);
  const job = jobs.find(Boolean)!;
  assert.equal(job.payload.generation, "1");
  await reconcileBnbJob(db.runtime, item.client, policy, options, job);
  assert.equal((await row(item)).reconcile_generation, "2");
});

test("an expired lease cannot update an order and a reclaimed job completes once", async () => {
  const item = await admitted();
  const stale = await claimed(item);
  await db.owner.query(
    "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [stale.id]
  );
  const replacement = await claimed(item);
  await assert.rejects(
    reconcileBnbJob(db.runtime, item.client, policy, options, stale),
    LostJobLeaseError
  );
  assert.equal((await row(item)).reconcile_generation, "0");
  await reconcileBnbJob(db.runtime, item.client, policy, options, replacement);
  assert.equal((await row(item)).reconcile_generation, "1");
});

test("old generations cannot overwrite newer state and retired jobs are replaced without losing signatures", async () => {
  const item = await admitted();
  const stale = await claimed(item);
  await db.owner.query(
    "UPDATE yunipals_market.orders SET reconcile_generation=1,state='unavailable',state_reason='fixture_newer_state' WHERE order_hash=$1",
    [item.input.hash.toLowerCase()]
  );
  await reconcileBnbJob(db.runtime, item.client, policy, options, stale);
  assert.equal((await row(item)).state_reason, "fixture_newer_state");
  await due(item);
  const failed = await claimed(item);
  await db.owner.query(
    "UPDATE yunipals_market.job SET state='failed',lease_token=NULL,lease_until=NULL WHERE id=$1",
    [failed.id]
  );
  await due(item);
  const next = await claimed(item);
  assert.equal(next.payload.generation, "2");
  await reconcileBnbJob(db.runtime, item.client, policy, options, next);
  assert.equal((await row(item)).state, "active");
  assert.equal((await row(item)).signature, item.request.signature);
});

test("scheduling does not wait for an existing worker's job lock", async () => {
  const item = await admitted();
  const job = await claimed(item);
  const lock = await db.owner.connect();
  try {
    await lock.query("BEGIN");
    await lock.query(
      "SELECT id FROM yunipals_market.job WHERE id=$1 FOR UPDATE",
      [job.id]
    );
    await scheduleBnbReconciliation(db.runtime, 100, item.input.hash);
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
  }
  await reconcileBnbJob(db.runtime, item.client, policy, options, job);
  assert.equal((await row(item)).state, "active");
});

test("cleanup removes only old completed work while retaining orders, cancellation data and current work", async () => {
  const item = await admitted();
  await reconcile(item);
  await db.owner.query(
    "UPDATE yunipals_market.job SET updated_at=clock_timestamp()-interval '2 days' WHERE kind=$1 AND payload->>'orderHash'=$2",
    [bnbReconcileKind, item.input.hash.toLowerCase()]
  );
  await due(item);
  assert.equal(await pruneBnbReconcileJobs(db.runtime), 1);
  assert.ok(await claimed(item));
  assert.equal((await row(item)).signature, item.request.signature);
  const recovery = new BnbRecoveryService(db.runtime, () => now);
  const result = await recovery.cancellation(item.input.hash, {
    actor: seller.address
  });
  assert.deepEqual(result.order, item.request.order);
  await db.owner.query(
    "UPDATE yunipals_market.orders SET state='cancelled',state_observed_at=$2 WHERE order_hash=$1",
    [item.input.hash.toLowerCase(), new Date(now - 91000)]
  );
  assert.equal(
    (await recovery.accepted(item.input.hash)).order.status,
    "unavailable"
  );
  assert.equal((await recovery.accepted(item.input.hash)).persisted, true);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import type { Hex } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { claimJob, LostJobLeaseError } from "@/db/jobs";
import { createOpenSeaTestDatabase } from "@/opensea/fixtures/database";
import { acknowledgmentFixture } from "@/opensea/fixtures/orders";
import { fixtureNow, fixtureTimestamp } from "@/opensea/fixtures/admission";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { verifyOpenSeaAcknowledgment } from "@/opensea/orders";
import {
  openSeaSubmissionKind,
  processOpenSeaSubmission,
  readRetainedOpenSeaCandidate
} from "@/opensea/outbox";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import {
  openSeaReconcileKind,
  pruneOpenSeaReconcileJobs,
  reconcileOpenSeaJob,
  scheduleOpenSeaReconciliation
} from "@/opensea/reconciliation";
import { runOpenSeaSubmissionWorker } from "@/opensea/worker";

const db = createOpenSeaTestDatabase();
let previousJobs: PoolClient;
before(async () => {
  await db.initialize();
  previousJobs = await db.owner.connect();
  await previousJobs.query("BEGIN");
  await previousJobs.query(
    "SELECT id FROM yunipals_market.job WHERE kind IN ('opensea_submission','opensea_order_reconcile') FOR UPDATE"
  );
});
after(async () => {
  await previousJobs.query("ROLLBACK");
  previousJobs.release();
  await db.close();
});
type Fixture = Awaited<ReturnType<typeof db.setup>>;
function resolver(item: Fixture) {
  let offline = false;
  const policies: Pick<OpenSeaPolicyResolver, "resolve"> = {
    async resolve() {
      if (offline) throw new Error("fixture provider unavailable");
      return {
        policy: item.policy,
        collectionSlug: `yunipals-${item.input.asset.chain}`,
        providerFees: [],
        wire: {
          schemaVersion: 1,
          source: "opensea",
          chain: item.input.asset.chain,
          chainId: marketplaceChains[item.input.asset.chain].chainId,
          collection: item.policy.collection,
          listingCurrencies: [...item.policy.listingCurrencies],
          offerCurrency: item.policy.offerCurrency,
          listingZone: item.policy.listingZone,
          offerZone: item.policy.offerZone,
          maxDurationSeconds: String(item.policy.maxDurationSeconds),
          policyVersion: item.policy.version,
          expiresAt: String(item.policy.expiresAt),
          fees: [...item.policy.fees]
        }
      };
    }
  };
  return {
    policies,
    setOffline(value: boolean) {
      offline = value;
    }
  };
}
async function pending(
  chain: "ethereum" | "base" | "polygon" = "ethereum",
  side: "listing" | "offer" = "listing",
  contractSignature = false
) {
  const item = await db.setup(chain, side);
  if (contractSignature) {
    item.signature = "0x1234";
    item.request.signature = item.signature;
    item.state.erc1271 = true;
  }
  const policy = resolver(item);
  const admission = new OpenSeaAdmissionService(
    db.runtime,
    { [chain]: item.client },
    policy.policies,
    item.options
  );
  const prepared = await admission.prepare(item.draft);
  await admission.submit({ ...item.request, preparationId: prepared.id });
  const provider = {
    async lookup() {
      return null;
    },
    async publish() {
      return {
        state: "acknowledged" as const,
        acknowledgment: verifyOpenSeaAcknowledgment(
          acknowledgmentFixture({
            order: item.draft.order,
            signature: item.signature,
            summary: item.intent.summary
          }),
          item.intent.summary,
          new Date(fixtureNow)
        )
      };
    }
  };
  return { ...item, ...policy, provider };
}
type Item = Awaited<ReturnType<typeof pending>>;
async function accepted(
  chain: "ethereum" | "base" | "polygon" = "ethereum",
  side: "listing" | "offer" = "listing",
  contractSignature = false
) {
  const item = await pending(chain, side, contractSignature);
  const job = await claimJob(db.runtime, openSeaSubmissionKind, 30000, {
    chainId: item.input.asset.chainId
  });
  assert.ok(job);
  assert.equal(job.payload.orderHash, item.input.hash);
  await processOpenSeaSubmission(db.runtime, item.provider, job);
  return item;
}
async function row(item: Item) {
  return (
    await db.owner.query(
      `SELECT state,state_reason,state_observed_at,state_block_number::text,
    state_block_hash,reconcile_generation::text,reconcile_failures,signature,components,next_reconcile_at,
    stream_ack_seq::text,bound_transfer_hash
    FROM yunipals_market.orders WHERE chain_id=$1 AND order_hash=$2`,
      [item.input.asset.chainId, item.input.hash]
    )
  ).rows[0];
}
async function due(item: Item) {
  await db.owner.query(
    "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE chain_id=$1 AND order_hash=$2",
    [item.input.asset.chainId, item.input.hash]
  );
  await scheduleOpenSeaReconciliation(
    db.runtime,
    item.input.asset.chain,
    100,
    item.input.hash
  );
}
async function claimed(item: Item) {
  const job = await claimJob(db.runtime, openSeaReconcileKind, 30000, {
    chainId: item.input.asset.chainId
  });
  assert.ok(job);
  assert.equal(job.payload.orderHash, item.input.hash);
  return job;
}
async function reconcile(item: Item, options = item.options) {
  await due(item);
  await reconcileOpenSeaJob(
    db.runtime,
    item.client,
    item.input.asset.chain,
    item.policies,
    options,
    await claimed(item)
  );
  return row(item);
}

test("all three accepted chains require chain checks and recover when NFT approval is restored", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await accepted(chain);
    assert.equal((await row(item)).state, "unavailable");
    assert.equal((await row(item)).state_observed_at, null);
    assert.equal((await reconcile(item)).state, "active");
    item.state.approved = false;
    assert.equal((await reconcile(item)).state_reason, "nft_approval_required");
    item.state.approved = true;
    const recovered = await reconcile(item);
    assert.equal(recovered.state, "active");
    assert.equal(recovered.state_block_number, "121");
    assert.equal(recovered.signature, item.signature);
    assert.deepEqual(recovered.components, item.draft.order);
  }
});

test("retained catalog orders accept fresh browse policies and reject expired or oversized lifetimes", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      const item = await accepted(chain, side);
      for (const remaining of [300n, 182n]) {
        item.policy.expiresAt = fixtureTimestamp + remaining;
        assert.equal((await reconcile(item)).state, "active");
      }
      item.policy.expiresAt = fixtureTimestamp;
      assert.equal(
        (await reconcile(item)).state_reason,
        "order_policy_rejected"
      );
      item.policy.expiresAt = fixtureTimestamp + 301n;
      assert.equal(
        (await reconcile(item)).state_reason,
        "order_policy_rejected"
      );
    }
  }
});

test("an indexer advancing during protocol reads does not invalidate retained orders", async () => {
  const item = await accepted();
  const read = item.client.readContract.bind(item.client);
  let advanced = false;
  item.client.readContract = async (args) => {
    if (!advanced) {
      advanced = true;
      const checkpoint = `${String(fixtureTimestamp + 12n).padStart(10, "0")}${"1".padStart(16, "0")}${"122".padStart(16, "0")}${"0".repeat(33)}`;
      await db.owner.query(
        "UPDATE yunipals_indexer_v3._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=1",
        [checkpoint]
      );
    }
    return read(args);
  };
  const row = await reconcile(item);
  assert.equal(advanced, true);
  assert.equal(row.state, "active", row.state_reason);
  assert.equal(row.state_reason, null);
});

test("retained orders still reject an indexer already ahead of the captured head", async () => {
  const item = await accepted();
  const checkpoint = `${String(fixtureTimestamp + 12n).padStart(10, "0")}${"1".padStart(16, "0")}${"122".padStart(16, "0")}${"0".repeat(33)}`;
  await db.owner.query(
    "UPDATE yunipals_indexer_v3._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=1",
    [checkpoint]
  );
  assert.equal(
    (await reconcile(item)).state_reason,
    "indexer_not_finalized_or_stale"
  );
});

test("retained catalog policy expiry during chain checks prevents eligibility", async () => {
  const item = await accepted();
  item.policy.expiresAt = fixtureTimestamp + 300n;
  item.state.afterReceipt = async () => {
    item.policy.expiresAt = fixtureTimestamp;
  };
  const row = await reconcile(item);
  assert.equal(row.state, "unavailable");
  assert.equal(row.state_reason, "order_policy_rejected");
});

test("retained reconciliation acknowledges only the stream version captured by its job", async () => {
  const item = await accepted("base");
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_stream_wakeup(chain_id,target,version,reason)
    VALUES(8453,$1,1,'item_listed') ON CONFLICT(chain_id,target) DO UPDATE SET
      version=1,requested_at=clock_timestamp(),reason='item_listed'`,
    [`order:${item.input.hash}`]
  );
  assert.equal(
    await scheduleOpenSeaReconciliation(
      db.runtime,
      "base",
      100,
      item.input.hash
    ),
    1
  );
  const first = await claimed(item);
  assert.equal(first.payload.streamSequence, "1");
  await db.owner.query(
    `UPDATE yunipals_market.opensea_stream_wakeup SET version=2,
    requested_at=clock_timestamp(),reason='item_sold' WHERE chain_id=8453 AND target=$1`,
    [`order:${item.input.hash}`]
  );
  await reconcileOpenSeaJob(
    db.runtime,
    item.client,
    "base",
    item.policies,
    item.options,
    first
  );
  assert.equal((await row(item)).stream_ack_seq, "1");
  assert.equal(
    await scheduleOpenSeaReconciliation(
      db.runtime,
      "base",
      100,
      item.input.hash
    ),
    1
  );
  assert.equal((await claimed(item)).payload.streamSequence, "2");
});

test("healthy retained orders use a six-hour audit and an indexed transfer wakes the exact order", async () => {
  const item = await accepted("base");
  const saved = await reconcile(item);
  assert.equal(
    saved.bound_transfer_hash,
    item.indexed.lastTransfer.transactionHash.toLowerCase()
  );
  assert.ok(
    saved.next_reconcile_at.getTime() > Date.now() + 5.9 * 60 * 60 * 1000
  );
  assert.equal(
    await scheduleOpenSeaReconciliation(
      db.runtime,
      "base",
      100,
      item.input.hash
    ),
    0
  );
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET last_transaction_hash=$3 WHERE collection=$1 AND token_id=$2",
    ["base", item.input.asset.tokenId, `0x${"ef".repeat(32)}`]
  );
  assert.equal(
    await scheduleOpenSeaReconciliation(
      db.runtime,
      "base",
      100,
      item.input.hash
    ),
    1
  );
  assert.equal((await claimed(item)).payload.orderHash, item.input.hash);
});

test("terminal state survives provider/indexer failure and filled takes precedence over cancelled", async () => {
  for (const status of [
    "filled",
    "cancelled",
    "counter-changed",
    "expired"
  ] as const) {
    const item = await accepted();
    item.setOffline(true);
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET burned=true WHERE collection='ethereum' AND token_id=$1",
      [item.input.asset.tokenId]
    );
    await db.owner.query(
      "DELETE FROM yunipals_indexer_v3._ponder_checkpoint WHERE chain_id=$1",
      [item.input.asset.chainId]
    );
    if (status === "filled") {
      item.state.filled = 1n;
      item.state.cancelled = true;
    }
    if (status === "cancelled") item.state.cancelled = true;
    if (status === "counter-changed") item.state.counter = 1n;
    if (status === "expired")
      item.state.headTimestamp = item.input.order.endTime;
    const saved = await reconcile(item, {
      ...item.options,
      now: () => Number(item.state.headTimestamp) * 1000
    });
    assert.equal(saved.state, status);
    assert.equal(saved.state_block_number, "121");
    if (status === "expired") {
      const terminal = (
        await db.owner.query(
          "SELECT terminal_reason,next_reconcile_at='infinity'::timestamptz AS retired FROM yunipals_market.orders WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0];
      assert.deepEqual(terminal, { terminal_reason: "expired", retired: true });
      assert.equal(
        await scheduleOpenSeaReconciliation(
          db.runtime,
          "ethereum",
          100,
          item.input.hash
        ),
        0
      );
    }
  }
});

test("funds, allowance, signature, policy and RPC failures do not permanently retire an order", async () => {
  const item = await accepted("base", "offer", true);
  item.state.balance = 0n;
  assert.equal((await reconcile(item)).state_reason, "offer_funding_required");
  item.state.balance = 10n ** 18n;
  item.state.allowance = 0n;
  assert.equal((await reconcile(item)).state_reason, "offer_funding_required");
  item.state.allowance = 10n ** 18n;
  item.state.erc1271 = true;
  item.state.signatureValid = false;
  assert.equal((await reconcile(item)).state_reason, "invalid_maker_signature");
  item.state.signatureValid = true;
  item.setOffline(true);
  assert.equal(
    (await reconcile(item)).state_reason,
    "provider_policy_unavailable"
  );
  item.setOffline(false);
  item.policy.version = "changed";
  assert.equal((await reconcile(item)).state_reason, "order_policy_rejected");
  item.policy.version = item.draft.policyVersion;
  item.state.rpcFailure = true;
  const failed = await reconcile(item);
  assert.equal(failed.state, "unavailable");
  assert.equal(failed.state_observed_at, null);
  assert.ok(failed.next_reconcile_at.getTime() > Date.now() + 15000);
  item.state.rpcFailure = false;
  const recovered = await reconcile(item);
  assert.equal(recovered.state, "active");
  assert.equal(recovered.reconcile_failures, 0);
});

test("canonical rechecks reject reorged observations and revisit previously terminal orders", async () => {
  const item = await accepted("polygon");
  item.state.cancelled = true;
  assert.equal((await reconcile(item)).state, "cancelled");
  item.state.cancelled = false;
  item.state.afterReceipt = async () => {
    item.state.headHash = `0x${"ef".repeat(32)}` as Hex;
  };
  const reorged = await reconcile(item);
  assert.equal(reorged.state_reason, "observation_expired");
  assert.equal(reorged.state_block_number, null);
  item.state.afterReceipt = undefined;
  assert.equal((await reconcile(item)).state, "active");
});

test("terminal labels require the registered chain and exact Seaport runtime", async () => {
  const item = await accepted();
  item.state.cancelled = true;
  item.state.chainId = 56;
  let saved = await reconcile(item);
  assert.equal(saved.state, "unavailable");
  assert.equal(saved.state_observed_at, null);
  item.state.chainId = 1;
  const code = item.state.code;
  item.state.code = "0x6000";
  saved = await reconcile(item);
  assert.equal(saved.state_reason, "deployment_or_hash_mismatch");
  assert.equal(saved.state_block_hash, null);
  item.state.code = code;
  assert.equal((await reconcile(item)).state, "cancelled");
});

test("a slow chain inspection cannot commit a stale active observation", async () => {
  const item = await accepted();
  let now = fixtureNow;
  item.state.afterReceipt = async () => {
    now += 10001;
  };
  const result = await reconcile(item, { ...item.options, now: () => now });
  assert.equal(result.state, "unavailable");
  assert.equal(result.state_reason, "observation_expired");
  assert.equal(result.state_observed_at, null);
});

test("indexer changes during inspection cannot publish an active observation", async () => {
  const item = await accepted();
  item.state.afterReceipt = async () => {
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET lifecycle=2 WHERE collection='ethereum' AND token_id=$1",
      [item.input.asset.tokenId]
    );
  };
  const result = await reconcile(item);
  assert.equal(result.state, "unavailable");
  assert.ok(
    ["asset_still_syncing", "indexer_unavailable"].includes(
      result.state_reason
    ),
    result.state_reason
  );
});

test("concurrent schedulers and leases fence stale writers and leave pending submissions alone", async () => {
  const pendingItem = await pending();
  assert.equal(
    await scheduleOpenSeaReconciliation(
      db.runtime,
      "ethereum",
      100,
      pendingItem.input.hash
    ),
    0
  );
  const item = await accepted("base");
  await db.owner.query(
    "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE order_hash=$1",
    [item.input.hash]
  );
  const scheduled = await Promise.all(
    Array.from({ length: 6 }, () =>
      scheduleOpenSeaReconciliation(db.runtime, "base", 100, item.input.hash)
    )
  );
  assert.equal(
    scheduled.reduce((a, b) => a + b, 0),
    1
  );
  const old = await claimed(item);
  assert.equal(
    await claimJob(db.runtime, openSeaReconcileKind, 30000, { chainId: 8453 }),
    null
  );
  await db.owner.query(
    "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [old.id]
  );
  const current = await claimed(item);
  await assert.rejects(
    reconcileOpenSeaJob(
      db.runtime,
      item.client,
      "base",
      item.policies,
      item.options,
      old
    ),
    LostJobLeaseError
  );
  assert.equal((await row(item)).state_observed_at, null);
  await reconcileOpenSeaJob(
    db.runtime,
    item.client,
    "base",
    item.policies,
    item.options,
    current
  );
  assert.equal((await row(item)).state, "active");
  await due(item);
  const stale = await claimed(item);
  await db.owner.query(
    "UPDATE yunipals_market.orders SET reconcile_generation=reconcile_generation+1 WHERE order_hash=$1",
    [item.input.hash]
  );
  const generation = (await row(item)).reconcile_generation;
  await reconcileOpenSeaJob(
    db.runtime,
    item.client,
    "base",
    item.policies,
    item.options,
    stale
  );
  assert.equal((await row(item)).reconcile_generation, generation);
});

test("retired jobs recover with a fresh generation and cleanup preserves retained signatures", async () => {
  const item = await accepted("polygon");
  await due(item);
  const old = await claimed(item);
  await db.owner.query(
    "UPDATE yunipals_market.job SET state='failed',lease_token=NULL,lease_until=NULL WHERE id=$1",
    [old.id]
  );
  const before = BigInt((await row(item)).reconcile_generation);
  await due(item);
  assert.equal(BigInt((await row(item)).reconcile_generation), before + 1n);
  assert.equal((await row(item)).state_reason, "reconciliation_job_retired");
  await reconcileOpenSeaJob(
    db.runtime,
    item.client,
    "polygon",
    item.policies,
    item.options,
    await claimed(item)
  );
  await db.owner.query(
    "UPDATE yunipals_market.job SET updated_at=clock_timestamp()-interval '2 days' WHERE kind='opensea_order_reconcile' AND payload->>'orderHash'=$1 AND state='completed'",
    [item.input.hash]
  );
  assert.equal(await pruneOpenSeaReconcileJobs(db.runtime), 1);
  const retained = await readRetainedOpenSeaCandidate(
    db.runtime,
    137,
    item.input.hash
  );
  assert.equal(retained?.publication.signature, item.signature);
});

test("running worker automatically reconciles accepted orders on its configured chain", async () => {
  const item = await accepted("polygon");
  const abort = new AbortController();
  const running = runOpenSeaSubmissionWorker({
    pool: db.runtime,
    chain: "polygon",
    provider: item.provider,
    concurrency: 1,
    signal: abort.signal,
    reconciliation: {
      client: item.client,
      policies: item.policies,
      options: item.options
    }
  });
  try {
    const deadline = Date.now() + 5000;
    while ((await row(item)).state !== "active" && Date.now() < deadline)
      await delay(50);
    assert.equal((await row(item)).state, "active");
  } finally {
    abort.abort();
    await running;
  }
});

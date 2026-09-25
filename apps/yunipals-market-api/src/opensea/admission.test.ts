import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { zeroAddress } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { createApp } from "@/app";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { claimJob } from "@/db/jobs";
import { readEnvironment } from "@/environment";
import { OpenSeaRecoveryService } from "@/opensea/recovery";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { OpenSeaClient } from "@/opensea/client";
import { runOpenSeaSubmissionWorker } from "@/opensea/worker";
import {
  fixtureProvider,
  fixtureJsonBody,
  fixtureJsonResponse
} from "@/opensea/fixtures/provider";
import {
  admissionFixture,
  fixtureNow,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";
import { acknowledgmentFixture } from "@/opensea/fixtures/orders";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import {
  OpenSeaOrderError,
  verifyOpenSeaAcknowledgment,
  type OpenSeaOrderRequest
} from "@/opensea/orders";
import {
  openSeaSubmissionKind,
  processOpenSeaSubmission
} from "@/opensea/outbox";

const database = createBnbTestDatabase();
const tokens: string[] = [];
let sequence = BigInt(Date.now()) * 1000000n;
before(async () => {
  await database.initialize();
  await database.owner.query(`CREATE SCHEMA IF NOT EXISTS yunipals_indexer_v3;
    CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_checkpoint(chain_id integer PRIMARY KEY,latest_checkpoint text);
    CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE IF NOT EXISTS yunipals_read_v4.token_lifecycle(collection text,token_id text,lifecycle integer,mint_block bigint,mint_transaction_hash text,minted_to text,PRIMARY KEY(collection,token_id,lifecycle));
    ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS last_transaction_hash text;
    ALTER TABLE yunipals_read_v4.transfer_event ADD COLUMN IF NOT EXISTS transaction_hash text;
    GRANT USAGE ON SCHEMA yunipals_indexer_v3 TO market_test_runtime;
    GRANT SELECT ON yunipals_indexer_v3._ponder_checkpoint,yunipals_indexer_v3._ponder_meta,yunipals_read_v4.token_lifecycle TO market_test_runtime;`);
  await database.owner.query(
    `INSERT INTO yunipals_indexer_v3._ponder_meta VALUES('app',$1) ON CONFLICT(key) DO UPDATE SET value=$1`,
    [JSON.stringify({ version: 6, is_ready: 1, heartbeat_at: fixtureNow })]
  );
});
after(async () => {
  try {
    await database.owner.query(
      `DELETE FROM yunipals_market.job WHERE kind='opensea_submission' AND lower(payload->>'orderHash') IN
      (SELECT order_hash FROM yunipals_market.orders WHERE source='opensea' AND token_id=ANY($1::numeric[]))`,
      [tokens]
    );
    for (const table of ["submission_attempt", "orders", "preparation"]) {
      await database.owner.query(
        table === "submission_attempt"
          ? `DELETE FROM yunipals_market.submission_attempt WHERE order_hash IN (SELECT order_hash FROM yunipals_market.orders WHERE source='opensea' AND token_id=ANY($1::numeric[]))`
          : `DELETE FROM yunipals_market.${table} WHERE chain_id IN (1,8453,137) AND token_id=ANY($1::numeric[])`,
        [tokens]
      );
    }
    await database.owner.query(
      "DELETE FROM metadata.token_visibility WHERE collection IN ('ethereum','base','polygon') AND token_id=ANY($1::numeric[])",
      [tokens]
    );
    for (const table of ["transfer_event", "token_lifecycle", "token"])
      await database.owner.query(
        `DELETE FROM yunipals_read_v4.${table} WHERE collection IN ('ethereum','base','polygon') AND token_id=ANY($1::text[])`,
        [tokens]
      );
  } finally {
    await database.close();
  }
});

async function setup(
  chain: "ethereum" | "base" | "polygon" = "ethereum",
  side: "listing" | "offer" = "listing",
  tokenId = ++sequence,
  salt = 7n,
  authorize?: (input: OpenSeaOrderRequest, summary: MarketOrder) => void
) {
  const item = await admissionFixture(chain, side, tokenId, salt);
  const { asset } = item.input;
  if (!tokens.includes(String(tokenId))) {
    tokens.push(String(tokenId));
    await database.owner.query(
      `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned,mint_block,last_transfer_block,last_transaction_hash)
      VALUES($1,$2,$3,$4,$5,1,false,50,80,$6)`,
      [
        chain,
        asset.chainId,
        asset.contractAddress.toLowerCase(),
        String(tokenId),
        item.indexed.owner.toLowerCase(),
        item.indexed.lastTransfer.transactionHash
      ]
    );
    await database.owner.query(
      `INSERT INTO yunipals_read_v4.token_lifecycle VALUES($1,$2,1,50,$3,$4)`,
      [
        chain,
        String(tokenId),
        item.indexed.mint.transactionHash,
        item.indexed.mint.recipient.toLowerCase()
      ]
    );
    await database.owner.query(
      `INSERT INTO yunipals_read_v4.transfer_event(id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index,transaction_hash)
      VALUES($1,$2,$3,1,$4,$5,80,2,3,$6)`,
      [
        `${chain}:${tokenId}`,
        chain,
        String(tokenId),
        item.indexed.lastTransfer.from.toLowerCase(),
        item.indexed.owner.toLowerCase(),
        item.indexed.lastTransfer.transactionHash
      ]
    );
  }
  const checkpoint = `${String(fixtureTimestamp - 30n).padStart(10, "0")}${String(asset.chainId).padStart(16, "0")}${"100".padStart(16, "0")}${"0".repeat(33)}`;
  await database.owner.query(
    `INSERT INTO yunipals_indexer_v3._ponder_checkpoint VALUES($1,$2) ON CONFLICT(chain_id) DO UPDATE SET latest_checkpoint=$2`,
    [asset.chainId, checkpoint]
  );
  let policyOffline = false;
  const wire = {
    schemaVersion: 1 as const,
    source: "opensea" as const,
    chain,
    chainId: marketplaceChains[chain].chainId,
    collection: asset.contractAddress,
    listingCurrencies: item.policy.listingCurrencies,
    offerCurrency: item.policy.offerCurrency,
    listingZone: item.policy.listingZone,
    offerZone: item.policy.offerZone,
    maxDurationSeconds: String(item.policy.maxDurationSeconds),
    policyVersion: item.policy.version,
    expiresAt: String(item.policy.expiresAt),
    fees: [...item.policy.fees]
  };
  const policies = {
    async resolve() {
      if (policyOffline) throw new Error("isolated provider offline");
      return {
        policy: item.policy,
        wire,
        collectionSlug: `yunipals-${chain}`,
        providerFees: []
      };
    }
  };
  const service = new OpenSeaAdmissionService(
    database.runtime,
    { [chain]: item.client },
    policies,
    { ...item.options, authorize }
  );
  const environment = readEnvironment({
    MARKET_DATABASE_URL: "postgresql://fixture@127.0.0.1/yunipals_market_test",
    MARKET_DEPLOYMENT: "staging",
    MARKET_OPENSEA_VALIDATION_CHAIN: chain,
    MARKET_OPENSEA_VALIDATION_RPC: "http://127.0.0.1:18545",
    MARKET_OPENSEA_VALIDATION_PROVIDER: "http://127.0.0.1:19000"
  });
  const recovery = new OpenSeaRecoveryService(database.runtime);
  const app = createApp(environment, async () => {}, {
    openseaRecovery: recovery,
    openseaValidation: service
  });
  const post = async (path: string, value: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  return {
    ...item,
    service,
    recovery,
    app,
    post,
    offline() {
      policyOffline = true;
      item.state.rpcFailure = true;
    }
  };
}

test("real API and restricted PostgreSQL prepare and atomically retain all three chains without claiming provider acceptance", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await setup(chain, chain === "polygon" ? "offer" : "listing");
    assert.deepEqual(
      await readIndexedOpenSeaAsset(database.runtime, item.input.asset),
      item.indexed
    );
    const response = await item.post("/v1/market/orders/prepare", item.draft);
    assert.equal(response.status, 200);
    const prepared = await response.json();
    assert.equal(prepared.policyVersion, item.policy.version);
    assert.equal(prepared.source, "opensea");
    assert.equal((await item.service.prepare(item.draft)).id, prepared.id);
    const submitted = { ...item.request, preparationId: prepared.id };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => item.service.submit(submitted))
    );
    for (const result of results) {
      assert.equal(result.persisted, true);
      assert.equal(result.providerAccepted, false);
      assert.equal(result.publicationState, "pending");
      assert.equal(result.order.status, "unavailable");
    }
    const count = await database.owner.query(
      `SELECT (SELECT count(*) FROM yunipals_market.submission_attempt WHERE order_hash=$1)::int AS attempts,
      (SELECT count(*) FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'orderHash'=$1)::int AS jobs`,
      [item.input.hash]
    );
    assert.deepEqual(count.rows[0], { attempts: 1, jobs: 1 });
    const cancellationPath = `/v1/market/orders/${chain}/${item.intent.summary.protocolAddress}/${item.input.hash}/cancellation`;
    const recoveryApp = createApp(
      readEnvironment({
        MARKET_DATABASE_URL:
          "postgresql://fixture@127.0.0.1/yunipals_market_test",
        MARKET_DEPLOYMENT: "production"
      }),
      async () => {},
      { openseaRecovery: item.recovery }
    );
    const recoveryPath = cancellationPath.replace("/cancellation", "");
    const pendingLookup = await recoveryApp.request(recoveryPath);
    assert.equal(pendingLookup.status, 200);
    assert.equal((await pendingLookup.json()).publicationState, "pending");

    const pendingCancellation = await item.post(cancellationPath, {
      actor: item.intent.summary.maker
    });
    assert.equal(pendingCancellation.status, 200);
    assert.deepEqual((await pendingCancellation.json()).order, item.input.wire);
    assert.equal(
      (await item.post(cancellationPath, { actor: zeroAddress })).status,
      400
    );
    const job = await database.runtime.query(
      "SELECT id FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'orderHash'=$1",
      [item.input.hash]
    );
    // Claim just this retained candidate while unrelated fixture jobs are locked.
    const lock = await database.owner.connect();
    let work;
    try {
      await lock.query("BEGIN");
      await lock.query(
        "SELECT id FROM yunipals_market.job WHERE kind='opensea_submission' AND id<>$1 FOR UPDATE",
        [job.rows[0].id]
      );
      work = await claimJob(database.runtime, openSeaSubmissionKind);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    assert.ok(work);
    assert.equal(work.payload.orderHash, item.input.hash);
    const publication = {
      summary: item.intent.summary,
      order: item.draft.order,
      signature: item.signature
    };
    await processOpenSeaSubmission(
      database.runtime,
      {
        async lookup() {
          return verifyOpenSeaAcknowledgment(
            acknowledgmentFixture(publication),
            publication.summary,
            new Date()
          );
        },
        async publish() {
          throw new Error("fixture acknowledgment already visible");
        }
      },
      work
    );
    item.offline();
    const disabledLookup = await recoveryApp.request(recoveryPath);
    assert.equal(disabledLookup.status, 200);
    assert.equal((await disabledLookup.json()).providerAccepted, true);
    const disabledCancellation = await recoveryApp.request(cancellationPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: item.intent.summary.maker })
    });
    assert.equal(disabledCancellation.status, 200);
    assert.deepEqual(
      (await disabledCancellation.json()).order,
      item.input.wire
    );
    for (const path of ["/v1/market/orders", "/v1/market/orders/prepare"]) {
      assert.equal(
        (
          await recoveryApp.request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(submitted)
          })
        ).status,
        503
      );
    }
    const offlineCancellation = await item.post(cancellationPath, {
      actor: item.intent.summary.maker
    });
    assert.equal(offlineCancellation.status, 200);
    assert.deepEqual((await offlineCancellation.json()).order, item.input.wire);
    const recovered = await item.post("/v1/market/orders", submitted);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).providerAccepted, true);
    const lookup = await item.app.request(
      `/v1/market/orders/${chain}/${item.intent.summary.protocolAddress}/${item.input.hash}`
    );
    assert.equal(lookup.status, 200);
    assert.equal((await lookup.json()).order.status, "unavailable");
    const caps = await (
      await item.app.request("/v1/market/capabilities")
    ).json();
    assert.equal(caps.chains[chain].createListing, false);
  }
});

test("owner authorization blocks OpenSea preparation before retaining a signature", async () => {
  let checks = 0;
  const item = await setup(
    "ethereum",
    "listing",
    ++sequence,
    7n,
    (input, summary) => {
      checks++;
      assert.equal(input.hash, summary.orderHash);
      throw new OpenSeaOrderError("owner_trade_not_authorized", 503);
    }
  );
  await assert.rejects(item.service.prepare(item.draft), {
    code: "owner_trade_not_authorized"
  });
  assert.equal(checks, 1);
  assert.equal(
    (
      await database.owner.query(
        "SELECT id FROM yunipals_market.preparation WHERE chain_id=$1 AND order_hash=$2",
        [item.input.asset.chainId, item.input.hash]
      )
    ).rowCount,
    0
  );
});

test("admission rejects wrong preparation, invalid signature and changed policy before retaining anything", async () => {
  const item = await setup();
  const prepared = await item.service.prepare(item.draft);
  await assert.rejects(
    item.service.submit(item.request),
    /preparation_mismatch/
  );
  await assert.rejects(
    item.service.submit({
      ...item.request,
      preparationId: prepared.id,
      signature: "0x1234"
    }),
    /invalid_maker_signature/
  );
  item.policy.version = "changed-policy";
  await assert.rejects(
    item.service.submit({ ...item.request, preparationId: prepared.id }),
    /order_policy_rejected/
  );
  const rows = await database.owner.query(
    "SELECT 1 FROM yunipals_market.orders WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal(rows.rowCount, 0);
});

test("failed outbox insertion rolls back the signature and attempt together, then an exact retry succeeds", async () => {
  const item = await setup("base", "offer");
  const prepared = await item.service.prepare(item.draft);
  const request = { ...item.request, preparationId: prepared.id };
  // The hash is generated by the shared strict codec, never caller-controlled SQL.
  assert.match(item.input.hash, /^0x[0-9a-f]{64}$/);
  await database.owner
    .query(`ALTER TABLE yunipals_market.job ADD CONSTRAINT opensea_admission_rollback
    CHECK (payload->>'orderHash'<>'${item.input.hash}') NOT VALID`);
  try {
    await assert.rejects(
      item.service.submit(request),
      /opensea_admission_rollback/
    );
    for (const table of ["orders", "submission_attempt"])
      assert.equal(
        (
          await database.owner.query(
            `SELECT 1 FROM yunipals_market.${table} WHERE order_hash=$1`,
            [item.input.hash]
          )
        ).rowCount,
        0
      );
  } finally {
    await database.owner.query(
      "ALTER TABLE yunipals_market.job DROP CONSTRAINT opensea_admission_rollback"
    );
  }
  const retried = await item.service.submit(request);
  assert.equal(retried.persisted, true);
  assert.equal(retried.publicationState, "pending");
});

test("competing signed replacements serialize by maker and asset until the earlier order is cancelled", async () => {
  const first = await setup("base");
  const second = await setup(
    "base",
    "listing",
    BigInt(first.input.asset.tokenId),
    8n
  );
  const [a, b] = await Promise.all([
    first.service.prepare(first.draft),
    second.service.prepare(second.draft)
  ]);
  const outcomes = await Promise.allSettled([
    first.service.submit({ ...first.request, preparationId: a.id }),
    second.service.submit({ ...second.request, preparationId: b.id })
  ]);
  assert.equal(
    outcomes.filter((value) => value.status === "fulfilled").length,
    1
  );
  const failed = outcomes.find((value) => value.status === "rejected");
  assert.ok(failed?.status === "rejected");
  assert.match(
    String(failed.reason),
    /outstanding_order_requires_cancellation/
  );
  const winner = outcomes[0]!.status === "fulfilled" ? first : second;
  const loser = winner === first ? second : first;
  // A stale rejected label still cannot revoke a previously issued signature.
  await database.owner.query(
    "UPDATE yunipals_market.orders SET publication_state='rejected' WHERE order_hash=$1",
    [winner.input.hash]
  );
  await assert.rejects(
    loser.service.prepare(loser.draft),
    /outstanding_order_requires_cancellation/
  );
  loser.state.cancelledHistory.add(winner.input.hash);
  await loser.service.prepare(loser.draft);
});

test("indexer corruption, anchored visibility and changes during observation fail before commit", async () => {
  const item = await setup("polygon");
  await database.owner.query(
    "UPDATE yunipals_read_v4.token_lifecycle SET minted_to=NULL WHERE collection='polygon' AND token_id=$1",
    [item.input.asset.tokenId]
  );
  await assert.rejects(item.service.prepare(item.draft), /indexer_unavailable/);
  await database.owner.query(
    "UPDATE yunipals_read_v4.token_lifecycle SET minted_to=$2 WHERE collection='polygon' AND token_id=$1",
    [item.input.asset.tokenId, item.indexed.mint.recipient.toLowerCase()]
  );
  let changed = false;
  item.state.afterReceipt = async () => {
    if (changed) return;
    changed = true;
    await database.owner.query(
      `INSERT INTO metadata.token_visibility VALUES('polygon',$1,$2,1,$3,80,2,3)`,
      [
        item.input.asset.tokenId,
        item.indexed.owner.toLowerCase(),
        `polygon:${item.input.asset.tokenId}`
      ]
    );
  };
  await assert.rejects(item.service.prepare(item.draft), /asset_still_syncing/);
  assert.equal(
    (await readIndexedOpenSeaAsset(database.runtime, item.input.asset)).hidden,
    true
  );
  await assert.rejects(item.service.prepare(item.draft), /asset_changed/);
  const result = await database.owner.query(
    "SELECT 1 FROM yunipals_market.preparation WHERE order_hash=$1",
    [item.input.hash]
  );
  assert.equal(result.rowCount, 0);
  item.state.owner = zeroAddress;
});

test("automatic worker rechecks approval before POST, scopes claims to its chain and recovers a lost response after restart", async (t) => {
  const item = await setup("ethereum");
  const other = await setup("base");
  for (const candidate of [item, other]) {
    const prepared = await candidate.service.prepare(candidate.draft);
    await candidate.service.submit({
      ...candidate.request,
      preparationId: prepared.id
    });
  }
  const publication = {
    summary: item.intent.summary,
    order: item.draft.order,
    signature: item.signature
  };
  let posts = 0;
  let visible = false;
  const provider = await fixtureProvider(async (req, res) => {
    if (req.method === "GET") {
      if (visible)
        fixtureJsonResponse(res, { order: acknowledgmentFixture(publication) });
      else {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    posts++;
    const body = (await fixtureJsonBody(req)) as { signature: string };
    assert.equal(body.signature, item.signature);
    const stored = (
      await database.owner.query(
        "SELECT signature,publication_state FROM yunipals_market.orders WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0];
    assert.equal(stored.signature, item.signature);
    assert.equal(stored.publication_state, "indeterminate");
    res.destroy();
  });
  t.after(() => provider.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: provider.origin,
    authorizePublication: (value) => item.service.validateRetainedForSend(value)
  });
  const lock = await database.owner.connect();
  let stop = new AbortController();
  let worker: Promise<void> | undefined;
  const waitFor = async (predicate: () => Promise<boolean>) => {
    const deadline = Date.now() + 5000;
    while (!(await predicate())) {
      if (Date.now() > deadline)
        throw new Error("Worker observation timed out.");
      await delay(25);
    }
  };
  const start = () => {
    stop = new AbortController();
    worker = runOpenSeaSubmissionWorker({
      pool: database.runtime,
      provider: client,
      chain: "ethereum",
      concurrency: 2,
      signal: stop.signal
    });
    // Record unexpected rejection immediately, before a test assertion can fail.
    void worker.catch(() => {});
  };
  const due = () =>
    database.owner.query(
      "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE order_hash=$1",
      [item.input.hash]
    );
  try {
    await lock.query("BEGIN");
    await lock.query(
      "SELECT id FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'chainId'='1' AND payload->>'orderHash'<>$1 FOR UPDATE",
      [item.input.hash]
    );
    item.state.approved = false;
    start();
    await waitFor(
      async () =>
        (
          await database.owner.query(
            "SELECT state_reason FROM yunipals_market.orders WHERE order_hash=$1",
            [item.input.hash]
          )
        ).rows[0].state_reason === "publication_not_authorized"
    );
    assert.equal(posts, 0);
    item.state.approved = true;
    await due();
    await waitFor(
      async () =>
        (
          await database.owner.query(
            "SELECT state FROM yunipals_market.submission_attempt WHERE order_hash=$1",
            [item.input.hash]
          )
        ).rows[0].state === "indeterminate"
    );
    assert.equal(posts, 1);
    stop.abort();
    await worker;
    visible = true;
    await due();
    start();
    await waitFor(
      async () =>
        (await item.recovery.accepted("ethereum", item.input.hash))
          .providerAccepted
    );
    assert.equal(
      posts,
      1,
      "Restart reconciles exact identity without another POST."
    );
    const otherJob = (
      await database.owner.query(
        "SELECT attempts FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'orderHash'=$1",
        [other.input.hash]
      )
    ).rows[0];
    assert.equal(
      otherJob.attempts,
      0,
      "The Ethereum worker never claims Base jobs."
    );
  } finally {
    stop.abort();
    await worker;
    await lock.query("ROLLBACK");
    lock.release();
  }
});

test("OpenSea validation configuration refuses public endpoints, partial configuration and production", () => {
  const base = {
    MARKET_DATABASE_URL: "postgresql://test@127.0.0.1/test",
    MARKET_DEPLOYMENT: "staging",
    MARKET_OPENSEA_VALIDATION_CHAIN: "base",
    MARKET_OPENSEA_VALIDATION_RPC: "http://127.0.0.1:8545",
    MARKET_OPENSEA_VALIDATION_PROVIDER: "http://127.0.0.1:19000"
  };
  assert.ok(readEnvironment(base).openseaValidation);
  for (const change of [
    { MARKET_DEPLOYMENT: "production" },
    { MARKET_OPENSEA_VALIDATION_RPC: "https://mainnet.base.org" },
    { MARKET_OPENSEA_VALIDATION_PROVIDER: "https://api.opensea.io" },
    { MARKET_OPENSEA_VALIDATION_CHAIN: "bnb" },
    { MARKET_OPENSEA_VALIDATION_PROVIDER: undefined },
    { MARKET_OPENSEA_VALIDATION_RPC: "http://secret@127.0.0.1" }
  ])
    assert.throws(() => readEnvironment({ ...base, ...change }));
});

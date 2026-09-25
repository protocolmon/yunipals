import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import pg, { type PoolClient } from "pg";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  seaportOrderHash,
  seaportSigningData
} from "@protopals/yunipals-market-core/seaport";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";

import { testUrl } from "@/bnb/fixtures/database";
import { claimJob, LostJobLeaseError } from "@/db/jobs";
import { migrate } from "@/db/migrate";
import {
  OpenSeaClient,
  OpenSeaError,
  type OpenSeaPublicationResult
} from "@/opensea/client";
import {
  acknowledgmentFixture,
  publicationFixture
} from "@/opensea/fixtures/orders";
import {
  fixtureProvider,
  fixtureJsonBody,
  fixtureJsonResponse
} from "@/opensea/fixtures/provider";
import {
  snapshotOpenSeaPublication,
  verifyOpenSeaAcknowledgment,
  type OpenSeaPublication
} from "@/opensea/orders";
import {
  openSeaSubmissionKind,
  processOpenSeaSubmission,
  pruneOpenSeaSubmissionJobs,
  readRetainedOpenSeaCandidate,
  retainOpenSeaCandidate,
  scheduleOpenSeaSubmissions
} from "@/opensea/outbox";

const owner = new pg.Pool({
  connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
  max: 4,
  statement_timeout: 5000
});
const runtimeOptions = {
  connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
  max: 8,
  statement_timeout: 5000
};
const runtime = new pg.Pool(runtimeOptions);
let existing: PoolClient;
const admitted: OpenSeaPublication[] = [];
before(async () => {
  await migrate(owner, "staging");
  existing = await owner.connect();
  await existing.query("BEGIN");
  await existing.query(
    "SELECT id FROM yunipals_market.job WHERE kind='opensea_submission' FOR UPDATE"
  );
});
afterEach(async () => {
  for (const publication of admitted.splice(0)) {
    const { asset, orderHash } = publication.summary;
    await owner.query(
      "DELETE FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'chainId'=$1 AND payload->>'orderHash'=$2",
      [String(asset.chainId), orderHash]
    );
    await owner.query(
      "DELETE FROM yunipals_market.submission_attempt WHERE chain_id=$1 AND order_hash=$2",
      [asset.chainId, orderHash]
    );
    await owner.query(
      "DELETE FROM yunipals_market.orders WHERE chain_id=$1 AND order_hash=$2",
      [asset.chainId, orderHash]
    );
  }
});
after(async () => {
  try {
    if (existing) await existing.query("ROLLBACK");
  } finally {
    existing?.release();
    await runtime.end();
    await owner.end();
  }
});

function candidate(
  chain: "ethereum" | "base" | "polygon" = "ethereum",
  side: "listing" | "offer" = "listing"
) {
  const publication = publicationFixture(chain, side);
  publication.order.salt = BigInt(
    `0x${randomUUID().replaceAll("-", "")}`
  ).toString();
  publication.summary.orderHash = seaportOrderHash(
    decodeSeaportOrder(publication.order)
  );
  admitted.push(publication);
  return publication;
}
function retain(publication: OpenSeaPublication) {
  return retainOpenSeaCandidate(runtime, {
    publication,
    policyVersion: "isolated-expired-fixture",
    admissionBlock: { number: "123", hash: `0x${"ab".repeat(32)}` }
  });
}
function read(publication: OpenSeaPublication) {
  return readRetainedOpenSeaCandidate(
    runtime,
    publication.summary.asset.chainId,
    publication.summary.orderHash
  );
}
async function claimed(publication: OpenSeaPublication) {
  const job = await claimJob(runtime, openSeaSubmissionKind);
  assert.ok(job);
  assert.equal(job.payload.orderHash, publication.summary.orderHash);
  return job;
}
async function due(publication: OpenSeaPublication) {
  const scope = {
    chainId: publication.summary.asset.chainId,
    orderHash: publication.summary.orderHash
  };
  await owner.query(
    "UPDATE yunipals_market.orders SET next_reconcile_at=clock_timestamp() WHERE chain_id=$1 AND order_hash=$2",
    [scope.chainId, scope.orderHash]
  );
  assert.equal(await scheduleOpenSeaSubmissions(runtime, 1, scope), 1);
}
function ack(publication: OpenSeaPublication) {
  return verifyOpenSeaAcknowledgment(
    acknowledgmentFixture(publication),
    publication.summary,
    new Date()
  );
}

test("concurrent retention commits one signed candidate, attempt and job without overwriting recovery evidence", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const publication = candidate(chain, "offer");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => retain(publication))
    );
    assert.equal(results.filter((result) => result.retained).length, 1);
    const stored = await read(publication);
    assert.equal(stored!.state, "pending");
    assert.equal(stored!.attempt.state, "queued");
    assert.equal(stored!.publication.signature, publication.signature);
    assert.deepEqual(
      stored!.publication.order,
      snapshotOpenSeaPublication(publication).order
    );
    const different = structuredClone(publication);
    different.signature = "0x9876";
    await retain(different);
    assert.equal(
      (await read(publication))!.publication.signature,
      publication.signature
    );
    different.summary.lifecycle++;
    await assert.rejects(retain(different), /another lifecycle/);
    const count = await owner.query(
      "SELECT count(*)::int AS n FROM yunipals_market.submission_attempt WHERE chain_id=$1 AND order_hash=$2",
      [publication.summary.asset.chainId, publication.summary.orderHash]
    );
    assert.equal(count.rows[0].n, 1);
    assert.equal((await claimed(publication)).payload.generation, "0");
  }
});

test("a cryptographically valid expired fixture signature remains verifiable after acknowledgment and pool restart", async () => {
  const publication = candidate();
  const signer = privateKeyToAccount(`0x${"03".repeat(32)}`);
  publication.order.offerer = signer.address;
  publication.order.consideration[0]!.recipient = signer.address;
  publication.summary.maker = signer.address;
  const order = decodeSeaportOrder(publication.order);
  publication.summary.orderHash = seaportOrderHash(order);
  const signing = seaportSigningData(
    {
      name: "Seaport",
      version: "1.6",
      chainId: 1,
      verifyingContract: seaportDeployment.address
    },
    order
  );
  publication.signature = await signer.signTypedData(signing);
  assert.ok(order.endTime < BigInt(Math.floor(Date.now() / 1000)));
  assert.ok(
    await verifyTypedData({
      ...signing,
      address: signer.address,
      signature: publication.signature
    })
  );
  await retain(publication);
  await processOpenSeaSubmission(
    runtime,
    {
      async lookup() {
        return ack(publication);
      },
      async publish() {
        throw new Error("already acknowledged fixture");
      }
    },
    await claimed(publication)
  );
  const restarted = new pg.Pool(runtimeOptions);
  try {
    const recovered = await readRetainedOpenSeaCandidate(
      restarted,
      1,
      publication.summary.orderHash
    );
    assert.ok(recovered);
    assert.equal(recovered.state, "accepted");
    assert.equal(recovered.publication.signature, publication.signature);
    const data = seaportSigningData(
      signing.domain,
      decodeSeaportOrder(recovered.publication.order)
    );
    assert.ok(
      await verifyTypedData({
        ...data,
        address: signer.address,
        signature: recovered.publication.signature
      })
    );
  } finally {
    await restarted.end();
  }
});

test("real HTTP publication sees committed signature and sending state, then persists acknowledgment without active-price eligibility", async (t) => {
  const publication = candidate();
  await retain(publication);
  let posts = 0;
  let verifiedBeforeSend = false;
  const provider = await fixtureProvider(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    posts++;
    assert.deepEqual(
      await fixtureJsonBody(req),
      snapshotOpenSeaPublication(publication).body
    );
    const durable = await read(publication);
    assert.equal(durable!.state, "indeterminate");
    assert.equal(durable!.attempt.state, "sending");
    assert.equal(durable!.publication.signature, publication.signature);
    verifiedBeforeSend = true;
    fixtureJsonResponse(res, acknowledgmentFixture(publication));
  });
  t.after(() => provider.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: provider.origin,
    authorizePublication: async () => {}
  });
  assert.equal(
    await processOpenSeaSubmission(runtime, client, await claimed(publication)),
    "accepted"
  );
  assert.ok(verifiedBeforeSend);
  assert.equal((await read(publication))!.attempt.state, "accepted");
  const row = (
    await owner.query(
      "SELECT state,provider_ack,accepted_at,admission_block_number::text FROM yunipals_market.orders WHERE chain_id=1 AND order_hash=$1",
      [publication.summary.orderHash]
    )
  ).rows[0];
  assert.equal(row.state, "unavailable");
  assert.equal(row.provider_ack.orderHash, publication.summary.orderHash);
  assert.ok(row.accepted_at instanceof Date);
  assert.equal(row.admission_block_number, "123");
  assert.equal((await retain(publication)).retained, false);
  assert.equal(posts, 1);
});

test("a dropped response survives pool restart and repeated 404s, then exact lookup recovers without a second POST", async (t) => {
  const publication = candidate("base");
  await retain(publication);
  let posts = 0;
  let visible = false;
  const provider = await fixtureProvider(async (req, res) => {
    if (req.method === "POST") {
      await fixtureJsonBody(req);
      posts++;
      res.destroy();
    } else if (visible)
      fixtureJsonResponse(res, { order: acknowledgmentFixture(publication) });
    else {
      res.writeHead(404);
      res.end();
    }
  });
  t.after(() => provider.close());
  const options = {
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: provider.origin,
    authorizePublication: async () => {}
  };
  const firstPool = new pg.Pool(runtimeOptions);
  try {
    assert.equal(
      await processOpenSeaSubmission(
        firstPool,
        new OpenSeaClient(options),
        await claimed(publication)
      ),
      "indeterminate"
    );
  } finally {
    await firstPool.end();
  }
  const restarted = new OpenSeaClient(options);
  for (let i = 0; i < 2; i++) {
    await due(publication);
    assert.equal(
      await processOpenSeaSubmission(
        runtime,
        restarted,
        await claimed(publication)
      ),
      "indeterminate"
    );
  }
  visible = true;
  await due(publication);
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      restarted,
      await claimed(publication)
    ),
    "accepted"
  );
  assert.equal(posts, 1);
  assert.equal(
    (await read(publication))!.publication.signature,
    publication.signature
  );
});

test("a lease handoff after sending fences late acknowledgment and preserves lookup-only recovery", async () => {
  const publication = candidate("polygon", "offer");
  await retain(publication);
  let resolveSend!: (result: OpenSeaPublicationResult) => void;
  let arrived!: () => void;
  const entered = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let posts = 0;
  let visible = false;
  const provider = {
    async lookup() {
      return visible ? ack(publication) : null;
    },
    async publish() {
      posts++;
      arrived();
      return new Promise<OpenSeaPublicationResult>((resolve) => {
        resolveSend = resolve;
      });
    }
  };
  const oldJob = await claimed(publication);
  const oldWork = processOpenSeaSubmission(runtime, provider, oldJob);
  const oldFailure = assert.rejects(oldWork, LostJobLeaseError);
  await entered;
  assert.equal((await read(publication))!.attempt.state, "sending");
  await owner.query(
    "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [oldJob.id]
  );
  const replacement = await claimed(publication);
  assert.equal(replacement.id, oldJob.id);
  assert.notEqual(replacement.leaseToken, oldJob.leaseToken);
  assert.equal(
    await processOpenSeaSubmission(runtime, provider, replacement),
    "indeterminate"
  );
  resolveSend({ state: "acknowledged", acknowledgment: ack(publication) });
  await oldFailure;
  assert.equal((await read(publication))!.state, "indeterminate");
  visible = true;
  await due(publication);
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      provider,
      await claimed(publication)
    ),
    "accepted"
  );
  assert.equal(posts, 1);
});

test("a definite first-attempt rejection retains evidence; authentication failure cannot erase prior uncertainty", async () => {
  const rejected = candidate();
  await retain(rejected);
  const provider = {
    async lookup() {
      return null;
    },
    async publish(): Promise<OpenSeaPublicationResult> {
      return {
        state: "rejected",
        code: "provider_http_error",
        httpStatus: 400
      };
    }
  };
  assert.equal(
    await processOpenSeaSubmission(runtime, provider, await claimed(rejected)),
    "rejected"
  );
  assert.equal(
    (await read(rejected))!.publication.signature,
    rejected.signature
  );
  const uncertain = candidate();
  await retain(uncertain);
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      {
        ...provider,
        async publish() {
          throw new OpenSeaError("provider_network");
        }
      },
      await claimed(uncertain)
    ),
    "indeterminate"
  );
  await due(uncertain);
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      {
        ...provider,
        async lookup() {
          throw new OpenSeaError("provider_auth", 403);
        }
      },
      await claimed(uncertain)
    ),
    "indeterminate"
  );
  assert.equal((await read(uncertain))!.attempt.state, "indeterminate");
});

test("confirmed non-transmission can retry safely; wrong acknowledgment never becomes accepted", async () => {
  const publication = candidate();
  await retain(publication);
  let sends = 0;
  const disabled = {
    async lookup() {
      return null;
    },
    async publish(): Promise<OpenSeaPublicationResult> {
      return { state: "not_sent", code: "publication_disabled" };
    }
  };
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      disabled,
      await claimed(publication)
    ),
    "pending"
  );
  assert.equal((await read(publication))!.attempt.state, "queued");
  await due(publication);
  const bad = ack(publication);
  bad.order.consideration[0]!.startAmount = "1";
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      {
        ...disabled,
        async publish(): Promise<OpenSeaPublicationResult> {
          sends++;
          return { state: "acknowledged", acknowledgment: bad };
        }
      },
      await claimed(publication)
    ),
    "indeterminate"
  );
  await due(publication);
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      {
        ...disabled,
        async publish() {
          sends++;
          return {
            state: "acknowledged",
            acknowledgment: ack(publication)
          } as const;
        }
      },
      await claimed(publication)
    ),
    "indeterminate"
  );
  assert.equal(sends, 1);
});

test("exhausted leases get a new generation and completed-job cleanup preserves accepted signatures and attempts", async () => {
  const publication = candidate();
  await retain(publication);
  const old = await claimed(publication);
  await owner.query(
    "UPDATE yunipals_market.orders SET publication_state='indeterminate' WHERE chain_id=1 AND order_hash=$1",
    [publication.summary.orderHash]
  );
  await owner.query(
    "UPDATE yunipals_market.submission_attempt SET state='sending' WHERE chain_id=1 AND order_hash=$1",
    [publication.summary.orderHash]
  );
  await owner.query(
    "UPDATE yunipals_market.job SET attempts=max_attempts,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [old.id]
  );
  assert.equal(await claimJob(runtime, openSeaSubmissionKind), null);
  await due(publication);
  const next = await claimed(publication);
  assert.notEqual(next.id, old.id);
  assert.equal(next.payload.generation, "1");
  assert.equal(
    await processOpenSeaSubmission(
      runtime,
      {
        async lookup() {
          return ack(publication);
        },
        async publish() {
          throw new Error("must never publish");
        }
      },
      next
    ),
    "accepted"
  );
  await owner.query(
    "UPDATE yunipals_market.job SET updated_at=clock_timestamp()-interval '2 days' WHERE id=$1",
    [next.id]
  );
  assert.equal(await pruneOpenSeaSubmissionJobs(runtime), 1);
  const durable = await read(publication);
  assert.equal(durable!.state, "accepted");
  assert.equal(durable!.attempt.state, "accepted");
  assert.equal(durable!.publication.signature, publication.signature);
});

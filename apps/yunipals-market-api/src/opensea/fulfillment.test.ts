import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { decodeFunctionData, zeroAddress, type PublicClient } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportWriteAbi } from "@protopals/yunipals-market-core/seaport";
import {
  openseaConduit,
  openseaCurrencies,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { createOpenSeaTestDatabase } from "@/opensea/fixtures/database";
import {
  buyer,
  seller,
  fixtureTimestamp,
  fixtureNow
} from "@/opensea/fixtures/admission";
import { parseOpenSeaDiscoveredOrder } from "@/opensea/discoveryOrder";
import {
  claimDiscoveredOpenSeaOrder,
  reconcileDiscoveredOpenSeaOrder
} from "@/opensea/discoveredReconciliation";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { OpenSeaError } from "@/opensea/client";
import { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { loadOpenSeaFulfillmentCandidate } from "@/opensea/fulfillmentCandidate";
import { retainOpenSeaMakerSignature } from "@/opensea/makerSignature";
import {
  enqueueMissingOpenSeaSignatures,
  enrichNextOpenSeaSignature
} from "@/opensea/signatureEnrichment";
import { OpenSeaOrderError } from "@/opensea/orders";
import { testUrl } from "@/bnb/fixtures/database";
import { marketOrderRowsSql } from "@/reads/orderRows";
import {
  claimJob,
  completeJob,
  enqueueJob,
  LostJobLeaseError,
  retryJob
} from "@/db/jobs";
import {
  assertOpenSeaSignatureWorkerReady,
  runOpenSeaSignatureWorker
} from "@/opensea/signatureWorker";
import { runOpenSeaSignatureFleet } from "@/opensea/signatureFleet";
import { SignatureSchedule } from "@/opensea/signatureSchedule";

const db = createOpenSeaTestDatabase();
const hashes: string[] = [];
const workerRole = `market_test_signature_worker_${process.pid}`;
let workerPool: pg.Pool;
before(async () => {
  await db.initialize();
  await db.owner.query(
    `CREATE ROLE ${workerRole} LOGIN NOINHERIT PASSWORD 'local-worker-test-only'`
  );
  for (const script of [
    "grant-opensea-maker-signature.sql",
    "grant-opensea-signature-read.sql",
    "configure-opensea-signature-jobs.sql"
  ]) {
    await db.owner.query(
      (
        await readFile(
          new URL(`../../scripts/${script}`, import.meta.url),
          "utf8"
        )
      ).replaceAll(':"market_signature_role"', `"${workerRole}"`)
    );
  }
  const url = new URL(testUrl("MARKET_TEST_DATABASE_URL"));
  url.username = workerRole;
  url.password = "local-worker-test-only";
  workerPool = new pg.Pool({
    connectionString: url.href,
    max: 4,
    statement_timeout: 5000
  });
});
after(async () => {
  await db.owner.query(
    "DELETE FROM yunipals_market.job WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=ANY($1::text[])",
    [hashes]
  );
  for (const table of ["opensea_discovered_state", "opensea_discovered_order"])
    await db.owner.query(
      `DELETE FROM yunipals_market.${table} WHERE order_hash=ANY($1::text[])`,
      [hashes]
    );
  await workerPool?.end();
  await db.owner.query(`DROP POLICY job_signature_scope ON yunipals_market.job;
    DROP POLICY job_existing_table_access ON yunipals_market.job;
    ALTER TABLE yunipals_market.job DISABLE ROW LEVEL SECURITY;
    DROP OWNED BY ${workerRole}; DROP ROLE ${workerRole}`);
  await db.close();
});
async function providerPresenceRoundTrip(hash: string) {
  for (const present of [false, true])
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET present=$2 WHERE order_hash=$1",
      [hash, present]
    );
}

async function setup(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing",
  weth = false,
  servicePool = db.runtime
) {
  const item = await db.setup(
    chain,
    side,
    weth ? openseaCurrencies[chain].address : zeroAddress
  );
  const envelope = {
    chain,
    order_hash: item.input.hash,
    protocol_address: seaportDeployment.address,
    protocol_data: {
      parameters: {
        ...item.draft.order,
        totalOriginalConsiderationItems: item.draft.order.consideration.length
      },
      signature: "0x"
    },
    status: "ACTIVE",
    remaining_quantity: 1
  };
  const parsed = parseOpenSeaDiscoveredOrder(envelope, chain, side);
  hashes.push(parsed.orderHash);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_discovered_order
    (chain_id,protocol_address,order_hash,contract_address,side,token_id,maker,classification,provider_status,components,signature,provider_observation,last_seen_run_id,last_seen_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
      randomUUID(),
      new Date(fixtureNow)
    ]
  );
  let policyFailure: Error | undefined;
  const policies: Pick<OpenSeaPolicyResolver, "resolve"> = {
    async resolve() {
      if (policyFailure) throw policyFailure;
      return { policy: item.policy } as Awaited<
        ReturnType<OpenSeaPolicyResolver["resolve"]>
      >;
    }
  };
  let now = fixtureNow;
  const options = { ...item.options, providerMaxAgeMs: 300000, now: () => now };
  const claim = await claimDiscoveredOpenSeaOrder(
    db.runtime,
    chain,
    30000,
    item.input.hash
  );
  assert.ok(claim);
  await reconcileDiscoveredOpenSeaOrder(
    db.runtime,
    item.client,
    chain,
    policies,
    options,
    claim
  );
  const actor = side === "listing" ? buyer.address : seller.address;
  const authorization = `0x00${actor.slice(2)}${(fixtureTimestamp + 20n).toString(16).padStart(16, "0")}${"11".repeat(64)}`;
  const parameters = {
    ...item.draft.order,
    totalOriginalConsiderationItems: item.draft.order.consideration.length
  };
  const { counter: _counter, ...callParameters } = parameters;
  const fulfillment = {
    protocol: "seaport1.6",
    fulfillment_data: {
      orders: [{ parameters, signature: item.signature }],
      transaction: {
        chain: item.input.asset.chainId,
        to: seaportDeployment.address,
        value:
          side === "listing" && !weth ? item.intent.summary.grossAmount : "0",
        function: "fulfillAdvancedOrder",
        input_data: {
          advancedOrder: {
            parameters: structuredClone(callParameters),
            signature: item.signature,
            numerator: 1,
            denominator: 1,
            extraData: side === "offer" ? authorization : "0x"
          },
          criteriaResolvers: [],
          fulfillerConduitKey: openseaConduit.key,
          recipient: actor
        }
      }
    }
  };
  const actorState = {
    balance: 10n ** 18n,
    allowance: 10n ** 18n,
    approved: true,
    signature: true,
    settlement: true
  };
  const calls: string[] = [];
  let duringCall: (() => Promise<void>) | undefined;
  const client = {
    ...item.client,
    getBalance: async () => actorState.balance,
    readContract: async (
      request: Parameters<PublicClient["readContract"]>[0]
    ) => {
      if (String(request.args?.[0]).toLowerCase() === actor.toLowerCase()) {
        if (request.functionName === "isApprovedForAll")
          return actorState.approved;
        if (request.functionName === "balanceOf") return actorState.balance;
        if (request.functionName === "allowance") return actorState.allowance;
      }
      return item.client.readContract(request);
    },
    simulateContract: async (request: {
      account: string;
      blockNumber: bigint;
      functionName: string;
      args: { signature: string }[][];
    }) => {
      calls.push("validate");
      assert.equal(request.account, actor);
      assert.equal(request.blockNumber, 121n);
      assert.equal(request.functionName, "validate");
      assert.equal(request.args[0]?.[0]?.signature, item.signature);
      return { result: actorState.signature };
    },
    call: async (request: {
      account: string;
      blockNumber: bigint;
      to: string;
      data: `0x${string}`;
      value: bigint;
    }) => {
      calls.push("settle");
      assert.equal(request.account, actor);
      assert.equal(request.blockNumber, 121n);
      assert.equal(request.to, seaportDeployment.address);
      assert.equal(
        request.value,
        BigInt(fulfillment.fulfillment_data.transaction.value)
      );
      assert.equal(
        decodeFunctionData({ abi: seaportWriteAbi, data: request.data })
          .functionName,
        "fulfillAdvancedOrder"
      );
      await duringCall?.();
      return { data: actorState.settlement ? `0x${"0".repeat(63)}1` : "0x" };
    }
  } as unknown as PublicClient;
  let fetches = 0;
  const service = new OpenSeaFulfillmentService(
    servicePool,
    { [chain]: client },
    policies,
    {
      async fulfillment(summary, fulfiller) {
        fetches++;
        assert.equal(summary.orderHash, item.input.hash);
        assert.equal(fulfiller, actor);
        return fulfillment;
      }
    },
    options
  );
  const body = { actor, lifecycle: 1 };
  return {
    ...item,
    actorState,
    fulfillment,
    calls,
    service,
    actor,
    async reconcile() {
      const claim = await claimDiscoveredOpenSeaOrder(
        db.runtime,
        chain,
        30000,
        item.input.hash
      );
      assert.ok(claim);
      return reconcileDiscoveredOpenSeaOrder(
        db.runtime,
        item.client,
        chain,
        policies,
        options,
        claim
      );
    },
    preflight: () => service.preflight(chain, item.input.hash, body),
    quote: () => service.quote(chain, item.input.hash, body),
    prepare: () => service.prepare(chain, item.input.hash, body),
    duringCall: (callback: () => Promise<void>) => {
      duringCall = callback;
    },
    advance: (ms: number) => {
      now += ms;
    },
    fetches: () => fetches,
    failPolicy: (error: Error) => {
      policyFailure = error;
    }
  };
}

test("unified preparation simulates native, WETH and offer settlement with one authorization fetch", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const [side, weth] of [
      ["listing", false],
      ["listing", true],
      ["offer", false]
    ] as const) {
      const item = await setup(chain, side, weth);
      const result = await item.prepare();
      assert.equal(result.purpose, "prepare");
      assert.equal(result.simulated, true);
      assert.equal(item.fetches(), 1);
      assert.deepEqual(item.calls, ["validate", "settle"]);
      assert.ok(BigInt(result.expiresAt) - fixtureTimestamp >= 20n);
    }
  }
});

test("unified preparation reports prerequisites without attempting settlement", async () => {
  for (const mode of ["funding", "currency", "nft"] as const) {
    const item = await setup(
      "ethereum",
      mode === "nft" ? "offer" : "listing",
      mode === "currency"
    );
    if (mode === "funding") item.actorState.balance = 0n;
    if (mode === "currency") item.actorState.allowance = 0n;
    if (mode === "nft") item.actorState.approved = false;
    assert.equal((await item.prepare()).simulated, false);
    assert.equal(item.fetches(), 1);
    assert.deepEqual(item.calls, ["validate"]);
    item.actorState.balance = 10n ** 18n;
    item.actorState.allowance = 10n ** 18n;
    item.actorState.approved = true;
    assert.equal((await item.prepare()).simulated, true);
    assert.equal(item.fetches(), 2);
  }
});

test("unified preparation never disguises invalid settlement or a nearly expired quote as a prerequisite", async () => {
  const invalid = await setup();
  invalid.actorState.settlement = false;
  await assert.rejects(invalid.prepare(), {
    code: "fulfillment_simulation_failed"
  });
  const slow = await setup("base", "offer");
  slow.duringCall(async () => slow.advance(1000));
  await assert.rejects(slow.prepare(), { code: "trade_preparation_too_slow" });
});

test("provider policy quota deferral remains a classified fulfillment error", async () => {
  const item = await setup();
  item.failPolicy(new OpenSeaError("provider_busy"));
  await assert.rejects(item.preflight(), { code: "provider_busy" });
  assert.equal(item.fetches(), 0);
});

test("durable enrichment retains all-chain listing and offer maker signatures without settlement or admission", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      const item = await setup(chain, side);
      assert.equal(
        await enqueueMissingOpenSeaSignatures(
          db.runtime,
          chain,
          new Date(fixtureNow),
          item.input.hash
        ),
        1
      );
      assert.equal(
        await enqueueMissingOpenSeaSignatures(
          db.runtime,
          chain,
          new Date(fixtureNow),
          item.input.hash
        ),
        0
      );
      const result = await enrichNextOpenSeaSignature({
        pool: db.runtime,
        chain,
        listingActor: buyer.address,
        service: item.service
      });
      assert.equal(result.status, "retained");
      assert.equal(item.fetches(), 1);
      assert.equal(item.calls.includes("settle"), false);
      assert.equal(
        await enqueueMissingOpenSeaSignatures(
          db.runtime,
          chain,
          new Date(fixtureNow),
          item.input.hash
        ),
        0
      );
      const job = (
        await db.owner.query(
          "SELECT state,payload FROM yunipals_market.job WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
          [item.input.hash]
        )
      ).rows[0];
      assert.equal(job.state, "completed");
      assert.equal(
        JSON.stringify(job.payload).includes(item.signature.slice(2)),
        false
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
    }
  }
});

test("enrichment wakes stale missing-signature projections after a budget pause", async () => {
  const item = await setup("base", "listing", false, workerPool);
  const leaseToken = randomUUID();
  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovered_state
    SET observed_at=$2,next_reconcile_at=clock_timestamp()+interval '6 hours',
      lease_token=$3,lease_until=clock_timestamp()+interval '5 minutes'
    WHERE order_hash=$1`,
    [item.input.hash, new Date(fixtureNow - 61000), leaseToken]
  );
  assert.equal(
    await enqueueMissingOpenSeaSignatures(
      workerPool,
      "base",
      new Date(fixtureNow),
      item.input.hash
    ),
    0
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT next_reconcile_at<=clock_timestamp() AS due FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].due,
    false
  );
  await db.owner.query(
    `UPDATE yunipals_market.opensea_discovered_state
    SET lease_token=NULL,lease_until=NULL WHERE order_hash=$1`,
    [item.input.hash]
  );
  assert.equal(
    await enqueueMissingOpenSeaSignatures(
      workerPool,
      "base",
      new Date(fixtureNow),
      item.input.hash
    ),
    0
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT next_reconcile_at<=clock_timestamp() AS due FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].due,
    true
  );
  await item.reconcile();
  assert.equal(
    await enqueueMissingOpenSeaSignatures(
      workerPool,
      "base",
      new Date(fixtureNow),
      item.input.hash
    ),
    1
  );
  assert.equal(
    (
      await enrichNextOpenSeaSignature({
        pool: workerPool,
        chain: "base",
        listingActor: buyer.address,
        service: item.service
      })
    ).status,
    "retained"
  );
});

test("enrichment recovers a signature committed before lost job completion without fetching again", async () => {
  const item = await setup("base");
  await enqueueMissingOpenSeaSignatures(
    db.runtime,
    "base",
    new Date(fixtureNow),
    item.input.hash
  );
  const interrupted = await enrichNextOpenSeaSignature({
    pool: db.runtime,
    chain: "base",
    listingActor: buyer.address,
    service: {
      async preflight(...args) {
        const result = await item.service.preflight(...args);
        await db.owner.query(
          "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
          [item.input.hash]
        );
        return result;
      }
    }
  });
  assert.equal(interrupted.status, "lease-lost");
  const recovered = await enrichNextOpenSeaSignature({
    pool: db.runtime,
    chain: "base",
    listingActor: buyer.address,
    service: item.service
  });
  assert.equal(recovered.status, "already-retained");
  assert.equal(item.fetches(), 1);
});

test("budget deferral preserves enrichment attempts and invalid signatures are never retained", async () => {
  const item = await setup("polygon");
  await enqueueMissingOpenSeaSignatures(
    db.runtime,
    "polygon",
    new Date(fixtureNow),
    item.input.hash
  );
  const busy = await enrichNextOpenSeaSignature({
    pool: db.runtime,
    chain: "polygon",
    listingActor: buyer.address,
    service: {
      async preflight() {
        throw new OpenSeaOrderError("provider_busy", 503);
      }
    }
  });
  assert.equal(busy.status, "deferred");
  const job = (
    await db.owner.query(
      "SELECT state,attempts,available_at FROM yunipals_market.job WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
      [item.input.hash]
    )
  ).rows[0];
  assert.equal(job.state, "pending");
  assert.equal(job.attempts, 0);
  assert.ok(job.available_at.getTime() > Date.now());
  const makeDue = () =>
    db.owner.query(
      "UPDATE yunipals_market.job SET available_at=clock_timestamp() WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
      [item.input.hash]
    );
  await makeDue();
  item.actorState.signature = false;
  const invalid = await enrichNextOpenSeaSignature({
    pool: db.runtime,
    chain: "polygon",
    listingActor: buyer.address,
    service: item.service
  });
  assert.equal(invalid.status, "retry-scheduled");
  assert.equal(invalid.code, "invalid_maker_signature");
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS n FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].n,
    0
  );
  item.actorState.signature = true;
  await makeDue();
  assert.equal(
    (
      await enrichNextOpenSeaSignature({
        pool: db.runtime,
        chain: "polygon",
        listingActor: buyer.address,
        service: item.service
      })
    ).status,
    "retained"
  );
});

test("enrichment reports an exhausted job as failed and retains it for inspection", async () => {
  const item = await setup("ethereum");
  await enqueueMissingOpenSeaSignatures(
    db.runtime,
    "ethereum",
    new Date(fixtureNow),
    item.input.hash
  );
  await db.owner.query(
    "UPDATE yunipals_market.job SET max_attempts=1 WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
    [item.input.hash]
  );
  item.actorState.signature = false;
  const result = await enrichNextOpenSeaSignature({
    pool: db.runtime,
    chain: "ethereum",
    listingActor: buyer.address,
    service: item.service
  });
  assert.equal(result.status, "failed");
  const job = (
    await db.owner.query(
      "SELECT state,attempts,last_error_code FROM yunipals_market.job WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=$1",
      [item.input.hash]
    )
  ).rows[0];
  assert.deepEqual(job, {
    state: "failed",
    attempts: 1,
    last_error_code: "invalid_maker_signature"
  });
  assert.equal(
    await enqueueMissingOpenSeaSignatures(
      db.runtime,
      "ethereum",
      new Date(fixtureNow),
      item.input.hash
    ),
    0
  );
});

test("discovered native listings receive actor-bound preflight and fresh simulated quotes on all OpenSea chains", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await setup(chain);
    const preflight = await item.preflight();
    assert.equal(preflight.purpose, "preflight");
    assert.equal(preflight.simulated, false);
    assert.deepEqual(item.calls, ["validate"]);
    const quote = await item.quote();
    assert.equal(quote.purpose, "fulfillment");
    assert.equal(quote.simulated, true);
    assert.notEqual(quote.id, preflight.id);
    assert.equal(item.fetches(), 2);
    assert.deepEqual(item.calls, ["validate", "validate", "settle"]);
  }
});

test("offer preflight survives missing actor NFT and fee approvals; settlement requires both and accepts fees funded by proceeds", async () => {
  const item = await setup("base", "offer");
  item.actorState.approved = false;
  item.actorState.allowance = 0n;
  item.actorState.balance = 0n;
  assert.equal(
    (await item.preflight()).expiresAt,
    String(fixtureTimestamp + 20n)
  );
  await assert.rejects(item.quote(), { code: "nft_approval_required" });
  item.actorState.approved = true;
  await assert.rejects(item.quote(), { code: "currency_approval_required" });
  item.actorState.allowance = 10n ** 18n;
  assert.equal((await item.quote()).simulated, true);
});

test("invalid maker signature, insufficient native funding and settlement failure cannot return executable quotes", async () => {
  const item = await setup();
  item.actorState.signature = false;
  await assert.rejects(item.preflight(), { code: "invalid_maker_signature" });
  item.actorState.signature = true;
  item.actorState.balance = 0n;
  await item.preflight();
  await assert.rejects(item.quote(), { code: "buyer_funding_required" });
  item.actorState.balance = 10n ** 18n;
  item.actorState.settlement = false;
  await assert.rejects(item.quote(), { code: "fulfillment_simulation_failed" });
});

test("provider transaction redirection and expired or misbound zone authorization fail before simulation", async () => {
  const item = await setup("polygon", "offer");
  const transaction = item.fulfillment.fulfillment_data.transaction;
  transaction.input_data.recipient = buyer.address;
  await assert.rejects(item.quote(), { code: "provider_fulfillment_mismatch" });
  transaction.input_data.recipient = item.actor;
  transaction.input_data.advancedOrder.extraData = `0x00${buyer.address.slice(2)}${(fixtureTimestamp + 20n).toString(16).padStart(16, "0")}${"11".repeat(64)}`;
  await assert.rejects(item.quote(), {
    code: "provider_authorization_mismatch"
  });
  assert.equal(item.calls.length, 0);
});

test("source updates during settlement, lifecycle changes, stale heads and unreconciled discovery invalidate quotes", async () => {
  for (const change of ["source", "lifecycle", "head", "binding"] as const) {
    const item = await setup();
    item.duringCall(async () => {
      if (change === "source")
        await db.owner.query(
          "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE order_hash=$1",
          [item.input.hash]
        );
      if (change === "lifecycle")
        await db.owner.query(
          "UPDATE yunipals_read_v4.token SET lifecycle=2 WHERE collection=$1 AND token_id=$2",
          [item.input.asset.chain, item.input.asset.tokenId]
        );
      if (change === "head") item.advance(11000);
      if (change === "binding")
        await db.owner.query(
          "DELETE FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
          [item.input.hash]
        );
    });
    await assert.rejects(item.quote());
    assert.ok(
      item.calls.includes("settle"),
      "The mutation must occur during settlement simulation."
    );
  }
});

test("self-trades, wrong lifecycle, extra fields and missing orders are rejected before calling the provider", async () => {
  const item = await setup();
  for (const body of [
    { actor: seller.address, lifecycle: 1 },
    { actor: item.actor, lifecycle: 2 },
    { actor: item.actor, lifecycle: 1, price: "0" },
    { actor: zeroAddress, lifecycle: 1 }
  ])
    await assert.rejects(
      item.service.preflight("ethereum", item.input.hash, body)
    );
  assert.equal(item.fetches(), 0);
});

test("WETH listings require exact actor funding and allowance on all three chains", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await setup(chain, "listing", true);
    item.actorState.balance = 0n;
    item.actorState.allowance = 0n;
    await item.preflight();
    await assert.rejects(item.quote(), { code: "buyer_funding_required" });
    item.actorState.balance = 10n ** 18n;
    await assert.rejects(item.quote(), { code: "currency_approval_required" });
    item.actorState.allowance = 10n ** 18n;
    assert.equal((await item.quote()).simulated, true);
  }
});

test("freshness, unavailable discovery and missing lifecycle binding reject before provider requests", async () => {
  for (const change of ["age", "unavailable", "binding"] as const) {
    const item = await setup();
    if (change === "age") item.advance(301000);
    if (change === "unavailable")
      await db.owner.query(
        "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE order_hash=$1",
        [item.input.hash]
      );
    if (change === "binding")
      await db.owner.query(
        "DELETE FROM yunipals_market.opensea_discovered_state WHERE order_hash=$1",
        [item.input.hash]
      );
    await assert.rejects(item.preflight(), {
      code:
        change === "age"
          ? "provider_observation_stale"
          : change === "unavailable"
            ? "provider_order_unavailable"
            : "discovery_not_reconciled"
    });
    assert.equal(item.fetches(), 0);
  }
});

test("identical refresh during simulation preserves the quote but stale or future fetch evidence rejects it", async () => {
  for (const mode of ["refresh", "stale", "future"] as const) {
    const item = await setup();
    item.duringCall(async () => {
      await db.owner.query(
        "UPDATE yunipals_market.opensea_discovered_order SET last_seen_at=$2,last_seen_run_id=$3 WHERE order_hash=$1",
        [
          item.input.hash,
          new Date(
            fixtureNow +
              (mode === "refresh" ? 1 : mode === "stale" ? -300001 : 30001)
          ),
          randomUUID()
        ]
      );
    });
    if (mode === "refresh") assert.equal((await item.quote()).simulated, true);
    else
      await assert.rejects(item.quote(), {
        code: "provider_observation_stale"
      });
  }
});

test("provider disappearance and return during simulation fence the response", async () => {
  const item = await setup();
  item.duringCall(async () => {
    await providerPresenceRoundTrip(item.input.hash);
  });
  await assert.rejects(item.quote(), {
    code: "order_changed_during_fulfillment"
  });
  assert.ok(item.calls.includes("settle"));
});

test("uncertain retained publication cannot be bypassed through a reconciled discovered copy", async () => {
  const item = await setup();
  const policies: Pick<OpenSeaPolicyResolver, "resolve"> = {
    async resolve() {
      return { policy: item.policy } as Awaited<
        ReturnType<OpenSeaPolicyResolver["resolve"]>
      >;
    }
  };
  const admission = new OpenSeaAdmissionService(
    db.runtime,
    { ethereum: item.client },
    policies,
    item.options
  );
  const prepared = await admission.prepare(item.draft);
  await admission.submit({ ...item.request, preparationId: prepared.id });
  await assert.rejects(item.preflight(), { code: "order_not_accepted" });
  assert.equal(item.fetches(), 0);
});

test("verified fulfillment signatures survive unsigned collector refresh and enable independent reconciliation without another provider request", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const item = await setup(chain);
    await item.preflight();
    const proof = (
      await db.owner.query(
        "SELECT * FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0];
    assert.equal(proof.signature, item.signature);
    assert.equal(proof.validation_actor, item.actor.toLowerCase());
    assert.equal(proof.source, "fulfillment");
    assert.equal(proof.block_number, "121");
    assert.equal(proof.lifecycle, 1);
    assert.equal(proof.mint_hash, item.indexed.mint.transactionHash);
    assert.equal(JSON.stringify(proof).includes("extraData"), false);
    await db.owner.query(
      "UPDATE yunipals_market.opensea_discovered_order SET signature=NULL,last_seen_at=last_seen_at+interval '1 microsecond' WHERE order_hash=$1",
      [item.input.hash]
    );
    const result = await item.reconcile();
    assert.equal(result.state, "eligible");
    assert.equal(item.fetches(), 1);
    assert.equal(item.state.validated, false);
    assert.equal(
      (
        await db.owner.query(
          "SELECT signature FROM yunipals_market.opensea_discovered_order WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].signature,
      null
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
  }
});

test("signature retention never caches protected authorization or bypasses later maker approval checks", async () => {
  const item = await setup("base", "offer");
  await item.preflight();
  const result = await item.reconcile();
  assert.equal(result.state, "authorization-required");
  assert.equal(result.reason, "provider_authorization_required");
  await item.preflight();
  item.state.allowance = 0n;
  assert.equal((await item.reconcile()).reason, "offer_funding_required");
  assert.equal(item.fetches(), 2);
});

test("rejected signatures and changed source observations never populate the signature store", async () => {
  for (const mode of ["signature", "source"] as const) {
    const item = await setup();
    if (mode === "signature") item.actorState.signature = false;
    else
      item.duringCall(async () => {
        await db.owner.query(
          "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE order_hash=$1",
          [item.input.hash]
        );
      });
    await assert.rejects(item.quote());
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS n FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].n,
      0
    );
  }
});

test("signature persistence fences a collector change after fulfillment inspection and stores no proof", async () => {
  const item = await setup();
  const candidate = await loadOpenSeaFulfillmentCandidate(
    db.runtime,
    "ethereum",
    item.input.hash
  );
  await providerPresenceRoundTrip(item.input.hash);
  await assert.rejects(
    retainOpenSeaMakerSignature(
      db.runtime,
      candidate,
      item.actor,
      item.signature,
      {
        chainId: 1,
        number: 121n,
        hash: item.state.headHash,
        timestamp: fixtureTimestamp,
        checkedAt: fixtureNow
      }
    ),
    { code: "order_changed_during_fulfillment" }
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS n FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0].n,
    0
  );
});

test("persisted signature bytes are reverified rather than trusted as a permanent eligibility certificate", async () => {
  const item = await setup();
  await item.preflight();
  await db.owner.query(
    "UPDATE yunipals_market.opensea_maker_signature SET signature='0x1234' WHERE order_hash=$1",
    [item.input.hash]
  );
  const result = await item.reconcile();
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "invalid_maker_signature");
  assert.equal(item.fetches(), 1);
});

test("maker proof retention works without source, job or projection-state write privileges", async () => {
  const item = await setup();
  const role = `market_test_signature_${process.pid}`;
  await db.owner.query(
    `CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD 'local-signature-test-only'`
  );
  const url = new URL(testUrl("MARKET_TEST_DATABASE_URL"));
  url.username = role;
  url.password = "local-signature-test-only";
  const restricted = new pg.Pool({
    connectionString: url.href,
    max: 2,
    statement_timeout: 3000
  });
  try {
    await db.owner.query(
      (
        await readFile(
          new URL(
            "../../scripts/grant-opensea-maker-signature.sql",
            import.meta.url
          ),
          "utf8"
        )
      ).replaceAll(':"market_signature_role"', `"${role}"`)
    );
    const candidate = await loadOpenSeaFulfillmentCandidate(
      db.runtime,
      "ethereum",
      item.input.hash
    );
    await retainOpenSeaMakerSignature(
      restricted,
      candidate,
      item.actor,
      item.signature,
      {
        chainId: 1,
        number: 121n,
        hash: item.state.headHash,
        timestamp: fixtureTimestamp,
        checkedAt: fixtureNow
      }
    );
    assert.equal(
      (
        await restricted.query(
          "SELECT signature FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
          [item.input.hash]
        )
      ).rows[0].signature,
      item.signature
    );
    for (const sql of [
      "UPDATE yunipals_market.opensea_discovered_order SET present=false WHERE false",
      "UPDATE yunipals_market.opensea_discovered_state SET state='eligible' WHERE false",
      "UPDATE yunipals_market.opensea_discovered_state SET provider_seen_at=clock_timestamp() WHERE false",
      "UPDATE yunipals_market.orders SET updated_at=clock_timestamp() WHERE false",
      "UPDATE yunipals_market.job SET state='completed' WHERE false"
    ])
      await assert.rejects(restricted.query(sql), { code: "42501" });
  } finally {
    await restricted.end();
    await db.owner.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
  }
});

test("collector changes during signature commit preserve historical proof but invalidate the response and visible price", async () => {
  const item = await setup();
  const candidate = await loadOpenSeaFulfillmentCandidate(
    db.runtime,
    "ethereum",
    item.input.hash
  );
  const lock = await db.owner.connect();
  await lock.query("SELECT pg_advisory_lock(178858,99124)");
  await db.owner
    .query(`CREATE FUNCTION yunipals_market.test_signature_commit_wait() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(178858,99124); RETURN NEW; END $$;
    CREATE TRIGGER test_signature_commit_wait BEFORE INSERT ON yunipals_market.opensea_maker_signature
    FOR EACH ROW EXECUTE FUNCTION yunipals_market.test_signature_commit_wait()`);
  let running: Promise<unknown> | undefined;
  try {
    running = item.preflight();
    void running.catch(() => {});
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      waiting = (
        await db.owner.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=178858 AND objid=99124 AND NOT granted) AS waiting"
        )
      ).rows[0].waiting;
      if (!waiting) await delay(10);
    }
    assert.equal(
      waiting,
      true,
      "Proof insertion must be paused after its source read"
    );
    await providerPresenceRoundTrip(item.input.hash);
    await lock.query("SELECT pg_advisory_unlock(178858,99124)");
    await assert.rejects(running, { code: "order_changed_during_fulfillment" });
    const proof = (
      await db.owner.query(
        "SELECT signature,provider_seen_at::text AS version FROM yunipals_market.opensea_maker_signature WHERE order_hash=$1",
        [item.input.hash]
      )
    ).rows[0];
    assert.equal(proof.signature, item.signature);
    assert.equal(proof.version, candidate.providerVersion);
    const visible = (
      await db.owner.query(
        `SELECT o.state,o.state_reason FROM ${marketOrderRowsSql} o WHERE order_hash=$2`,
        [new Date(fixtureNow), item.input.hash]
      )
    ).rows[0];
    assert.deepEqual(visible, {
      state: "unavailable",
      state_reason: "discovery_projection_stale"
    });
    assert.equal(
      (await item.reconcile()).state,
      "eligible",
      "Only a new independent chain/provider observation can restore eligibility"
    );
  } finally {
    await lock.query("SELECT pg_advisory_unlock(178858,99124)");
    await running?.catch(() => {});
    lock.release();
    await db.owner.query(
      "DROP TRIGGER test_signature_commit_wait ON yunipals_market.opensea_maker_signature; DROP FUNCTION yunipals_market.test_signature_commit_wait()"
    );
  }
});

test("signature queue RLS isolates unrelated jobs and startup rejects weakened permissions", async () => {
  await assertOpenSeaSignatureWorkerReady(workerPool, "staging");
  await assert.rejects(
    assertOpenSeaSignatureWorkerReady(db.runtime, "staging")
  );
  const unrelatedKind = `test_other_${process.pid}`;
  const key = randomUUID();
  const unrelated = await enqueueJob(db.runtime, {
    kind: unrelatedKind,
    key,
    payload: { chainId: 1 }
  });
  const own = await enqueueJob(workerPool, {
    kind: "opensea_signature_enrichment",
    key,
    payload: { chainId: 1 }
  });
  try {
    assert.equal(
      (
        await workerPool.query(
          "SELECT 1 FROM yunipals_market.job WHERE id=$1",
          [unrelated]
        )
      ).rowCount,
      0
    );
    assert.equal(
      (
        await workerPool.query(
          "UPDATE yunipals_market.job SET payload='{}' WHERE id=$1",
          [unrelated]
        )
      ).rowCount,
      0
    );
    assert.equal(await claimJob(workerPool, unrelatedKind), null);
    const otherJob = await claimJob(db.runtime, unrelatedKind);
    assert.ok(
      otherJob,
      "Existing runtime keeps access to its jobs after RLS is enabled"
    );
    await assert.rejects(
      completeJob(workerPool, otherJob, async () => undefined),
      LostJobLeaseError
    );
    assert.equal(
      await retryJob(workerPool, otherJob, "test_failure", 1000),
      false
    );
    await completeJob(db.runtime, otherJob, async () => undefined);
    await assert.rejects(
      enqueueJob(workerPool, { kind: unrelatedKind, key, payload: {} }),
      { code: "42501" }
    );
    await assert.rejects(
      workerPool.query("UPDATE yunipals_market.job SET kind=$1 WHERE id=$2", [
        unrelatedKind,
        own
      ]),
      { code: "42501" }
    );
    await assert.rejects(
      workerPool.query("DELETE FROM yunipals_market.job WHERE id=$1", [own]),
      { code: "42501" }
    );
    await db.owner.query(
      `GRANT UPDATE(present) ON yunipals_market.opensea_discovered_order TO ${workerRole}`
    );
    await assert.rejects(
      assertOpenSeaSignatureWorkerReady(workerPool, "staging")
    );
    await db.owner.query(
      `REVOKE UPDATE(present) ON yunipals_market.opensea_discovered_order FROM ${workerRole}`
    );
    await db.owner.query(
      "ALTER POLICY job_signature_scope ON yunipals_market.job USING (true) WITH CHECK (true)"
    );
    await assert.rejects(
      assertOpenSeaSignatureWorkerReady(workerPool, "staging")
    );
    await db.owner.query(
      "ALTER POLICY job_signature_scope ON yunipals_market.job USING (kind='opensea_signature_enrichment') WITH CHECK (kind='opensea_signature_enrichment')"
    );
    await assertOpenSeaSignatureWorkerReady(workerPool, "staging");
  } finally {
    await db.owner.query(
      `REVOKE UPDATE(present) ON yunipals_market.opensea_discovered_order FROM ${workerRole}`
    );
    await db.owner.query(
      "ALTER POLICY job_signature_scope ON yunipals_market.job USING (kind='opensea_signature_enrichment') WITH CHECK (kind='opensea_signature_enrichment')"
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.job WHERE id=ANY($1::uuid[])",
      [[unrelated, own]]
    );
  }
});

test("restricted fleet rotates real jobs across restart and holds a budget-deferred chain", async () => {
  await db.owner.query(
    "UPDATE yunipals_market.opensea_discovered_state SET state='unavailable' WHERE order_hash=ANY($1::text[])",
    [hashes]
  );
  await db.owner.query(
    "UPDATE yunipals_market.job SET state='failed',lease_token=NULL,lease_until=NULL WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=ANY($1::text[])",
    [hashes]
  );
  const items = {
    ethereum: await setup("ethereum", "listing", false, workerPool),
    base: await setup("base", "listing", false, workerPool),
    polygon: await setup("polygon", "listing", false, workerPool)
  };
  const directory = await mkdtemp(join(tmpdir(), "yunipals-fleet-"));
  const visited: OpenSeaChain[] = [];
  try {
    for (const expected of ["ethereum", "base", "base", "polygon"] as const) {
      const abort = new AbortController();
      const defer = visited.length === 1;
      const report = await runOpenSeaSignatureFleet({
        pool: workerPool,
        directory,
        listingActor: buyer.address,
        signal: abort.signal,
        now: () => fixtureNow,
        service: {
          async preflight(chain, hash, input) {
            visited.push(chain);
            assert.equal(chain, expected);
            if (defer) {
              abort.abort();
              throw new OpenSeaOrderError("provider_busy", 503);
            }
            const result = await items[chain].service.preflight(
              chain,
              hash,
              input
            );
            abort.abort();
            return result;
          }
        }
      });
      assert.equal(
        report.chains[expected]!.outcomes[defer ? "deferred" : "retained"],
        1
      );
      if (defer) {
        const stored = await SignatureSchedule.load(directory);
        assert.equal(stored.next, "base");
        assert.ok(stored.notBefore > Date.now());
        const timeout = AbortSignal.timeout(25);
        const waiting = await runOpenSeaSignatureFleet({
          pool: workerPool,
          directory,
          listingActor: buyer.address,
          signal: timeout,
          service: {
            preflight: async () =>
              assert.fail("Budget wait must survive restart")
          }
        });
        assert.equal(
          Object.values(waiting.chains).reduce((n, c) => n + c.processed, 0),
          0
        );
        const job = (
          await workerPool.query(
            "SELECT attempts,state FROM yunipals_market.job WHERE payload->>'orderHash'=$1",
            [items.base.input.hash]
          )
        ).rows[0];
        assert.deepEqual(job, { attempts: 0, state: "pending" });
        // Advance only the test clock boundaries, without changing job identity.
        await writeFile(
          join(directory, "schedule.json"),
          JSON.stringify({ version: 1, next: "base", notBefore: 0 })
        );
        await db.owner.query(
          "UPDATE yunipals_market.job SET available_at=clock_timestamp() WHERE payload->>'orderHash'=$1",
          [items.base.input.hash]
        );
      }
    }
    assert.deepEqual(visited, ["ethereum", "base", "base", "polygon"]);
    assert.equal((await SignatureSchedule.load(directory)).next, "ethereum");
    for (const item of Object.values(items)) assert.equal(item.fetches(), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restricted recurring signature runtime completes listing and offer jobs on all chains and drains on shutdown", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      // Prior fixtures must not compete with this test's bounded recurring run.
      await db.owner.query(
        "UPDATE yunipals_market.opensea_discovered_state SET state='unavailable' WHERE order_hash=ANY($1::text[])",
        [hashes]
      );
      await db.owner.query(
        "UPDATE yunipals_market.job SET state='failed',lease_token=NULL,lease_until=NULL WHERE kind='opensea_signature_enrichment' AND payload->>'orderHash'=ANY($1::text[])",
        [hashes]
      );
      const item = await setup(chain, side, false, workerPool);
      const abort = new AbortController();
      const report = await runOpenSeaSignatureWorker({
        pool: workerPool,
        chain,
        listingActor: buyer.address,
        signal: abort.signal,
        now: () => fixtureNow,
        service: {
          async preflight(...args) {
            const result = await item.service.preflight(...args);
            abort.abort();
            return result;
          }
        }
      });
      assert.equal(report.enqueued, 1);
      assert.equal(report.processed, 1);
      assert.equal(report.outcomes.retained, 1);
      assert.equal(item.fetches(), 1);
      assert.deepEqual(item.calls, ["validate"]);
      const job = (
        await workerPool.query(
          "SELECT state,lease_token FROM yunipals_market.job WHERE payload->>'orderHash'=$1",
          [item.input.hash]
        )
      ).rows[0];
      assert.deepEqual(job, { state: "completed", lease_token: null });
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
            [item.input.hash]
          )
        ).rows[0].n,
        0
      );
    }
  }
  const abort = new AbortController();
  abort.abort();
  const stopped = await runOpenSeaSignatureWorker({
    pool: workerPool,
    chain: "base",
    listingActor: buyer.address,
    service: {
      preflight: async () => {
        throw new Error("Must not dispatch");
      }
    },
    signal: abort.signal
  });
  assert.equal(stopped.enqueued + stopped.processed, 0);
});

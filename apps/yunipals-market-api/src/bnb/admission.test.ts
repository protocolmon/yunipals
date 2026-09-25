import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BnbFulfillmentService } from "@/bnb/fulfillment";
import { BnbAdmissionService } from "@/bnb/admission";
import { inspectBnbAdmission } from "@/bnb/chain";
import { zeroAddress } from "viem";
import { BnbRecoveryService } from "@/bnb/recovery";
import { createApp } from "@/app";
import { readEnvironment } from "@/environment";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { readIndexedBnbAsset } from "@/bnb/indexer";
import { BnbOrderError } from "@/bnb/orders";
import { now, policy, seller, buyer } from "@/bnb/fixtures/admission";
import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";

const { owner, runtime, initialize, close, setup, nextTokenId } =
  createBnbTestDatabase();
before(initialize);
after(close);

test("empty-signature BNB orders require Seaport validation at the inspected block", async () => {
  const item = await setup();
  const input = { ...item.input, signature: "0x" as const };
  const options = {
    confirmations: 20n,
    indexerMaxAgeMs: 720000,
    now: () => now
  };
  await assert.rejects(
    inspectBnbAdmission(item.client, input, item.summary, item.indexed, options),
    /order_not_validated/
  );
  item.state.validated = true;
  await assert.doesNotReject(
    inspectBnbAdmission(item.client, input, item.summary, item.indexed, options)
  );
});

test("preparation leaves room for a fresh chain clock behind database time within the client signing window", async () => {
  const item = await setup();
  item.state.blockTimestamp -= 30n;
  const draft = {
    ...item.draft,
    order: {
      ...item.draft.order,
      startTime: (item.state.blockTimestamp - 1n).toString()
    }
  };
  item.state.contractHash = seaportOrderHash(decodeSeaportOrder(draft.order));
  const prepared = await item.service.prepare(draft);
  assert.ok(BigInt(prepared.expiresAt) > item.state.blockTimestamp);
  assert.ok(
    BigInt(prepared.expiresAt) <= item.state.blockTimestamp + 120n,
    "Valid preparations must fit the browser's chain-based 120-second maximum"
  );
});

test("owner authorization gates preparation and fulfillment before executable work", async () => {
  const item = await setup();
  let admissionChecks = 0;
  const guardedAdmission = new BnbAdmissionService(
    runtime,
    item.client,
    policy,
    {
      confirmations: 20n,
      indexerMaxAgeMs: 720000,
      now: () => now,
      authorize(input, summary) {
        admissionChecks++;
        assert.equal(input.hash, item.input.hash);
        assert.equal(summary.maker, seller.address);
        throw new BnbOrderError("owner_trade_not_authorized", 503);
      }
    }
  );
  await assert.rejects(guardedAdmission.prepare(item.draft), {
    code: "owner_trade_not_authorized"
  });
  assert.equal(admissionChecks, 1);
  assert.equal(
    (
      await owner.query(
        "SELECT id FROM yunipals_market.preparation WHERE chain_id=56 AND order_hash=$1",
        [item.input.hash]
      )
    ).rowCount,
    0
  );

  const prepared = await item.service.prepare(item.draft);
  await item.service.submit({ ...item.request, preparationId: prepared.id });
  const simulations = item.state.simulations.length;
  const guardedFulfillment = new BnbFulfillmentService(
    runtime,
    item.client,
    policy,
    {
      confirmations: 20n,
      indexerMaxAgeMs: 720000,
      now: () => now,
      authorize(input, summary, actor) {
        assert.equal(input.hash, item.input.hash);
        assert.equal(summary.side, "listing");
        assert.equal(actor, buyer.address);
        throw new BnbOrderError("owner_trade_not_authorized", 503);
      }
    }
  );
  await assert.rejects(
    guardedFulfillment.quote(item.input.hash, {
      actor: buyer.address,
      lifecycle: 0
    }),
    { code: "owner_trade_not_authorized" }
  );
  assert.equal(item.state.simulations.length, simulations);
});

test("real signatures and exact components commit with their reconciliation job using the restricted role", async () => {
  for (const side of ["listing", "offer"] as const) {
    const item = await setup(side);
    const prepared = await item.service.prepare(item.draft);
    const published = await item.service.submit({
      ...item.request,
      preparationId: prepared.id
    });
    assert.equal(published.persisted, true);
    assert.equal(published.order.side, side);
    const rows = await owner.query(
      `SELECT signature,components,publication_state FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1`,
      [item.input.hash.toLowerCase()]
    );
    assert.equal(rows.rows[0].signature, item.request.signature);
    assert.deepEqual(rows.rows[0].components, item.request.order);
    assert.equal(rows.rows[0].publication_state, "accepted");
    assert.equal(
      (
        await owner.query(
          "SELECT id FROM yunipals_market.job WHERE kind='bnb_order_reconcile' AND deduplication_key=$1",
          [item.input.hash.toLowerCase()]
        )
      ).rowCount,
      1
    );
  }
});

test("concurrent retries acknowledge one accepted order and one durable job", async () => {
  const item = await setup();
  const preparations = await Promise.all(
    Array.from({ length: 4 }, () => item.service.prepare(item.draft))
  );
  assert.equal(new Set(preparations.map((value) => value.id)).size, 1);
  const prepared = preparations[0]!;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      item.service.submit({ ...item.request, preparationId: prepared.id })
    )
  );
  assert.ok(
    results.every(
      (result) => result.persisted && result.order.orderHash === item.input.hash
    )
  );
  assert.equal(
    (
      await owner.query(
        "SELECT order_hash FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1",
        [item.input.hash.toLowerCase()]
      )
    ).rowCount,
    1
  );
});

test("HTTP admission uses durable storage and paused trading retains unsigned cancellation recovery", async () => {
  const item = await setup();
  const environment = readEnvironment({
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
    MARKET_BNB_VALIDATION_RPC: "http://127.0.0.1:18647"
  });
  const recovery = new BnbRecoveryService(runtime, () => now);
  const app = createApp(environment, async () => {}, {
    recovery,
    bnbValidation: { admission: item.service, policy }
  });
  const post = (path: string, value: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  const preparedResponse = await post("/v1/market/orders/prepare", item.draft);
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  const publication = await post("/v1/market/orders", {
    ...item.request,
    preparationId: prepared.id
  });
  assert.equal(publication.status, 200);
  assert.equal((await publication.json()).persisted, true);
  const paused = createApp(
    { ...environment, bnbValidationRpc: undefined },
    async () => {},
    { recovery }
  );
  const path = `/v1/market/orders/bnb/${seaportDeployment.address}/${item.input.hash}`;
  assert.equal(
    (await paused.request("/v1/market/orders", { method: "POST" })).status,
    503
  );
  item.state.rpcFailure = true;
  await owner.query(
    "UPDATE yunipals_read_v4.token SET burned=true,lifecycle=1,owner=$1 WHERE collection='bnb' AND token_id=$2",
    [buyer.address.toLowerCase(), item.input.asset.tokenId]
  );
  const accepted = await paused.request(path);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).persisted, true);
  const cancellation = await paused.request(`${path}/cancellation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: seller.address })
  });
  assert.equal(cancellation.status, 200);
  const parameters = await cancellation.json();
  assert.deepEqual(parameters.order, item.request.order);
  assert.equal("signature" in parameters, false);
  assert.equal(
    (await paused.request(path.replace("/bnb/", "/ethereum/"))).status,
    400
  );
  const wrongMaker = await post(`${path}/cancellation`, {
    actor: buyer.address
  });
  assert.equal(wrongMaker.status, 400);
  const unknown = await paused.request(
    path.replace(item.input.hash, `0x${"ff".repeat(32)}`)
  );
  assert.equal(unknown.status, 404);
});

test("fulfillment quotes simulate exact native and WBNB settlement for the actor at the checked block", async () => {
  for (const side of ["listing", "offer"] as const) {
    const item = await setup(side);
    const prepared = await item.service.prepare(item.draft);
    await item.service.submit({ ...item.request, preparationId: prepared.id });
    const service = new BnbFulfillmentService(runtime, item.client, policy, {
      confirmations: 20n,
      indexerMaxAgeMs: 720000,
      now: () => now
    });
    const actor = side === "listing" ? buyer.address : seller.address;
    const checksBeforeQuote = item.state.canonicalChecks;
    const quote = await service.quote(item.input.hash, { actor, lifecycle: 0 });
    assert.equal(item.state.canonicalChecks - checksBeforeQuote, 1);
    assert.equal(quote.actor, actor);
    assert.deepEqual(quote.order, item.request.order);
    assert.equal(quote.signature, item.request.signature);
    assert.equal(BigInt(quote.expiresAt), BigInt(Math.floor(now / 1000)) + 60n);
    const simulation = item.state.simulations[0]!;
    assert.equal(
      simulation.functionName,
      side === "listing" ? "fulfillOrder" : "fulfillBasicOrder"
    );
    assert.equal(simulation.account, actor);
    assert.equal(simulation.value ?? 0n, side === "listing" ? 10n ** 18n : 0n);
    assert.equal(simulation.blockNumber, 121n);
    if (side === "listing") {
      item.state.nativeBalance = 0n;
      await assert.rejects(
        service.quote(item.input.hash, { actor, lifecycle: 0 }),
        /buyer_funding_required/
      );
      item.state.nativeBalance = 10n ** 18n;
    }
    const originalBlockHash = item.state.blockHash;
    item.state.simulationReorg = true;
    await assert.rejects(
      service.quote(item.input.hash, { actor, lifecycle: 0 }),
      /observation_expired/
    );
    item.state.simulationReorg = false;
    item.state.blockHash = originalBlockHash;
    item.state.simulationFails = true;
    await assert.rejects(
      service.quote(item.input.hash, { actor, lifecycle: 0 }),
      /simulation RPC failure/
    );
    item.state.simulationFails = false;
    item.state.cancelled = true;
    await assert.rejects(
      service.quote(item.input.hash, { actor, lifecycle: 0 }),
      /order_invalidated/
    );
    await assert.rejects(
      service.quote(item.input.hash, { actor, lifecycle: 1 }),
      /asset_changed/
    );
  }
});

test("offer preflight validates maker state before requesting approval and refuses an unsimulated quote", async () => {
  const item = await setup("offer");
  const prepared = await item.service.prepare(item.draft);
  await item.service.submit({ ...item.request, preparationId: prepared.id });
  const service = new BnbFulfillmentService(runtime, item.client, policy, {
    confirmations: 20n,
    indexerMaxAgeMs: 720000,
    now: () => now
  });
  item.state.approved = zeroAddress;
  const request = { actor: seller.address, lifecycle: 0 };
  assert.equal(
    (await service.preflight(item.input.hash, request)).needsNftApproval,
    true
  );
  await assert.rejects(
    service.quote(item.input.hash, request),
    /nft_approval_required/
  );
  assert.equal(item.state.simulations.length, 0);
  item.state.balance = 0n;
  await assert.rejects(
    service.preflight(item.input.hash, request),
    /offer_funding_required/
  );
  item.state.balance = 10n ** 18n;
  item.state.approved = seaportDeployment.address;
  assert.equal(
    (await service.preflight(item.input.hash, request)).needsNftApproval,
    false
  );
  assert.equal(
    (await service.quote(item.input.hash, request)).orderHash,
    item.input.hash
  );
  await assert.rejects(
    service.preflight(item.input.hash, { ...request, actor: buyer.address }),
    /self_trade_rejected/
  );
  await assert.rejects(
    service.preflight(item.input.hash, { ...request, calldata: "0x" }),
    /invalid_fulfillment_request/
  );
});

test("competing prepared prices cannot both enter the same maker/asset/side orderbook scope", async () => {
  const first = await setup();
  const second = await setup("listing", BigInt(first.input.asset.tokenId), 88n);
  const [a, b] = await Promise.all([
    first.service.prepare(first.draft),
    second.service.prepare(second.draft)
  ]);
  const results = await Promise.allSettled([
    first.service.submit({ ...first.request, preparationId: a.id }),
    second.service.submit({ ...second.request, preparationId: b.id })
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" && rejected.reason instanceof BnbOrderError
  );
  assert.equal(rejected.reason.code, "outstanding_order_requires_cancellation");
});

test("expired preparation can retry a valid signature and accepted history survives RPC failure and order expiry", async () => {
  const item = await setup();
  const prepared = await item.service.prepare(item.draft);
  await owner.query(
    `UPDATE yunipals_market.preparation SET created_at=clock_timestamp()-interval '1 hour',
    expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,
    [prepared.id]
  );
  const payload = { ...item.request, preparationId: prepared.id };
  assert.equal((await item.service.submit(payload)).persisted, true);
  await owner.query(
    "UPDATE yunipals_market.orders SET state='expired' WHERE chain_id=56 AND order_hash=$1",
    [item.input.hash.toLowerCase()]
  );
  item.state.rpcFailure = true;
  assert.equal((await item.service.submit(payload)).order.status, "expired");
  assert.equal(
    (await item.service.accepted(item.input.hash)).order.status,
    "expired"
  );
  await assert.rejects(
    item.service.submit({
      ...payload,
      asset: { ...payload.asset, tokenId: nextTokenId().toString() }
    }),
    /order_asset_mismatch/
  );
});

test("cached cancellation labels do not let an outstanding earlier price survive repricing", async () => {
  const first = await setup();
  const prepared = await first.service.prepare(first.draft);
  await first.service.submit({ ...first.request, preparationId: prepared.id });
  await owner.query(
    "UPDATE yunipals_market.orders SET state='cancelled' WHERE order_hash=$1",
    [first.input.hash.toLowerCase()]
  );
  const replacement = await setup(
    "listing",
    BigInt(first.input.asset.tokenId),
    99n
  );
  await assert.rejects(
    replacement.service.prepare(replacement.draft),
    /outstanding_order_requires_cancellation/
  );
});

test("a mismatched preparation cannot publish another signed order", async () => {
  const first = await setup();
  const second = await setup();
  const prepared = await first.service.prepare(first.draft);
  await assert.rejects(
    second.service.submit({ ...second.request, preparationId: prepared.id }),
    /preparation_mismatch/
  );
  assert.equal(
    (
      await owner.query(
        "SELECT order_hash FROM yunipals_market.orders WHERE order_hash=$1",
        [second.input.hash.toLowerCase()]
      )
    ).rowCount,
    0
  );
});

test("failure to enqueue reconciliation rolls back order admission", async () => {
  const item = await setup();
  const prepared = await item.service.prepare(item.draft);
  await owner.query(`CREATE FUNCTION yunipals_market.test_reject_job() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='bnb_order_reconcile' THEN RAISE EXCEPTION 'fixture queue failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_reject_job BEFORE INSERT ON yunipals_market.job FOR EACH ROW EXECUTE FUNCTION yunipals_market.test_reject_job()`);
  try {
    await assert.rejects(
      item.service.submit({ ...item.request, preparationId: prepared.id }),
      /fixture queue failure/
    );
    assert.equal(
      (
        await owner.query(
          "SELECT order_hash FROM yunipals_market.orders WHERE order_hash=$1",
          [item.input.hash.toLowerCase()]
        )
      ).rowCount,
      0
    );
  } finally {
    await owner.query(
      "DROP TRIGGER test_reject_job ON yunipals_market.job; DROP FUNCTION yunipals_market.test_reject_job()"
    );
  }
});

test("indexer visibility follows the ownership anchor and expires after transfer-away-and-back", async () => {
  const item = await setup();
  const id = item.input.asset.tokenId;
  await owner.query(
    `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,0,$3,$4,50,0,0)`,
    [
      `anchor-${id}`,
      id,
      buyer.address.toLowerCase(),
      seller.address.toLowerCase()
    ]
  );
  await owner.query(
    `INSERT INTO metadata.token_visibility VALUES('bnb',$1,$2,0,$3,50,0,0)`,
    [id, seller.address.toLowerCase(), `anchor-${id}`]
  );
  assert.equal(
    (await readIndexedBnbAsset(runtime, item.input.asset)).hidden,
    true
  );
  await assert.rejects(item.service.prepare(item.draft), /asset_changed/);
  await owner.query(
    `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,0,$3,$4,51,0,0),($5,'bnb',$2,0,$4,$3,52,0,0)`,
    [
      `away-${id}`,
      id,
      seller.address.toLowerCase(),
      buyer.address.toLowerCase(),
      `back-${id}`
    ]
  );
  assert.equal(
    (await readIndexedBnbAsset(runtime, item.input.asset)).hidden,
    false
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportSigningData } from "@protopals/yunipals-market-core/seaport";
import {
  BnbOrderError,
  checkBnbOrder,
  parseBnbOrderRequest
} from "@/bnb/orders";
import {
  fixture,
  code,
  now,
  timestamp,
  headHash,
  cursorHash,
  seller,
  buyer,
  policy
} from "@/bnb/fixtures/admission";

const rejectsCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof BnbOrderError);
  assert.equal(error.code, code);
  return true;
};

test("BNB native listing and WBNB offer validate real EOA signatures against pinned state", async () => {
  for (const side of ["listing", "offer"] as const) {
    const item = await fixture(side);
    assert.deepEqual(await item.inspect(), {
      number: 121n,
      hash: headHash,
      timestamp,
      checkedAt: now
    });
  }
});

test("RPC uncertainty, another chain and unexpected deployment/hash cannot admit an order", async () => {
  const item = await fixture();
  item.state.rpcFailure = true;
  await assert.rejects(item.inspect(), /fixture RPC failure/);
  item.state.rpcFailure = false;
  item.state.chainId = 1;
  await assert.rejects(item.inspect(), rejectsCode("chain_unavailable"));
  item.state.chainId = 56;
  item.state.code = "0x00";
  await assert.rejects(
    item.inspect(),
    rejectsCode("deployment_or_hash_mismatch")
  );
  item.state.code = code;
  item.state.contractHash = cursorHash;
  await assert.rejects(
    item.inspect(),
    rejectsCode("deployment_or_hash_mismatch")
  );
});

test("hidden or changed lifecycle and transfer-away-and-back wait for correct indexed state", async () => {
  const item = await fixture();
  item.indexed.hidden = true;
  await assert.rejects(item.inspect(), rejectsCode("asset_changed"));
  item.indexed.hidden = false;
  item.indexed.lifecycle++;
  await assert.rejects(item.inspect(), rejectsCode("asset_changed"));
  item.indexed.lifecycle--;
  item.state.transfers = true;
  await assert.rejects(item.inspect(), rejectsCode("asset_still_syncing"));
  item.state.transfers = false;
  item.state.owner = buyer.address;
  await assert.rejects(item.inspect(), rejectsCode("asset_still_syncing"));
});

test("stalled and noncanonical checkpoints reject signing even if ownerOf agrees", async () => {
  const item = await fixture();
  item.indexed.checkpoint.updatedAt = new Date(now - 900000);
  await assert.rejects(
    item.inspect(),
    rejectsCode("indexer_not_finalized_or_stale")
  );
  item.indexed.checkpoint.updatedAt = new Date(now);
  item.indexed.checkpoint.hash = headHash;
  await assert.rejects(
    item.inspect(),
    rejectsCode("indexer_checkpoint_invalid")
  );
});

test("cancellation, counter changes, revoked approval and offer shortfalls reject admission", async () => {
  const item = await fixture();
  item.state.cancelled = true;
  await assert.rejects(item.inspect(), rejectsCode("order_invalidated"));
  item.state.cancelled = false;
  item.state.counter = 1n;
  await assert.rejects(item.inspect(), rejectsCode("order_invalidated"));
  item.state.counter = 0n;
  item.state.approved = zeroAddress;
  await assert.rejects(item.inspect(), rejectsCode("nft_approval_required"));
  const offer = await fixture("offer");
  offer.state.balance = 0n;
  await assert.rejects(offer.inspect(), rejectsCode("offer_funding_required"));
  offer.state.balance = 10n ** 18n;
  offer.state.allowance = 0n;
  await assert.rejects(offer.inspect(), rejectsCode("offer_funding_required"));
});

test("a signature for Ethereum cannot authorize the same order on BNB", async () => {
  const item = await fixture();
  item.input.signature = await seller.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: 1,
        verifyingContract: seaportDeployment.address
      },
      item.order
    )
  );
  await assert.rejects(item.inspect(), rejectsCode("invalid_maker_signature"));
});

test("request parsing rejects foreign assets, extra policy fields and signature-less submission", async () => {
  const item = await fixture();
  for (const value of [
    { ...item.request, policyVersion: "untrusted" },
    { ...item.request, signature: undefined },
    { ...item.request, asset: { ...item.request.asset, chainId: 1 } },
    { ...item.request, lifecycle: -1 },
    { ...item.request, preparationId: "not-a-uuid" }
  ])
    assert.throws(
      () => parseBnbOrderRequest(value, true),
      rejectsCode("invalid_order_request")
    );
  const wrong = parseBnbOrderRequest(
    { ...item.request, asset: { ...item.request.asset, tokenId: "43" } },
    true
  );
  assert.throws(
    () => checkBnbOrder(wrong, policy),
    rejectsCode("order_asset_mismatch")
  );
});

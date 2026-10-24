import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { positiveAction } from "./ypal-native-reader-probe-v1.mjs";

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])])
        )
      : value;
function fixture(kind = "bnb-validate") {
  const request = {
    version: 1,
    releaseId:
      "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
    readIdentity:
      "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67",
    chainId: 56,
    transactionHash: "0x" + "ab".repeat(32),
    blockNumber: "128816538",
    blockHash: "0x" + "cd".repeat(32),
    action: {
      kind,
      orderHash: "0x" + "ef".repeat(32),
      offerer: "0x" + "12".repeat(20)
    }
  };
  return {
    request,
    value: {
      version: 1,
      state: "indexed",
      reason: "action_indexed",
      expectationHash:
        "0x" +
        createHash("sha256")
          .update(JSON.stringify(stable(request)))
          .digest("hex"),
      identity: {
        releaseId: request.releaseId,
        readIdentity: request.readIdentity,
        manifestHash:
          "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
        buildId: "71e2a7f3b7"
      },
      transaction: {
        chainId: 56,
        hash: request.transactionHash,
        blockNumber: request.blockNumber,
        blockHash: request.blockHash
      },
      coverage: { sourceId: "marketplace:bnb:seaport", policy: "latest" },
      proof: {
        kind: "canonical_event_and_full_receipt",
        receiptRequirement: "full",
        receiptPayloadHash: "0x" + "98".repeat(32),
        events: [
          {
            name: kind === "bnb-validate" ? "OrderValidated" : "OrderCancelled",
            logIndex: 9
          }
        ]
      },
      application: { state: "not_evaluated", component: "marketplace" }
    }
  };
}

test("both real BNB action kinds require canonical full receipt proof", () => {
  for (const kind of ["bnb-validate", "bnb-cancel"]) {
    const { request, value } = fixture(kind);
    assert.equal(positiveAction(value, request), true);
  }
});
test("old release, wrong transaction and absent full receipt reject", () => {
  for (const mutate of [
    (v) => (v.identity.buildId = "old-build"),
    (v) => (v.transaction.blockHash = "0x" + "00".repeat(32)),
    (v) => (v.proof.kind = "canonical_event"),
    (v) => (v.proof.receiptRequirement = "none"),
    (v) => (v.proof.receiptPayloadHash = null),
    (v) => (v.state = "pending")
  ]) {
    const { request, value } = fixture();
    mutate(value);
    assert.throws(() => positiveAction(value, request));
  }
});
test("wrong kind cannot silently choose cancellation and event bounds are exact", () => {
  for (const mutate of [
    (v, r) => (r.action.kind = "foreign-action"),
    (v) => (v.proof.events = []),
    (v) => (v.proof.events = Array(257).fill(v.proof.events[0])),
    (v) => (v.proof.events[0].logIndex = -1),
    (v) => (v.proof.events[0].name = "OrderCancelled"),
    (v) => (v.application.state = "applied")
  ]) {
    const { request, value } = fixture();
    mutate(value, request);
    assert.throws(() => positiveAction(value, request));
  }
});
test("canonical request hash is property-order independent and binds every action field", () => {
  const { request, value } = fixture();
  assert.equal(
    positiveAction(
      value,
      Object.fromEntries(Object.entries(request).reverse())
    ),
    true
  );
  request.action.orderHash = "0x" + "00".repeat(32);
  assert.throws(() => positiveAction(value, request));
});

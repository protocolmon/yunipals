import assert from "node:assert/strict";
import test from "node:test";

import {
  admissionFixture,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";
import { checkDiscoveredOpenSeaPolicy } from "@/opensea/discoveredReconciliation";
import { checkOpenSeaOrder } from "@/opensea/orders";
import { assertOpenSeaPolicyFresh } from "@/opensea/policyFreshness";

test("browse expiry is bounded and reuse never extends the original lifetime", async () => {
  const { policy } = await admissionFixture();
  policy.expiresAt = fixtureTimestamp + 300n;
  for (const elapsed of [0n, 118n, 299n])
    assert.doesNotThrow(() =>
      assertOpenSeaPolicyFresh(policy, fixtureTimestamp + elapsed, "catalog")
    );
  assert.throws(() =>
    assertOpenSeaPolicyFresh(policy, fixtureTimestamp + 300n, "catalog")
  );
  assert.throws(() =>
    assertOpenSeaPolicyFresh(policy, fixtureTimestamp - 1n, "catalog")
  );
  assert.equal(policy.expiresAt, fixtureTimestamp + 300n);
});

test("shared listing and offer validators keep transaction freshness as their default", async () => {
  for (const side of ["listing", "offer"] as const) {
    const item = await admissionFixture("ethereum", side);
    const check = (purpose?: "transaction" | "catalog") => {
      checkOpenSeaOrder(item.input, item.policy, fixtureTimestamp, purpose);
      checkDiscoveredOpenSeaPolicy(
        item.intent.summary,
        item.input.order,
        item.policy,
        fixtureTimestamp,
        purpose
      );
    };
    item.policy.expiresAt = fixtureTimestamp + 300n;
    assert.doesNotThrow(() => check("catalog"));
    assert.throws(() =>
      checkOpenSeaOrder(item.input, item.policy, fixtureTimestamp)
    );
    assert.throws(() =>
      checkDiscoveredOpenSeaPolicy(
        item.intent.summary,
        item.input.order,
        item.policy,
        fixtureTimestamp
      )
    );
    assert.throws(() => check("transaction"));
    item.policy.expiresAt = fixtureTimestamp + 120n;
    assert.doesNotThrow(() => check());
    item.policy.expiresAt = fixtureTimestamp + 121n;
    assert.throws(() => check());
  }
});

test("catalog freshness still requires signed orders to satisfy current required fees", async () => {
  for (const side of ["listing", "offer"] as const) {
    const item = await admissionFixture("ethereum", side);
    item.policy.expiresAt = fixtureTimestamp + 300n;
    item.policy.fees[0]!.basisPoints++;
    assert.throws(() =>
      checkOpenSeaOrder(item.input, item.policy, fixtureTimestamp, "catalog")
    );
    assert.throws(() =>
      checkDiscoveredOpenSeaPolicy(
        item.intent.summary,
        item.input.order,
        item.policy,
        fixtureTimestamp,
        "catalog"
      )
    );
  }
});

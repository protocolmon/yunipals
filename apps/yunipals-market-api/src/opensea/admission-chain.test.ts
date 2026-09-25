import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress } from "viem";
import { checkOpenSeaOrder, parseOpenSeaOrderRequest } from "@/opensea/orders";
import {
  admissionFixture,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";

test("OpenSea admission binds native listings and WETH offers on all three registered chains", async () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      const fixture = await admissionFixture(chain, side);
      assert.deepEqual(
        checkOpenSeaOrder(fixture.input, fixture.policy, fixtureTimestamp),
        fixture.intent.summary
      );
      const observed = await fixture.inspect();
      assert.equal(observed.chainId, fixture.input.asset.chainId);
      assert.equal(observed.number, 121n);
    }
  }
});

test("OpenSea admission rejects changed fees, zones, currencies, components and stale policy", async () => {
  const fixture = await admissionFixture();
  for (const mutate of [
    (value: typeof fixture.request) => {
      value.order.consideration[0]!.startAmount = "1";
    },
    (value: typeof fixture.request) => {
      value.order.zone = fixture.policy.offerZone;
    },
    (value: typeof fixture.request) => {
      value.order.conduitKey = `0x${"00".repeat(32)}`;
    },
    (value: typeof fixture.request) => {
      value.order.offer[0]!.identifierOrCriteria = "2";
    },
    (value: typeof fixture.request) => {
      value.policyVersion = "other";
    }
  ]) {
    const changed = structuredClone(fixture.request);
    mutate(changed);
    assert.throws(
      () =>
        checkOpenSeaOrder(
          parseOpenSeaOrderRequest(changed, true),
          fixture.policy,
          fixtureTimestamp
        ),
      /order_policy_rejected/
    );
  }
  assert.throws(
    () =>
      checkOpenSeaOrder(
        fixture.input,
        { ...fixture.policy, expiresAt: fixtureTimestamp },
        fixtureTimestamp
      ),
    /order_policy_rejected/
  );
  assert.throws(
    () => parseOpenSeaOrderRequest({ ...fixture.request, extra: true }, true),
    /invalid_order_request/
  );
  assert.throws(
    () =>
      parseOpenSeaOrderRequest(
        { ...fixture.request, preparationId: "invalid" },
        true
      ),
    /invalid_order_request/
  );
});

test("OpenSea chain admission rejects stale, conflicting or unconfirmed indexer evidence", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.indexed.hidden = true;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.indexed.burned = true;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.indexed.lifecycle++;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.indexed.lastTransfer.blockNumber = 120n;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.indexed.checkpoint.heartbeatAt -= 61000;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.checkpointTimestamp--;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.receiptCanonical = false;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.receiptStatus = "reverted";
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.mintRecipient = zeroAddress;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.receiptLogIndex++;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.recentTransfers.push({
        blockNumber: 101n,
        logIndex: 0,
        removed: false
      });
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.recentTransfers.push({
        blockNumber: null,
        logIndex: null,
        removed: false
      });
    }
  ]) {
    const fixture = await admissionFixture();
    mutate(fixture);
    await assert.rejects(fixture.inspect());
  }
});

test("OpenSea chain admission checks exact deployment, ownership, funding, cancellation and signature", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.chainId = 56;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.code = "0x6000";
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.channel = false;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.conduit = zeroAddress;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.owner = zeroAddress;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.counter++;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.cancelled = true;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.filled = 1n;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.approved = false;
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.input.signature = "0x1234";
    },
    (f: Awaited<ReturnType<typeof admissionFixture>>) => {
      f.state.headTimestamp -= 100n;
    }
  ]) {
    const fixture = await admissionFixture();
    mutate(fixture);
    await assert.rejects(fixture.inspect());
  }
  for (const field of ["balance", "allowance"] as const) {
    const fixture = await admissionFixture("polygon", "offer");
    fixture.state[field] = 0n;
    await assert.rejects(fixture.inspect(), /offer_funding_required/);
  }
  const contract = await admissionFixture("base", "offer");
  contract.input.signature = "0x1234";
  contract.state.erc1271 = true;
  await contract.inspect();
  contract.state.signatureValid = false;
  await assert.rejects(contract.inspect(), /invalid_maker_signature/);
  contract.state.zoneCode = "0x";
  await assert.rejects(contract.inspect(), /provider_zone_unavailable/);
});

test("a reorg during retained-receipt verification invalidates the entire admission observation", async () => {
  const fixture = await admissionFixture();
  fixture.state.afterReceipt = async () => {
    fixture.state.headHash = `0x${"ff".repeat(32)}`;
  };
  await assert.rejects(fixture.inspect(), /observation_expired/);
});

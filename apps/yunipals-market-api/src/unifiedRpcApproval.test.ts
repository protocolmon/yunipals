import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { UnifiedRpcProfile } from "../../../packages/yunipals-indexer-server/src/rpc-policy";
import { validateUnifiedRpcApproval } from "@/unifiedRpcApproval";

const now = Date.parse("2026-11-02T10:00:00.000Z");
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "approval-test",
  coordinatorId: randomUUID(),
  reviewId: randomUUID(),
  limits: { batchCalls: 10, logRange: 500, addresses: 10, topicValues: 10 },
  manifest: {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [
      {
        id: "ownership:base",
        feature: "ownership",
        chainId: 8453,
        contractName: "YunipalsBase",
        address: `0x${"12".repeat(20)}`,
        startBlock: "100",
        endBlock: null,
        enabled: true,
        abiHash: `0x${"34".repeat(32)}`,
        events: ["Transfer"],
        receiptRequirement: "full",
        policies: [{ kind: "latest" }]
      }
    ]
  }
};
const temporary = {
  profile,
  expiresAt: new Date(now + 3600000).toISOString(),
  permits: []
};
const service = { ...temporary, lifecycle: "service", expiresAt: null };

test("legacy approvals remain temporary and service approval is explicit", () => {
  assert.equal(
    validateUnifiedRpcApproval(temporary, now).lifecycle,
    "temporary"
  );
  assert.equal(validateUnifiedRpcApproval(service, now).expiresAt, null);
  for (const input of [
    { ...service, profile: { ...profile, reviewId: undefined } },
    { ...service, expiresAt: temporary.expiresAt },
    { ...temporary, expiresAt: null },
    { ...temporary, expiresAt: "infinity" },
    { ...temporary, expiresAt: new Date(now - 1).toISOString() },
    { ...temporary, expiresAt: new Date(now + 31 * 86400000).toISOString() },
    { ...service, lifecycle: "permanent-replay" },
    { ...service, maximumCu: 1000000000 }
  ])
    assert.throws(() => validateUnifiedRpcApproval(input, now));
});

test("service approval retains finite one-day replay limits and reviewed chains", () => {
  const permit = {
    permitId: `0x${"56".repeat(32)}`,
    chainId: 8453,
    fromBlock: "100",
    throughBlock: "1000",
    maximumCu: 120,
    expiresAt: new Date(now + 3600000).toISOString()
  };
  assert.equal(
    validateUnifiedRpcApproval({ ...service, permits: [permit] }, now).permits
      .length,
    1
  );
  for (const changed of [
    { expiresAt: null },
    { expiresAt: "infinity" },
    { expiresAt: new Date(now + 86400001).toISOString() },
    { maximumCu: 0 },
    { maximumCu: 1000000001 },
    { fromBlock: "1001" },
    { chainId: 1 }
  ])
    assert.throws(() =>
      validateUnifiedRpcApproval(
        {
          ...service,
          permits: [{ ...permit, ...changed }]
        },
        now
      )
    );
  assert.throws(() =>
    validateUnifiedRpcApproval({ ...service, permits: [permit, permit] }, now)
  );
  assert.throws(() =>
    validateUnifiedRpcApproval(
      {
        ...temporary,
        expiresAt: new Date(now + 1000).toISOString(),
        permits: [permit]
      },
      now
    )
  );
});

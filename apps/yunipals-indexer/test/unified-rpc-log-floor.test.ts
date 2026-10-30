import { expect, it } from "vitest";
import { buildSourceManifest } from "../lib/unified/sources.js";
import { reviewedLogRange } from "../lib/unified/rpc-log-floor.js";
import {
  validateUnifiedRpcCalls,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";
const older = `0x${"12".repeat(20)}`,
  newer = `0x${"34".repeat(20)}`;
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "log-floor-test",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({
    UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([
      { address: older, startBlock: 50 },
      { address: newer, startBlock: 100 }
    ])
  }),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const call = (
  from: string,
  to: string,
  address: string | string[] = newer
) => ({
  method: "eth_getLogs",
  params: [{ address, fromBlock: from, toBlock: to }]
});
it("skips only known pre-deployment history and preserves the first deployed block", () => {
  expect(reviewedLogRange(call("0x32", "0x63"), profile, 8453)).toBeNull();
  expect(reviewedLogRange(call("0x0", "0x63"), profile, 8453)).toBeNull();
  const crossing = reviewedLogRange(call("0x32", "0x65"), profile, 8453)!;
  expect(crossing.params).toEqual([
    { address: newer, fromBlock: "0x64", toBlock: "0x65" }
  ]);
  expect(() =>
    validateUnifiedRpcCalls(profile, 8453, [crossing])
  ).not.toThrow();
  const exact = call("0x64", "0x65");
  expect(reviewedLogRange(exact, profile, 8453)).toBe(exact);
});
it("keeps mixed-address history and refuses malformed empty requests", () => {
  const mixed = call("0x32", "0x63", [older, newer]);
  expect(reviewedLogRange(mixed, profile, 8453)).toBe(mixed);
  const unknown = call("0x32", "0x63", `0x${"56".repeat(20)}`);
  expect(reviewedLogRange(unknown, profile, 8453)).toBe(unknown);
  expect(() => validateUnifiedRpcCalls(profile, 8453, [unknown])).toThrow();
  const malformed = {
    method: "eth_getLogs",
    params: [{ ...call("0x32", "0x63").params[0], topics: ["invalid"] }]
  };
  expect(() => reviewedLogRange(malformed, profile, 8453)).toThrow("topic");
  expect(() =>
    reviewedLogRange(call("0x32", "0x300"), profile, 8453)
  ).toThrow();
  const foreign = call("0x32", "0x63");
  expect(reviewedLogRange(foreign, profile, 1)).toBe(foreign);
});

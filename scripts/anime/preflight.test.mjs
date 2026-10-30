import assert from "node:assert/strict";
import { test } from "node:test";
import { animeLaunchBlockers } from "./preflight.mjs";

const complete = {
  chainId: 8453,
  registry: `0x${"1".repeat(40)}`,
  arena: `0x${"2".repeat(40)}`,
  registryDeploymentBlock: "100",
  arenaDeploymentBlock: "101",
  rulesHash: `0x${"a".repeat(64)}`,
  remainingLiveAcceptance: []
};
test("launch refuses placeholders, wrong chains and incomplete live acceptance", () => {
  assert.deepEqual(animeLaunchBlockers(complete), []);
  for (const change of [
    { chainId: 1 },
    { registry: null },
    { arena: `0x${"0".repeat(40)}` },
    { registryDeploymentBlock: 0 },
    { arenaDeploymentBlock: "PLACEHOLDER" },
    { rulesHash: `0x${"0".repeat(64)}` },
    { arena: complete.registry },
    { remainingLiveAcceptance: ["paid pilot"] },
    { remainingLiveAcceptance: null }
  ])
    assert.ok(animeLaunchBlockers({ ...complete, ...change }).length > 0);
});

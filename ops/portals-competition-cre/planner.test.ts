import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { recoveryIndices, settlementReport } from "./planner.ts";

test("recovery rotates past failed batches, including a non-divisible queue length", () => {
  assert.deepEqual(recoveryIndices(0n, 0n), []);
  assert.deepEqual(recoveryIndices(2n, 1n), [1n, 0n]);
  const seen = new Set<string>();
  for (let minute = 0n; minute < 12n; minute++) {
    const indices = recoveryIndices(12n, minute);
    assert.equal(indices.length, 3);
    assert.equal(new Set(indices).size, 3);
    indices.forEach((i) => seen.add(String(i)));
  }
  assert.equal(seen.size, 12);
});

test("reports bind the chain, pool, rules and batch without allowing custom winners or amounts", () => {
  const pool = `0x${"1".repeat(40)}` as const,
    rules = `0x${"2".repeat(64)}` as const;
  const report = settlementReport(8453, pool, rules, 7n);
  assert.deepEqual(
    decodeAbiParameters(
      parseAbiParameters("uint256,address,bytes32,uint256"),
      report
    ),
    [8453n, pool, rules, 7n]
  );
  assert.notEqual(report, settlementReport(84532, pool, rules, 7n));
  assert.throws(() => settlementReport(8453, pool, rules, 0n));
});

import { describe, expect, it } from "vitest";
import { assertBoosterVrfLimits } from "../lib/boosters/vrf-preflight.js";

const rules = {
  baseGas: 450000,
  perMintGas: 250000,
  maxBatch: 7,
  confirmations: 3
};
const limits = {
  configured: true,
  disabled: false,
  wrapperGasOverhead: 61904,
  maxNumWords: 1,
  keyHash: `0x${"ab".repeat(32)}`,
  maxGasLimit: 2500000,
  minimumConfirmations: 0,
  maximumConfirmations: 200
};

describe("live VRF activation preflight", () => {
  it("includes EIP-150 and wrapper gas at the exact coordinator boundary", () => {
    const ceiling = { ...rules, baseGas: 650000 };
    expect(assertBoosterVrfLimits(ceiling, limits).remainingGas).toBe(0);
    expect(() =>
      assertBoosterVrfLimits(ceiling, { ...limits, wrapperGasOverhead: 61905 })
    ).toThrow("gas limit");
    expect(assertBoosterVrfLimits(rules, limits).callbackGas).toBe(2200000);
  });
  it("fails closed on disabled, unconfigured or unusable wrappers", () => {
    for (const change of [
      { disabled: true },
      { configured: false },
      { maxNumWords: 0 },
      { keyHash: `0x${"00".repeat(32)}` }
    ])
      expect(() =>
        assertBoosterVrfLimits(rules, { ...limits, ...change })
      ).toThrow();
  });
  it("respects live coordinator bounds, including a raised minimum", () => {
    expect(() =>
      assertBoosterVrfLimits(rules, { ...limits, minimumConfirmations: 4 })
    ).toThrow("confirmations");
    expect(() =>
      assertBoosterVrfLimits({ ...rules, confirmations: 201 }, limits)
    ).toThrow("confirmations");
  });
});

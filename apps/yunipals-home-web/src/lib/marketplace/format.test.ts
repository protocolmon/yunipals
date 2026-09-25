import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnits, zeroAddress } from "viem";

import {
  formatMarketAmount,
  formatMarketCardAmount
} from "@/lib/marketplace/format";

const order = {
  currency: { address: zeroAddress, decimals: 18, symbol: "ETH" }
};

test("card prices round to three significant digits while review amounts stay exact", () => {
  for (const [exact, display] of [
    ["0.000116999", "≈ 0.000117 ETH"],
    ["0.012345", "≈ 0.0123 ETH"],
    ["1.234567", "≈ 1.23 ETH"],
    ["0.0009995", "≈ 0.001 ETH"],
    ["9.995", "≈ 10 ETH"],
    ["1.23", "1.23 ETH"],
    ["10", "10 ETH"],
    ["0", "0 ETH"],
    ["0.000000000000000001", "0.000000000000000001 ETH"],
    ["0.000000000000001235", "≈ 0.00000000000000124 ETH"]
  ]) {
    const value = parseUnits(exact, 18).toString();
    assert.equal(formatMarketCardAmount(value, order), display);
    assert.equal(formatMarketAmount(value, order), `${exact} ETH`);
  }
});

test("card formatting respects currency decimals and integers beyond floating-point precision", () => {
  const usdc = { currency: { ...order.currency, decimals: 6, symbol: "USDC" } };
  assert.equal(formatMarketCardAmount("1234567", usdc), "≈ 1.23 USDC");
  assert.equal(formatMarketAmount("1234567", usdc), "1.234567 USDC");
  const integer = {
    currency: { ...order.currency, decimals: 0, symbol: "TOKEN" }
  };
  assert.equal(
    formatMarketCardAmount("9007199254740993", integer),
    "≈ 9010000000000000 TOKEN"
  );
  assert.equal(
    formatMarketAmount("9007199254740993", integer),
    "9007199254740993 TOKEN"
  );
});

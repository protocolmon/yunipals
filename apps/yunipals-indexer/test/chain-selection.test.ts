import { describe, expect, it } from "vitest";
import { chainSelection } from "../lib/api/chains.js";

describe("chain selection", () => {
  it("defaults to every chain", () => {
    expect(chainSelection("https://api.test/v1/tokens")).toMatchObject({
      chain: null, chains: ["ethereum", "base", "polygon", "bnb"], scope: "all"
    });
  });

  it("normalizes order and duplicates", () => {
    const first = chainSelection("https://api.test/v1/tokens?chain=base&chain=ethereum&chain=base");
    const second = chainSelection("https://api.test/v1/tokens?chain=ethereum&chain=base");
    expect(first).toEqual(second);
    expect(first).toMatchObject({ chain: null, chains: ["ethereum", "base"], scope: "ethereum+base" });
  });

  it("retains the scalar response for one chain and rejects invalid values", () => {
    expect(chainSelection("https://api.test/v1/tokens?chain=base")).toMatchObject({ chain: "base", chains: ["base"], scope: "base" });
    expect(chainSelection("https://api.test/v1/tokens?chain=base&chain=nope")).toBeUndefined();
    expect(chainSelection("https://api.test/v1/tokens?chain=")).toBeUndefined();
  });
});

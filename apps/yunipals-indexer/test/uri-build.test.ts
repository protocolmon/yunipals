import { describe, expect, it } from "vitest";
import { buildTokenUri } from "../lib/uri/build.js";

describe("buildTokenUri", () => {
  it("assembles the verified current URI formula", () => {
    expect(buildTokenUri("1000000000000"))
      .toBe("https://meta.polkamon.com/meta?id=1000000000000");
  });

  it("preserves arbitrarily large decimal token IDs", () => {
    expect(buildTokenUri("999999999999999999999999999999"))
      .toBe("https://meta.polkamon.com/meta?id=999999999999999999999999999999");
  });

  it("rejects non-decimal input", () => {
    expect(() => buildTokenUri("0x123")).toThrow("decimal integer");
  });
});

import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "../lib/safe-error.js";

describe("safeErrorMessage", () => {
  it("removes HTTP and WebSocket RPC credentials", () => {
    expect(safeErrorMessage(new Error("URL: https://bnb-mainnet.g.alchemy.com/v2/secret-key timeout")))
      .toBe("URL: <redacted-rpc-url> timeout");
    expect(safeErrorMessage("wss://bnb-mainnet.g.alchemy.com/v2/another-secret disconnected"))
      .toBe("<redacted-rpc-url> disconnected");
  });
});
